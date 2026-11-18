// SPDX-License-Identifier: MIT
// Beru (BERU): fixed-supply six-decimal staking token; the whole supply is minted once at deploy, no admin.
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract BeruToken is ERC20 {
    error BadInput();

    /// @param faucet receives `faucetShare` for public claims; `treasury` receives the rest.
    constructor(address faucet, address treasury, uint256 supply, uint256 faucetShare) ERC20("Beru", "BERU") {
        if (faucet == address(0) || treasury == address(0) || faucetShare > supply) revert BadInput();
        _mint(faucet, faucetShare);
        _mint(treasury, supply - faucetShare);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
