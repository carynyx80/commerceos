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
import {TestStable} from "../src/mocks/TestStable.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";

/// @notice Deploys Commerce OS on one chain. The same contracts serve Robinhood Chain (USDG + ETH)
///         and BNB Chain (USDC + BNB); only the stablecoin and the native/USD feed differ.
///   Env: DEPLOYER_PRIVATE_KEY, QUOTE_SIGNER (address), REGISTRAR (address, the worker's registry key),
///        ADMIN (multisig; defaults to deployer on dev chains only), ARBITER,
///        STABLE_ADDRESS (real stablecoin; empty deploys a labelled no-value test token; USDG_ADDRESS accepted),
///        NATIVE_USD_FEED (Chainlink-style feed; empty deploys a mock on dev chains; ETH_USD_FEED accepted),
///        STABLE_SYMBOL / STABLE_DECIMALS / NATIVE_SYMBOL / MOCK_NATIVE_USD (test-token and mock settings),
///        SEED_MERCHANTS (comma-separated payout addresses, dev only).
///   Refuses mainnets (4663 Robinhood, 56 BNB Chain) without a real stablecoin, a real feed and a separate ADMIN.
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
        string stableSymbol;
        uint8 stableDecimals;
        string nativeSymbol;
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
        c.mainnet = block.chainid == 4663 || block.chainid == 56;
        c.usdg = vm.envOr("STABLE_ADDRESS", vm.envOr("USDG_ADDRESS", address(0)));
        c.ethFeed = vm.envOr("NATIVE_USD_FEED", vm.envOr("ETH_USD_FEED", address(0)));
        bool bnb = block.chainid == 56 || block.chainid == 97 || block.chainid == 31338;
        c.stableSymbol = vm.envOr("STABLE_SYMBOL", bnb ? string("USDC") : string("USDG"));
        c.stableDecimals = uint8(vm.envOr("STABLE_DECIMALS", bnb ? uint256(18) : uint256(6)));
        c.nativeSymbol = vm.envOr("NATIVE_SYMBOL", bnb ? string("BNB") : string("ETH"));
        if (c.mainnet) {
            require(c.usdg != address(0) && c.ethFeed != address(0), "mainnet needs STABLE_ADDRESS and NATIVE_USD_FEED");
            require(c.admin != c.deployer, "mainnet ADMIN must be a multisig, not the deployer");
        }

        vm.startBroadcast(c.pk);
        c.testToken = c.usdg == address(0);
        if (c.testToken) {
            c.usdg = address(new TestStable(string.concat("Test ", c.stableSymbol, " (no value)"), string.concat("t", c.stableSymbol), c.stableDecimals));
        } else {
            c.stableDecimals = TestStable(c.usdg).decimals(); // trust the real token, not the env
        }
        if (c.ethFeed == address(0)) c.ethFeed = address(new MockPriceFeed(8, int256(vm.envOr("MOCK_NATIVE_USD", bnb ? uint256(729e8) : uint256(2_500e8)))));
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
        vm.serializeAddress(k, "stable", c.usdg);
        vm.serializeString(k, "stableSymbol", c.stableSymbol);
        vm.serializeUint(k, "stableDecimals", c.stableDecimals);
        vm.serializeString(k, "nativeSymbol", c.nativeSymbol);
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
