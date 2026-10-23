// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {CommerceEscrow} from "../src/CommerceEscrow.sol";
import {AgentAccount} from "../src/AgentAccount.sol";
import {AgentPolicyModule} from "../src/AgentPolicyModule.sol";

contract AgentPolicyTest is Base {
    AgentAccount account;
    address agentKey = makeAddr("agentKey");
    address otherSeller = makeAddr("otherSeller");

    function setUp() public override {
        super.setUp();
        vm.prank(admin);
        registry.setMerchant(otherSeller, keccak256("other"), true, false);

        vm.startPrank(buyer);
        account = factory.createAccount(0);
        account.setAgentKey(agentKey);
        // Buyer: max 100 USDG / order, 300 USDG rolling 30 days, approved sellers only, 7-day expiry.
        policy.setPolicy(
            address(account),
            AgentPolicyModule.Policy({
                maxPerOrderUsd: 100e6,
                rollingLimitUsd: 300e6,
                window: 30 days,
                expiresAt: uint40(block.timestamp + 7 days),
                allowedAssets: 3,
                merchantAllowlist: true,
                revoked: false,
                nonce: 0
            })
        );
        policy.setMerchant(address(account), seller, true);
        usdg.transfer(address(account), 1_000e6);
        (bool ok,) = address(account).call{value: 1 ether}("");
        require(ok);
        vm.stopPrank();
    }

    function nonce() internal view returns (uint64 n) {
        (,,,,,,, n) = policy.policies(address(account));
    }

    function agentPay(bytes32 id, address s, address token, uint256 amount) internal {
        CommerceEscrow.Quote memory q = quote(id, address(account), token, amount);
        q.seller = s;
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        account.agentCheckout(q, sig, n);
    }

    function test_factory_isDeterministic_andOwnerBound() public view {
        assertEq(factory.accountAddress(buyer, 0), address(account));
        assertEq(account.owner(), buyer);
    }

    function test_authorisedPurchase_92USDG() public {
        agentPay(keccak256("a"), seller, address(usdg), 92e6);
        assertEq(uint8(status(keccak256("a"))), uint8(CommerceEscrow.Status.Funded));
        assertEq(escrow.getOrder(keccak256("a")).buyer, address(account));
        assertEq(policy.spentInWindow(address(account)), 92e6);
        assertEq(usdg.allowance(address(account), address(escrow)), 0, "no lingering approval");
    }

    function test_rejects_overPerOrder() public {
        CommerceEscrow.Quote memory q = quote(keccak256("b"), address(account), address(usdg), 101e6);
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicyModule.OverPerOrderLimit.selector, 101e6, 100e6));
        account.agentCheckout(q, sig, n);
    }

    function test_rejects_overRollingLimit() public {
        agentPay(keccak256("1"), seller, address(usdg), 100e6);
        agentPay(keccak256("2"), seller, address(usdg), 100e6);
        agentPay(keccak256("3"), seller, address(usdg), 99e6);
        CommerceEscrow.Quote memory q = quote(keccak256("4"), address(account), address(usdg), 2e6);
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicyModule.OverRollingLimit.selector, 301e6, 300e6));
        account.agentCheckout(q, sig, n);
        // window rolls forward
        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(buyer);
        policy.setPolicy(
            address(account),
            AgentPolicyModule.Policy(100e6, 300e6, 30 days, uint40(block.timestamp + 7 days), 3, true, false, 0)
        );
        agentPay(keccak256("5"), seller, address(usdg), 2e6);
    }

    function test_rejects_unapprovedMerchant() public {
        CommerceEscrow.Quote memory q = quote(keccak256("m"), address(account), address(usdg), 10e6);
        q.seller = otherSeller;
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        vm.expectRevert(AgentPolicyModule.MerchantNotAllowed.selector);
        account.agentCheckout(q, sig, n);
    }

    function test_revocation_stopsFurtherPurchases() public {
        agentPay(keccak256("x"), seller, address(usdg), 10e6);
        vm.prank(buyer);
        policy.revoke(address(account));
        CommerceEscrow.Quote memory q = quote(keccak256("y"), address(account), address(usdg), 10e6);
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        vm.expectRevert(AgentPolicyModule.Revoked.selector);
        account.agentCheckout(q, sig, n);
    }

    function test_expiry() public {
        vm.warp(block.timestamp + 7 days);
        CommerceEscrow.Quote memory q = quote(keccak256("e"), address(account), address(usdg), 10e6);
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        vm.expectRevert(AgentPolicyModule.Expired.selector);
        account.agentCheckout(q, sig, n);
    }

    function test_retryAfterSuccess_cannotPayTwice() public {
        CommerceEscrow.Quote memory q = quote(keccak256("r"), address(account), address(usdg), 10e6);
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        account.agentCheckout(q, sig, n);
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicyModule.StaleNonce.selector, n, n + 1));
        account.agentCheckout(q, sig, n);
        // even with a fresh nonce the escrow refuses the same order id
        uint64 n2 = nonce();
        vm.prank(agentKey);
        vm.expectRevert(CommerceEscrow.OrderExists.selector);
        account.agentCheckout(q, sig, n2);
    }

    function test_ethPurchase_valuedByOracle() public {
        // 0.036 ETH at $2,500 = $90
        agentPay(keccak256("eth"), seller, address(0), 0.036 ether);
        assertEq(policy.spentInWindow(address(account)), 90e6);
        // 0.0404 ETH = $101 > per-order cap
        CommerceEscrow.Quote memory q = quote(keccak256("eth2"), address(account), address(0), 0.0404 ether);
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        vm.expectRevert(abi.encodeWithSelector(AgentPolicyModule.OverPerOrderLimit.selector, 101e6, 100e6));
        account.agentCheckout(q, sig, n);
    }

    function test_rejects_staleOraclePrice() public {
        ethFeed.set(2_500e8, block.timestamp - 2 hours);
        CommerceEscrow.Quote memory q = quote(keccak256("s"), address(account), address(0), 0.01 ether);
        bytes memory sig = sign(q);
        uint64 n = nonce();
        vm.prank(agentKey);
        vm.expectRevert(AgentPolicyModule.BadPrice.selector);
        account.agentCheckout(q, sig, n);
    }

    function test_rejects_nonPositiveOraclePrice() public {
        ethFeed.set(0, block.timestamp);
        vm.expectRevert(AgentPolicyModule.BadPrice.selector);
        policy.valueUsd(address(0), 1 ether);
    }

    function test_agentKey_cannotMoveFundsOrChangePolicy() public {
        vm.startPrank(agentKey);
        vm.expectRevert();
        account.execute(address(usdg), 0, abi.encodeCall(usdg.transfer, (agentKey, 1)));
        vm.expectRevert(AgentPolicyModule.NotAccountOwner.selector);
        policy.setPolicy(address(account), AgentPolicyModule.Policy(1e12, 1e12, 30 days, uint40(block.timestamp + 1 days), 3, false, false, 0));
        vm.expectRevert(AgentPolicyModule.NotAccountOwner.selector);
        policy.setMerchant(address(account), agentKey, true);
        vm.stopPrank();
    }

    function test_agentCannotPayQuoteForAnotherBuyer() public {
        CommerceEscrow.Quote memory q = quote(keccak256("o"), buyer, address(usdg), 10e6);
        bytes memory sig = sign(q);
        vm.prank(agentKey);
        vm.expectRevert(AgentAccount.WrongBuyer.selector);
        account.agentCheckout(q, sig, 0);
    }

    function test_ownerConfirmsDelivery_throughAccount() public {
        agentPay(keccak256("d"), seller, address(usdg), 50e6);
        vm.startPrank(seller);
        escrow.accept(keccak256("d"));
        escrow.markFulfilled(keccak256("d"));
        vm.stopPrank();
        vm.prank(agentKey);
        vm.expectRevert();
        account.execute(address(escrow), 0, abi.encodeCall(escrow.confirmDelivery, (keccak256("d"))));
        vm.prank(buyer);
        account.execute(address(escrow), 0, abi.encodeCall(escrow.confirmDelivery, (keccak256("d"))));
        assertEq(usdg.balanceOf(seller), 49e6);
    }

    function testFuzz_neverExceedsLimits(uint96[6] memory amounts) public {
        uint256 total;
        for (uint256 i; i < amounts.length; ++i) {
            uint256 amt = bound(amounts[i], 1, 150e6);
            CommerceEscrow.Quote memory q = quote(keccak256(abi.encode(i)), address(account), address(usdg), amt);
            bytes memory sig = sign(q);
            uint64 n = nonce();
            vm.prank(agentKey);
            try account.agentCheckout(q, sig, n) {
                total += amt;
                assertLe(amt, 100e6);
            } catch {}
        }
        assertLe(total, 300e6);
        assertEq(policy.spentInWindow(address(account)), total);
    }
}
