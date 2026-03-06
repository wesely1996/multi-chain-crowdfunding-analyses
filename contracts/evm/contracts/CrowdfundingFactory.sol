// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { CrowdfundingCampaign } from "./CrowdfundingCampaign.sol";

/// @title CrowdfundingFactory
/// @notice Deploys and indexes CrowdfundingCampaign instances.
contract CrowdfundingFactory {
    CrowdfundingCampaign[] public campaigns;
    mapping(address => CrowdfundingCampaign[]) public campaignsByCreator;

    event CampaignCreated(
        address indexed campaign,
        address indexed creator,
        address indexed paymentToken
    );

    function createCampaign(
        IERC20 paymentToken,
        uint256 softCap,
        uint256 hardCap,
        uint256 deadline,
        uint8[] calldata milestonePercentages,
        string calldata tokenName,
        string calldata tokenSymbol
    ) external returns (CrowdfundingCampaign campaign) {
        campaign = new CrowdfundingCampaign(
            msg.sender,
            paymentToken,
            softCap,
            hardCap,
            deadline,
            milestonePercentages,
            tokenName,
            tokenSymbol
        );

        campaigns.push(campaign);
        campaignsByCreator[msg.sender].push(campaign);

        emit CampaignCreated(address(campaign), msg.sender, address(paymentToken));
    }

    function getCampaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    function getCampaignsByCreator(address creator) external view returns (CrowdfundingCampaign[] memory) {
        return campaignsByCreator[creator];
    }
}
