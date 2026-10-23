// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {CommerceEscrow} from "./CommerceEscrow.sol";
import {AgentPolicyModule} from "./AgentPolicyModule.sol";

/// @title AgentAccount
/// @notice A minimal smart account that holds an agent's spending budget. The owner (the
///         user's own wallet) has full control. The agent key — held by the Commerce OS worker —
///         can do exactly one thing: pay a server-signed escrow quote, and only after
///         AgentPolicyModule approves it. It cannot transfer funds, approve tokens, confirm
///         deliveries or change the policy.
/// @dev    Not an ERC-4337 account: the agent key submits its own transaction and pays gas.
///         Chosen because 4337 bundler/paymaster availability on Robinhood Chain is unverified.
///         UNAUDITED.
contract AgentAccount is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    CommerceEscrow public immutable escrow;
    AgentPolicyModule public immutable policy;
    address public agentKey;

    event AgentKeySet(address indexed agentKey);
    event AgentCheckout(bytes32 indexed orderId, address indexed seller, address token, uint256 amount, uint256 usd);
    event Executed(address indexed target, uint256 value, bytes data);

    error NotAgent();
    error WrongBuyer();

    constructor(address owner_, CommerceEscrow escrow_, AgentPolicyModule policy_) Ownable(owner_) {
        escrow = escrow_;
        policy = policy_;
    }

    receive() external payable {}

    /// @notice Owner-only arbitrary call (withdraw funds, confirm delivery, dispute, change policy).
    function execute(address target, uint256 value, bytes calldata data) external onlyOwner nonReentrant returns (bytes memory) {
        bytes memory ret = Address.functionCallWithValue(target, data, value);
        emit Executed(target, value, data);
        return ret;
    }

    function setAgentKey(address key) external onlyOwner {
        agentKey = key;
        emit AgentKeySet(key);
    }

    /// @notice The only action available to the agent key.
    function agentCheckout(CommerceEscrow.Quote calldata q, bytes calldata signature, uint64 expectedNonce) external nonReentrant {
        if (msg.sender != agentKey || agentKey == address(0)) revert NotAgent();
        if (q.buyer != address(this)) revert WrongBuyer();
        uint256 usd = policy.authorize(q.seller, q.token, q.amount, expectedNonce);
        if (q.token == address(0)) {
            escrow.payWithEth{value: q.amount}(q, signature);
        } else {
            IERC20(q.token).forceApprove(address(escrow), q.amount);
            escrow.payWithToken(q, signature);
            IERC20(q.token).forceApprove(address(escrow), 0);
        }
        emit AgentCheckout(q.orderId, q.seller, q.token, q.amount, usd);
    }
}
