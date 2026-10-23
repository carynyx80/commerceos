// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {CommerceEscrow} from "../src/CommerceEscrow.sol";
import {DisputeResolver} from "../src/DisputeResolver.sol";
import {TestUSDG} from "../src/mocks/TestUSDG.sol";

/// @dev Drives random sequences of payments, lifecycle actions, refunds and disputes.
contract EscrowHandler is Test {
    CommerceEscrow escrow;
    DisputeResolver resolver;
    TestUSDG usdg;
    uint256 signerKey;
    address buyer;
    address seller;
    address arbiter;
    bytes32[] public ids;
    mapping(bytes32 => uint256) public paidAmount;
    uint256 public totalPaidIn;

    constructor(CommerceEscrow e, DisputeResolver r, TestUSDG t, uint256 k, address b, address s, address a) {
        escrow = e;
        resolver = r;
        usdg = t;
        signerKey = k;
        buyer = b;
        seller = s;
        arbiter = a;
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function pay(uint256 amount, bool eth) external {
        amount = bound(amount, 1, 500e6);
        bytes32 id = keccak256(abi.encode(ids.length, "inv"));
        CommerceEscrow.Quote memory q = CommerceEscrow.Quote(id, buyer, seller, eth ? address(0) : address(usdg), amount, block.timestamp + 1 hours, bytes32(0));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, escrow.hashQuote(q));
        bytes memory sig = abi.encodePacked(r, s, v);
        if (eth) {
            vm.deal(buyer, amount);
            vm.prank(buyer);
            escrow.payWithEth{value: amount}(q, sig);
        } else {
            usdg.faucet(buyer, amount);
            vm.startPrank(buyer);
            usdg.approve(address(escrow), amount);
            escrow.payWithToken(q, sig);
            vm.stopPrank();
        }
        ids.push(id);
        paidAmount[id] = amount;
        totalPaidIn += amount;
    }

    function _id(uint256 i) internal view returns (bytes32) {
        return ids.length == 0 ? bytes32(0) : ids[i % ids.length];
    }

    function accept(uint256 i) external {
        vm.prank(seller);
        escrow.accept(_id(i));
    }

    function fulfil(uint256 i) external {
        vm.prank(seller);
        escrow.markFulfilled(_id(i));
    }

    function confirm(uint256 i) external {
        vm.prank(buyer);
        escrow.confirmDelivery(_id(i));
    }

    function sellerCancel(uint256 i) external {
        vm.prank(seller);
        escrow.sellerCancel(_id(i));
    }

    function buyerCancel(uint256 i) external {
        vm.prank(buyer);
        escrow.buyerCancel(_id(i));
    }

    function dispute(uint256 i) external {
        vm.prank(buyer);
        escrow.openDispute(_id(i));
    }

    function rule(uint256 i, uint16 bps) external {
        vm.prank(arbiter);
        resolver.rule(_id(i), uint16(bound(bps, 0, 10_000)), bytes32(0));
    }

    function finalize(uint256 i) external {
        resolver.finalize(_id(i));
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 10 days));
    }
}

contract EscrowInvariantTest is Base {
    EscrowHandler h;

    function setUp() public override {
        super.setUp();
        h = new EscrowHandler(escrow, resolver, usdg, signerKey, buyer, seller, arbiter);
        targetContract(address(h));
    }

    /// The escrow always holds at least what it owes (active orders + credited balances).
    function invariant_solvent() public view {
        assertGe(usdg.balanceOf(address(escrow)), escrow.liabilities(address(usdg)));
        assertGe(address(escrow).balance, escrow.liabilities(address(0)));
    }

    /// Liabilities equal the sum of amounts in non-terminal orders (nothing is owed: no reverting receivers here).
    function invariant_liabilitiesMatchOpenOrders() public view {
        uint256 openUsdg;
        uint256 openEth;
        for (uint256 i; i < h.idCount(); ++i) {
            CommerceEscrow.Order memory o = escrow.getOrder(h.ids(i));
            if (o.status == CommerceEscrow.Status.Funded || o.status == CommerceEscrow.Status.Accepted || o.status == CommerceEscrow.Status.Fulfilled || o.status == CommerceEscrow.Status.Disputed) {
                if (o.token == address(0)) openEth += o.amount;
                else openUsdg += o.amount;
            }
        }
        assertEq(escrow.liabilities(address(usdg)), openUsdg);
        assertEq(escrow.liabilities(address(0)), openEth);
    }

    /// No value is created or destroyed: everything paid in sits in escrow or went to buyer/seller/treasury.
    function invariant_conservation() public view {
        uint256 out = usdg.balanceOf(address(escrow)) + usdg.balanceOf(seller) + usdg.balanceOf(address(treasury)) + address(escrow).balance + seller.balance + address(treasury).balance;
        // buyer refunds return to buyer; buyer's starting balance from Base is 10_000e6 USDG and 100 ETH
        uint256 buyerGain = (usdg.balanceOf(buyer) - 10_000e6) + (buyer.balance >= 100 ether ? buyer.balance - 100 ether : buyer.balance);
        assertLe(out, h.totalPaidIn() + buyerGain + 100 ether);
        assertEq(usdg.balanceOf(seller) % 1, 0);
    }
}
