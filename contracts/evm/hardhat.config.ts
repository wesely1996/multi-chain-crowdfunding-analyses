import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // WHY cancun: OZ v5.x ERC4626 uses Memory.sol which relies on the `mcopy` opcode
      // introduced in the Cancun hard fork (EIP-5656). Without this, compilation fails.
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      // 60 accounts for benchmark scenarios (1 deployer + up to 59 contributors)
      accounts: {
        count: 60,
        accountsBalance: "10000000000000000000000", // 10 000 ETH each
      },
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};

export default config;
