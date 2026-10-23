// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CommerceEscrow} from "../src/CommerceEscrow.sol";
import {FeeController} from "../src/FeeController.sol";
import {MerchantRegistry} from "../src/MerchantRegistry.sol";
import {Treasury} from "../src/Treasury.sol";
import {AgentPolicyModule} from "../src/AgentPolicyModule.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {AgentAccountFactory} from "../src/AgentAccountFactory.sol";
import {TestStable} from "../src/mocks/TestStable.sol";
import {MockPriceFeed} from "../src/mocks/MockPriceFeed.sol";

/// @notice The same contracts configured like BNB Chain: USDC with 18 decimals, BNB as the native coin.
contract BnbChainTest is Test {
    TestStable usdc;
    MockPriceFeed bnbFeed;
    Treasury treasury;
    FeeController fees;
    MerchantRegistry registry;
    CommerceEscrow escrow;
    AgentPolicyModule policy;
    AgentAccountFactory factory;
    AgentAccount account;

    address admin = makeAddr("admin");
    address buyer = makeAddr("buyer");
    address seller = makeAddr("seller");
    address agentKey = makeAddr("agentKey");
    uint256 signerKey = 0xB0B;

    function setUp() public {
        vm.warp(1_800_000_000);
        usdc = new TestStable("Test USDC (no value)", "tUSDC", 18);
        bnbFeed = new MockPriceFeed(8, 729e8); // $729.00
        treasury = new Treasury(admin);
        fees = new FeeController(admin, address(treasury), 200);
        registry = new MerchantRegistry(admin);
        escrow = new CommerceEscrow(admin, address(usdc), fees, registry, vm.addr(signerKey));
        policy = new AgentPolicyModule(admin, address(usdc), bnbFeed);
        factory = new AgentAccountFactory(escrow, policy);
        vm.startPrank(admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), admin);
        registry.setMerchant(seller, keccak256("s"), true, true);
        vm.stopPrank();
        usdc.faucet(buyer, 10_000e18);
        vm.deal(buyer, 100 ether);

        vm.startPrank(buyer);
        account = factory.createAccount(0);
        account.setAgentKey(agentKey);
        policy.setPolicy(address(account), AgentPolicyModule.Policy(100e6, 300e6, 30 days, uint40(block.timestamp + 7 days), 3, false, false, 0));
        usdc.transfer(address(account), 1_000e18);
        (bool ok,) = address(account).call{value: 10 ether}("");
        require(ok);
        vm.stopPrank();
    }

    function _q(bytes32 id, address b, address token, uint256 amount) internal view returns (CommerceEscrow.Quote memory q, bytes memory sig) {
        q = CommerceEscrow.Quote(id, b, seller, token, amount, block.timestamp + 15 minutes, bytes32(0));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, escrow.hashQuote(q));
        sig = abi.encodePacked(r, s, v);
    }

    function test_policyReadsStableDecimals() public view {
        assertEq(policy.stableDecimals(), 18);
        assertEq(policy.valueUsd(address(usdc), 92e18), 92e6);
        assertEq(policy.valueUsd(address(usdc), 1), 1, "dust rounds up, never down");
        // 0.1 BNB at $729 = $72.90
        assertEq(policy.valueUsd(address(0), 0.1 ether), 72_900_000);
    }

    function test_usdc18_fullFlow() public {
        (CommerceEscrow.Quote memory q, bytes memory sig) = _q(keccak256("o2"), buyer, address(usdc), 100e18);
        vm.startPrank(buyer);
        usdc.approve(address(escrow), 100e18);
        escrow.payWithToken(q, sig);
        vm.stopPrank();
        vm.startPrank(seller);
        escrow.accept(q.orderId);
        escrow.markFulfilled(q.orderId);
        vm.stopPrank();
        vm.prank(buyer);
        escrow.confirmDelivery(q.orderId);
        assertEq(usdc.balanceOf(seller), 98e18);
        assertEq(usdc.balanceOf(address(treasury)), 2e18);
    }

    function test_bnb_fullFlow() public {
        (CommerceEscrow.Quote memory q, bytes memory sig) = _q(keccak256("b"), buyer, address(0), 0.5 ether);
        vm.prank(buyer);
        escrow.payWithEth{value: 0.5 ether}(q, sig);
        vm.startPrank(seller);
        escrow.accept(q.orderId);
        escrow.markFulfilled(q.orderId);
        vm.stopPrank();
        vm.prank(buyer);
        escrow.confirmDelivery(q.orderId);
        assertEq(seller.balance, 0.49 ether);
        assertEq(address(treasury).balance, 0.01 ether);
    }

    function test_agent_usdc18_limits() public {
        (CommerceEscrow.Quote memory ok, bytes memory s1) = _q(keccak256("a1"), address(account), address(usdc), 92e18);
        (,,,,,,, uint64 n) = policy.policies(address(account));
        vm.prank(agentKey);
        account.agentCheckout(ok, s1, n);
        assertEq(policy.spentInWindow(address(account)), 92e6);

        (CommerceEscrow.Quote memory big, bytes memory s2) = _q(keccak256("a2"), address(account), address(usdc), 101e18);
        (,,,,,,, n) = policy.policies(address(account));
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicyModule.OverPerOrderLimit.selector, 101e6, 100e6));
        account.agentCheckout(big, s2, n);
    }

    function test_agent_bnb_valuedByFeed() public {
        // 0.137 BNB at $729 = $99.873 → allowed (≤ $100)
        (CommerceEscrow.Quote memory ok, bytes memory s1) = _q(keccak256("n1"), address(account), address(0), 0.137 ether);
        (,,,,,,, uint64 n) = policy.policies(address(account));
        vm.prank(agentKey);
        account.agentCheckout(ok, s1, n);
        // 0.138 BNB = $100.602 → over the per-order cap
        (CommerceEscrow.Quote memory big, bytes memory s2) = _q(keccak256("n2"), address(account), address(0), 0.138 ether);
        (,,,,,,, n) = policy.policies(address(account));
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicyModule.OverPerOrderLimit.selector, 100_602_000, 100e6));
        account.agentCheckout(big, s2, n);
    }

    function testFuzz_usdc18_valuation(uint96 amount) public view {
        uint256 v = policy.valueUsd(address(usdc), amount);
        // ceil(amount / 1e12)
        assertEq(v, amount == 0 ? 0 : (uint256(amount) - 1) / 1e12 + 1);
    }
}
