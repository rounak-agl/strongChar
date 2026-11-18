// SPDX-License-Identifier: MIT
// Test doubles: precompiles that really check keys and signatures, and a plain six-decimal fUSD.
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev pqcKeyStatus with per-account keys set by the test (storage lives at the precompile address after etch).
contract MockKeyStatus {
    struct K {
        bool registered;
        uint8 algo;
        bytes pubkey;
        bool proven;
    }

    mapping(address => K) internal keys;

    function setKey(address a, bytes calldata pubkey, bool proven) external {
        keys[a] = K(true, 1, pubkey, proven);
    }

    fallback(bytes calldata data) external returns (bytes memory) {
        address a = abi.decode(data[4:], (address));
        K storage k = keys[a];
        return abi.encode(k.registered, k.algo, k.pubkey, k.proven);
    }
}

/// @dev pqcVerify stand-in: a "signature" is valid only if it equals keccak(pubkey ‖ message), so tampering fails.
contract MockVerify {
    fallback(bytes calldata data) external returns (bytes memory) {
        (bytes memory pubkey, bytes memory sig, bytes memory message) = abi.decode(data[4:], (bytes, bytes, bytes));
        return abi.encode(keccak256(sig) == keccak256(abi.encodePacked(keccak256(abi.encodePacked(pubkey, message)))));
    }
}

library MockSig {
    function sign(bytes memory pubkey, bytes memory message) internal pure returns (bytes memory) {
        return abi.encodePacked(keccak256(abi.encodePacked(pubkey, message)));
    }
}

contract MockFUSD is ERC20 {
    constructor() ERC20("FestUSD", "fUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
