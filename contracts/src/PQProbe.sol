// SPDX-License-Identifier: MIT
// Minimal probe used by the Phase 0 spikes: reads PQ key status on-chain and records pings.
pragma solidity ^0.8.30;

import {PQ} from "./PQ.sol";

contract PQProbe {
    // Immutables are written into the deployed code as full 32-byte words, so the
    // complete precompile addresses appear in the runtime bytecode for anyone checking it.
    address public immutable verifyPrecompile = PQ.VERIFY;
    address public immutable keyStatusPrecompile = PQ.KEY_STATUS;

    event Pinged(address indexed from, bool provenKey);

    function proven(address account) external view returns (bool) {
        return PQ.keyStatus(account).possessionProven;
    }

    function ping() external returns (bool provenKey) {
        provenKey = PQ.keyStatus(msg.sender).possessionProven;
        emit Pinged(msg.sender, provenKey);
    }
}
