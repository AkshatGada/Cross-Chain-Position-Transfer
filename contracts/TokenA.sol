// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TokenA (TKA)
 * @dev Simple ERC-20 used for POC liquidity pools.
 */
contract TokenA is ERC20 {
    /**
     * @param initialSupply Minted to the deployer (18-decimals).
     */
    constructor(uint256 initialSupply) ERC20("TokenA", "TKA") {
        _mint(msg.sender, initialSupply);
    }
}
