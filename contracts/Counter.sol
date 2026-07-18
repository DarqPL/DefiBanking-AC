// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract Counter is Ownable {
    uint public count;

    event CountIncremented(uint256 newCount);

    constructor() Ownable(msg.sender) {}

    function increment() public onlyOwner {
        count += 1;
        emit CountIncremented(count);
    }

    function getCount() public view returns (uint) {
        return count;
    }
}
