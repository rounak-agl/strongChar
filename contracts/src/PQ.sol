// SPDX-License-Identifier: MIT
// Wrappers for QoreChain's PQC precompiles: ML-DSA-87 verification and key status.
pragma solidity ^0.8.30;

library PQ {
    // Lower-case addresses: Solidity rejects mixed-case literals that fail the checksum.
    address internal constant VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant KEY_STATUS = 0x0000000000000000000000000000000000000a02;
    uint8 internal constant ML_DSA_87 = 1;

    error PrecompileInactive(address precompile);
    error KeyNotProven(address account);

    struct KeyStatus {
        bool registered;
        uint8 algorithmId;
        bytes pubkey;
        bool possessionProven;
    }

    function keyStatus(address account) internal view returns (KeyStatus memory s) {
        (bool ok, bytes memory ret) = KEY_STATUS.staticcall(abi.encodeWithSignature("pqcKeyStatus(address)", account));
        // An inactive precompile returns empty data; fail loudly instead of decoding garbage.
        if (!ok || ret.length == 0) revert PrecompileInactive(KEY_STATUS);
        (s.registered, s.algorithmId, s.pubkey, s.possessionProven) = abi.decode(ret, (bool, uint8, bytes, bool));
    }

    function requireProven(address account) internal view returns (bytes memory pubkey) {
        KeyStatus memory s = keyStatus(account);
        if (!s.registered || !s.possessionProven || s.algorithmId != ML_DSA_87) revert KeyNotProven(account);
        return s.pubkey;
    }

    function verify(bytes memory pubkey, bytes memory sig, bytes memory message) internal view returns (bool) {
        (bool ok, bytes memory ret) =
            VERIFY.staticcall(abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pubkey, sig, message));
        if (!ok || ret.length == 0) revert PrecompileInactive(VERIFY);
        return abi.decode(ret, (bool));
    }
}
