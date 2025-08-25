import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

// Network Configurations
export const NETWORKS = {
  SEPOLIA: {
    RPC_URL: 'https://sepolia.gateway.tenderly.co/1QkR6WuJgLiObP64j16Aea', // You'll need to replace with your Alchemy/Infura API key
    CHAIN_ID: 11155111,
    NAME: 'Sepolia',
    NETWORK: 'sepolia'
  },
  TATARA: {
    RPC_URL: 'https://katana-tatara.gateway.tenderly.co/x53Hr4hpNj4buY178WZiS',
    CHAIN_ID: 129399,
    NAME: 'Katana Tatara ',
    NETWORK: 'katana-tatara'
  }
};

// Contract Addresses
export const ADDRESSES = {
  SEPOLIA: {
    V3_FACTORY: '0x0000000000000000000000000000000000000000', // Replace with actual Sepolia addresses
    V3_POSITION_MANAGER: '0x0000000000000000000000000000000000000000',
    V3_ROUTER: '0x0000000000000000000000000000000000000000',
    BRIDGE_CONTRACT: '0x528e26b25a34a4A5d0dbDa1d57D318153d2ED582',
    BRIDGE_EXTENSION: '0x2311BFA86Ae27FC10E1ad3f805A2F9d22Fc8a6a1'
  },
  TATARA: {
    V3_FACTORY: '0x9B3336186a38E1b6c21955d112dbb0343Ee061eE',
    V3_POSITION_MANAGER: '0x1400feFD6F9b897970f00Df6237Ff2B8b27Dc82C',
    V3_ROUTER: '0xAC4c6e212A361c968F1725b4d055b47E63F80b75',
    BRIDGE_CONTRACT: '0x528e26b25a34a4A5d0dbDa1d57D318153d2ED582',
    BRIDGE_EXTENSION: '0x2311BFA86Ae27FC10E1ad3f805A2F9d22Fc8a6a1'
  }
};

// Default Configuration
export const DEFAULTS = {
  PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  BRIDGE_GAS_LIMIT: '300000',
  BRIDGE_TIMEOUT: 1200000, // 20 minutes in milliseconds
};

// Chain Configurations
export const CHAIN_CONFIGS = {
  SEPOLIA: {
    ...sepolia
  },
  TATARA: {
    id: NETWORKS.TATARA.CHAIN_ID,
    name: NETWORKS.TATARA.NAME,
    network: NETWORKS.TATARA.NETWORK,
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: [NETWORKS.TATARA.RPC_URL],
      },
      public: {
        http: [NETWORKS.TATARA.RPC_URL],
      },
    },
  }
};

// Create Network Client
export async function createNetworkClient(network, privateKey = DEFAULTS.PRIVATE_KEY) {
  const config = network === 'SEPOLIA' ? CHAIN_CONFIGS.SEPOLIA : CHAIN_CONFIGS.TATARA;
  const rpcUrl = NETWORKS[network].RPC_URL;

  const publicClient = createPublicClient({
    transport: http(rpcUrl),
    chain: config
  });

  const walletClient = createWalletClient({
    transport: http(rpcUrl),
    chain: config,
    account: privateKeyToAccount(privateKey)
  });

  return { publicClient, walletClient };
}

export default {
  NETWORKS,
  ADDRESSES,
  DEFAULTS,
  CHAIN_CONFIGS,
  createNetworkClient
}; 