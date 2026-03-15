// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { CrowdfundingCampaign1155 } from "./CrowdfundingCampaign1155.sol";

/// @title CrowdfundingFactory1155
/// @notice Deploys and indexes CrowdfundingCampaign1155 instances (V3 ERC-1155 variant).
contract CrowdfundingFactory1155 {
    CrowdfundingCampaign1155[] public campaigns;
    mapping(address => CrowdfundingCampaign1155[]) public campaignsByCreator;

    /// @notice Emitted when a new ERC-1155 tier campaign is created.
    /// @param campaign     Address of the deployed campaign.
    /// @param creator      Address of the campaign creator.
    /// @param paymentToken Address of the ERC-20 payment token.
    /// @param tierToken    Address of the deployed CampaignTierToken (ERC-1155).
    event CampaignCreated1155(
        address indexed campaign,
        address indexed creator,
        address indexed paymentToken,
        address tierToken
    );

    /// @notice Deploy a new ERC-1155 tier-based crowdfunding campaign.
    function createCampaign(
        IERC20 paymentToken,
        uint256 softCap,
        uint256 hardCap,
        uint256 deadline,
        uint8[] calldata milestonePercentages,
        uint256[3] calldata tierPrices,
        string[3] calldata tierNames,
        string calldata tokenUri
    ) external returns (CrowdfundingCampaign1155 campaign) {
        campaign = new CrowdfundingCampaign1155(
            msg.sender,
            paymentToken,
            softCap,
            hardCap,
            deadline,
            milestonePercentages,
            tierPrices,
            tierNames,
            tokenUri
        );

        campaigns.push(campaign);
        campaignsByCreator[msg.sender].push(campaign);

        emit CampaignCreated1155(
            address(campaign),
            msg.sender,
            address(paymentToken),
            address(campaign.tierToken())
        );
    }

    function getCampaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    function getCampaignsByCreator(address creator) external view returns (CrowdfundingCampaign1155[] memory) {
        return campaignsByCreator[creator];
    }
}
