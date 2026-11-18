// SPDX-License-Identifier: MIT
// Kaggle-style competitions where scripts are sealed to two verifiers, every validity verdict and the final score
// table carry both verifiers' ML-DSA-87 signatures checked by pqcVerify, and the hidden labels are committed up front
// and revealed on-chain so anyone can recompute the ranking.
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Encodings} from "./Encodings.sol";
import {PQ} from "./PQ.sol";

contract Competitions is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint256 public constant SETTLE_GRACE = 3 days; // after the reveal deadline, an unsettled prize can go home
    uint256 public constant MAX_ENTRIES = 256;

    enum Validity {
        Pending,
        Valid,
        Invalid
    }

    struct Competition {
        address host;
        bytes32 metaHash; // task, metric, data blobs, sandbox image digest: hashed off-chain
        bytes32 labelCommit; // keccak(abi.encode(keccak(labels), salt))
        uint256 prize; // fUSD base units
        uint64 deadline;
        uint64 revealDeadline;
        uint8 maxPerEntrant;
        bool scoresPosted;
        bool labelsRevealed;
        bool settled;
    }

    struct Entry {
        address entrant;
        bytes32 scriptHash; // keccak of the plaintext script, so it can be shown later without trusting anyone
        bytes32 envelopeHash; // keccak of the sealed upload the verifiers fetch
        Validity validity;
        bytes32 predHash; // canonical prediction hash both verifiers agreed on
        int256 score; // ×1e6, higher is better (RMSE stored negated)
    }

    IERC20 public immutable fusd;
    address public immutable verifierA;
    address public immutable verifierB;
    address public immutable verifyPrecompile = PQ.VERIFY;
    address public immutable keyStatusPrecompile = PQ.KEY_STATUS;

    uint256 public count;
    mapping(uint256 => Competition) private _comps;
    mapping(uint256 => Entry[]) private _entries;
    mapping(uint256 => mapping(address => uint8)) public entriesBy;
    mapping(address => uint256) public claimable;

    error NotAuthorized();
    error BadInput();
    error WrongState();
    error TooEarly();
    error TooLate();
    error BadSignature();
    error SignatureExpired();
    error BadLabels();
    error NothingToClaim();

    event Created(uint256 indexed id, address indexed host, bytes32 metaHash, uint256 prize, uint64 deadline);
    event Submitted(uint256 indexed id, uint256 indexed entry, address indexed entrant, bytes32 scriptHash,
        bytes32 envelopeHash);
    event ValidityPosted(uint256 indexed id, uint256 indexed entry, bool ok, bytes32 predHash);
    event ScoresPosted(uint256 indexed id, uint256[] entries, int256[] scores);
    event LabelsRevealed(uint256 indexed id, bytes labels, bytes32 salt);
    event Settled(uint256 indexed id, int256 winner, uint256 amount); // winner -1: prize returned to the host
    event Claimed(address indexed account, uint256 amount);

    constructor(address fusd_, address verifierA_, address verifierB_) {
        if (fusd_ == address(0) || verifierA_ == address(0) || verifierB_ == address(0) || verifierA_ == verifierB_) {
            revert BadInput();
        }
        fusd = IERC20(fusd_);
        verifierA = verifierA_;
        verifierB = verifierB_;
    }

    function create(
        bytes32 metaHash,
        bytes32 labelCommit,
        uint256 prize,
        uint64 deadline,
        uint64 revealDeadline,
        uint8 maxPerEntrant
    ) external nonReentrant returns (uint256 id) {
        if (prize == 0 || labelCommit == 0 || maxPerEntrant == 0 || deadline <= block.timestamp || revealDeadline <= deadline) {
            revert BadInput();
        }
        id = ++count;
        _comps[id] = Competition(msg.sender, metaHash, labelCommit, prize, deadline, revealDeadline, maxPerEntrant,
            false, false, false);
        fusd.safeTransferFrom(msg.sender, address(this), prize);
        emit Created(id, msg.sender, metaHash, prize, deadline);
    }

    function submit(uint256 id, bytes32 scriptHash, bytes32 envelopeHash) external returns (uint256 entry) {
        Competition storage c = _comps[id];
        if (c.host == address(0)) revert BadInput();
        if (block.timestamp > c.deadline) revert TooLate();
        if (entriesBy[id][msg.sender] >= c.maxPerEntrant || _entries[id].length >= MAX_ENTRIES) revert BadInput();
        if (scriptHash == 0 || envelopeHash == 0) revert BadInput();
        entriesBy[id][msg.sender]++;
        entry = _entries[id].length;
        _entries[id].push(Entry(msg.sender, scriptHash, envelopeHash, Validity.Pending, 0, 0));
        emit Submitted(id, entry, msg.sender, scriptHash, envelopeHash);
    }

    /// @notice Both verifiers ran the script in the pinned sandbox; valid only if both agreed on the prediction hash.
    function postValidity(
        uint256 id,
        uint256 entry,
        bool ok,
        bytes32 predHash,
        uint64 expiryBlock,
        bytes calldata sigA,
        bytes calldata sigB
    ) external nonReentrant {
        Entry storage e = _entry(id, entry);
        if (e.validity != Validity.Pending) revert WrongState();
        _checkSigs(Encodings.KIND_VALIDITY, Encodings.validityPayload(id, entry, ok, predHash), expiryBlock, sigA, sigB);
        e.validity = ok ? Validity.Valid : Validity.Invalid;
        e.predHash = predHash;
        emit ValidityPosted(id, entry, ok, predHash);
    }

    /// @notice One final score table after the deadline, covering exactly the valid entries in ascending order.
    function postScores(
        uint256 id,
        uint256[] calldata entries,
        int256[] calldata scores,
        uint64 expiryBlock,
        bytes calldata sigA,
        bytes calldata sigB
    ) external nonReentrant {
        Competition storage c = _comps[id];
        if (c.host == address(0) || c.scoresPosted) revert WrongState();
        if (block.timestamp <= c.deadline) revert TooEarly();
        if (entries.length != scores.length) revert BadInput();
        _checkSigs(Encodings.KIND_SCORES, Encodings.scoresPayload(id, entries, scores), expiryBlock, sigA, sigB);
        Entry[] storage all = _entries[id];
        uint256 k;
        for (uint256 i; i < all.length; i++) {
            if (all[i].validity != Validity.Valid) continue;
            if (k >= entries.length || entries[k] != i) revert BadInput(); // every valid entry, in order, nothing else
            all[i].score = scores[k];
            k++;
        }
        if (k != entries.length) revert BadInput();
        c.scoresPosted = true;
        emit ScoresPosted(id, entries, scores);
    }

    /// @notice The host reveals before the reveal deadline; after it, either verifier may (they hold the labels).
    function revealLabels(uint256 id, bytes calldata labels, bytes32 salt) external {
        Competition storage c = _comps[id];
        if (c.host == address(0) || c.labelsRevealed) revert WrongState();
        if (block.timestamp <= c.deadline) revert TooEarly();
        bool hostWindow = block.timestamp <= c.revealDeadline;
        if (hostWindow ? msg.sender != c.host : (msg.sender != verifierA && msg.sender != verifierB && msg.sender != c.host)) {
            revert NotAuthorized();
        }
        if (Encodings.labelCommit(labels, salt) != c.labelCommit) revert BadLabels();
        c.labelsRevealed = true;
        emit LabelsRevealed(id, labels, salt);
    }

    /// @notice Pays the best score (ties go to the earlier entry). With no valid entries, or nothing settled within
    ///         the grace period, the prize goes back to the host.
    function settle(uint256 id) external nonReentrant {
        Competition storage c = _comps[id];
        if (c.host == address(0) || c.settled) revert WrongState();
        if (block.timestamp <= c.deadline) revert TooEarly();
        int256 winner = -1;
        if (c.scoresPosted && c.labelsRevealed) {
            Entry[] storage all = _entries[id];
            for (uint256 i; i < all.length; i++) {
                if (all[i].validity == Validity.Valid && (winner < 0 || all[i].score > all[uint256(winner)].score)) {
                    winner = int256(i);
                }
            }
        } else if (block.timestamp <= c.revealDeadline + SETTLE_GRACE) {
            revert TooEarly(); // still waiting for scores or labels
        }
        c.settled = true;
        address payee = winner >= 0 ? _entries[id][uint256(winner)].entrant : c.host;
        claimable[payee] += c.prize;
        emit Settled(id, winner, c.prize);
    }

    function claim() external nonReentrant {
        uint256 amount = claimable[msg.sender];
        if (amount == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        fusd.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    function message(uint8 kind, bytes32 payload, uint64 expiryBlock) public view returns (bytes memory) {
        return Encodings.pqMessage(block.chainid, address(this), kind, payload, expiryBlock);
    }

    function getCompetition(uint256 id) external view returns (Competition memory) {
        return _comps[id];
    }

    function getEntries(uint256 id) external view returns (Entry[] memory) {
        return _entries[id];
    }

    function _entry(uint256 id, uint256 entry) private view returns (Entry storage) {
        if (entry >= _entries[id].length) revert BadInput();
        return _entries[id][entry];
    }

    function _checkSigs(uint8 kind, bytes32 payload, uint64 expiryBlock, bytes calldata sigA, bytes calldata sigB)
        private
        view
    {
        if (block.number > expiryBlock) revert SignatureExpired();
        bytes memory m = message(kind, payload, expiryBlock);
        if (!PQ.verify(PQ.requireProven(verifierA), sigA, m)) revert BadSignature();
        if (!PQ.verify(PQ.requireProven(verifierB), sigB, m)) revert BadSignature();
    }
}
