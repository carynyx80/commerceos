// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {FeeController} from "./FeeController.sol";
import {MerchantRegistry} from "./MerchantRegistry.sol";

/// @title CommerceEscrow
/// @notice Holds a buyer's payment for one order until the order is released to the seller,
///         refunded to the buyer, or split by the dispute resolver. Supports one ERC-20
///         (USDG) and native ETH. Escrowed funds can only ever go to that order's buyer,
///         seller, or (fee only) the treasury: no admin function can move them.
/// @dev    UNAUDITED. Do not hold unrestricted real user funds before an independent audit.
contract CommerceEscrow is Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Funded,
        Accepted,
        Fulfilled,
        Released,
        Refunded,
        Disputed
    }

    /// @notice Server-signed, time-limited checkout quote. `token` is address(0) for ETH.
    struct Quote {
        bytes32 orderId;
        address buyer;
        address seller;
        address token;
        uint256 amount;
        uint256 deadline;
        bytes32 termsHash;
    }

    struct Order {
        address buyer;
        address seller;
        address token;
        uint96 amount; // fits 79B USDG or 79B ETH
        uint16 feeBps; // snapshot at funding
        Status status;
        uint40 fundedAt;
        uint40 acceptedAt;
        uint40 fulfilledAt;
        bytes32 termsHash;
    }

    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(bytes32 orderId,address buyer,address seller,address token,uint256 amount,uint256 deadline,bytes32 termsHash)"
    );

    FeeController public immutable feeController;
    MerchantRegistry public immutable registry;
    /// @notice The only ERC-20 accepted (USDG).
    address public immutable stableToken;

    address public quoteSigner;
    address public disputeResolver;
    address public pauser;

    /// @notice Seller must accept within this window or the buyer may cancel for a refund.
    uint40 public acceptWindow = 3 days;
    /// @notice After accepting, seller must mark fulfilled within this window or the buyer may cancel.
    uint40 public fulfillWindow = 21 days;
    /// @notice After fulfilment, buyer has this long to confirm or dispute; afterwards anyone may release.
    uint40 public confirmWindow = 7 days;

    mapping(bytes32 orderId => Order) internal _orders;
    /// @notice Funds that could not be pushed (e.g. reverting receiver); claimable by `withdraw`.
    mapping(address account => mapping(address token => uint256)) public owed;
    /// @notice Sum of all value this contract is responsible for, per token (escrow + owed).
    mapping(address token => uint256) public liabilities;

    event OrderFunded(
        bytes32 indexed orderId, address indexed buyer, address indexed seller, address token, uint256 amount, uint16 feeBps, bytes32 termsHash
    );
    event OrderAccepted(bytes32 indexed orderId);
    event OrderFulfilled(bytes32 indexed orderId);
    event OrderReleased(bytes32 indexed orderId, uint256 sellerAmount, uint256 feeAmount);
    event OrderRefunded(bytes32 indexed orderId, uint256 amount, uint8 reason);
    event OrderDisputed(bytes32 indexed orderId, address indexed by);
    event DisputeResolved(bytes32 indexed orderId, uint256 buyerAmount, uint256 sellerAmount, uint256 feeAmount);
    event Credited(address indexed account, address indexed token, uint256 amount);
    event Withdrawn(address indexed account, address indexed token, uint256 amount);
    event QuoteSignerSet(address signer);
    event DisputeResolverSet(address resolver);
    event PauserSet(address pauser);
    event WindowsSet(uint40 acceptWindow, uint40 fulfillWindow, uint40 confirmWindow);

    // Refund reasons
    uint8 public constant REFUND_SELLER_CANCEL = 1;
    uint8 public constant REFUND_ACCEPT_TIMEOUT = 2;
    uint8 public constant REFUND_FULFIL_TIMEOUT = 3;

    error QuoteExpired();
    error BadSignature();
    error NotBuyer();
    error NotSeller();
    error NotResolver();
    error NotPauser();
    error OrderExists();
    error WrongStatus(Status status);
    error UnsupportedToken();
    error WrongAmount();
    error MerchantInactive();
    error TooEarly();
    error TooLate();
    error ZeroAddress();
    error AmountTooLarge();
    error BadShare();
    error EthTransferFailed();
    error NothingOwed();
    error BadWindow();

    constructor(address owner_, address stableToken_, FeeController fees_, MerchantRegistry registry_, address quoteSigner_)
        Ownable(owner_)
        EIP712("CommerceOS Escrow", "1")
    {
        if (stableToken_ == address(0) || address(fees_) == address(0) || address(registry_) == address(0) || quoteSigner_ == address(0)) {
            revert ZeroAddress();
        }
        stableToken = stableToken_;
        feeController = fees_;
        registry = registry_;
        quoteSigner = quoteSigner_;
        pauser = owner_;
    }

    // ----------------------------------------------------------------- funding

    /// @notice Pay a quote in USDG. Caller must be the quote's buyer and have approved `amount`.
    function payWithToken(Quote calldata q, bytes calldata signature) external nonReentrant whenNotPaused {
        if (q.token != stableToken) revert UnsupportedToken();
        _checkQuote(q, signature);
        uint256 beforeBal = IERC20(q.token).balanceOf(address(this));
        IERC20(q.token).safeTransferFrom(msg.sender, address(this), q.amount);
        // Reject fee-on-transfer or otherwise short transfers.
        if (IERC20(q.token).balanceOf(address(this)) - beforeBal != q.amount) revert WrongAmount();
        _fund(q);
    }

    /// @notice Pay a quote in native ETH. `msg.value` must equal the quoted amount exactly.
    function payWithEth(Quote calldata q, bytes calldata signature) external payable nonReentrant whenNotPaused {
        if (q.token != address(0)) revert UnsupportedToken();
        if (msg.value != q.amount) revert WrongAmount();
        _checkQuote(q, signature);
        _fund(q);
    }

    function _checkQuote(Quote calldata q, bytes calldata signature) internal view {
        if (block.timestamp > q.deadline) revert QuoteExpired();
        if (msg.sender != q.buyer) revert NotBuyer();
        if (q.amount == 0) revert WrongAmount();
        if (q.amount > type(uint96).max) revert AmountTooLarge();
        if (q.seller == address(0) || q.seller == q.buyer) revert ZeroAddress();
        if (_orders[q.orderId].status != Status.None) revert OrderExists();
        if (!registry.isActive(q.seller)) revert MerchantInactive();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(QUOTE_TYPEHASH, q.orderId, q.buyer, q.seller, q.token, q.amount, q.deadline, q.termsHash))
        );
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != quoteSigner) revert BadSignature();
    }

    function _fund(Quote calldata q) internal {
        uint16 feeBps = feeController.feeBps();
        _orders[q.orderId] = Order({
            buyer: q.buyer,
            seller: q.seller,
            token: q.token,
            amount: uint96(q.amount),
            feeBps: feeBps,
            status: Status.Funded,
            fundedAt: uint40(block.timestamp),
            acceptedAt: 0,
            fulfilledAt: 0,
            termsHash: q.termsHash
        });
        liabilities[q.token] += q.amount;
        emit OrderFunded(q.orderId, q.buyer, q.seller, q.token, q.amount, feeBps, q.termsHash);
    }

    // ------------------------------------------------------------- lifecycle

    function accept(bytes32 orderId) external whenNotPaused {
        Order storage o = _orders[orderId];
        if (msg.sender != o.seller) revert NotSeller();
        if (o.status != Status.Funded) revert WrongStatus(o.status);
        o.status = Status.Accepted;
        o.acceptedAt = uint40(block.timestamp);
        emit OrderAccepted(orderId);
    }

    function markFulfilled(bytes32 orderId) external whenNotPaused {
        Order storage o = _orders[orderId];
        if (msg.sender != o.seller) revert NotSeller();
        if (o.status != Status.Accepted) revert WrongStatus(o.status);
        o.status = Status.Fulfilled;
        o.fulfilledAt = uint40(block.timestamp);
        emit OrderFulfilled(orderId);
    }

    /// @notice Buyer confirms delivery; seller is paid and the fee goes to the treasury.
    function confirmDelivery(bytes32 orderId) external nonReentrant whenNotPaused {
        Order storage o = _orders[orderId];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.status != Status.Fulfilled && o.status != Status.Accepted) revert WrongStatus(o.status);
        _release(orderId, o);
    }

    /// @notice Anyone may release after the confirmation window passes without a dispute.
    function releaseAfterWindow(bytes32 orderId) external nonReentrant whenNotPaused {
        Order storage o = _orders[orderId];
        if (o.status != Status.Fulfilled) revert WrongStatus(o.status);
        if (block.timestamp < uint256(o.fulfilledAt) + confirmWindow) revert TooEarly();
        _release(orderId, o);
    }

    /// @notice Seller cancels before fulfilment: full refund to the buyer.
    function sellerCancel(bytes32 orderId) external nonReentrant {
        Order storage o = _orders[orderId];
        if (msg.sender != o.seller) revert NotSeller();
        if (o.status != Status.Funded && o.status != Status.Accepted) revert WrongStatus(o.status);
        _refund(orderId, o, REFUND_SELLER_CANCEL);
    }

    /// @notice Buyer cancels when the seller missed the accept or fulfil deadline.
    function buyerCancel(bytes32 orderId) external nonReentrant {
        Order storage o = _orders[orderId];
        if (msg.sender != o.buyer) revert NotBuyer();
        if (o.status == Status.Funded) {
            if (block.timestamp < uint256(o.fundedAt) + acceptWindow) revert TooEarly();
            _refund(orderId, o, REFUND_ACCEPT_TIMEOUT);
        } else if (o.status == Status.Accepted) {
            if (block.timestamp < uint256(o.acceptedAt) + fulfillWindow) revert TooEarly();
            _refund(orderId, o, REFUND_FULFIL_TIMEOUT);
        } else {
            revert WrongStatus(o.status);
        }
    }

    /// @notice Buyer or seller opens a dispute. Funds stay locked until the resolver decides.
    function openDispute(bytes32 orderId) external {
        Order storage o = _orders[orderId];
        if (msg.sender != o.buyer && msg.sender != o.seller) revert NotBuyer();
        if (o.status == Status.Fulfilled) {
            if (block.timestamp >= uint256(o.fulfilledAt) + confirmWindow) revert TooLate();
        } else if (o.status != Status.Funded && o.status != Status.Accepted) {
            revert WrongStatus(o.status);
        }
        o.status = Status.Disputed;
        emit OrderDisputed(orderId, msg.sender);
    }

    /// @notice Called by the DisputeResolver. `buyerBps` of the amount goes back to the buyer;
    ///         the rest goes to the seller, minus the protocol fee on the seller's share.
    function resolveDispute(bytes32 orderId, uint16 buyerBps) external nonReentrant {
        if (msg.sender != disputeResolver) revert NotResolver();
        if (buyerBps > 10_000) revert BadShare();
        Order storage o = _orders[orderId];
        if (o.status != Status.Disputed) revert WrongStatus(o.status);
        uint256 amount = o.amount;
        uint256 toBuyer = (amount * buyerBps) / 10_000;
        uint256 sellerGross = amount - toBuyer;
        uint256 fee = (sellerGross * o.feeBps) / 10_000;
        uint256 toSeller = sellerGross - fee;
        o.status = buyerBps == 10_000 ? Status.Refunded : Status.Released;
        liabilities[o.token] -= amount;
        _send(o.token, o.buyer, toBuyer);
        _send(o.token, o.seller, toSeller);
        _send(o.token, feeController.treasury(), fee);
        emit DisputeResolved(orderId, toBuyer, toSeller, fee);
    }

    /// @notice Claim funds that could not be pushed earlier.
    function withdraw(address token) external nonReentrant {
        uint256 amt = owed[msg.sender][token];
        if (amt == 0) revert NothingOwed();
        owed[msg.sender][token] = 0;
        liabilities[token] -= amt;
        if (token == address(0)) {
            (bool ok,) = msg.sender.call{value: amt}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(msg.sender, amt);
        }
        emit Withdrawn(msg.sender, token, amt);
    }

    // -------------------------------------------------------------- internals

    function _release(bytes32 orderId, Order storage o) internal {
        uint256 amount = o.amount;
        uint256 fee = (amount * o.feeBps) / 10_000;
        uint256 toSeller = amount - fee;
        o.status = Status.Released;
        liabilities[o.token] -= amount;
        _send(o.token, o.seller, toSeller);
        _send(o.token, feeController.treasury(), fee);
        emit OrderReleased(orderId, toSeller, fee);
    }

    function _refund(bytes32 orderId, Order storage o, uint8 reason) internal {
        uint256 amount = o.amount;
        o.status = Status.Refunded;
        liabilities[o.token] -= amount;
        _send(o.token, o.buyer, amount);
        emit OrderRefunded(orderId, amount, reason);
    }

    /// @dev Push payment; if the receiver reverts (or is blocklisted by the token), credit it instead
    ///      so one bad receiver can never lock the other party's funds.
    function _send(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        bool ok;
        if (token == address(0)) {
            // Assembly call so a malicious receiver cannot return-bomb us with huge returndata.
            assembly {
                ok := call(50000, to, amount, 0, 0, 0, 0)
            }
        } else {
            ok = IERC20(token).trySafeTransfer(to, amount);
        }
        if (!ok) {
            owed[to][token] += amount;
            liabilities[token] += amount;
            emit Credited(to, token, amount);
        }
    }

    // ------------------------------------------------------------------ views

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function hashQuote(Quote calldata q) external view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(QUOTE_TYPEHASH, q.orderId, q.buyer, q.seller, q.token, q.amount, q.deadline, q.termsHash))
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------------ admin
    // Owner is intended to be a multisig behind a TimelockController. None of these can move escrowed funds.

    function setQuoteSigner(address s) external onlyOwner {
        if (s == address(0)) revert ZeroAddress();
        quoteSigner = s;
        emit QuoteSignerSet(s);
    }

    function setDisputeResolver(address r) external onlyOwner {
        if (r == address(0)) revert ZeroAddress();
        disputeResolver = r;
        emit DisputeResolverSet(r);
    }

    /// @param p zero disables the separate pauser (owner can still pause).
    function setPauser(address p) external onlyOwner {
        pauser = p;
        emit PauserSet(p);
    }

    function setWindows(uint40 accept_, uint40 fulfil_, uint40 confirm_) external onlyOwner {
        if (accept_ < 1 hours || fulfil_ < 1 days || confirm_ < 1 days || accept_ > 30 days || fulfil_ > 90 days || confirm_ > 30 days) {
            revert BadWindow();
        }
        acceptWindow = accept_;
        fulfillWindow = fulfil_;
        confirmWindow = confirm_;
        emit WindowsSet(accept_, fulfil_, confirm_);
    }

    /// @notice Emergency stop for new payments and releases. Refunds, disputes and withdrawals stay open.
    function pause() external {
        if (msg.sender != pauser && msg.sender != owner()) revert NotPauser();
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
