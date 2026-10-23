// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CommerceEscrow} from "../src/CommerceEscrow.sol";
import {FeeController} from "../src/FeeController.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {Treasury} from "../src/Treasury.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";
import {AgentPolicyModule} from "../src/AgentPolicyModule.sol";
import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
import {TestUSDG} from "../src/mocks/TestUSDG.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";

/// @notice Deploys Commerce OS.
///   Env: DEPLOYER_PRIVATE_KEY, QUOTE_SIGNER (address), REGISTRAR (address, the API's registry key),
///        ADMIN (multisig; defaults to deployer on dev chains only), ARBITER, USDG_ADDRESS (mainnet),
///        ETH_USD_FEED (mainnet), SEED_MERCHANTS (comma-separated payout addresses, dev only).
///   Refuses to run on mainnet (4663) without USDG_ADDRESS, ETH_USD_FEED, and an ADMIN distinct from the deployer.
contract Deploy is Script {
    struct Cfg {
        uint256 pk;
        address deployer;
        address admin;
        address quoteSigner;
        address registrar;
        address arbiter;
        address usdg;
        address ethFeed;
        bool mainnet;
        bool testToken;
    }

    struct Out {
        Treasury treasury;
        FeeController fees;
        MerchantRegistry registry;
        CommerceEscrow escrow;
        DisputeResolver resolver;
        AgentPolicyModule policy;
        AgentAccountFactory factory;
    }

    function run() external {
        Cfg memory c;
        c.pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        c.deployer = vm.addr(c.pk);
        c.admin = vm.envOr("ADMIN", c.deployer);
        c.quoteSigner = vm.envAddress("QUOTE_SIGNER");
        c.registrar = vm.envOr("REGISTRAR", c.deployer);
        c.arbiter = vm.envOr("ARBITER", c.admin);
        c.mainnet = block.chainid == 4663;
        c.usdg = vm.envOr("USDG_ADDRESS", address(0));
        c.ethFeed = vm.envOr("ETH_USD_FEED", address(0));
        if (c.mainnet) {
            require(c.usdg != address(0) && c.ethFeed != address(0), "mainnet needs USDG_ADDRESS and ETH_USD_FEED");
            require(c.admin != c.deployer, "mainnet ADMIN must be a multisig, not the deployer");
        }

        vm.startBroadcast(c.pk);
        c.testToken = c.usdg == address(0);
        if (c.testToken) c.usdg = address(new TestUSDG());
        if (c.ethFeed == address(0)) c.ethFeed = address(new MockPriceFeed(8, 2_500e8));
        Out memory o = _deploy(c);
        _wire(c, o);
        vm.stopBroadcast();
        _write(c, o);
    }

    function _deploy(Cfg memory c) internal returns (Out memory o) {
        o.treasury = new Treasury(c.admin);
        o.fees = new FeeController(c.deployer, address(o.treasury), 200);
        o.registry = new MerchantRegistry(c.deployer);
        o.escrow = new CommerceEscrow(c.deployer, c.usdg, o.fees, o.registry, c.quoteSigner);
        o.resolver = new DisputeResolver(c.deployer, o.escrow);
        o.policy = new AgentPolicyModule(c.deployer, c.usdg, IPriceFeed(c.ethFeed));
        o.factory = new AgentAccountFactory(o.escrow, o.policy);
    }

    function _wire(Cfg memory c, Out memory o) internal {
        o.escrow.setDisputeResolver(address(o.resolver));
        o.registry.grantRole(o.registry.REGISTRAR_ROLE(), c.registrar);
        o.resolver.grantRole(o.resolver.ARBITER_ROLE(), c.arbiter);
        o.resolver.grantRole(o.resolver.APPEALS_ROLE(), c.admin);

        if (!c.mainnet) {
            o.registry.grantRole(o.registry.REGISTRAR_ROLE(), c.deployer);
            address[] memory seeds = vm.envOr("SEED_MERCHANTS", ",", new address[](0));
            for (uint256 i; i < seeds.length; ++i) {
                o.registry.setMerchant(seeds[i], keccak256(abi.encode(seeds[i])), true, true);
            }
        }

        // Hand ownership to the admin (two-step for Ownable2Step contracts: admin must accept).
        if (c.admin != c.deployer) {
            o.fees.transferOwnership(c.admin);
            o.escrow.transferOwnership(c.admin);
            o.policy.transferOwnership(c.admin);
            o.registry.grantRole(o.registry.DEFAULT_ADMIN_ROLE(), c.admin);
            o.resolver.grantRole(o.resolver.DEFAULT_ADMIN_ROLE(), c.admin);
            o.registry.renounceRole(o.registry.DEFAULT_ADMIN_ROLE(), c.deployer);
            o.resolver.renounceRole(o.resolver.DEFAULT_ADMIN_ROLE(), c.deployer);
        }
    }

    function _write(Cfg memory c, Out memory o) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "deployedAtBlock", block.number);
        vm.serializeBool(k, "testToken", c.testToken);
        vm.serializeAddress(k, "usdg", c.usdg);
        vm.serializeAddress(k, "escrow", address(o.escrow));
        vm.serializeAddress(k, "merchantRegistry", address(o.registry));
        vm.serializeAddress(k, "feeController", address(o.fees));
        vm.serializeAddress(k, "treasury", address(o.treasury));
        vm.serializeAddress(k, "disputeResolver", address(o.resolver));
        vm.serializeAddress(k, "policyModule", address(o.policy));
        vm.serializeAddress(k, "accountFactory", address(o.factory));
        string memory json = vm.serializeAddress(k, "priceFeed", c.ethFeed);
        string memory path = string.concat("../packages/blockchain/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("deployment written to", path);
    }
}
