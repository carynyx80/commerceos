// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceFeed} from "../interfaces/IPriceFeed.sol";

/// @notice Test-only price feed. Never deploy to mainnet.
contract MockPriceFeed is IPriceFeed {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public round = 1;
    address public immutable admin;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
        admin = msg.sender;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        require(msg.sender == admin, "admin");
        answer = answer_;
        updatedAt = updatedAt_;
        round++;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, answer, updatedAt, updatedAt, round);
    }
}
