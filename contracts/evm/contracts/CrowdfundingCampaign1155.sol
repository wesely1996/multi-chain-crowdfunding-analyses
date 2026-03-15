// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { CampaignTierToken } from "./CampaignTierToken.sol";

/// @title CrowdfundingCampaign1155
/// @notice ERC-1155 tier-based crowdfunding campaign (V3 EVM variant).
///         Contributors select a tier (Bronze/Silver/Gold) and receive a corresponding
///         ERC-1155 token. Refunds are per-tier and burn the associated token.
///         State machine: Created → Funding → Finalized → Success (milestone withdrawals)
///                                                      └→ Failed  (contributor refunds)
contract CrowdfundingCampaign1155 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Immutables
    // -------------------------------------------------------------------------
    address public immutable creator;
    IERC20  public immutable paymentToken;
    uint256 public immutable softCap;
    uint256 public immutable hardCap;
    uint256 public immutable deadline;

    // -------------------------------------------------------------------------
    // Storage — slot 0
    // -------------------------------------------------------------------------
    uint256 public totalRaised;

    // Storage — slot 1 (packed: bool + bool + uint8 = 3 bytes)
    bool   public finalized;
    bool   public successful;
    uint8  public currentMilestone;

    // Storage — slot 2
    uint256 public totalWithdrawn;

    // -------------------------------------------------------------------------
    // Tier storage
    // -------------------------------------------------------------------------
    struct Tier {
        uint256 price;
        string  name;
    }

    Tier[3] public tiers;
    CampaignTierToken public tierToken;

    /// @notice Maps contributor → tierId → number of tokens held (count, not USDC).
    mapping(address => mapping(uint256 => uint256)) public tierContributions;

    /// @notice Maps contributor → total USDC contributed (all tiers combined).
    ///         Used for totalRaised / softCap accounting and consistent with V1/V2.
    mapping(address => uint256) public contributions;

    // Dynamic storage
    uint8[] public milestonePercentages;

    // -------------------------------------------------------------------------
    // Custom errors
    // -------------------------------------------------------------------------
    error NotCreator();
    error DeadlineNotReached();
    error AlreadyFinalized();
    error InvalidDeadline();
    error InvalidCapRange();
    error InvalidMilestonePercentages();
    error ContributionExceedsHardCap();
    error CampaignNotActive();
    error CampaignNotSuccessful();
    error CampaignNotFailed();
    error NoMoreMilestones();
    error ZeroAmount();
    error InvalidTierId();
    error NothingToRefundForTier();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event CampaignCreated(
        address indexed creator,
        uint256 softCap,
        uint256 hardCap,
        uint256 deadline
    );
    event Contributed(
        address indexed contributor,
        uint256 amount,
        uint256 totalRaised
    );
    event Finalized(bool successful, uint256 totalRaised);
    event MilestoneWithdrawn(uint256 indexed milestoneIndex, uint256 amount, address recipient);
    event Refunded(address indexed contributor, uint256 amount);

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------
    constructor(
        address creator_,
        IERC20 paymentToken_,
        uint256 softCap_,
        uint256 hardCap_,
        uint256 deadline_,
        uint8[] memory milestonePercentages_,
        uint256[3] memory tierPrices_,
        string[3] memory tierNames_,
        string memory tokenUri_
    ) {
        if (softCap_ > hardCap_)               revert InvalidCapRange();
        if (deadline_ <= block.timestamp)       revert InvalidDeadline();
        if (milestonePercentages_.length == 0)  revert InvalidMilestonePercentages();

        uint256 sum;
        for (uint256 i; i < milestonePercentages_.length; ++i) {
            sum += milestonePercentages_[i];
        }
        if (sum != 100) revert InvalidMilestonePercentages();

        creator      = creator_;
        paymentToken = paymentToken_;
        softCap      = softCap_;
        hardCap      = hardCap_;
        deadline     = deadline_;

        for (uint256 i; i < milestonePercentages_.length; ++i) {
            milestonePercentages.push(milestonePercentages_[i]);
        }

        for (uint256 i; i < 3; ++i) {
            tiers[i] = Tier({ price: tierPrices_[i], name: tierNames_[i] });
        }

        tierToken = new CampaignTierToken(address(this), tokenUri_);

        emit CampaignCreated(creator_, softCap_, hardCap_, deadline_);
    }

    // -------------------------------------------------------------------------
    // Core functions
    // -------------------------------------------------------------------------

    /// @notice Contribute to a specific tier. Mints 1 ERC-1155 token of that tier to the caller.
    /// @param tierId Tier index: 0 = Bronze, 1 = Silver, 2 = Gold.
    function contribute(uint256 tierId) external nonReentrant {
        if (tierId >= 3)                            revert InvalidTierId();
        if (finalized)                              revert CampaignNotActive();
        if (block.timestamp > deadline)             revert CampaignNotActive();

        uint256 amount = tiers[tierId].price;
        if (totalRaised + amount > hardCap)         revert ContributionExceedsHardCap();

        // CEI: update state before external calls
        contributions[msg.sender]          += amount;
        tierContributions[msg.sender][tierId] += 1;
        totalRaised                        += amount;

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        tierToken.mint(msg.sender, tierId, 1);

        emit Contributed(msg.sender, amount, totalRaised);
    }

    /// @notice Finalize the campaign. Permissionless after deadline — prevents creator blocking refunds.
    function finalize() external {
        if (block.timestamp <= deadline) revert DeadlineNotReached();
        if (finalized)                   revert AlreadyFinalized();

        finalized  = true;
        successful = (totalRaised >= softCap);

        emit Finalized(successful, totalRaised);
    }

    /// @notice Withdraw the next milestone tranche. Only the creator may call.
    ///         Last milestone sweeps the remaining balance to avoid dust.
    function withdrawMilestone() external nonReentrant {
        if (msg.sender != creator)                           revert NotCreator();
        if (!finalized || !successful)                       revert CampaignNotSuccessful();
        if (currentMilestone >= milestonePercentages.length) revert NoMoreMilestones();

        uint256 milestoneIndex = currentMilestone;
        uint256 amount;

        if (milestoneIndex == milestonePercentages.length - 1) {
            amount = paymentToken.balanceOf(address(this));
        } else {
            amount = totalRaised * milestonePercentages[milestoneIndex] / 100;
        }

        currentMilestone++;
        totalWithdrawn += amount;

        paymentToken.safeTransfer(creator, amount);

        emit MilestoneWithdrawn(milestoneIndex, amount, creator);
    }

    /// @notice Refund one unit of `tierId` contribution. Only callable on failed campaigns.
    ///         Burns 1 ERC-1155 token of the given tier and returns the tier price in payment token.
    /// @param tierId Tier index: 0 = Bronze, 1 = Silver, 2 = Gold.
    function refund(uint256 tierId) external nonReentrant {
        if (!finalized || successful)                         revert CampaignNotFailed();
        if (tierId >= 3)                                      revert InvalidTierId();
        if (tierContributions[msg.sender][tierId] == 0)       revert NothingToRefundForTier();

        uint256 price = tiers[tierId].price;

        // CEI: zero out before any external call
        tierContributions[msg.sender][tierId] -= 1;
        contributions[msg.sender]             -= price;

        tierToken.burn(msg.sender, tierId, 1);
        paymentToken.safeTransfer(msg.sender, price);

        emit Refunded(msg.sender, price);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    function getMilestoneCount() external view returns (uint256) {
        return milestonePercentages.length;
    }

    function getMilestonePercentages() external view returns (uint8[] memory) {
        return milestonePercentages;
    }
}
