// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @title CampaignTierToken
/// @notice ERC-1155 tier token minted 1:1 per tier contribution to a campaign.
///         Token ID 0 = Bronze, 1 = Silver, 2 = Gold (or whatever the campaign defines).
///         Only the parent CrowdfundingCampaign1155 contract may mint or burn.
contract CampaignTierToken is ERC1155 {
    address public immutable campaign;

    error OnlyCampaign();

    modifier onlyCampaign() {
        if (msg.sender != campaign) revert OnlyCampaign();
        _;
    }

    constructor(address campaign_, string memory uri_) ERC1155(uri_) {
        campaign = campaign_;
    }

    /// @notice Mint `qty` tokens of `tierId` to `to`. Only callable by the parent campaign.
    function mint(address to, uint256 tierId, uint256 qty) external onlyCampaign {
        _mint(to, tierId, qty, "");
    }

    /// @notice Burn `qty` tokens of `tierId` from `from`. Only callable by the parent campaign.
    function burn(address from, uint256 tierId, uint256 qty) external onlyCampaign {
        _burn(from, tierId, qty);
    }
}
