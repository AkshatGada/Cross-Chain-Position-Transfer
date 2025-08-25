import { createPublicClient, createWalletClient, http, parseEther, formatEther, getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs/promises';
import path from 'path';

// Import configuration
import config from '../../../config/katanaConfig.js';

// Default private key from Anvil
const PRIVATE_KEY = config.DEFAULTS.PRIVATE_KEY;

// Use WETH and AUSD addresses directly
const TOKEN_A = config.ADDRESSES.WETH;  // WETH
const TOKEN_B = config.ADDRESSES.AUSD;  // AUSD

// SushiSwap V3 Factory ABI
const FACTORY_ABI = [
  {
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' }
    ],
    name: 'createPool',
    outputs: [{ type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' }
    ],
    name: 'getPool',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  }
];

// SushiSwap V3 Pool ABI
const POOL_ABI = [
  {
    inputs: [{ name: 'sqrtPriceX96', type: 'uint160' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function'
  },
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' }
    ],
    stateMutability: 'view',
    type: 'function'
  }
];

// ERC20 ABI for token info
const ERC20_ABI = [
  {
    inputs: [],
    name: 'symbol',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'name',
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [],
    name: 'decimals',
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view',
    type: 'function'
  }
];

// Pool configuration
const POOL_CONFIG = {
  fee: config.FEE_TIERS.MEDIUM, // 3000 (0.3%)
  initialPrice: 1.0, // 1:1 ratio initially
};

// Utility functions for price calculations
function encodePriceSqrt(reserve1, reserve0) {
  // Calculate sqrt(reserve1/reserve0) * 2^96
  // For 1:1 ratio: sqrt(1) * 2^96 = 2^96
  return BigInt(Math.floor(Math.sqrt(reserve1 / reserve0) * (2 ** 96)));
}

function decodePriceSqrt(sqrtPriceX96) {
  // Convert sqrtPriceX96 back to price
  const price = (Number(sqrtPriceX96) / (2 ** 96)) ** 2;
  return price;
}

function sortTokens(tokenA, tokenB) {
  // Sort tokens by address (SushiSwap V3 requires token0 < token1)
  return tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
}

async function main() {
  console.log('🏊 Creating SushiSwap V3 Pool for WETH/AUSD...\n');

  console.log('📋 Using token addresses:');
  console.log(`  WETH: ${TOKEN_A}`);
  console.log(`  AUSD: ${TOKEN_B}`);

  // Initialize clients
  const publicClient = createPublicClient({
    transport: http(config.NETWORK.RPC_URL),
    chain: config.CHAIN_CONFIG
  });

  const walletClient = createWalletClient({
    transport: http(config.NETWORK.RPC_URL),
    chain: config.CHAIN_CONFIG,
    account: privateKeyToAccount(PRIVATE_KEY)
  });
  
  // Verify chain connection
  const chainId = await publicClient.getChainId();
  console.log(`\nConnected to Katana Tatara Fork (Chain ID: ${chainId})`);
  if (chainId !== config.NETWORK.CHAIN_ID) {
    throw new Error(`Wrong chain ID. Expected ${config.NETWORK.CHAIN_ID} (Katana Tatara Fork), got ${chainId}`);
  }

  // Sort tokens (SushiSwap V3 requires token0 < token1)
  const [token0, token1] = sortTokens(TOKEN_A, TOKEN_B);
  console.log(`\n🔄 Sorted tokens:`);
  console.log(`  Token0: ${token0}`);
  console.log(`  Token1: ${token1}`);

  // Get token info
  const token0Symbol = await publicClient.readContract({
    address: token0,
    abi: ERC20_ABI,
    functionName: 'symbol'
  });

  const token1Symbol = await publicClient.readContract({
    address: token1,
    abi: ERC20_ABI,
    functionName: 'symbol'
  });

  console.log(`  ${token0Symbol} / ${token1Symbol} pair`);

  // Connect to SushiSwap V3 Factory
  const factoryAddress = config.ADDRESSES.V3_FACTORY;

  // Check if pool already exists
  console.log(`\n🔍 Checking if pool exists with ${POOL_CONFIG.fee} fee tier...`);
  const existingPool = await publicClient.readContract({
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: 'getPool',
    args: [token0, token1, POOL_CONFIG.fee]
  });
  
  let poolAddress;
  
  if (existingPool !== '0x0000000000000000000000000000000000000000') {
    console.log(`✅ Pool already exists at: ${existingPool}`);
    poolAddress = existingPool;
  } else {
    console.log('❌ Pool does not exist. Creating new pool...');
    
    // Create the pool
    console.log('\n📝 Creating pool...');
    const createTx = await walletClient.writeContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'createPool',
      args: [token0, token1, POOL_CONFIG.fee]
    });
    console.log(`   Transaction hash: ${createTx}`);
    
    // Wait for transaction
    const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createTx });
    console.log(`   ✅ Pool created in block: ${createReceipt.blockNumber}`);
    
    // Get the pool address
    poolAddress = await publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [token0, token1, POOL_CONFIG.fee]
    });
    console.log(`   📍 Pool address: ${poolAddress}`);
  }

  // Check if pool is initialized
  console.log('\n🔍 Checking if pool is initialized...');
  const poolContract = getContract({
    address: poolAddress,
    abi: POOL_ABI,
    client: { public: publicClient, wallet: walletClient }
  });

  const slot0 = await poolContract.read.slot0();
  const sqrtPriceX96 = slot0[0];
  
  if (sqrtPriceX96 === 0n) {
    console.log('❌ Pool is not initialized. Initializing with 1:1 price...');
    
    // Initialize pool with 1:1 price ratio
    const initialSqrtPriceX96 = encodePriceSqrt(POOL_CONFIG.initialPrice, 1);
    console.log(`   Initial sqrt price: ${initialSqrtPriceX96}`);
    
    const initTx = await walletClient.writeContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'initialize',
      args: [initialSqrtPriceX96]
    });
    console.log(`   Transaction hash: ${initTx}`);
    
    // Wait for transaction
    const initReceipt = await publicClient.waitForTransactionReceipt({ hash: initTx });
    console.log(`   ✅ Pool initialized in block: ${initReceipt.blockNumber}`);
  } else {
    console.log('✅ Pool is already initialized');
    console.log(`   Current sqrt price: ${sqrtPriceX96}`);
  }

  // Verify pool state
  console.log('\n🔍 Verifying pool state...');
  const finalSlot0 = await poolContract.read.slot0();
  const finalSqrtPriceX96 = finalSlot0[0];
  const currentTick = finalSlot0[1];
  
  console.log(`   Final sqrt price: ${finalSqrtPriceX96}`);
  console.log(`   Current tick: ${currentTick}`);
  
  const price = decodePriceSqrt(finalSqrtPriceX96);
  console.log(`   Calculated price: ${price.toFixed(6)}`);

  console.log('\n✅ Pool creation/verification completed successfully!');
  console.log(`📍 Pool Address: ${poolAddress}`);
  console.log(`💰 Fee Tier: ${POOL_CONFIG.fee} (${POOL_CONFIG.fee / 10000}%)`);
  console.log(`🔄 Token Pair: ${token0Symbol}/${token1Symbol}`);
}

main().catch((error) => {
  console.error('\n❌ Pool creation failed:', error);
  process.exit(1);
});