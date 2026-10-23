// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title MerchantRegistry
/// @notice On-chain list of merchant payout addresses the escrow will pay. Off-chain
///         merchant records (KYC, store profile) stay in the application database.
contract MerchantRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    struct Merchant {
        bytes32 merchantId; // keccak256 of the off-chain merchant id
        bool active;
        bool verified;
    }

    mapping(address payout => Merchant) public merchants;

    event MerchantSet(address indexed payout, bytes32 indexed merchantId, bool active, bool verified);

    error ZeroAddress();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setMerchant(address payout, bytes32 merchantId, bool active, bool verified) external onlyRole(REGISTRAR_ROLE) {
        if (payout == address(0)) revert ZeroAddress();
        merchants[payout] = Merchant(merchantId, active, verified);
        emit MerchantSet(payout, merchantId, active, verified);
    }

    function isActive(address payout) external view returns (bool) {
        return merchants[payout].active;
    }
}
