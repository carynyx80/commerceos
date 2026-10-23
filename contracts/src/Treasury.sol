// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Treasury
/// @notice Receives protocol fees only. It never holds escrowed order funds.
///         Owner is intended to be a multisig behind a timelock.
contract Treasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event Received(address indexed from, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();
    error EthTransferFailed();

    constructor(address owner_) Ownable(owner_) {}

    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /// @param token address(0) for ETH.
    function withdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Withdrawn(token, to, amount);
    }
}
