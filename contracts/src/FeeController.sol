// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/// @title FeeController
/// @notice Holds the marketplace fee and the treasury address. Changes are time-delayed so
///         buyers and sellers can see them coming. The escrow snapshots the fee per order.
contract FeeController is Ownable2Step {
    uint16 public constant MAX_FEE_BPS = 1_000; // 10% hard cap
    uint64 public constant MIN_DELAY = 1 days;

    uint16 public feeBps;
    address public treasury;

    uint16 public pendingFeeBps;
    address public pendingTreasury;
    uint64 public pendingAt; // 0 = nothing pending

    event FeeChangeProposed(uint16 feeBps, address treasury, uint64 effectiveAt);
    event FeeChangeApplied(uint16 feeBps, address treasury);
    event FeeChangeCancelled();

    error FeeTooHigh();
    error ZeroAddress();
    error NotReady();

    constructor(address owner_, address treasury_, uint16 feeBps_) Ownable(owner_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        treasury = treasury_;
        feeBps = feeBps_;
        emit FeeChangeApplied(feeBps_, treasury_);
    }

    function proposeChange(uint16 feeBps_, address treasury_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh();
        if (treasury_ == address(0)) revert ZeroAddress();
        pendingFeeBps = feeBps_;
        pendingTreasury = treasury_;
        pendingAt = uint64(block.timestamp) + MIN_DELAY;
        emit FeeChangeProposed(feeBps_, treasury_, pendingAt);
    }

    function applyChange() external onlyOwner {
        if (pendingAt == 0 || block.timestamp < pendingAt) revert NotReady();
        feeBps = pendingFeeBps;
        treasury = pendingTreasury;
        pendingAt = 0;
        emit FeeChangeApplied(feeBps, treasury);
    }

    function cancelChange() external onlyOwner {
        pendingAt = 0;
        emit FeeChangeCancelled();
    }
}
