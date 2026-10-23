// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {AgentAccount} from "./AgentAccount.sol";
import {CommerceEscrow} from "./CommerceEscrow.sol";
import {AgentPolicyModule} from "./AgentPolicyModule.sol";

/// @title AgentAccountFactory
/// @notice Deploys AgentAccounts at deterministic addresses (CREATE2) bound to this
///         deployment's escrow and policy module.
contract AgentAccountFactory {
    CommerceEscrow public immutable escrow;
    AgentPolicyModule public immutable policy;

    event AccountCreated(address indexed account, address indexed owner, uint256 salt);

    constructor(CommerceEscrow escrow_, AgentPolicyModule policy_) {
        escrow = escrow_;
        policy = policy_;
    }

    /// @notice Deploy (or return the existing) account for msg.sender. Only the owner can create
    ///         their own account, so nobody can front-run a user into an account they don't control.
    function createAccount(uint256 salt) external returns (AgentAccount account) {
        address predicted = accountAddress(msg.sender, salt);
        if (predicted.code.length > 0) return AgentAccount(payable(predicted));
        account = new AgentAccount{salt: _salt(msg.sender, salt)}(msg.sender, escrow, policy);
        emit AccountCreated(address(account), msg.sender, salt);
    }

    function accountAddress(address owner, uint256 salt) public view returns (address) {
        bytes32 codeHash = keccak256(abi.encodePacked(type(AgentAccount).creationCode, abi.encode(owner, escrow, policy)));
        return Create2.computeAddress(_salt(owner, salt), codeHash);
    }

    function _salt(address owner, uint256 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }
}
