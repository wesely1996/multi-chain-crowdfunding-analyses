import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
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
  },
};

export default config;
