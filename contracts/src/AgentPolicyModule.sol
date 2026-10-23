// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IPriceFeed} from "./interfaces/IPriceFeed.sol";

interface IOwned {
    function owner() external view returns (address);
}

/// @title AgentPolicyModule
/// @notice Deterministic spending rules for agent-initiated payments from an AgentAccount.
///         The AI never approves a payment: it can only ask the account to pay a quote, and
///         the account asks this module, which checks every limit on-chain.
///
///         Values are accounted in USD with 6 decimals. ETH is valued with a Chainlink-style
///         feed that must be fresh and positive. USDG uses its own feed when configured; with no
///         feed it is counted 1:1, which is why the USDG feed should be set before mainnet.
/// @dev    UNAUDITED.
contract AgentPolicyModule is Ownable2Step {
    uint8 public constant ASSET_USDG = 1;
    uint8 public constant ASSET_ETH = 2;
    uint256 public constant MAX_TRACKED_SPENDS = 64;

    struct Policy {
        uint128 maxPerOrderUsd; // 6 decimals
        uint128 rollingLimitUsd; // 6 decimals
        uint40 window; // seconds
        uint40 expiresAt;
        uint8 allowedAssets; // bitmask
        bool merchantAllowlist; // when true, only allowedMerchant[seller]
        bool revoked;
        uint64 nonce; // increments on every authorised spend and on every policy change
    }

    struct Spend {
        uint40 at;
        uint128 usd;
    }

    address public immutable usdg;
    IPriceFeed public ethUsdFeed;
    IPriceFeed public usdgUsdFeed; // optional
    uint256 public maxFeedAge = 1 hours;

    mapping(address account => Policy) public policies;
    mapping(address account => mapping(address seller => bool)) public allowedMerchant;
    mapping(address account => Spend[]) internal _spends;

    event PolicySet(address indexed account, Policy policy);
    event MerchantAllowed(address indexed account, address indexed seller, bool allowed);
    event PolicyRevoked(address indexed account);
    event SpendAuthorized(address indexed account, address indexed seller, address token, uint256 amount, uint256 usd, uint64 nonce);
    event FeedsSet(address ethUsdFeed, address usdgUsdFeed, uint256 maxFeedAge);

    error NotAccountOwner();
    error NotAccount();
    error Revoked();
    error Expired();
    error AssetNotAllowed();
    error MerchantNotAllowed();
    error OverPerOrderLimit(uint256 usd, uint256 limit);
    error OverRollingLimit(uint256 wouldSpend, uint256 limit);
    error StaleNonce(uint64 expected, uint64 actual);
    error BadPrice();
    error TooManySpends();
    error BadPolicy();

    constructor(address owner_, address usdg_, IPriceFeed ethUsdFeed_) Ownable(owner_) {
        usdg = usdg_;
        ethUsdFeed = ethUsdFeed_;
    }

    modifier onlyAccountOwner(address account) {
        if (msg.sender != account && msg.sender != IOwned(account).owner()) revert NotAccountOwner();
        _;
    }

    // ------------------------------------------------------- owner controls

    function setPolicy(address account, Policy calldata p) external onlyAccountOwner(account) {
        if (p.maxPerOrderUsd == 0 || p.rollingLimitUsd < p.maxPerOrderUsd || p.window == 0 || p.window > 90 days) revert BadPolicy();
        if (p.expiresAt <= block.timestamp || p.allowedAssets == 0 || p.allowedAssets > 3) revert BadPolicy();
        Policy storage cur = policies[account];
        uint64 nextNonce = cur.nonce + 1;
        policies[account] = Policy({
            maxPerOrderUsd: p.maxPerOrderUsd,
            rollingLimitUsd: p.rollingLimitUsd,
            window: p.window,
            expiresAt: p.expiresAt,
            allowedAssets: p.allowedAssets,
            merchantAllowlist: p.merchantAllowlist,
            revoked: false,
            nonce: nextNonce
        });
        emit PolicySet(account, policies[account]);
    }

    function setMerchant(address account, address seller, bool allowed) external onlyAccountOwner(account) {
        allowedMerchant[account][seller] = allowed;
        policies[account].nonce += 1;
        emit MerchantAllowed(account, seller, allowed);
    }

    /// @notice Immediately stops all agent spending for the account.
    function revoke(address account) external onlyAccountOwner(account) {
        policies[account].revoked = true;
        policies[account].nonce += 1;
        emit PolicyRevoked(account);
    }

    // ------------------------------------------------------- enforcement

    /// @notice Called by the AgentAccount itself before paying a quote. Reverts unless every rule passes.
    /// @param expectedNonce the nonce the agent read when it prepared the payment; a retry after success
    ///        (or after any owner change) fails instead of paying twice.
    function authorize(address seller, address token, uint256 amount, uint64 expectedNonce) external returns (uint256 usd) {
        address account = msg.sender;
        Policy storage p = policies[account];
        if (p.maxPerOrderUsd == 0) revert NotAccount();
        if (p.revoked) revert Revoked();
        if (block.timestamp >= p.expiresAt) revert Expired();
        if (p.nonce != expectedNonce) revert StaleNonce(expectedNonce, p.nonce);

        uint8 bit = token == address(0) ? ASSET_ETH : (token == usdg ? ASSET_USDG : 0);
        if (bit == 0 || p.allowedAssets & bit == 0) revert AssetNotAllowed();
        if (p.merchantAllowlist && !allowedMerchant[account][seller]) revert MerchantNotAllowed();

        usd = valueUsd(token, amount);
        if (usd > p.maxPerOrderUsd) revert OverPerOrderLimit(usd, p.maxPerOrderUsd);

        uint256 spent = _pruneAndSum(account, p.window);
        if (spent + usd > p.rollingLimitUsd) revert OverRollingLimit(spent + usd, p.rollingLimitUsd);
        if (_spends[account].length >= MAX_TRACKED_SPENDS) revert TooManySpends();

        _spends[account].push(Spend(uint40(block.timestamp), uint128(usd)));
        p.nonce += 1;
        emit SpendAuthorized(account, seller, token, amount, usd, p.nonce);
    }

    /// @notice USD value (6 decimals) of `amount` of `token`, rounded up so limits are conservative.
    function valueUsd(address token, uint256 amount) public view returns (uint256) {
        if (token == address(0)) {
            (uint256 px, uint8 dec) = _price(ethUsdFeed);
            // amount (18 dec) * px (dec) → 6 dec
            return _ceilDiv(amount * px, 10 ** (18 + dec - 6));
        }
        if (token == usdg) {
            if (address(usdgUsdFeed) == address(0)) return amount; // USDG has 6 decimals
            (uint256 px, uint8 dec) = _price(usdgUsdFeed);
            return _ceilDiv(amount * px, 10 ** dec);
        }
        revert AssetNotAllowed();
    }

    function spentInWindow(address account) external view returns (uint256 total) {
        Spend[] storage s = _spends[account];
        uint256 cutoff = block.timestamp > policies[account].window ? block.timestamp - policies[account].window : 0;
        for (uint256 i; i < s.length; ++i) if (s[i].at > cutoff) total += s[i].usd;
    }

    function _pruneAndSum(address account, uint40 window) internal returns (uint256 total) {
        Spend[] storage s = _spends[account];
        uint256 cutoff = block.timestamp > window ? block.timestamp - window : 0;
        uint256 i;
        while (i < s.length) {
            if (s[i].at <= cutoff) {
                s[i] = s[s.length - 1];
                s.pop();
            } else {
                total += s[i].usd;
                ++i;
            }
        }
    }

    function _price(IPriceFeed feed) internal view returns (uint256, uint8) {
        if (address(feed) == address(0)) revert BadPrice();
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || answeredInRound < roundId) revert BadPrice();
        if (block.timestamp - updatedAt > maxFeedAge) revert BadPrice();
        return (uint256(answer), feed.decimals());
    }

    function _ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    // ------------------------------------------------------- protocol admin

    function setFeeds(IPriceFeed eth, IPriceFeed usdgFeed, uint256 maxAge) external onlyOwner {
        if (maxAge == 0 || maxAge > 1 days) revert BadPrice();
        ethUsdFeed = eth;
        usdgUsdFeed = usdgFeed;
        maxFeedAge = maxAge;
        emit FeedsSet(address(eth), address(usdgFeed), maxAge);
    }
}
