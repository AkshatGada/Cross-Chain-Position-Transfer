import { ethers } from 'ethers';
import { getLxLyClient } from './utils/bridgeUtils.js';
import { NETWORKS, ADDRESSES, DEFAULTS } from './config/bridgeConfig.js';
import fs from 'fs';
import path from 'path';

// Token addresses on Sepolia
const TOKEN_ADDRESSES = {
  TOKEN_A: "0x6357B8505C92F409DAcf682F310B502443e0259C",
  TOKEN_B: "0xb1298b123C55ebe04e0E2d9234d2f46b3406674C"
};

async function mintTokens(provider, signer) {
  console.log('\n=== Minting Tokens on Sepolia ===');
  
  // Load ABIs using fs
  const TokenAJson = JSON.parse(fs.readFileSync(path.resolve('../../TokenA.sol/TokenA.json'), 'utf-8'));
  const TokenBJson = JSON.parse(fs.readFileSync(path.resolve('../../TokenB.sol/TokenB.json'), 'utf-8'));
  
  // Create contract instances
  const tokenA = new ethers.Contract(TOKEN_ADDRESSES.TOKEN_A, TokenAJson.abi, signer);
  const tokenB = new ethers.Contract(TOKEN_ADDRESSES.TOKEN_B, TokenBJson.abi, signer);
  
  const mintAmount = ethers.parseEther("100"); // Mint 100 tokens of each
  
  try {
    // Mint Token A
    console.log('\nMinting Token A...');
    const txA = await tokenA.mint(signer.address, mintAmount);
    await txA.wait();
    const balanceA = await tokenA.balanceOf(signer.address);
    console.log(`✅ Token A minted. Balance: ${ethers.formatEther(balanceA)} TKA`);
    
    // Mint Token B
    console.log('\nMinting Token B...');
    const txB = await tokenB.mint(signer.address, mintAmount);
    await txB.wait();
    const balanceB = await tokenB.balanceOf(signer.address);
    console.log(`✅ Token B minted. Balance: ${ethers.formatEther(balanceB)} TKB`);
    
    return { balanceA, balanceB };
  } catch (error) {
    console.error('Error minting tokens:', error);
    throw error;
  }
}

async function bridgeTokens(signer) {
  console.log('\n=== Bridging Tokens to Tatara ===');
  
  try {
    // Initialize LxLy client
    const client = await getLxLyClient();
    console.log('✅ LxLy client initialized');
    
    // Source network is Sepolia (0)
    const sourceNetworkId = 0;
    // Destination network is Tatara (1)
    const destinationNetworkId = 1;
    
    // Bridge amount (10 tokens each)
    const bridgeAmount = ethers.parseEther("10");
    
    // Bridge Token A
    console.log('\nBridging Token A...');
    const tokenA = client.erc20(TOKEN_ADDRESSES.TOKEN_A, sourceNetworkId);
    const resultA = await tokenA.bridgeAsset(
      bridgeAmount.toString(),
      signer.address,
      destinationNetworkId
    );
    const txHashA = await resultA.getTransactionHash();
    console.log(`✅ Token A bridge transaction submitted: ${txHashA}`);
    const receiptA = await resultA.getReceipt();
    console.log('Token A bridge receipt:', {
      blockNumber: receiptA.blockNumber,
      transactionHash: receiptA.transactionHash,
      status: receiptA.status
    });
    
    // Bridge Token B
    console.log('\nBridging Token B...');
    const tokenB = client.erc20(TOKEN_ADDRESSES.TOKEN_B, sourceNetworkId);
    const resultB = await tokenB.bridgeAsset(
      bridgeAmount.toString(),
      signer.address,
      destinationNetworkId
    );
    const txHashB = await resultB.getTransactionHash();
    console.log(`✅ Token B bridge transaction submitted: ${txHashB}`);
    const receiptB = await resultB.getReceipt();
    console.log('Token B bridge receipt:', {
      blockNumber: receiptB.blockNumber,
      transactionHash: receiptB.transactionHash,
      status: receiptB.status
    });
    
    return { txHashA, txHashB };
  } catch (error) {
    console.error('Error bridging tokens:', error);
    throw error;
  }
}

async function main() {
  console.log('=================================================================');
  console.log('                  TOKEN MINTING AND BRIDGING TEST');
  console.log('=================================================================');
  
  // Create provider and signer
  const provider = new ethers.JsonRpcProvider(NETWORKS.SEPOLIA.RPC_URL);
  const privateKey = process.env.PRIVATE_KEY || DEFAULTS.PRIVATE_KEY;
  const signer = new ethers.Wallet(privateKey, provider);
  
  console.log(`Using account: ${signer.address}`);
  console.log(`Sepolia RPC: ${NETWORKS.SEPOLIA.RPC_URL}`);
  console.log(`Tatara RPC: ${NETWORKS.TATARA.RPC_URL}`);
  
  try {
    // Step 1: Mint tokens
    await mintTokens(provider, signer);
    
    // Step 2: Bridge tokens
    await bridgeTokens(signer);
    
    console.log('\n🎉 Token minting and bridging completed successfully!');
  } catch (error) {
    console.error('\n❌ Error in main process:', error);
    process.exit(1);
  }
}

// Run the test
main().catch(console.error); 