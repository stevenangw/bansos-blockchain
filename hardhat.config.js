require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "paris",
    },
  },
  networks: {
    ibft: {
      url: process.env.IBFT_URL || "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: [process.env.PRIVATE_KEY],
    },
    qbft: {
      url: process.env.QBFT_URL || "http://127.0.0.1:18545",
      chainId: 1337,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};
