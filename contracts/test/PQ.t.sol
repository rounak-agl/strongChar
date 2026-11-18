// SPDX-License-Identifier: MIT
// Tests the PQ library against mocked precompiles: decoding, proven-key checks, inactive precompiles.
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {PQ} from "../src/PQ.sol";

contract MockVerify {
    bool public answer = true;

    function set(bool a) external {
        answer = a;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(answer);
    }
}

contract MockKeyStatus {
    bool registered;
    uint8 algo;
    bool proven;

    function set(bool r, uint8 a, bool p) external {
        (registered, algo, proven) = (r, a, p);
    }

    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(registered, algo, hex"aabb", proven);
    }
}

contract PQHarness {
    function requireProven(address a) external view returns (bytes memory) {
        return PQ.requireProven(a);
    }

    function verify(bytes calldata p, bytes calldata s, bytes calldata m) external view returns (bool) {
        return PQ.verify(p, s, m);
    }
}

contract PQTest is Test {
    PQHarness h;

    function setUp() public {
        h = new PQHarness();
        vm.etch(PQ.VERIFY, address(new MockVerify()).code);
        vm.etch(PQ.KEY_STATUS, address(new MockKeyStatus()).code);
    }

    function test_provenKeyReturnsPubkey() public {
        MockKeyStatus(payable(PQ.KEY_STATUS)).set(true, 1, true);
        assertEq(h.requireProven(address(0xBEEF)), hex"aabb");
    }

    function test_unprovenKeyRejected() public {
        MockKeyStatus(payable(PQ.KEY_STATUS)).set(true, 1, false);
        vm.expectRevert(abi.encodeWithSelector(PQ.KeyNotProven.selector, address(0xBEEF)));
        h.requireProven(address(0xBEEF));
    }

    function test_wrongAlgorithmRejected() public {
        MockKeyStatus(payable(PQ.KEY_STATUS)).set(true, 2, true);
        vm.expectRevert(abi.encodeWithSelector(PQ.KeyNotProven.selector, address(0xBEEF)));
        h.requireProven(address(0xBEEF));
    }

    function test_verifyPassesThroughAnswer() public {
        // vm.etch copies code, not storage, so the mock's answer must be set explicitly.
        MockVerify(payable(PQ.VERIFY)).set(true);
        assertTrue(h.verify("k", "s", "m"));
        MockVerify(payable(PQ.VERIFY)).set(false);
        assertFalse(h.verify("k", "s", "m"));
    }

    function test_inactivePrecompileReverts() public {
        vm.etch(PQ.VERIFY, "");
        vm.expectRevert(abi.encodeWithSelector(PQ.PrecompileInactive.selector, PQ.VERIFY));
        h.verify("k", "s", "m");
    }
}
