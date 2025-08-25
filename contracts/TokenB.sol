// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TokenB (TKB)
 * @dev Companion ERC-20 for LP pair creation.
 */
contract TokenB is ERC20 {
    /**
     * @param initialSupply Minted to the deployer (18-decimals).
     */
    constructor(uint256 initialSupply) ERC20("TokenB", "TKB") {
        _mint(msg.sender, initialSupply);
    }
}
