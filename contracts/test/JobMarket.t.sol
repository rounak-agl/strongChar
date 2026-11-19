// SPDX-License-Identifier: MIT
// JobMarket and NodeRegistry: honest rounds, cheaters, forged/replayed/expired signatures, refunds and timeouts.
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {BeruToken} from "../src/BeruToken.sol";
import {BeruFaucet} from "../src/BeruFaucet.sol";
import {Encodings} from "../src/Encodings.sol";
import {JobMarket} from "../src/JobMarket.sol";
import {NodeRegistry} from "../src/NodeRegistry.sol";
import {PQ} from "../src/PQ.sol";
import {MockFUSD, MockKeyStatus, MockSig, MockVerify} from "./Mocks.sol";

contract JobMarketTest is Test {
    MockFUSD fusd;
    BeruToken beru;
    BeruFaucet faucet;
    NodeRegistry registry;
    JobMarket market;

    address coordinator = makeAddr("coordinator");
    address vA = makeAddr("verifierA");
    address vB = makeAddr("verifierB");
    address owner = makeAddr("owner");
    address[4] nodes;

    uint128 constant STAKE = 20e6; // above MIN_STAKE (15 BERU), the floor for these small budgets
    uint256 constant BUDGET = 4_000_000;
    bytes32 constant W0 = keccak256("w0");

    function pk(address a) internal pure returns (bytes memory) {
        return abi.encodePacked("pk", a);
    }

    function setUp() public {
        vm.etch(PQ.VERIFY, address(new MockVerify()).code);
        vm.etch(PQ.KEY_STATUS, address(new MockKeyStatus()).code);
        fusd = new MockFUSD();
        faucet = new BeruFaucet(100e6, 1 days);
        beru = new BeruToken(address(faucet), address(this), 1e12, 5e11);
        faucet.setToken(address(beru));
        registry = new NodeRegistry(address(beru), probation());
        market = new JobMarket(address(fusd), address(registry), coordinator, vA, vB);
        registry.setMarket(address(market));

        MockKeyStatus(payable(PQ.KEY_STATUS)).setKey(vA, pk(vA), true);
        MockKeyStatus(payable(PQ.KEY_STATUS)).setKey(vB, pk(vB), true);
        for (uint256 i; i < 4; i++) {
            nodes[i] = address(uint160(0x1000 + i)); // ascending addresses keep payout lists sorted
            MockKeyStatus(payable(PQ.KEY_STATUS)).setKey(nodes[i], pk(nodes[i]), true);
            beru.transfer(nodes[i], 100e6);
            vm.startPrank(nodes[i]);
            registry.join();
            beru.approve(address(registry), type(uint256).max);
            registry.depositStake(50e6);
            vm.stopPrank();
        }
        fusd.mint(owner, 100e6);
        vm.prank(owner);
        fusd.approve(address(market), type(uint256).max);
    }

    // ---------------------------------------------------------------- helpers

    /// Seconds of verified work before a node is paid directly; 0 here, so these tests see plain equal pay.
    function probation() internal pure virtual returns (uint64) {
        return 0;
    }

    function refWork() internal pure virtual returns (uint32) {
        return 0;
    }

    function params(uint16 rounds) internal pure returns (JobMarket.JobParams memory p) {
        p.specHash = keccak256("spec");
        p.initialWeightsHash = W0;
        p.shardTableHash = keccak256("shards");
        p.dataCommit = keccak256("data");
        p.budget = BUDGET;
        p.stakePerNode = STAKE;
        p.rounds = rounds;
        p.quorum = 2;
        p.maxNodes = 4;
        p.windows = JobMarket.Windows(100, 100, 100);
        p.refWorkSecondsPerRound = refWork();
    }

    function newJob(uint16 rounds) internal returns (uint256 id) {
        vm.prank(owner);
        id = market.createJob(params(rounds));
    }

    function open(uint256 job, uint256 n) internal {
        address[] memory ns = new address[](n);
        uint8[] memory sh = new uint8[](n);
        for (uint256 i; i < n; i++) {
            ns[i] = nodes[i];
            sh[i] = uint8(i);
        }
        vm.prank(coordinator);
        market.openRound(job, ns, sh);
    }

    function checkpoints(bytes32 start, address node) internal pure returns (bytes32[] memory c) {
        c = new bytes32[](3);
        c[0] = start;
        c[1] = keccak256(abi.encode("mid", node));
        c[2] = keccak256(abi.encode("final", node));
    }

    function commitFor(uint256 job, uint256 round, address node, bytes32 start) internal {
        bytes32 h = Encodings.commitHash(
            market.domain(), job, round, node, Encodings.checkpointRoot(checkpoints(start, node)), keccak256("salt")
        );
        vm.prank(node);
        market.commit(job, round, h);
    }

    function revealFor(uint256 job, uint256 round, address node, bytes32 start) internal {
        vm.prank(node);
        market.reveal(job, round, checkpoints(start, node), keccak256("salt"));
    }

    /// Commit for the first n nodes, then reveal for the first `revealers`.
    function work(uint256 job, uint256 round, uint256 n, uint256 revealers, bytes32 start) internal {
        for (uint256 i; i < n; i++) {
            commitFor(job, round, nodes[i], start);
        }
        vm.warp(vm.getBlockTimestamp() + 101);
        for (uint256 i; i < revealers; i++) {
            revealFor(job, round, nodes[i], start);
        }
        vm.warp(vm.getBlockTimestamp() + 100);
    }

    function settlement(uint8 outcome, uint32 slashed, address[] memory payees, uint256[] memory amounts)
        internal
        pure
        returns (JobMarket.Settlement memory s)
    {
        s.outcome = outcome;
        s.aggregateHash = outcome == 0 ? keccak256("agg") : W0;
        s.slashedBitmap = slashed;
        s.aggEvidenceHash = keccak256("aggEv");
        s.payEvidenceHash = keccak256("payEv");
        s.payouts = new Encodings.Payout[](payees.length);
        for (uint256 i; i < payees.length; i++) {
            s.payouts[i] = Encodings.Payout(payees[i], amounts[i]);
        }
    }

    function sigs(uint256 job, uint256 round, JobMarket.Settlement memory s, uint64 expiry)
        internal
        view
        returns (bytes memory a, bytes memory b)
    {
        bytes memory m = market.settlementMessage(job, round, s, expiry);
        return (MockSig.sign(pk(vA), m), MockSig.sign(pk(vB), m));
    }

    function finalize(uint256 job, uint256 round, JobMarket.Settlement memory s) internal {
        uint64 expiry = uint64(block.number + 100);
        (bytes memory a, bytes memory b) = sigs(job, round, s, expiry);
        market.finalizeRound(job, round, s, expiry, a, b);
    }

    function threePayees() internal view returns (address[] memory p, uint256[] memory a) {
        p = new address[](3);
        a = new uint256[](3);
        uint256 budget = BUDGET / 2;
        for (uint256 i; i < 3; i++) {
            p[i] = nodes[i];
            a[i] = budget / 3;
        }
        a[0] += budget % 3;
    }

    // ------------------------------------------------------------------ tests

    function test_stakeBelowTheFloorIsRefused() public {
        JobMarket.JobParams memory p = params(1);
        p.budget = 100e6; // floor = 2 * 100 / 1 round / quorum 2 = 100 BERU, above STAKE
        vm.prank(owner);
        vm.expectRevert(JobMarket.StakeTooLow.selector);
        market.createJob(p);
        assertEq(market.minStake(100e6, 1, 2), 100e6);
        assertEq(market.minStake(BUDGET, 4, 2), market.MIN_STAKE()); // small jobs still need MIN_STAKE
        p.budget = BUDGET;
        p.stakePerNode = 14e6;
        vm.prank(owner);
        vm.expectRevert(JobMarket.StakeTooLow.selector);
        market.createJob(p);
    }

    function test_honestRoundPaysAndAdvancesWeights() public virtual {
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        (address[] memory p, uint256[] memory a) = threePayees();
        finalize(job, 1, settlement(0, 0, p, a));
        (, JobMarket.Job memory j) = market.getJob(job);
        assertEq(j.weights, keccak256("agg"));
        assertEq(market.claimable(nodes[0]), a[0]);
        vm.prank(nodes[0]);
        market.claim();
        assertEq(fusd.balanceOf(nodes[0]), a[0]);
        assertTrue(registry.getNode(nodes[0]).busyJob == 0);
    }

    function test_cheaterIsSlashedAndUnpaid() public {
        uint256 job = newJob(2);
        open(job, 4);
        work(job, 1, 4, 4, W0);
        (address[] memory p, uint256[] memory a) = threePayees();
        uint256 burnBefore = beru.balanceOf(registry.BURN());
        finalize(job, 1, settlement(0, uint32(1 << 3), p, a));
        assertEq(registry.getNode(nodes[3]).stake, 50e6 - STAKE);
        assertEq(beru.balanceOf(registry.BURN()) - burnBefore, STAKE);
        assertEq(market.claimable(nodes[3]), 0);
    }

    function test_payingASlashedNodeIsRejected() public {
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        (address[] memory p, uint256[] memory a) = threePayees();
        JobMarket.Settlement memory s = settlement(0, uint32(1 << 2), p, a);
        uint64 expiry = uint64(block.number + 100);
        (bytes memory sa, bytes memory sb) = sigs(job, 1, s, expiry);
        vm.expectRevert(JobMarket.BadPayouts.selector);
        market.finalizeRound(job, 1, s, expiry, sa, sb);
    }

    function test_forgedReplayedAndExpiredSignaturesFail() public {
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        (address[] memory p, uint256[] memory a) = threePayees();
        JobMarket.Settlement memory s = settlement(0, 0, p, a);
        uint64 expiry = uint64(block.number + 100);
        (bytes memory sa, bytes memory sb) = sigs(job, 1, s, expiry);

        vm.expectRevert(JobMarket.BadSignature.selector); // B's signature replaced by A's
        market.finalizeRound(job, 1, s, expiry, sa, sa);

        JobMarket.Settlement memory changed = settlement(0, 0, p, a);
        changed.aggregateHash = keccak256("other");
        vm.expectRevert(JobMarket.BadSignature.selector); // signed values tampered with
        market.finalizeRound(job, 1, changed, expiry, sa, sb);

        vm.expectRevert(JobMarket.BadSignature.selector); // same signatures, different expiry
        market.finalizeRound(job, 1, s, expiry + 1, sa, sb);

        vm.roll(expiry + 1);
        vm.expectRevert(JobMarket.SignatureExpired.selector);
        market.finalizeRound(job, 1, s, expiry, sa, sb);

        vm.roll(expiry - 50);
        market.finalizeRound(job, 1, s, expiry, sa, sb);
        vm.expectRevert(JobMarket.WrongState.selector); // replaying a used settlement
        market.finalizeRound(job, 1, s, expiry, sa, sb);
    }

    function test_signatureForAnotherRoundDoesNotCarryOver() public {
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        (address[] memory p, uint256[] memory a) = threePayees();
        JobMarket.Settlement memory s = settlement(0, 0, p, a);
        uint64 expiry = uint64(block.number + 100);
        (bytes memory sa, bytes memory sb) = sigs(job, 2, s, expiry); // signed for round 2
        vm.expectRevert(JobMarket.BadSignature.selector);
        market.finalizeRound(job, 1, s, expiry, sa, sb);
    }

    function test_unprovenVerifierKeyIsRejected() public {
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        MockKeyStatus(payable(PQ.KEY_STATUS)).setKey(vB, pk(vB), false);
        (address[] memory p, uint256[] memory a) = threePayees();
        JobMarket.Settlement memory s = settlement(0, 0, p, a);
        uint64 expiry = uint64(block.number + 100);
        (bytes memory sa, bytes memory sb) = sigs(job, 1, s, expiry);
        vm.expectRevert(abi.encodeWithSelector(PQ.KeyNotProven.selector, vB));
        market.finalizeRound(job, 1, s, expiry, sa, sb);
    }

    function test_copiedCommitmentCannotBeRevealed() public {
        uint256 job = newJob(2);
        open(job, 3);
        bytes32 root = Encodings.checkpointRoot(checkpoints(W0, nodes[0]));
        bytes32 h0 = Encodings.commitHash(market.domain(), job, 1, nodes[0], root, keccak256("salt"));
        vm.prank(nodes[0]);
        market.commit(job, 1, h0);
        vm.prank(nodes[1]);
        market.commit(job, 1, h0); // node 1 copies node 0's commitment
        vm.warp(block.timestamp + 101);
        bytes32[] memory c = checkpoints(W0, nodes[0]);
        vm.prank(nodes[1]);
        vm.expectRevert(JobMarket.BadCommit.selector);
        market.reveal(job, 1, c, keccak256("salt"));
    }

    function test_revealMustStartFromRoundWeights() public {
        uint256 job = newJob(2);
        open(job, 3);
        commitFor(job, 1, nodes[0], keccak256("wrong start"));
        vm.warp(block.timestamp + 101);
        bytes32[] memory c = checkpoints(keccak256("wrong start"), nodes[0]);
        vm.prank(nodes[0]);
        vm.expectRevert(JobMarket.BadCommit.selector);
        market.reveal(job, 1, c, keccak256("salt"));
    }

    function test_tooFewRevealsVoidsAndPenalisesMissing() public {
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 1, W0);
        market.voidRound(job, 1);
        (, JobMarket.Job memory j) = market.getJob(job);
        assertEq(j.remaining, BUDGET); // the round's budget went back
        assertEq(registry.getNode(nodes[2]).stake, 50e6 - STAKE / 10); // missed reveal: 10%
        assertEq(registry.getNode(nodes[0]).stake, 50e6);
    }

    function test_silentVerifiersLetAnyoneExpireTheRound() public {
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        vm.expectRevert(JobMarket.TooEarly.selector);
        market.expireRound(job, 1);
        vm.warp(block.timestamp + 101);
        market.expireRound(job, 1);
        (, JobMarket.Job memory j) = market.getJob(job);
        assertEq(j.remaining, BUDGET);
        assertEq(registry.getNode(nodes[0]).busyJob, 0);
    }

    function test_cancelRefundsAndLastRoundCompletesJob() public {
        uint256 job = newJob(1);
        open(job, 3);
        vm.prank(owner);
        vm.expectRevert(JobMarket.WrongState.selector); // not while a round is open
        market.cancelJob(job);
        work(job, 1, 3, 3, W0);
        address[] memory p = new address[](3);
        uint256[] memory a = new uint256[](3);
        for (uint256 i; i < 3; i++) {
            p[i] = nodes[i];
            a[i] = BUDGET / 3;
        }
        a[0] += BUDGET % 3;
        finalize(job, 1, settlement(0, 0, p, a));
        (, JobMarket.Job memory j) = market.getJob(job);
        assertEq(uint8(j.status), uint8(JobMarket.JobStatus.Completed));

        uint256 job2 = newJob(3);
        uint256 before = fusd.balanceOf(owner);
        vm.prank(owner);
        market.cancelJob(job2);
        assertEq(fusd.balanceOf(owner) - before, BUDGET);
    }

    function test_revertedRoundReturnsBudgetAndKeepsWeights() public {
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        finalize(job, 1, settlement(1, 0, new address[](0), new uint256[](0)));
        (, JobMarket.Job memory j) = market.getJob(job);
        assertEq(j.weights, W0);
        assertEq(j.remaining, BUDGET);
    }

    function test_accessAndStakeRules() public {
        uint256 job = newJob(2);
        address[] memory ns = new address[](2);
        ns[0] = nodes[0];
        ns[1] = nodes[1];
        uint8[] memory sh = new uint8[](2);
        vm.expectRevert(JobMarket.NotAuthorized.selector);
        market.openRound(job, ns, sh);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(PQ.KeyNotProven.selector, stranger));
        registry.join();

        open(job, 2);
        vm.prank(nodes[0]);
        vm.expectRevert(NodeRegistry.NodeIsBusy.selector);
        registry.withdrawStake(1);
    }

    function test_faucetCooldown() public {
        address u = makeAddr("user");
        vm.startPrank(u);
        faucet.claim();
        assertEq(beru.balanceOf(u), 100e6);
        vm.expectRevert();
        faucet.claim();
        vm.warp(block.timestamp + 1 days);
        faucet.claim();
        vm.stopPrank();
    }

    function test_checkSignatureMatchesFinalizePath() public view {
        bytes memory m = bytes("any message");
        assertTrue(market.checkSignature(vA, m, MockSig.sign(pk(vA), m)));
        assertFalse(market.checkSignature(vB, m, MockSig.sign(pk(vA), m)));
    }

    function testFuzz_payoutSumMustEqualBudget(uint256 extra) public {
        extra = bound(extra, 1, 1e12);
        uint256 job = newJob(2);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        (address[] memory p, uint256[] memory a) = threePayees();
        a[1] += extra;
        JobMarket.Settlement memory s = settlement(0, 0, p, a);
        uint64 expiry = uint64(block.number + 100);
        (bytes memory sa, bytes memory sb) = sigs(job, 1, s, expiry);
        vm.expectRevert(JobMarket.BadPayouts.selector);
        market.finalizeRound(job, 1, s, expiry, sa, sb);
    }
}


/// Same suite with probation on: a node needs 2 s of verified work (2 paid rounds at 1 s each) before it is paid.
contract ProbationTest is JobMarketTest {
    function probation() internal pure override returns (uint64) {
        return 2;
    }

    function refWork() internal pure override returns (uint32) {
        return 1;
    }

    /// Under probation the plain honest round forfeits instead of paying, which the tests below cover.
    function test_honestRoundPaysAndAdvancesWeights() public override {}

    function pay(uint256 job, uint256 round, uint256 total) internal {
        address[] memory p = new address[](3);
        uint256[] memory a = new uint256[](3);
        for (uint256 i; i < 3; i++) {
            p[i] = nodes[i];
            a[i] = total / 3;
        }
        a[0] += total % 3;
        finalize(job, round, settlement(0, 0, p, a));
    }

    function budgetOf(uint256 job, uint256 round) internal view returns (uint256 b, uint256 drip) {
        (JobMarket.Round memory r,) = market.getRound(job, round);
        return (r.budget, r.drip);
    }

    function test_newNodesForfeitToThePoolThenGraduateAndShareIt() public {
        uint256 job = newJob(3);
        // Round 1: all on probation, so every share goes to the pool and each node is credited 1 s.
        open(job, 3);
        work(job, 1, 3, 3, W0);
        (uint256 b1,) = budgetOf(job, 1);
        pay(job, 1, b1);
        assertEq(market.claimable(nodes[0]), 0);
        assertEq(market.communityPool(), b1);
        assertEq(registry.verifiedWorkSeconds(nodes[0]), 1);
        assertEq(registry.graduatedAt(nodes[0]), 0);

        // Round 2: still on probation when it opens, so it forfeits too; nodes graduate when it settles.
        vm.warp(vm.getBlockTimestamp() + 1);
        open(job, 3);
        (uint256 b2, uint256 d2) = budgetOf(job, 2);
        assertEq(d2, b1 / 10); // 10% of the pool is set aside at open
        work(job, 2, 3, 3, keccak256("agg"));
        pay(job, 2, b2); // nobody graduated yet, so the drip isn't paid out and returns to the pool
        assertEq(market.communityPool(), b1 + b2);
        assertTrue(registry.graduatedAt(nodes[0]) != 0);

        // Round 3: graduated before it opened, so shares plus the drip are paid out directly.
        vm.warp(vm.getBlockTimestamp() + 1);
        open(job, 3);
        (uint256 b3, uint256 d3) = budgetOf(job, 3);
        assertEq(d3, (b1 + b2) / 10);
        work(job, 3, 3, 3, keccak256("agg"));
        pay(job, 3, b3 + d3);
        assertEq(market.claimable(nodes[1]), (b3 + d3) / 3);
        assertEq(market.communityPool(), b1 + b2 - d3);
        // Every fUSD is accounted for: claims plus the pool equal what the owner paid in.
        uint256 claims = market.claimable(nodes[0]) + market.claimable(nodes[1]) + market.claimable(nodes[2]);
        assertEq(claims + market.communityPool(), BUDGET);
        assertEq(fusd.balanceOf(address(market)), BUDGET);
    }

    function test_payoutsMustIncludeTheDripOnlyWhenSomeoneGraduated() public {
        uint256 job = newJob(3);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        (uint256 b1,) = budgetOf(job, 1);
        pay(job, 1, b1);
        vm.warp(vm.getBlockTimestamp() + 1);
        open(job, 3);
        work(job, 2, 3, 3, keccak256("agg"));
        (uint256 b2, uint256 d2) = budgetOf(job, 2);
        address[] memory p = new address[](3);
        uint256[] memory a = new uint256[](3);
        for (uint256 i; i < 3; i++) {
            p[i] = nodes[i];
            a[i] = (b2 + d2) / 3;
        }
        a[0] += (b2 + d2) % 3;
        JobMarket.Settlement memory s = settlement(0, 0, p, a);
        uint64 expiry = uint64(block.number + 100);
        (bytes memory sa, bytes memory sb) = sigs(job, 2, s, expiry);
        vm.expectRevert(JobMarket.BadPayouts.selector); // all still on probation: no drip may be paid
        market.finalizeRound(job, 2, s, expiry, sa, sb);
    }

    function test_aGraduatedNodeCannotBeStarved() public {
        uint256 job = newJob(4);
        for (uint256 r = 1; r <= 2; r++) {
            vm.warp(vm.getBlockTimestamp() + 1);
            open(job, 3);
            work(job, r, 3, 3, r == 1 ? W0 : keccak256("agg"));
            (uint256 b,) = budgetOf(job, r);
            pay(job, r, b);
        }
        vm.warp(vm.getBlockTimestamp() + 1);
        open(job, 3);
        work(job, 3, 3, 3, keccak256("agg"));
        (uint256 b3, uint256 d3) = budgetOf(job, 3);
        address[] memory p = new address[](3);
        uint256[] memory a = new uint256[](3);
        p[0] = nodes[0];
        p[1] = nodes[1];
        p[2] = nodes[2];
        a[2] = b3 / 2 / 3 - 1; // just under half an equal share
        a[1] = (b3 + d3 - a[2]) / 2;
        a[0] = b3 + d3 - a[2] - a[1];
        JobMarket.Settlement memory s = settlement(0, 0, p, a);
        uint64 expiry = uint64(block.number + 100);
        (bytes memory sa, bytes memory sb) = sigs(job, 3, s, expiry);
        vm.expectRevert(JobMarket.BadPayouts.selector);
        market.finalizeRound(job, 3, s, expiry, sa, sb);
    }

    function test_aRevertedRoundReturnsItsDripToThePool() public {
        uint256 job = newJob(3);
        open(job, 3);
        work(job, 1, 3, 3, W0);
        (uint256 b1,) = budgetOf(job, 1);
        pay(job, 1, b1);
        vm.warp(vm.getBlockTimestamp() + 1);
        open(job, 3);
        (, uint256 d2) = budgetOf(job, 2);
        assertEq(market.communityPool(), b1 - d2);
        work(job, 2, 3, 3, keccak256("agg"));
        finalize(job, 2, settlement(1, 0, new address[](0), new uint256[](0)));
        assertEq(market.communityPool(), b1);
    }
}
