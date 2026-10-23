// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CommerceEscrow} from "../src/CommerceEscrow.sol";
import {FeeController} from "../src/FeeController.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {Treasury} from "../src/Treasury.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";
import {AgentPolicyModule} from "../src/AgentPolicyModule.sol";
import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
import {TestUSDG} from "../src/mocks/TestUSDG.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";

abstract contract Base is Test {
    TestUSDG usdg;
    FeeController fees;
    MerchantRegistry registry;
    Treasury treasury;
    CommerceEscrow escrow;
    DisputeResolver resolver;
    MockPriceFeed ethFeed;
    AgentPolicyModule policy;
    AgentAccountFactory factory;

    address admin = makeAddr("admin");
    address arbiter = makeAddr("arbiter");
    address appeals = makeAddr("appeals");
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    uint256 signerKey = 0xA11CE;
    address signer;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        signer = vm.addr(signerKey);
        usdg = new TestUSDG();
        treasury = new Treasury(admin);
        fees = new FeeController(admin, address(treasury), 200);
        registry = new MerchantRegistry(admin);
        escrow = new CommerceEscrow(admin, address(usdg), fees, registry, signer);
        resolver = new DisputeResolver(admin, escrow);
        ethFeed = new MockPriceFeed(8, 2_500e8);
        policy = new AgentPolicyModule(admin, address(usdg), ethFeed);
        factory = new AgentAccountFactory(escrow, policy);

        vm.startPrank(admin);
        escrow.setDisputeResolver(address(resolver));
        registry.grantRole(registry.REGISTRAR_ROLE(), admin);
        registry.setMerchant(seller, keccak256("seller"), true, true);
        resolver.grantRole(resolver.ARBITER_ROLE(), arbiter);
        resolver.grantRole(resolver.APPEALS_ROLE(), appeals);
        vm.stopPrank();

        usdg.faucet(buyer, 10_000e6);
        vm.deal(buyer, 100 ether);
    }

    function quote(bytes32 id, address b, address token, uint256 amount) internal view returns (CommerceEscrow.Quote memory q) {
        q = CommerceEscrow.Quote({
            orderId: id,
            buyer: b,
            seller: seller,
            token: token,
            amount: amount,
            deadline: block.timestamp + 15 minutes,
            termsHash: keccak256(abi.encode(id, "terms"))
        });
    }

    function sign(CommerceEscrow.Quote memory q) internal view returns (bytes memory) {
        return signWith(signerKey, q);
    }

    function signWith(uint256 key, CommerceEscrow.Quote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, escrow.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    function payUsdg(bytes32 id, uint256 amount) internal returns (CommerceEscrow.Quote memory q) {
        q = quote(id, buyer, address(usdg), amount);
        bytes memory sig = sign(q);
        vm.startPrank(buyer);
        usdg.approve(address(escrow), amount);
        escrow.payWithToken(q, sig);
        vm.stopPrank();
    }

    function status(bytes32 id) internal view returns (CommerceEscrow.Status) {
        return escrow.getOrder(id).status;
    }
}
