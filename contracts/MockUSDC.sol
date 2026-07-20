// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Local testing ERC20 token that mimics USDC's 6 decimal precision.
 */
contract MockUSDC is ERC20 {
    /// @notice Initial supply minted to the deployer: 1,000,000 USDC with 6 decimals.
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 6;

    /**
     * @notice Mints the initial supply to the deployer.
     */
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, INITIAL_SUPPLY);
    }

    /**
     * @notice Returns the number of decimals used by USDC.
     * @return The USDC decimal precision, fixed at 6.
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Mints MockUSDC to a target account for local testing.
     * @param to Recipient of the minted tokens.
     * @param amount Amount to mint using 6 decimal precision.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
