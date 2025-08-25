import { LxLyClient, use, setProofApi } from '@maticnetwork/lxlyjs';
import { ethers } from 'ethers';
import { NETWORKS, DEFAULTS, ADDRESSES } from '../config/bridgeConfig.js';

// Set up proof API (optional, but recommended for LxLy)
setProofApi('https://api-gateway.polygon.technology/api/v3/proof/testnet');

// Export getLxLyClient for use in bridge scripts
export async function getLxLyClient() {
  // Use the default private key for the test
  const privateKey = process.env.PRIVATE_KEY || DEFAULTS.PRIVATE_KEY;
  const userAddress = new ethers.Wallet(privateKey).address;

  // Providers for Sepolia and Tatara
  const sepoliaProvider = new ethers.JsonRpcProvider(NETWORKS.SEPOLIA.RPC_URL);
  const tataraProvider = new ethers.JsonRpcProvider(NETWORKS.TATARA.RPC_URL);

  const lxLyClient = new LxLyClient();
  await lxLyClient.init({
    log: true,
    network: 'testnet',
    providers: {
      0: {
        provider: sepoliaProvider,
        configuration: {
          bridgeAddress: ADDRESSES.SEPOLIA.BRIDGE_CONTRACT,
          bridgeExtensionAddress: ADDRESSES.SEPOLIA.BRIDGE_EXTENSION,
        },
        defaultConfig: { from: userAddress }
      },
      1: {
        provider: tataraProvider,
        configuration: {
          bridgeAddress: ADDRESSES.TATARA.BRIDGE_CONTRACT,
          bridgeExtensionAddress: ADDRESSES.TATARA.BRIDGE_EXTENSION,
        },
        defaultConfig: { from: userAddress }
      }
    }
  });
  return lxLyClient;
}

// Updated bridge configuration with actual addresses
const BRIDGE_CONFIG = {
  SEPOLIA: {
    rpc: NETWORKS.SEPOLIA.RPC_URL,
    bridgeAddress: ADDRESSES.SEPOLIA.BRIDGE_CONTRACT,
    bridgeExtensionAddress: ADDRESSES.SEPOLIA.BRIDGE_EXTENSION
  },
  TATARA: {
    rpc: NETWORKS.TATARA.RPC_URL,
    bridgeAddress: ADDRESSES.TATARA.BRIDGE_CONTRACT,
    bridgeExtensionAddress: ADDRESSES.TATARA.BRIDGE_EXTENSION
  }
};

// Create ethers providers for direct interaction
export function createSepoliaProvider() {
  return new ethers.JsonRpcProvider(NETWORKS.SEPOLIA.RPC_URL);
}

export function createTataraProvider() {
  return new ethers.JsonRpcProvider(NETWORKS.TATARA.RPC_URL);
}

// Create wallet for signing transactions
export function createWallet(privateKey = DEFAULTS.PRIVATE_KEY, provider) {
  return new ethers.Wallet(privateKey, provider);
}

// Simple bridge and call function for our test
export async function testBridgeAndCall(params) {
  const {
    sourceTokenAddress,
    amount,
    calldata,
    userAddress,
    targetContractAddress
  } = params;

  console.log(`
=================================================================
              TEST BRIDGE AND CALL FROM SEPOLIA TO TATARA
=================================================================
Source Token: ${sourceTokenAddress}
Amount: ${amount}
Target Contract: ${targetContractAddress}
User Address: ${userAddress}
=================================================================`);

  // For now, we'll simulate the bridge call
  // In a real implementation, you'd use the actual LxLy bridge
  
  const sepoliaProvider = createSepoliaProvider();
  const signer = createWallet(DEFAULTS.PRIVATE_KEY, sepoliaProvider);
  
  console.log(`Wallet address: ${signer.address}`);
  
  // TODO: Implement actual bridge logic here
  // This is a placeholder for the bridge functionality
  
  return {
    success: true,
    message: "Bridge simulation completed",
    txHash: "0x" + "0".repeat(64), // Placeholder hash
    calldata: calldata
  };
}

export default {
  createSepoliaProvider,
  createTataraProvider,
  createWallet,
  testBridgeAndCall
}; 