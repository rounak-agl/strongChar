// SPDX-License-Identifier: MIT
// Competitions: entry caps, PQ-signed validity and scores, label reveal against the commitment, winner and refunds.
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {Competitions} from "../src/Competitions.sol";
import {Encodings} from "../src/Encodings.sol";
import {PQ} from "../src/PQ.sol";
import {MockFUSD, MockKeyStatus, MockSig, MockVerify} from "./Mocks.sol";

contract CompetitionsTest is Test {
    MockFUSD fusd;
    Competitions comp;
    address vA = makeAddr("verifierA");
    address vB = makeAddr("verifierB");
    address host = makeAddr("host");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes labels = hex"000101000101";
    bytes32 salt = keccak256("salt");
    uint256 constant PRIZE = 5_000;

    function pk(address a) internal pure returns (bytes memory) {
        return abi.encodePacked("pk", a);
    }

    function setUp() public {
        vm.etch(PQ.VERIFY, address(new MockVerify()).code);
        vm.etch(PQ.KEY_STATUS, address(new MockKeyStatus()).code);
        MockKeyStatus(payable(PQ.KEY_STATUS)).setKey(vA, pk(vA), true);
        MockKeyStatus(payable(PQ.KEY_STATUS)).setKey(vB, pk(vB), true);
        fusd = new MockFUSD();
        comp = new Competitions(address(fusd), vA, vB);
        fusd.mint(host, 1e9);
        vm.prank(host);
        fusd.approve(address(comp), type(uint256).max);
    }

    function create() internal returns (uint256 id) {
        vm.prank(host);
        id = comp.create(keccak256("meta"), Encodings.labelCommit(labels, salt), PRIZE, uint64(block.timestamp + 100),
            uint64(block.timestamp + 200), 2);
    }

    function enter(uint256 id, address who, bytes32 tag) internal returns (uint256) {
        vm.prank(who);
        return comp.submit(id, keccak256(abi.encode("script", tag)), keccak256(abi.encode("env", tag)));
    }

    function sign(uint8 kind, bytes32 payload, uint64 expiry) internal view returns (bytes memory a, bytes memory b) {
        bytes memory m = comp.message(kind, payload, expiry);
        return (MockSig.sign(pk(vA), m), MockSig.sign(pk(vB), m));
    }

    function validity(uint256 id, uint256 e, bool ok, bytes32 pred) internal {
        uint64 exp = uint64(block.number + 50);
        (bytes memory a, bytes memory b) = sign(Encodings.KIND_VALIDITY, Encodings.validityPayload(id, e, ok, pred), exp);
        comp.postValidity(id, e, ok, pred, exp, a, b);
    }

    function scores(uint256 id, uint256[] memory es, int256[] memory sc) internal {
        uint64 exp = uint64(block.number + 50);
        (bytes memory a, bytes memory b) = sign(Encodings.KIND_SCORES, Encodings.scoresPayload(id, es, sc), exp);
        comp.postScores(id, es, sc, exp, a, b);
    }

    function test_fullCompetitionPaysTheBestValidEntry() public {
        uint256 id = create();
        enter(id, alice, "a1");
        enter(id, bob, "b1");
        enter(id, alice, "a2");
        validity(id, 0, true, keccak256("p0"));
        validity(id, 1, false, bytes32(0));
        validity(id, 2, true, keccak256("p2"));
        vm.warp(block.timestamp + 101);
        uint256[] memory es = new uint256[](2);
        int256[] memory sc = new int256[](2);
        (es[0], es[1], sc[0], sc[1]) = (0, 2, 700_000, 820_000);
        scores(id, es, sc);
        vm.prank(host);
        comp.revealLabels(id, labels, salt);
        comp.settle(id);
        assertEq(comp.claimable(alice), PRIZE);
        vm.prank(alice);
        comp.claim();
        assertEq(fusd.balanceOf(alice), PRIZE);
    }

    function test_tiesGoToTheEarlierEntry() public {
        uint256 id = create();
        enter(id, bob, "b");
        enter(id, alice, "a");
        validity(id, 0, true, keccak256("p0"));
        validity(id, 1, true, keccak256("p1"));
        vm.warp(block.timestamp + 101);
        uint256[] memory es = new uint256[](2);
        int256[] memory sc = new int256[](2);
        (es[0], es[1], sc[0], sc[1]) = (0, 1, 500_000, 500_000);
        scores(id, es, sc);
        vm.prank(host);
        comp.revealLabels(id, labels, salt);
        comp.settle(id);
        assertEq(comp.claimable(bob), PRIZE);
    }

    function test_entryCapAndDeadline() public {
        uint256 id = create();
        enter(id, alice, "1");
        enter(id, alice, "2");
        vm.prank(alice);
        vm.expectRevert(Competitions.BadInput.selector);
        comp.submit(id, keccak256("s"), keccak256("e"));
        vm.warp(block.timestamp + 101);
        vm.prank(bob);
        vm.expectRevert(Competitions.TooLate.selector);
        comp.submit(id, keccak256("s"), keccak256("e"));
    }

    function test_forgedOrReplayedSignaturesFail() public {
        uint256 id = create();
        enter(id, alice, "a");
        uint64 exp = uint64(block.number + 50);
        (bytes memory a, bytes memory b) = sign(Encodings.KIND_VALIDITY, Encodings.validityPayload(id, 0, true, keccak256("p")), exp);
        vm.expectRevert(Competitions.BadSignature.selector); // claims ok=false with signatures for ok=true
        comp.postValidity(id, 0, false, keccak256("p"), exp, a, b);
        comp.postValidity(id, 0, true, keccak256("p"), exp, a, b);
        vm.expectRevert(Competitions.WrongState.selector); // replaying a used verdict
        comp.postValidity(id, 0, true, keccak256("p"), exp, a, b);
        vm.warp(block.timestamp + 101);
        vm.expectRevert(Competitions.BadSignature.selector); // a validity signature reused as a score signature
        comp.postScores(id, new uint256[](0), new int256[](0), exp, a, b);
    }

    function test_scoreTableMustCoverExactlyTheValidEntries() public {
        uint256 id = create();
        enter(id, alice, "a");
        enter(id, bob, "b");
        validity(id, 0, true, keccak256("p0"));
        validity(id, 1, false, bytes32(0));
        vm.warp(block.timestamp + 101);
        uint256[] memory es = new uint256[](2);
        int256[] memory sc = new int256[](2);
        (es[0], es[1]) = (0, 1); // includes the invalid entry
        uint64 exp = uint64(block.number + 50);
        (bytes memory a, bytes memory b) = sign(Encodings.KIND_SCORES, Encodings.scoresPayload(id, es, sc), exp);
        vm.expectRevert(Competitions.BadInput.selector);
        comp.postScores(id, es, sc, exp, a, b);
    }

    function test_labelsMustMatchCommitAndWhoMayReveal() public {
        uint256 id = create();
        vm.warp(block.timestamp + 101);
        vm.prank(alice);
        vm.expectRevert(Competitions.NotAuthorized.selector);
        comp.revealLabels(id, labels, salt);
        vm.prank(host);
        vm.expectRevert(Competitions.BadLabels.selector);
        comp.revealLabels(id, hex"000000000000", salt);
        vm.warp(block.timestamp + 100); // past the reveal deadline: a verifier may reveal
        vm.prank(vA);
        comp.revealLabels(id, labels, salt);
        assertTrue(comp.getCompetition(id).labelsRevealed);
    }

    function test_noValidEntriesOrNoScoresRefundsTheHost() public {
        uint256 id = create();
        enter(id, alice, "a");
        validity(id, 0, false, bytes32(0));
        vm.warp(block.timestamp + 101);
        vm.expectRevert(Competitions.TooEarly.selector);
        comp.settle(id);
        vm.warp(block.timestamp + 100 + 3 days);
        comp.settle(id);
        assertEq(comp.claimable(host), PRIZE);
    }
}
