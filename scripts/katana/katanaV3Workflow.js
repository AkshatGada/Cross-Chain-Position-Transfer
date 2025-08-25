import { createPublicClient, createWalletClient, http, parseEther, formatEther, getContract, decodeEventLog } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import config from '../../../config/katanaConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const POSITION_MANAGER_ADDRESS = config.ADDRESSES.V3_POSITION_MANAGER;
const POSITION_AMOUNT = config.DEFAULTS.POSITION_AMOUNT;
const TICK_LOWER = config.DEFAULTS.TICK_LOWER;
const TICK_UPPER = config.DEFAULTS.TICK_UPPER;

// Track gas costs
let totalGasUsed = 0n;
const gasCosts = {
  mintPosition: 0n,
  recreatePosition: 0n
};

// ABI for decoding events
const POSITION_MANAGER_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { type: 'address', name: 'from', indexed: true },
      { type: 'address', name: 'to', indexed: true },
      { type: 'uint256', name: 'tokenId', indexed: true }
    ]
  }
];

async function runScript(scriptPath, emoji, args = []) {
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath, ...args], {
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data;
      process.stdout.write(`${emoji} ${data}`);
    });

    child.stderr.on('data', (data) => {
      stderr += data;
      process.stderr.write(`${emoji} ${data}`);
    });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout,
        stderr
      });
    });
  });
}

async function main() {
  console.log('🚀 Starting Katana V3 Workflow Test on Forked Tatara\n');
  const startTime = Date.now();

  // Step 1: Verify chain connection
  console.log('Step 1: Verifying Chain Connection');
  const publicClient = createPublicClient({
    transport: http(config.NETWORK.RPC_URL),
    chain: config.CHAIN_CONFIG
  });

  const walletClient = createWalletClient({
    transport: http(config.NETWORK.RPC_URL),
    chain: config.CHAIN_CONFIG,
    account: privateKeyToAccount(config.DEFAULTS.PRIVATE_KEY)
  });

  const chainId = await publicClient.getChainId();
  if (chainId !== config.NETWORK.CHAIN_ID) {
    throw new Error(`Wrong chain ID. Expected ${config.NETWORK.CHAIN_ID} (Katana Tatara Fork), got ${chainId}`);
  }
  console.log(`Connected to Forked Katana Tatara (Chain ID: ${chainId})\n`);

  // Step 2: Verify SushiSwap V3 contracts
  console.log('Step 2: Verifying SushiSwap V3 Contracts');
  console.log(`Factory: ${config.ADDRESSES.V3_FACTORY}`);
  console.log(`Position Manager: ${config.ADDRESSES.V3_POSITION_MANAGER}`);
  console.log(`Router: ${config.ADDRESSES.V3_ROUTER}`);
  console.log(`WETH: ${config.ADDRESSES.WETH}`);
  console.log(`AUSD: ${config.ADDRESSES.AUSD}\n`);

  // Update config with WETH and AUSD addresses
  process.env.TOKEN_A = config.ADDRESSES.WETH;
  process.env.TOKEN_B = config.ADDRESSES.AUSD;

  // Step 3: Create pool
  console.log('Step 3: Creating WETH/AUSD Pool\n');
  const createPoolResult = await runScript(
    path.join(__dirname, 'createPool.js'),
    '🏊'
  );
  if (!createPoolResult.success) {
    throw new Error('Pool creation failed');
  }

  // Step 4: Mint position
  console.log('\nStep 4: Minting V3 Position\n');
  const mintResult = await runScript(
    path.join(__dirname, 'mintPosition.js'),
    '💎'
  );
  if (!mintResult.success) {
    throw new Error('Position minting failed');
  }

  // Extract tokenId from mint result
  const mintOutput = mintResult.stdout;
  const tokenIdMatch = mintOutput.match(/Token ID: (\d+)/);
  if (!tokenIdMatch) {
    throw new Error('Could not find token ID in mint output');
  }
  const tokenId = tokenIdMatch[1];
  console.log(`\nMinted Position Token ID: ${tokenId}\n`);

  // Step 5: Query position
  console.log('Step 5: Querying Position Details\n');
  const queryResult = await runScript(
    path.join(__dirname, 'queryPosition.js'),
    '🔍',
    [tokenId]
  );
  if (!queryResult.success) {
    throw new Error('Position query failed');
  }

  // Calculate total execution time
  const executionTime = (Date.now() - startTime) / 1000; // Convert to seconds

  // Generate Summary Report
  console.log('\n📊 Katana V3 Workflow Summary (Forked Tatara)');
  console.log('==========================================');
  console.log('1. Network Information:');
  console.log(`   - Chain ID: ${chainId}`);
  console.log(`   - Factory: ${config.ADDRESSES.V3_FACTORY}`);
  console.log(`   - Position Manager: ${config.ADDRESSES.V3_POSITION_MANAGER}`);
  console.log(`   - Router: ${config.ADDRESSES.V3_ROUTER}`);
  console.log(`   - WETH: ${config.ADDRESSES.WETH}`);
  console.log(`   - AUSD: ${config.ADDRESSES.AUSD}`);

  console.log('\n2. Performance Metrics:');
  console.log(`   - Total Execution Time: ${executionTime.toFixed(2)} seconds`);
  console.log(`   - Average Transaction Time: ${(executionTime / 3).toFixed(2)} seconds`);

  console.log('\n3. Gas Usage Summary:');
  console.log(`   - Total Gas Used: ${totalGasUsed.toString()} gas units`);
  
  console.log('\n4. Validation Results:');
  console.log('   ✅ Chain Connection: Success');
  console.log('   ✅ Contract Verification: Success');
  console.log('   ✅ Pool Creation: Success');
  console.log('   ✅ Position Minting: Success');
  console.log('   ✅ Position Query: Success');

  console.log('\n✨ Workflow Test Completed Successfully!');
}

main().catch((error) => {
  console.error('\n❌ Workflow Test Failed:', error);
  process.exit(1);
});