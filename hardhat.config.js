require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Environment variable validation and defaults
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "https://eth-sepolia.g.alchemy.com/v2/your-api-key";
const KATANA_RPC_URL = process.env.KATANA_RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "0000000000000000000000000000000000000000000000000000000000000000";
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// Ensure private key is properly formatted
const formattedPrivateKey = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY.slice(2) : PRIVATE_KEY;

// Gas configuration
const GAS_SETTINGS = {
  sepolia: {
    gasPrice: 30000000000, // 30 gwei
    gasLimit: 5000000,     // 5M gas
  },
  katana: {
    gasPrice: 1000000000,  // 1 gwei
    gasLimit: 8000000,     // 8M gas
  }
};

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
        },
      },
      {
        // For Uniswap V3 contracts
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        },
      },
    ],
  },
  
  defaultNetwork: "hardhat",
  
  networks: {
    hardhat: {
      chainId: 31337,
      blockGasLimit: 12000000,
      allowUnlimitedContractSize: true,
      mining: {
        auto: true,
        interval: 1000
      },
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20,
      },
    },
    
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: [`0x${formattedPrivateKey}`],
      chainId: 11155111,
      gasPrice: GAS_SETTINGS.sepolia.gasPrice,
      gas: GAS_SETTINGS.sepolia.gasLimit,
      timeout: 60000, // 1 minute
      minGasPrice: 1000000000, // 1 gwei
      maxFeePerGas: 100000000000, // 100 gwei
      verify: {
        etherscan: {
          apiKey: ETHERSCAN_API_KEY,
        },
      },
      deploymentConfig: {
        waitConfirmations: 3,
        timeoutBlocks: 50,
      },
    },
    
    katana: {
      url: KATANA_RPC_URL,
      accounts: [`0x${formattedPrivateKey}`],
      chainId: 1337,
      gasPrice: GAS_SETTINGS.katana.gasPrice,
      gas: GAS_SETTINGS.katana.gasLimit,
      timeout: 30000, // 30 seconds
      minGasPrice: 100000000, // 0.1 gwei
      deploymentConfig: {
        waitConfirmations: 1,
        timeoutBlocks: 20,
      },
    },
  },
  
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
    deploy: "./deploy",
    deployments: "./deployments",
  },
  
  mocha: {
    timeout: 100000, // 100 seconds
  },
  
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    gasPrice: 30,
    excludeContracts: ["mocks/"],
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },
  
  // Custom settings for different deployment environments
  deploymentSettings: {
    sepolia: {
      verifyContracts: true,
      deployerAddress: process.env.DEPLOYER_ADDRESS,
      uniswapV3: {
        factory: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
        positionManager: "0x1238536071E1c677A632429e3655c799b22cDA52",
        swapRouter: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
      },
    },
    katana: {
      verifyContracts: false,
      deployerAddress: process.env.DEPLOYER_ADDRESS,
      uniswapV3: {
        // These will be deployed locally
        factory: "",
        positionManager: "",
        swapRouter: "",
      },
    },
  },
}; 