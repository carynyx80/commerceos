// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice NO-VALUE TEST TOKEN for local and testnet use only. Mirrors a real stablecoin's
///         decimals (USDG: 6, BNB Chain USDC: 18). Anyone may mint from the faucet, capped per call.
contract TestStable is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable faucetMax;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        faucetMax = 10_000 * 10 ** decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function faucet(address to, uint256 amount) external {
        require(amount <= faucetMax, "faucet cap");
        _mint(to, amount);
    }
}
