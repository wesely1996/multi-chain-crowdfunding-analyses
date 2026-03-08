// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { CampaignToken } from "./CampaignToken.sol";

/// @title CrowdfundingCampaign
/// @notice Singleton ERC-20 receipt-token crowdfunding campaign (V1 / MVP EVM variant).
///         State machine: Created → Funding → Finalized → Success (milestone withdrawals)
///                                                      └→ Failed  (contributor refunds)
/// @dev D6: milestonePercentages stored in a storage array (uint8[] immutable is invalid Solidity).
///      D7: receiptToken is not immutable — address only known after new CampaignToken() call.
contract CrowdfundingCampaign is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Immutables (bytecode — zero storage cost)
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

    // Dynamic storage
    uint8[]  public milestonePercentages;
    mapping(address => uint256) public contributions;
    CampaignToken public receiptToken;

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
    error NothingToRefund();
    error ZeroAmount();

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
        string memory tokenName_,
        string memory tokenSymbol_
    ) {
        if (softCap_ > hardCap_) revert InvalidCapRange();
        if (deadline_ <= block.timestamp) revert InvalidDeadline();
        if (milestonePercentages_.length == 0) revert InvalidMilestonePercentages();

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

        // D7: deployed after immutables are set
        receiptToken = new CampaignToken(address(this), tokenName_, tokenSymbol_, 6);

        emit CampaignCreated(creator_, softCap_, hardCap_, deadline_);
    }

    // -------------------------------------------------------------------------
    // Core functions
    // -------------------------------------------------------------------------

    /// @notice Contribute `amount` of the payment token to this campaign.
    ///         Mints an equal amount of receipt tokens to the caller.
    function contribute(uint256 amount) external nonReentrant {
        if (finalized)                           revert CampaignNotActive();
        if (block.timestamp > deadline)          revert CampaignNotActive();
        if (amount == 0)                         revert ZeroAmount();
        if (totalRaised + amount > hardCap)      revert ContributionExceedsHardCap();

        contributions[msg.sender] += amount;
        totalRaised               += amount;

        paymentToken.safeTransferFrom(msg.sender, address(this), amount);
        receiptToken.mint(msg.sender, amount);

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
        if (msg.sender != creator)               revert NotCreator();
        if (!finalized || !successful)           revert CampaignNotSuccessful();
        if (currentMilestone >= milestonePercentages.length) revert NoMoreMilestones();

        uint256 milestoneIndex = currentMilestone;
        uint256 amount;

        if (milestoneIndex == milestonePercentages.length - 1) {
            // Last milestone: sweep remaining balance
            amount = paymentToken.balanceOf(address(this));
        } else {
            amount = totalRaised * milestonePercentages[milestoneIndex] / 100;
        }

        currentMilestone++;
        totalWithdrawn += amount;

        paymentToken.safeTransfer(creator, amount);

        emit MilestoneWithdrawn(milestoneIndex, amount, creator);
    }

    /// @notice Refund the caller's full contribution. Only callable on failed campaigns.
    ///         Burns the corresponding receipt tokens.
    function refund() external nonReentrant {
        if (!finalized || successful)            revert CampaignNotFailed();
        if (contributions[msg.sender] == 0)     revert NothingToRefund();

        uint256 amount = contributions[msg.sender];
        contributions[msg.sender] = 0; // CEI: zero before any external call

        receiptToken.burn(msg.sender, amount);
        paymentToken.safeTransfer(msg.sender, amount);

        emit Refunded(msg.sender, amount);
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
