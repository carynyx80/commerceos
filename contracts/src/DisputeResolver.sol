// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {CommerceEscrow} from "./CommerceEscrow.sol";

/// @title DisputeResolver
/// @notice Evidence → arbiter ruling → appeal window → final settlement on the escrow.
///         Evidence content stays off-chain (it can contain private data); only its hash is
///         recorded here. Physical delivery cannot be proven on-chain; arbiters weigh evidence.
///
///         Flow: a party submits evidence until `evidenceDeadline`. An ARBITER proposes a
///         ruling. Either party may appeal once within `appealWindow`; an APPEALS (multisig)
///         member then makes the final ruling. Unappealed rulings finalize after the window.
contract DisputeResolver is AccessControl {
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");
    bytes32 public constant APPEALS_ROLE = keccak256("APPEALS_ROLE");

    enum Stage {
        None,
        Evidence,
        Ruled,
        Appealed,
        Final
    }

    struct Case {
        Stage stage;
        uint40 evidenceDeadline;
        uint40 appealDeadline;
        uint16 buyerBps;
        bytes32 rationaleHash;
    }

    CommerceEscrow public immutable escrow;
    uint40 public evidencePeriod = 5 days;
    uint40 public appealWindow = 3 days;

    mapping(bytes32 orderId => Case) public cases;

    event CaseOpened(bytes32 indexed orderId, uint40 evidenceDeadline);
    event EvidenceSubmitted(bytes32 indexed orderId, address indexed party, bytes32 evidenceHash);
    event Ruled(bytes32 indexed orderId, address indexed arbiter, uint16 buyerBps, bytes32 rationaleHash, uint40 appealDeadline);
    event Appealed(bytes32 indexed orderId, address indexed party);
    event Finalized(bytes32 indexed orderId, uint16 buyerBps);
    event PeriodsSet(uint40 evidencePeriod, uint40 appealWindow);

    error NotDisputed();
    error NotParty();
    error WrongStage(Stage stage);
    error TooEarly();
    error TooLate();
    error BadShare();
    error BadPeriod();

    constructor(address admin, CommerceEscrow escrow_) {
        escrow = escrow_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @notice Anyone may open the case once the escrow shows the order as Disputed.
    function openCase(bytes32 orderId) public {
        if (escrow.getOrder(orderId).status != CommerceEscrow.Status.Disputed) revert NotDisputed();
        Case storage c = cases[orderId];
        if (c.stage != Stage.None) revert WrongStage(c.stage);
        c.stage = Stage.Evidence;
        c.evidenceDeadline = uint40(block.timestamp) + evidencePeriod;
        emit CaseOpened(orderId, c.evidenceDeadline);
    }

    function submitEvidence(bytes32 orderId, bytes32 evidenceHash) external {
        Case storage c = cases[orderId];
        if (c.stage == Stage.None) openCase(orderId);
        if (c.stage != Stage.Evidence) revert WrongStage(c.stage);
        if (block.timestamp > c.evidenceDeadline) revert TooLate();
        CommerceEscrow.Order memory o = escrow.getOrder(orderId);
        if (msg.sender != o.buyer && msg.sender != o.seller) revert NotParty();
        emit EvidenceSubmitted(orderId, msg.sender, evidenceHash);
    }

    /// @notice Arbiter ruling. May be made early if both parties have submitted (arbiter's judgement),
    ///         and must be made within the evidence stage.
    function rule(bytes32 orderId, uint16 buyerBps, bytes32 rationaleHash) external onlyRole(ARBITER_ROLE) {
        if (buyerBps > 10_000) revert BadShare();
        Case storage c = cases[orderId];
        if (c.stage == Stage.None) openCase(orderId);
        if (c.stage != Stage.Evidence) revert WrongStage(c.stage);
        c.stage = Stage.Ruled;
        c.buyerBps = buyerBps;
        c.rationaleHash = rationaleHash;
        c.appealDeadline = uint40(block.timestamp) + appealWindow;
        emit Ruled(orderId, msg.sender, buyerBps, rationaleHash, c.appealDeadline);
    }

    function appeal(bytes32 orderId) external {
        Case storage c = cases[orderId];
        if (c.stage != Stage.Ruled) revert WrongStage(c.stage);
        if (block.timestamp > c.appealDeadline) revert TooLate();
        CommerceEscrow.Order memory o = escrow.getOrder(orderId);
        if (msg.sender != o.buyer && msg.sender != o.seller) revert NotParty();
        c.stage = Stage.Appealed;
        emit Appealed(orderId, msg.sender);
    }

    /// @notice Settle an unappealed ruling after the appeal window. Callable by anyone.
    function finalize(bytes32 orderId) external {
        Case storage c = cases[orderId];
        if (c.stage != Stage.Ruled) revert WrongStage(c.stage);
        if (block.timestamp <= c.appealDeadline) revert TooEarly();
        _settle(orderId, c, c.buyerBps);
    }

    /// @notice Final ruling on appeal by the appeals multisig.
    function decideAppeal(bytes32 orderId, uint16 buyerBps, bytes32 rationaleHash) external onlyRole(APPEALS_ROLE) {
        if (buyerBps > 10_000) revert BadShare();
        Case storage c = cases[orderId];
        if (c.stage != Stage.Appealed) revert WrongStage(c.stage);
        c.rationaleHash = rationaleHash;
        _settle(orderId, c, buyerBps);
    }

    function _settle(bytes32 orderId, Case storage c, uint16 buyerBps) internal {
        c.stage = Stage.Final;
        c.buyerBps = buyerBps;
        escrow.resolveDispute(orderId, buyerBps);
        emit Finalized(orderId, buyerBps);
    }

    function setPeriods(uint40 evidence, uint40 appealW) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (evidence < 1 days || evidence > 30 days || appealW < 1 days || appealW > 14 days) revert BadPeriod();
        evidencePeriod = evidence;
        appealWindow = appealW;
        emit PeriodsSet(evidence, appealW);
    }
}
