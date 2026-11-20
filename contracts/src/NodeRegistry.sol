// SPDX-License-Identifier: MIT
// Nodes join with a possession-proven ML-DSA-87 key and a BERU stake; only the JobMarket can mark busy, slash or
// credit verified work. A node is on probation until it has PROBATION_SECONDS of verified work behind it.
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {PQ} from "./PQ.sol";

contract NodeRegistry is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @dev Slashed stake goes here, out of everyone's reach, so no party profits from accusing a node.
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;

    struct Node {
        bool joined;
        uint128 stake;
        uint256 busyJob; // 0 = idle
        uint256 busyRound;
    }

    IERC20 public immutable beru;
    address public market;
    address private immutable _deployer;
    /// @notice Reference seconds of verified work a node needs before it is paid directly.
    uint64 public immutable PROBATION_SECONDS;
    mapping(address => uint64) public verifiedWorkSeconds;
    mapping(address => uint64) public graduatedAt; // 0 = still on probation
    // Kept as immutables so the full precompile addresses appear in deployed code (MEMORY D39).
    address public immutable verifyPrecompile = PQ.VERIFY;
    address public immutable keyStatusPrecompile = PQ.KEY_STATUS;
    mapping(address => Node) private _nodes;

    error NotAuthorized();
    error BadInput();
    error AlreadyJoined();
    error NotJoined();
    error NodeIsBusy();
    error NodeNotBusy();

    event MarketSet(address market);
    event NodeJoined(address indexed node);
    event StakeDeposited(address indexed node, uint256 amount, uint256 stake);
    event StakeWithdrawn(address indexed node, uint256 amount, uint256 stake);
    event NodeBusy(address indexed node, uint256 indexed jobId, uint256 indexed roundId);
    event NodeFreed(address indexed node, uint256 indexed jobId, uint256 indexed roundId);
    event StakeSlashed(address indexed node, uint256 indexed jobId, uint256 indexed roundId, uint256 amount);
    event WorkCredited(address indexed node, uint256 indexed jobId, uint256 indexed roundId, uint64 seconds_, uint64 total);
    event Graduated(address indexed node, uint64 at);

    modifier onlyMarket() {
        if (msg.sender != market) revert NotAuthorized();
        _;
    }

    constructor(address beru_, uint64 probationSeconds) {
        if (beru_ == address(0)) revert BadInput();
        beru = IERC20(beru_);
        _deployer = msg.sender;
        PROBATION_SECONDS = probationSeconds;
    }

    /// @dev One-time wiring, because the market's constructor needs this registry's address.
    function setMarket(address market_) external {
        if (msg.sender != _deployer || market != address(0)) revert NotAuthorized();
        if (market_ == address(0)) revert BadInput();
        market = market_;
        emit MarketSet(market_);
    }

    function join() external {
        if (_nodes[msg.sender].joined) revert AlreadyJoined();
        PQ.requireProven(msg.sender);
        _nodes[msg.sender].joined = true;
        emit NodeJoined(msg.sender);
    }

    function depositStake(uint128 amount) external nonReentrant {
        Node storage n = _nodes[msg.sender];
        if (!n.joined) revert NotJoined();
        if (amount == 0) revert BadInput();
        n.stake += amount;
        beru.safeTransferFrom(msg.sender, address(this), amount);
        emit StakeDeposited(msg.sender, amount, n.stake);
    }

    /// @dev Only a node busy in a round can be slashed, so an idle node may always withdraw: no unbonding delay.
    function withdrawStake(uint128 amount) external nonReentrant {
        Node storage n = _nodes[msg.sender];
        if (n.busyJob != 0) revert NodeIsBusy();
        if (amount == 0 || amount > n.stake) revert BadInput();
        n.stake -= amount;
        beru.safeTransfer(msg.sender, amount);
        emit StakeWithdrawn(msg.sender, amount, n.stake);
    }

    function markBusy(address node, uint256 jobId, uint256 roundId, uint128 minStake) external onlyMarket {
        Node storage n = _nodes[node];
        if (!n.joined) revert NotJoined();
        if (n.busyJob != 0) revert NodeIsBusy();
        if (n.stake < minStake) revert BadInput();
        // The key could have been rotated away since joining; re-check at every seat.
        PQ.requireProven(node);
        n.busyJob = jobId;
        n.busyRound = roundId;
        emit NodeBusy(node, jobId, roundId);
    }

    function markFree(address node, uint256 jobId, uint256 roundId) external onlyMarket {
        Node storage n = _nodes[node];
        if (n.busyJob != jobId || n.busyRound != roundId) revert NodeNotBusy();
        n.busyJob = 0;
        n.busyRound = 0;
        emit NodeFreed(node, jobId, roundId);
    }

    function slash(address node, uint256 jobId, uint256 roundId, uint256 amount)
        external
        onlyMarket
        nonReentrant
        returns (uint256 taken)
    {
        Node storage n = _nodes[node];
        if (n.busyJob != jobId || n.busyRound != roundId) revert NodeNotBusy();
        taken = amount < n.stake ? amount : n.stake;
        if (taken == 0) return 0;
        n.stake -= uint128(taken);
        beru.safeTransfer(BURN, taken);
        emit StakeSlashed(node, jobId, roundId, taken);
    }

    /// @dev Called once per paid round, so verified work can only come from settlements both verifiers signed.
    function creditWork(address node, uint256 jobId, uint256 roundId, uint64 seconds_) external onlyMarket {
        uint64 total = verifiedWorkSeconds[node] + seconds_;
        verifiedWorkSeconds[node] = total;
        emit WorkCredited(node, jobId, roundId, seconds_, total);
        if (graduatedAt[node] == 0 && total >= PROBATION_SECONDS) {
            graduatedAt[node] = uint64(block.timestamp);
            emit Graduated(node, uint64(block.timestamp));
        }
    }

    /// @notice True if the node had finished probation strictly before time `t` (a round's opening time).
    function graduatedBefore(address node, uint64 t) public view returns (bool) {
        uint64 g = graduatedAt[node];
        return PROBATION_SECONDS == 0 || (g != 0 && g < t);
    }

    function getNode(address node) external view returns (Node memory) {
        return _nodes[node];
    }
}
