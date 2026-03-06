// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title CampaignToken
/// @notice ERC-20 receipt token minted 1:1 for each unit contributed to a campaign.
///         Only the parent CrowdfundingCampaign contract may mint or burn.
/// @dev D5: decimals_ is a constructor parameter so receipt token decimals match the payment token.
contract CampaignToken is ERC20 {
    address public immutable campaign;
    uint8 private immutable _decimals;

    error OnlyCampaign();

    modifier onlyCampaign() {
        if (msg.sender != campaign) revert OnlyCampaign();
        _;
    }

    constructor(
        address campaign_,
        string memory name_,
        string memory symbol_,
        uint8 decimals_
    ) ERC20(name_, symbol_) {
        campaign = campaign_;
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external onlyCampaign {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyCampaign {
        _burn(from, amount);
    }
}
