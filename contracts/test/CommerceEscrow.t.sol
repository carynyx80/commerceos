// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./Base.t.sol";
import {CommerceEscrow} from "../src/CommerceEscrow.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";

contract RevertingReceiver {
    receive() external payable {
        revert("no");
    }
}

contract CommerceEscrowTest is Base {
    bytes32 constant ID = keccak256("order-1");

    // ---------------------------------------------------------------- happy path

    function test_usdg_fullFlow_paysSeller98_treasury2() public {
        payUsdg(ID, 100e6);
        assertEq(uint8(status(ID)), uint8(CommerceEscrow.Status.Funded));
        assertEq(usdg.balanceOf(address(escrow)), 100e6);

        vm.prank(seller);
        escrow.accept(ID);
        vm.prank(seller);
        escrow.markFulfilled(ID);
        vm.prank(buyer);
        escrow.confirmDelivery(ID);

        assertEq(uint8(status(ID)), uint8(CommerceEscrow.Status.Released));
        assertEq(usdg.balanceOf(seller), 98e6);
        assertEq(usdg.balanceOf(address(treasury)), 2e6);
        assertEq(usdg.balanceOf(address(escrow)), 0);
        assertEq(escrow.liabilities(address(usdg)), 0);
    }

    function test_eth_fullFlow() public {
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(0), 0.04 ether);
        bytes memory sig = sign(q);
        vm.prank(buyer);
        escrow.payWithEth{value: 0.04 ether}(q, sig);
        vm.prank(seller);
        escrow.accept(ID);
        vm.prank(seller);
        escrow.markFulfilled(ID);
        vm.prank(buyer);
        escrow.confirmDelivery(ID);
        assertEq(seller.balance, 0.0392 ether);
        assertEq(address(treasury).balance, 0.0008 ether);
    }

    function test_releaseAfterWindow_byAnyone() public {
        payUsdg(ID, 50e6);
        vm.startPrank(seller);
        escrow.accept(ID);
        escrow.markFulfilled(ID);
        vm.stopPrank();
        vm.expectRevert(CommerceEscrow.TooEarly.selector);
        escrow.releaseAfterWindow(ID);
        vm.warp(block.timestamp + 7 days);
        escrow.releaseAfterWindow(ID);
        assertEq(usdg.balanceOf(seller), 49e6);
    }

    // ------------------------------------------------------------- quote checks

    function test_rejects_replay_sameOrderId() public {
        payUsdg(ID, 10e6);
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(usdg), 10e6);
        bytes memory sig = sign(q);
        vm.startPrank(buyer);
        usdg.approve(address(escrow), 10e6);
        vm.expectRevert(CommerceEscrow.OrderExists.selector);
        escrow.payWithToken(q, sig);
        vm.stopPrank();
    }

    function test_rejects_wrongSigner() public {
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(usdg), 10e6);
        bytes memory sig = signWith(0xBAD, q);
        vm.startPrank(buyer);
        usdg.approve(address(escrow), 10e6);
        vm.expectRevert(CommerceEscrow.BadSignature.selector);
        escrow.payWithToken(q, sig);
        vm.stopPrank();
    }

    function test_rejects_tamperedAmount() public {
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(usdg), 100e6);
        bytes memory sig = sign(q);
        q.amount = 1e6; // buyer tries to pay less than quoted
        vm.startPrank(buyer);
        usdg.approve(address(escrow), 100e6);
        vm.expectRevert(CommerceEscrow.BadSignature.selector);
        escrow.payWithToken(q, sig);
        vm.stopPrank();
    }

    function test_rejects_expiredQuote() public {
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(usdg), 10e6);
        bytes memory sig = sign(q);
        vm.warp(q.deadline + 1);
        vm.prank(buyer);
        vm.expectRevert(CommerceEscrow.QuoteExpired.selector);
        escrow.payWithToken(q, sig);
    }

    function test_rejects_someoneElsePayingBuyersQuote() public {
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(usdg), 10e6);
        bytes memory sig = sign(q);
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(CommerceEscrow.NotBuyer.selector);
        escrow.payWithToken(q, sig);
    }

    function test_rejects_wrongEthValue() public {
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(0), 1 ether);
        bytes memory sig = sign(q);
        vm.prank(buyer);
        vm.expectRevert(CommerceEscrow.WrongAmount.selector);
        escrow.payWithEth{value: 0.5 ether}(q, sig);
    }

    function test_rejects_ethQuoteThroughTokenPath() public {
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(0), 1 ether);
        bytes memory sig = sign(q);
        vm.prank(buyer);
        vm.expectRevert(CommerceEscrow.UnsupportedToken.selector);
        escrow.payWithToken(q, sig);
    }

    function test_rejects_inactiveMerchant() public {
        vm.prank(admin);
        registry.setMerchant(seller, keccak256("seller"), false, true);
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(usdg), 10e6);
        bytes memory sig = sign(q);
        vm.startPrank(buyer);
        usdg.approve(address(escrow), 10e6);
        vm.expectRevert(CommerceEscrow.MerchantInactive.selector);
        escrow.payWithToken(q, sig);
        vm.stopPrank();
    }

    // -------------------------------------------------------------- transitions

    function test_cannotReleaseBeforeFunding_orTwice() public {
        vm.prank(buyer);
        vm.expectRevert();
        escrow.confirmDelivery(ID);
        payUsdg(ID, 10e6);
        vm.startPrank(seller);
        escrow.accept(ID);
        escrow.markFulfilled(ID);
        vm.stopPrank();
        vm.startPrank(buyer);
        escrow.confirmDelivery(ID);
        vm.expectRevert(abi.encodeWithSelector(CommerceEscrow.WrongStatus.selector, CommerceEscrow.Status.Released));
        escrow.confirmDelivery(ID);
        vm.stopPrank();
    }

    function test_onlySellerAcceptsAndFulfils() public {
        payUsdg(ID, 10e6);
        vm.prank(buyer);
        vm.expectRevert(CommerceEscrow.NotSeller.selector);
        escrow.accept(ID);
    }

    // ------------------------------------------------------------------ refunds

    function test_sellerCancel_refundsBuyerInFull() public {
        uint256 before = usdg.balanceOf(buyer);
        payUsdg(ID, 25e6);
        vm.prank(seller);
        escrow.sellerCancel(ID);
        assertEq(usdg.balanceOf(buyer), before);
        assertEq(uint8(status(ID)), uint8(CommerceEscrow.Status.Refunded));
        assertEq(usdg.balanceOf(address(treasury)), 0);
    }

    function test_buyerCancel_afterAcceptTimeout_ethRefund() public {
        CommerceEscrow.Quote memory q = quote(ID, buyer, address(0), 1 ether);
        bytes memory sig = sign(q);
        vm.prank(buyer);
        escrow.payWithEth{value: 1 ether}(q, sig);
        vm.prank(buyer);
        vm.expectRevert(CommerceEscrow.TooEarly.selector);
        escrow.buyerCancel(ID);
        vm.warp(block.timestamp + 3 days);
        uint256 before = buyer.balance;
        vm.prank(buyer);
        escrow.buyerCancel(ID);
        assertEq(buyer.balance, before + 1 ether);
    }

    function test_buyerCancel_afterFulfilTimeout() public {
        payUsdg(ID, 25e6);
        vm.prank(seller);
        escrow.accept(ID);
        vm.warp(block.timestamp + 21 days);
        vm.prank(buyer);
        escrow.buyerCancel(ID);
        assertEq(uint8(status(ID)), uint8(CommerceEscrow.Status.Refunded));
    }

    function test_refundToRevertingBuyer_isCreditedNotLost() public {
        RevertingReceiver r = new RevertingReceiver();
        vm.deal(address(r), 1 ether);
        CommerceEscrow.Quote memory q = quote(ID, address(r), address(0), 1 ether);
        bytes memory sig = sign(q);
        vm.prank(address(r));
        escrow.payWithEth{value: 1 ether}(q, sig);
        vm.prank(seller);
        escrow.sellerCancel(ID);
        assertEq(escrow.owed(address(r), address(0)), 1 ether);
        assertEq(address(escrow).balance, 1 ether);
        assertEq(escrow.liabilities(address(0)), 1 ether);
    }

    // ----------------------------------------------------------------- disputes

    function test_dispute_locksFunds_thenSplit() public {
        payUsdg(ID, 100e6);
        vm.startPrank(seller);
        escrow.accept(ID);
        escrow.markFulfilled(ID);
        vm.stopPrank();
        vm.prank(buyer);
        escrow.openDispute(ID);

        // locked: neither confirm nor timed release works
        vm.prank(buyer);
        vm.expectRevert();
        escrow.confirmDelivery(ID);
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        escrow.releaseAfterWindow(ID);

        // only the resolver may settle
        vm.prank(admin);
        vm.expectRevert(CommerceEscrow.NotResolver.selector);
        escrow.resolveDispute(ID, 5_000);

        vm.prank(buyer);
        resolver.submitEvidence(ID, keccak256("photos"));
        vm.prank(arbiter);
        resolver.rule(ID, 5_000, keccak256("half"));
        vm.expectRevert(DisputeResolver.TooEarly.selector);
        resolver.finalize(ID);
        vm.warp(block.timestamp + 3 days + 1);
        resolver.finalize(ID);

        // buyer 50, seller 50 - 2% of 50 = 49, treasury 1
        assertEq(usdg.balanceOf(seller), 49e6);
        assertEq(usdg.balanceOf(address(treasury)), 1e6);
        assertEq(usdg.balanceOf(buyer), 10_000e6 - 100e6 + 50e6);
    }

    function test_dispute_appeal_finalByAppealsRole() public {
        payUsdg(ID, 100e6);
        vm.prank(buyer);
        escrow.openDispute(ID);
        vm.prank(arbiter);
        resolver.rule(ID, 0, bytes32(0));
        vm.prank(buyer);
        resolver.appeal(ID);
        vm.prank(arbiter);
        vm.expectRevert();
        resolver.decideAppeal(ID, 10_000, bytes32(0));
        vm.prank(appeals);
        resolver.decideAppeal(ID, 10_000, keccak256("full refund"));
        assertEq(uint8(status(ID)), uint8(CommerceEscrow.Status.Refunded));
        assertEq(usdg.balanceOf(buyer), 10_000e6);
    }

    function test_cannotDisputeAfterConfirmWindow() public {
        payUsdg(ID, 10e6);
        vm.startPrank(seller);
        escrow.accept(ID);
        escrow.markFulfilled(ID);
        vm.stopPrank();
        vm.warp(block.timestamp + 7 days);
        vm.prank(buyer);
        vm.expectRevert(CommerceEscrow.TooLate.selector);
        escrow.openDispute(ID);
    }

    // -------------------------------------------------------------------- admin

    function test_pause_blocksPayment_butNotRefund() public {
        payUsdg(ID, 10e6);
        vm.prank(admin);
        escrow.pause();
        CommerceEscrow.Quote memory q = quote(keccak256("2"), buyer, address(usdg), 1e6);
        bytes memory sig = sign(q);
        vm.prank(buyer);
        vm.expectRevert();
        escrow.payWithToken(q, sig);
        vm.prank(seller);
        escrow.sellerCancel(ID);
        assertEq(uint8(status(ID)), uint8(CommerceEscrow.Status.Refunded));
    }

    function test_feeChange_isTimelocked_andSnapshotted() public {
        payUsdg(ID, 100e6);
        vm.startPrank(admin);
        fees.proposeChange(500, address(treasury));
        vm.expectRevert();
        fees.applyChange();
        vm.warp(block.timestamp + 1 days);
        fees.applyChange();
        vm.expectRevert();
        fees.proposeChange(1_001, address(treasury));
        vm.stopPrank();
        vm.startPrank(seller);
        escrow.accept(ID);
        escrow.markFulfilled(ID);
        vm.stopPrank();
        vm.prank(buyer);
        escrow.confirmDelivery(ID);
        assertEq(usdg.balanceOf(seller), 98e6, "existing order keeps its 2% fee");
    }

    function test_nonOwnerCannotAdmin() public {
        vm.expectRevert();
        escrow.setQuoteSigner(address(1));
        vm.expectRevert();
        escrow.unpause();
    }

    // --------------------------------------------------------------------- fuzz

    function testFuzz_feeSplitConservesValue(uint96 amount) public {
        amount = uint96(bound(amount, 1, 10_000e6));
        payUsdg(ID, amount);
        vm.startPrank(seller);
        escrow.accept(ID);
        escrow.markFulfilled(ID);
        vm.stopPrank();
        vm.prank(buyer);
        escrow.confirmDelivery(ID);
        assertEq(usdg.balanceOf(seller) + usdg.balanceOf(address(treasury)), amount);
        assertEq(usdg.balanceOf(address(treasury)), (uint256(amount) * 200) / 10_000);
    }

    function testFuzz_disputeSplitConservesValue(uint96 amount, uint16 buyerBps) public {
        amount = uint96(bound(amount, 1, 10_000e6));
        buyerBps = uint16(bound(buyerBps, 0, 10_000));
        uint256 start = usdg.balanceOf(buyer);
        payUsdg(ID, amount);
        vm.prank(buyer);
        escrow.openDispute(ID);
        vm.prank(arbiter);
        resolver.rule(ID, buyerBps, bytes32(0));
        vm.warp(block.timestamp + 4 days);
        resolver.finalize(ID);
        uint256 total = usdg.balanceOf(buyer) - (start - amount) + usdg.balanceOf(seller) + usdg.balanceOf(address(treasury));
        assertEq(total, amount);
        assertEq(usdg.balanceOf(address(escrow)), 0);
    }
}
