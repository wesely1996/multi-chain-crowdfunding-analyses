// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { CrowdfundingCampaign4626 } from "./CrowdfundingCampaign4626.sol";

/// @title CrowdfundingFactory4626
/// @notice Deploys and indexes CrowdfundingCampaign4626 instances (V2 ERC-4626 variant).
///         Each deployed campaign IS its own ERC-4626 vault share token.
contract CrowdfundingFactory4626 {
    CrowdfundingCampaign4626[] public campaigns;
    mapping(address => CrowdfundingCampaign4626[]) public campaignsByCreator;

    /// @notice Emitted when a new ERC-4626 campaign is created.
    /// @param campaign     Address of the deployed CrowdfundingCampaign4626 (also the share token).
    /// @param creator      Address of the campaign creator.
    /// @param paymentToken Address of the ERC-20 payment token (underlying asset).
    event CampaignCreated4626(
        address indexed campaign,
        address indexed creator,
        address indexed paymentToken
    );

    /// @notice Deploy a new ERC-4626 crowdfunding campaign.
    /// @param paymentToken         ERC-20 token contributors will deposit.
    /// @param softCap              Minimum raise for success (payment token units).
    /// @param hardCap              Maximum raise; contributions beyond this are rejected.
    /// @param deadline             Unix timestamp after which finalize() may be called.
    /// @param milestonePercentages Array of uint8 values summing to exactly 100.
    /// @param tokenName            Name for the ERC-20 share token.
    /// @param tokenSymbol          Symbol for the ERC-20 share token.
    /// @return campaign The newly deployed campaign contract.
    function createCampaign(
        IERC20 paymentToken,
        uint256 softCap,
        uint256 hardCap,
        uint256 deadline,
        uint8[] calldata milestonePercentages,
        string calldata tokenName,
        string calldata tokenSymbol
    ) external returns (CrowdfundingCampaign4626 campaign) {
        campaign = new CrowdfundingCampaign4626(
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

        emit CampaignCreated4626(address(campaign), msg.sender, address(paymentToken));
    }

    function getCampaignCount() external view returns (uint256) {
        return campaigns.length;
    }

    function getCampaignsByCreator(address creator) external view returns (CrowdfundingCampaign4626[] memory) {
        return campaignsByCreator[creator];
    }
}
