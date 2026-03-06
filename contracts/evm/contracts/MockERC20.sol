// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

// TEST ONLY — never deploy to mainnet
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockERC20
/// @notice Unrestricted-mint stablecoin used in tests and benchmarks (USDC-like, 6 decimals).
contract MockERC20 is ERC20 {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
