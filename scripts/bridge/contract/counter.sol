// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract counter {
    uint256 public count;

    constructor() {
        count = 0;
    }

    function increment(uint256 amount) public payable {
        count = count + amount;
    }
  
}