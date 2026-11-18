// SPDX-License-Identifier: MIT
// Hands out a fixed BERU allocation per address per cooldown from the faucet's own inventory.
pragma solidity ^0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

contract BeruFaucet is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public token;
    uint256 public immutable allocation;
    uint256 public immutable cooldown;
    address private immutable _deployer;
    mapping(address => uint256) public nextClaimAt;

    error BadInput();
    error AlreadySet();
    error CooldownActive(uint256 nextClaim);
    error EmptyFaucet();

    event Claimed(address indexed account, uint256 amount, uint256 nextClaim);

    constructor(uint256 allocation_, uint256 cooldown_) {
        if (allocation_ == 0 || cooldown_ == 0 || cooldown_ > 30 days) revert BadInput();
        allocation = allocation_;
        cooldown = cooldown_;
        _deployer = msg.sender;
    }

    /// @dev One-time wiring: the token mints the faucet's inventory to this contract, so it must exist first.
    function setToken(address token_) external {
        if (msg.sender != _deployer || address(token) != address(0)) revert AlreadySet();
        if (token_ == address(0)) revert BadInput();
        token = IERC20(token_);
    }

    function claim() external nonReentrant {
        uint256 next = nextClaimAt[msg.sender];
        if (block.timestamp < next) revert CooldownActive(next);
        if (token.balanceOf(address(this)) < allocation) revert EmptyFaucet();
        next = block.timestamp + cooldown;
        nextClaimAt[msg.sender] = next;
        token.safeTransfer(msg.sender, allocation);
        emit Claimed(msg.sender, allocation, next);
    }
}
