// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice NO-VALUE TEST TOKEN for local and testnet use only. Mirrors USDG's 6 decimals.
///         Anyone may mint from the faucet, capped per call.
contract TestUSDG is ERC20 {
    uint256 public constant FAUCET_MAX = 10_000e6;

    constructor() ERC20("Test USDG (no value)", "tUSDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet(address to, uint256 amount) external {
        require(amount <= FAUCET_MAX, "faucet cap");
        _mint(to, amount);
    }
}
