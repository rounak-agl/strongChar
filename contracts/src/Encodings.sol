// SPDX-License-Identifier: MIT
// On-chain twins of strongchar_core.encodings; vectors/encodings.json pins both sides.
pragma solidity ^0.8.30;

library Encodings {
    bytes32 internal constant PQ_DOMAIN_TAG = keccak256("strongChar/pq/v1");
    uint8 internal constant KIND_SETTLEMENT = 1;
    uint8 internal constant KIND_VALIDITY = 2;
    uint8 internal constant KIND_SCORES = 3;

    struct Payout {
        address node;
        uint256 amount;
    }

    function domain(uint256 chainId, address market) internal pure returns (bytes32) {
        return keccak256(abi.encode(chainId, market));
    }

    function checkpointRoot(bytes32[] memory hashes) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(hashes));
    }

    function commitHash(bytes32 dom, uint256 job, uint256 round, address node, bytes32 root, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(dom, job, round, node, root, salt));
    }

    function payoutsHash(Payout[] memory payouts) internal pure returns (bytes32) {
        return keccak256(abi.encode(payouts));
    }

    function settlementPayload(
        uint256 job,
        uint256 round,
        uint8 outcome,
        bytes32 aggregateHash,
        uint32 slashedBitmap,
        bytes32 aggEvidenceHash,
        bytes32 payEvidenceHash,
        Payout[] memory payouts
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                job, round, outcome, aggregateHash, slashedBitmap, aggEvidenceHash, payEvidenceHash, payoutsHash(payouts)
            )
        );
    }

    /// @dev The exact bytes verifiers sign with ML-DSA-87 and pqcVerify checks; no hashing (spike S2).
    function pqMessage(uint256 chainId, address target, uint8 kind, bytes32 payloadHash, uint64 expiryBlock)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(PQ_DOMAIN_TAG, chainId, target, kind, payloadHash, expiryBlock);
    }

    function validityPayload(uint256 competition, uint256 entry, bool ok, bytes32 predHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(competition, entry, ok, predHash));
    }

    function scoresPayload(uint256 competition, uint256[] memory entries, int256[] memory scores)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(competition, entries, scores));
    }

    function labelCommit(bytes memory labels, bytes32 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(labels), salt));
    }
}
