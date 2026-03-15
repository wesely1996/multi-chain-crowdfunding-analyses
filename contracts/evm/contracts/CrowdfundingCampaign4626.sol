// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { ERC4626 } from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CrowdfundingCampaign4626
/// @notice ERC-4626 vault-based crowdfunding campaign (V2 EVM variant).
///         The campaign contract IS the vault share token — no separate receipt token is deployed.
///         State machine: Created → Funding → Finalized → Success (milestone withdrawals)
///                                                       └→ Failed  (contributor refunds)
///
/// @dev Design choice D-V2-1: Extends ERC4626 so the campaign itself is the share token.
///      This eliminates the separate CampaignToken deployment cost vs. V1.
///      Standard ERC4626 deposit/mint/withdraw/redeem entry points are blocked — contributors
///      MUST use contribute() and refund() to preserve the crowdfunding state machine invariants.
///
/// @dev D-V2-2: _mint/_burn are called manually (not via _deposit/_withdraw) to avoid
///      double-event emission and to decouple the share accounting from ERC4626's internal
///      preview logic (which assumes a yield-bearing asset ratio, irrelevant here 1:1).
contract CrowdfundingCampaign4626 is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -------------------------------------------------------------------------
    // Immutables (bytecode — zero storage cost)
    // -------------------------------------------------------------------------
    address public immutable creator;
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
    /// @notice Thrown when a caller attempts to use the standard ERC4626 deposit/mint entry points.
    ///         Use contribute() instead to preserve the crowdfunding state machine.
    error UseContributeInstead();
    /// @notice Thrown when a caller attempts to use the standard ERC4626 withdraw/redeem entry points.
    ///         Use refund() instead on failed campaigns.
    error UseRefundInstead();

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

    /// @param creator_              Address that controls milestone withdrawals.
    /// @param paymentToken_         The ERC-20 token contributors deposit (e.g. USDC).
    /// @param softCap_              Minimum raise for success.
    /// @param hardCap_              Maximum raise; contributions beyond this are rejected.
    /// @param deadline_             Unix timestamp after which finalize() may be called.
    /// @param milestonePercentages_ Array of percentages summing to 100.
    /// @param tokenName_            Name for the ERC-20 share token (this contract).
    /// @param tokenSymbol_          Symbol for the ERC-20 share token.
    constructor(
        address creator_,
        IERC20 paymentToken_,
        uint256 softCap_,
        uint256 hardCap_,
        uint256 deadline_,
        uint8[] memory milestonePercentages_,
        string memory tokenName_,
        string memory tokenSymbol_
    )
        // WHY: ERC4626 wraps paymentToken_ as the underlying asset; ERC20 sets the share token metadata.
        ERC4626(paymentToken_)
        ERC20(tokenName_, tokenSymbol_)
    {
        if (softCap_ > hardCap_)               revert InvalidCapRange();
        if (deadline_ <= block.timestamp)       revert InvalidDeadline();
        if (milestonePercentages_.length == 0)  revert InvalidMilestonePercentages();

        uint256 sum;
        for (uint256 i; i < milestonePercentages_.length; ++i) {
            sum += milestonePercentages_[i];
        }
        if (sum != 100) revert InvalidMilestonePercentages();

        creator  = creator_;
        softCap  = softCap_;
        hardCap  = hardCap_;
        deadline = deadline_;

        for (uint256 i; i < milestonePercentages_.length; ++i) {
            milestonePercentages.push(milestonePercentages_[i]);
        }

        emit CampaignCreated(creator_, softCap_, hardCap_, deadline_);
    }

    // -------------------------------------------------------------------------
    // Core crowdfunding functions
    // -------------------------------------------------------------------------

    /// @notice Contribute `amount` of the payment token to this campaign.
    ///         Mints an equal amount of vault share tokens to the caller (1:1 ratio).
    /// @param amount Number of payment token units to contribute.
    function contribute(uint256 amount) external nonReentrant {
        if (finalized)                       revert CampaignNotActive();
        if (block.timestamp > deadline)      revert CampaignNotActive();
        if (amount == 0)                     revert ZeroAmount();
        if (totalRaised + amount > hardCap)  revert ContributionExceedsHardCap();

        // WHY CEI: update state before any external call to prevent reentrancy.
        contributions[msg.sender] += amount;
        totalRaised               += amount;

        // WHY safeTransferFrom: handles non-standard ERC20s that return false instead of reverting.
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);

        // WHY _mint directly (not _deposit): avoids ERC4626's internal asset-ratio preview math
        // and prevents double Deposit + Contributed event emission. Shares are 1:1 with assets.
        _mint(msg.sender, amount);

        emit Contributed(msg.sender, amount, totalRaised);
    }

    /// @notice Finalize the campaign. Permissionless after deadline to prevent creator blocking refunds.
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
        if (msg.sender != creator)                            revert NotCreator();
        if (!finalized || !successful)                        revert CampaignNotSuccessful();
        if (currentMilestone >= milestonePercentages.length)  revert NoMoreMilestones();

        uint256 milestoneIndex = currentMilestone;
        uint256 amount;

        if (milestoneIndex == milestonePercentages.length - 1) {
            // WHY balance sweep on last milestone: avoids dust from integer division rounding.
            amount = IERC20(asset()).balanceOf(address(this));
        } else {
            amount = totalRaised * milestonePercentages[milestoneIndex] / 100;
        }

        // CEI: increment before transfer.
        currentMilestone++;
        totalWithdrawn += amount;

        IERC20(asset()).safeTransfer(creator, amount);

        emit MilestoneWithdrawn(milestoneIndex, amount, creator);
    }

    /// @notice Refund the caller's full contribution. Only callable on failed campaigns.
    ///         Burns the corresponding share tokens.
    function refund() external nonReentrant {
        if (!finalized || successful)        revert CampaignNotFailed();
        if (contributions[msg.sender] == 0)  revert NothingToRefund();

        uint256 amount = contributions[msg.sender];

        // WHY CEI: zero contribution BEFORE burning and transferring to prevent reentrancy.
        contributions[msg.sender] = 0;

        // WHY _burn directly (not _withdraw): symmetric with contribute()'s _mint; avoids
        // ERC4626 Withdraw event double emission; share-to-asset ratio is always 1:1 here.
        _burn(msg.sender, amount);
        IERC20(asset()).safeTransfer(msg.sender, amount);

        emit Refunded(msg.sender, amount);
    }

    // -------------------------------------------------------------------------
    // ERC-4626 overrides — block standard vault entry points
    // -------------------------------------------------------------------------

    // WHY: The standard ERC4626 deposit/mint/withdraw/redeem functions bypass the
    // crowdfunding state machine (deadline, hardCap, finalized flag). Blocking them
    // ensures all fund movements go through the audited contribute/refund paths.

    /// @inheritdoc ERC4626
    function deposit(uint256, address) public pure override returns (uint256) {
        revert UseContributeInstead();
    }

    /// @inheritdoc ERC4626
    function mint(uint256, address) public pure override returns (uint256) {
        revert UseContributeInstead();
    }

    /// @inheritdoc ERC4626
    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert UseRefundInstead();
    }

    /// @inheritdoc ERC4626
    function redeem(uint256, address, address) public pure override returns (uint256) {
        revert UseRefundInstead();
    }

    // WHY maxDeposit/maxMint/maxWithdraw/maxRedeem → 0: signals to ERC4626-aware integrators
    // (aggregators, routers) that this vault does not accept deposits via standard ERC4626 paths.
    // This prevents accidental integration losses.

    /// @inheritdoc ERC4626
    function maxDeposit(address) public pure override returns (uint256) { return 0; }

    /// @inheritdoc ERC4626
    function maxMint(address) public pure override returns (uint256) { return 0; }

    /// @inheritdoc ERC4626
    function maxWithdraw(address) public pure override returns (uint256) { return 0; }

    /// @inheritdoc ERC4626
    function maxRedeem(address) public pure override returns (uint256) { return 0; }

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
