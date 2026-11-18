// SPDX-License-Identifier: MIT
// Sealed training jobs: fUSD budgets, commit/reveal rounds, and settlements accepted only with both verifiers'
// ML-DSA-87 signatures checked on-chain by the pqcVerify precompile.
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Encodings} from "./Encodings.sol";
import {NodeRegistry} from "./NodeRegistry.sol";
import {PQ} from "./PQ.sol";

contract JobMarket is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_NODES = 32; // the slashed bitmap is 32 bits wide
    uint256 public constant MAX_CHECKPOINTS = 64;
    uint256 public constant MISSED_REVEAL_BPS = 1000; // 10% of the job's stake per missed reveal

    enum JobStatus {
        None,
        Active,
        Completed,
        Cancelled
    }

    enum RoundStatus {
        None,
        Open,
        Settled,
        Reverted,
        Void,
        Expired
    }

    struct Windows {
        uint32 commit; // seconds from open to commit deadline
        uint32 reveal; // seconds from commit deadline to reveal deadline
        uint32 finalize; // seconds from reveal deadline to the last moment a settlement is accepted
    }

    struct JobParams {
        bytes32 specHash; // model, workload and hyper-parameters, hashed off-chain
        bytes32 initialWeightsHash;
        bytes32 shardTableHash;
        bytes32 dataCommit; // commitment to the sealed shards and validation split
        uint256 budget; // fUSD base units for the whole job
        uint128 stakePerNode; // BERU each seated node must hold
        uint16 rounds;
        uint8 quorum; // fewest revealed nodes a round needs
        uint8 maxNodes;
        Windows windows;
    }

    struct Job {
        address owner;
        JobStatus status;
        uint16 roundsOpened;
        uint256 remaining;
        bytes32 weights; // hash of the latest accepted global weights
    }

    struct Round {
        RoundStatus status;
        uint8 revealedCount;
        uint64 commitDeadline;
        uint64 revealDeadline;
        uint64 finalizeBy;
        uint256 budget;
        bytes32 startWeightsHash;
        bytes32 aggregateHash;
        bytes32 aggEvidenceHash;
        bytes32 payEvidenceHash;
        uint32 slashedBitmap;
    }

    struct Seat {
        uint8 slot;
        bool assigned;
        bytes32 commitHash;
        bool revealed;
        bytes32 finalHash; // last checkpoint hash: the node's claimed final weights
    }

    struct Settlement {
        uint8 outcome; // 0 accepted, 1 reverted
        bytes32 aggregateHash;
        uint32 slashedBitmap;
        bytes32 aggEvidenceHash;
        bytes32 payEvidenceHash;
        Encodings.Payout[] payouts;
    }

    IERC20 public immutable fusd;
    NodeRegistry public immutable registry;
    address public immutable coordinator;
    // Fixed at deploy with no setter: nobody can swap in friendlier verifiers later.
    address public immutable verifierA;
    address public immutable verifierB;
    address public immutable verifyPrecompile = PQ.VERIFY;
    address public immutable keyStatusPrecompile = PQ.KEY_STATUS;

    uint256 public jobCount;
    mapping(uint256 => JobParams) private _params;
    mapping(uint256 => Job) private _jobs;
    mapping(uint256 => mapping(uint256 => Round)) private _rounds;
    mapping(uint256 => mapping(uint256 => address[])) private _roster;
    mapping(uint256 => mapping(uint256 => mapping(address => Seat))) private _seats;
    mapping(address => uint256) public claimable;

    error NotAuthorized();
    error BadInput();
    error WrongState();
    error TooEarly();
    error TooLate();
    error QuorumNotMet();
    error BadCommit();
    error BadSignature();
    error SignatureExpired();
    error BadPayouts();
    error NothingToClaim();

    event JobCreated(uint256 indexed jobId, address indexed owner, uint256 budget, uint16 rounds, bytes32 specHash);
    event RoundOpened(
        uint256 indexed jobId,
        uint256 indexed roundId,
        address[] nodes,
        uint8[] shards,
        bytes32 startWeightsHash,
        uint64 commitDeadline,
        uint64 revealDeadline,
        uint64 finalizeBy,
        uint256 budget
    );
    event Committed(uint256 indexed jobId, uint256 indexed roundId, address indexed node, bytes32 commitHash);
    event Revealed(uint256 indexed jobId, uint256 indexed roundId, address indexed node, bytes32[] checkpoints);
    event RoundSettled(
        uint256 indexed jobId,
        uint256 indexed roundId,
        uint8 outcome,
        bytes32 aggregateHash,
        uint32 slashedBitmap,
        bytes32 aggEvidenceHash,
        bytes32 payEvidenceHash
    );
    event RoundClosedWithoutSettlement(uint256 indexed jobId, uint256 indexed roundId, RoundStatus status);
    event Slashed(uint256 indexed jobId, uint256 indexed roundId, address indexed node, uint256 amount, bool cheat);
    event JobClosed(uint256 indexed jobId, JobStatus status, uint256 refund);
    event Claimed(address indexed account, uint256 amount);

    constructor(address fusd_, address registry_, address coordinator_, address verifierA_, address verifierB_) {
        if (
            fusd_ == address(0) || registry_ == address(0) || coordinator_ == address(0) || verifierA_ == address(0)
                || verifierB_ == address(0) || verifierA_ == verifierB_
        ) revert BadInput();
        fusd = IERC20(fusd_);
        registry = NodeRegistry(registry_);
        coordinator = coordinator_;
        verifierA = verifierA_;
        verifierB = verifierB_;
    }

    // ------------------------------------------------------------------ jobs

    function createJob(JobParams calldata p) external nonReentrant returns (uint256 jobId) {
        if (
            p.rounds == 0 || p.quorum == 0 || p.maxNodes < p.quorum || p.maxNodes > MAX_NODES || p.budget == 0
                || p.windows.commit == 0 || p.windows.reveal == 0 || p.windows.finalize == 0
        ) revert BadInput();
        jobId = ++jobCount;
        _params[jobId] = p;
        _jobs[jobId] = Job(msg.sender, JobStatus.Active, 0, p.budget, p.initialWeightsHash);
        // fUSD is a plain six-decimal ERC-20 without transfer fees, so the amount pulled is the amount held.
        fusd.safeTransferFrom(msg.sender, address(this), p.budget);
        emit JobCreated(jobId, msg.sender, p.budget, p.rounds, p.specHash);
    }

    /// @notice The owner can stop a job between rounds and take back whatever budget is left.
    function cancelJob(uint256 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (msg.sender != j.owner) revert NotAuthorized();
        if (j.status != JobStatus.Active) revert WrongState();
        if (j.roundsOpened > 0 && _rounds[jobId][j.roundsOpened].status == RoundStatus.Open) revert WrongState();
        _closeJob(jobId, JobStatus.Cancelled);
    }

    // ---------------------------------------------------------------- rounds

    function openRound(uint256 jobId, address[] calldata nodes, uint8[] calldata shards) external nonReentrant {
        if (msg.sender != coordinator) revert NotAuthorized();
        JobParams storage p = _params[jobId];
        Job storage j = _jobs[jobId];
        if (j.status != JobStatus.Active || j.roundsOpened == p.rounds) revert WrongState();
        if (j.roundsOpened > 0 && _rounds[jobId][j.roundsOpened].status == RoundStatus.Open) revert WrongState();
        if (nodes.length < p.quorum) revert QuorumNotMet();
        if (nodes.length > p.maxNodes || shards.length != nodes.length) revert BadInput();

        uint256 roundId = ++j.roundsOpened;
        for (uint256 i; i < nodes.length; i++) {
            Seat storage s = _seats[jobId][roundId][nodes[i]];
            if (s.assigned) revert BadInput(); // one seat per node per round
            s.assigned = true;
            s.slot = uint8(i);
            registry.markBusy(nodes[i], jobId, roundId, p.stakePerNode);
        }
        _roster[jobId][roundId] = nodes;

        Round storage r = _rounds[jobId][roundId];
        uint64 t = uint64(block.timestamp);
        r.status = RoundStatus.Open;
        r.commitDeadline = t + p.windows.commit;
        r.revealDeadline = r.commitDeadline + p.windows.reveal;
        r.finalizeBy = r.revealDeadline + p.windows.finalize;
        r.budget = j.remaining / (p.rounds - roundId + 1);
        r.startWeightsHash = j.weights;
        j.remaining -= r.budget;
        emit RoundOpened(
            jobId, roundId, nodes, shards, r.startWeightsHash, r.commitDeadline, r.revealDeadline, r.finalizeBy, r.budget
        );
    }

    function commit(uint256 jobId, uint256 roundId, bytes32 commitHash) external {
        Round storage r = _rounds[jobId][roundId];
        Seat storage s = _seats[jobId][roundId][msg.sender];
        if (r.status != RoundStatus.Open || !s.assigned || s.commitHash != 0 || commitHash == 0) revert WrongState();
        if (block.timestamp > r.commitDeadline) revert TooLate();
        s.commitHash = commitHash;
        emit Committed(jobId, roundId, msg.sender, commitHash);
    }

    /// @dev The commitment binds the node's own address, so posting another node's commit and reveal fails here.
    function reveal(uint256 jobId, uint256 roundId, bytes32[] calldata checkpoints, bytes32 salt) external {
        Round storage r = _rounds[jobId][roundId];
        Seat storage s = _seats[jobId][roundId][msg.sender];
        if (r.status != RoundStatus.Open || s.commitHash == 0 || s.revealed) revert WrongState();
        if (block.timestamp <= r.commitDeadline) revert TooEarly();
        if (block.timestamp > r.revealDeadline) revert TooLate();
        if (checkpoints.length < 2 || checkpoints.length > MAX_CHECKPOINTS) revert BadInput();
        if (checkpoints[0] != r.startWeightsHash) revert BadCommit(); // training must start from this round's weights
        bytes32 root = Encodings.checkpointRoot(checkpoints);
        if (Encodings.commitHash(domain(), jobId, roundId, msg.sender, root, salt) != s.commitHash) revert BadCommit();
        s.revealed = true;
        s.finalHash = checkpoints[checkpoints.length - 1];
        r.revealedCount++;
        emit Revealed(jobId, roundId, msg.sender, checkpoints);
    }

    /// @notice Anyone may submit a settlement; it counts only if both verifiers signed exactly these values.
    function finalizeRound(
        uint256 jobId,
        uint256 roundId,
        Settlement calldata st,
        uint64 expiryBlock,
        bytes calldata sigA,
        bytes calldata sigB
    ) external nonReentrant {
        Round storage r = _rounds[jobId][roundId];
        if (r.status != RoundStatus.Open) revert WrongState();
        if (block.timestamp <= r.revealDeadline) revert TooEarly();
        if (block.timestamp > r.finalizeBy) revert TooLate();
        if (block.number > expiryBlock) revert SignatureExpired();
        if (r.revealedCount < _params[jobId].quorum) revert QuorumNotMet();
        if (st.outcome > 1) revert BadInput();
        _checkSignatures(jobId, roundId, st, expiryBlock, sigA, sigB);

        address[] storage roster = _roster[jobId][roundId];
        if (st.slashedBitmap >> roster.length != 0) revert BadInput();
        uint128 stake = _params[jobId].stakePerNode;
        for (uint256 i; i < roster.length; i++) {
            if ((st.slashedBitmap >> i) & 1 == 1) {
                if (!_seats[jobId][roundId][roster[i]].revealed) revert BadInput(); // only a replayed lie is a cheat
                uint256 taken = registry.slash(roster[i], jobId, roundId, stake);
                emit Slashed(jobId, roundId, roster[i], taken, true);
            }
        }

        Job storage j = _jobs[jobId];
        if (st.outcome == 0) {
            _pay(jobId, roundId, r, st);
            j.weights = st.aggregateHash;
            r.aggregateHash = st.aggregateHash;
            r.status = RoundStatus.Settled;
        } else {
            if (st.payouts.length != 0) revert BadPayouts();
            j.remaining += r.budget; // nothing earned: the round's budget goes back to the job
            r.aggregateHash = r.startWeightsHash;
            r.status = RoundStatus.Reverted;
        }
        r.slashedBitmap = st.slashedBitmap;
        r.aggEvidenceHash = st.aggEvidenceHash;
        r.payEvidenceHash = st.payEvidenceHash;
        emit RoundSettled(
            jobId, roundId, st.outcome, r.aggregateHash, st.slashedBitmap, st.aggEvidenceHash, st.payEvidenceHash
        );
        _closeRound(jobId, roundId);
    }

    /// @notice Too few reveals: anyone may void the round once reveals are over; the budget returns to the job.
    function voidRound(uint256 jobId, uint256 roundId) external nonReentrant {
        Round storage r = _rounds[jobId][roundId];
        if (r.status != RoundStatus.Open) revert WrongState();
        if (block.timestamp <= r.revealDeadline) revert TooEarly();
        if (r.revealedCount >= _params[jobId].quorum) revert WrongState();
        _unsettled(jobId, roundId, RoundStatus.Void);
    }

    /// @notice The verifiers never settled in time: anyone may close the round; nobody is paid or slashed for work.
    function expireRound(uint256 jobId, uint256 roundId) external nonReentrant {
        Round storage r = _rounds[jobId][roundId];
        if (r.status != RoundStatus.Open) revert WrongState();
        if (block.timestamp <= r.finalizeBy) revert TooEarly();
        _unsettled(jobId, roundId, RoundStatus.Expired);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        fusd.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ----------------------------------------------------------------- views

    /// @dev Computed per call so it follows block.chainid after a fork.
    function domain() public view returns (bytes32) {
        return Encodings.domain(block.chainid, address(this));
    }

    function settlementMessage(uint256 jobId, uint256 roundId, Settlement calldata st, uint64 expiryBlock)
        public
        view
        returns (bytes memory)
    {
        bytes32 payload = Encodings.settlementPayload(
            jobId,
            roundId,
            st.outcome,
            st.aggregateHash,
            st.slashedBitmap,
            st.aggEvidenceHash,
            st.payEvidenceHash,
            st.payouts
        );
        return Encodings.pqMessage(block.chainid, address(this), Encodings.KIND_SETTLEMENT, payload, expiryBlock);
    }

    /// @notice The exact check finalizeRound applies to one verifier signature; free to call with eth_call.
    function checkSignature(address verifier, bytes calldata message, bytes calldata sig) external view returns (bool) {
        if (verifier != verifierA && verifier != verifierB) revert NotAuthorized();
        return PQ.verify(PQ.requireProven(verifier), sig, message);
    }

    function getJob(uint256 jobId) external view returns (JobParams memory, Job memory) {
        return (_params[jobId], _jobs[jobId]);
    }

    function getRound(uint256 jobId, uint256 roundId) external view returns (Round memory, address[] memory) {
        return (_rounds[jobId][roundId], _roster[jobId][roundId]);
    }

    function getSeat(uint256 jobId, uint256 roundId, address node) external view returns (Seat memory) {
        return _seats[jobId][roundId][node];
    }

    // -------------------------------------------------------------- internal

    function _checkSignatures(
        uint256 jobId,
        uint256 roundId,
        Settlement calldata st,
        uint64 expiryBlock,
        bytes calldata sigA,
        bytes calldata sigB
    ) private view {
        bytes memory message = settlementMessage(jobId, roundId, st, expiryBlock);
        // Keys are read live from the chain's registry and must be possession-proven ML-DSA-87.
        if (!PQ.verify(PQ.requireProven(verifierA), sigA, message)) revert BadSignature();
        if (!PQ.verify(PQ.requireProven(verifierB), sigB, message)) revert BadSignature();
    }

    function _pay(uint256 jobId, uint256 roundId, Round storage r, Settlement calldata st) private {
        uint256 total;
        address previous;
        for (uint256 i; i < st.payouts.length; i++) {
            address node = st.payouts[i].node;
            Seat storage s = _seats[jobId][roundId][node];
            // Ascending order makes duplicates impossible; payees must have revealed and not been slashed.
            if (uint160(node) <= uint160(previous) || !s.revealed || (st.slashedBitmap >> s.slot) & 1 == 1) {
                revert BadPayouts();
            }
            previous = node;
            total += st.payouts[i].amount;
            claimable[node] += st.payouts[i].amount;
        }
        if (total != r.budget || st.payouts.length == 0) revert BadPayouts();
    }

    function _unsettled(uint256 jobId, uint256 roundId, RoundStatus status) private {
        Round storage r = _rounds[jobId][roundId];
        _jobs[jobId].remaining += r.budget;
        r.aggregateHash = r.startWeightsHash;
        r.status = status;
        emit RoundClosedWithoutSettlement(jobId, roundId, status);
        _closeRound(jobId, roundId);
    }

    /// @dev Frees every seat; a seated node that never revealed loses a slice of its stake.
    function _closeRound(uint256 jobId, uint256 roundId) private {
        address[] storage roster = _roster[jobId][roundId];
        uint256 penalty = uint256(_params[jobId].stakePerNode) * MISSED_REVEAL_BPS / 10_000;
        bool punishMissing = _rounds[jobId][roundId].status != RoundStatus.Expired;
        for (uint256 i; i < roster.length; i++) {
            if (punishMissing && !_seats[jobId][roundId][roster[i]].revealed && penalty > 0) {
                uint256 taken = registry.slash(roster[i], jobId, roundId, penalty);
                emit Slashed(jobId, roundId, roster[i], taken, false);
            }
            registry.markFree(roster[i], jobId, roundId);
        }
        Job storage j = _jobs[jobId];
        if (roundId == _params[jobId].rounds) _closeJob(jobId, JobStatus.Completed);
        else if (j.status != JobStatus.Active) revert WrongState();
    }

    function _closeJob(uint256 jobId, JobStatus status) private {
        Job storage j = _jobs[jobId];
        uint256 refund = j.remaining;
        j.remaining = 0;
        j.status = status;
        if (refund > 0) fusd.safeTransfer(j.owner, refund);
        emit JobClosed(jobId, status, refund);
    }
}
