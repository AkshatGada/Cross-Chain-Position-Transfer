import { createPublicClient, createWalletClient, http, formatEther, getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import config from '../../../config/katanaConfig.js';

// Configuration
const POSITION_MANAGER_ADDRESS = config.ADDRESSES.V3_POSITION_MANAGER;
const FACTORY_ADDRESS = config.ADDRESSES.V3_FACTORY;

// Use WETH and AUSD addresses directly
const WETH_ADDRESS = config.ADDRESSES.WETH;
const AUSD_ADDRESS = config.ADDRESSES.AUSD;

// ABIs
const POSITION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'positions',
    inputs: [{ type: 'uint256', name: 'tokenId' }],
    outputs: [
      { type: 'uint96', name: 'nonce' },
      { type: 'address', name: 'operator' },
      { type: 'address', name: 'token0' },
      { type: 'address', name: 'token1' },
      { type: 'uint24', name: 'fee' },
      { type: 'int24', name: 'tickLower' },
      { type: 'int24', name: 'tickUpper' },
      { type: 'uint128', name: 'liquidity' },
      { type: 'uint256', name: 'feeGrowthInside0LastX128' },
      { type: 'uint256', name: 'feeGrowthInside1LastX128' },
      { type: 'uint128', name: 'tokensOwed0' },
      { type: 'uint128', name: 'tokensOwed1' }
    ],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ type: 'uint256', name: 'tokenId' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view'
  }
];

const POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    inputs: [],
    outputs: [
      { type: 'uint160', name: 'sqrtPriceX96' },
      { type: 'int24', name: 'tick' },
      { type: 'uint16', name: 'observationIndex' },
      { type: 'uint16', name: 'observationCardinality' },
      { type: 'uint16', name: 'observationCardinalityNext' },
      { type: 'uint8', name: 'feeProtocol' },
      { type: 'bool', name: 'unlocked' }
    ],
    stateMutability: 'view'
  }
];

const ERC20_ABI = [
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view'
  },
  {
    type: 'function',
    name: 'decimals',
    inputs: [],
    outputs: [{ type: 'uint8' }],
    stateMutability: 'view'
  }
];

function tickToPrice(tick, token0Decimals, token1Decimals) {
  const price = 1.0001 ** tick;
  const decimalAdjustment = 10 ** (token1Decimals - token0Decimals);
  return price * decimalAdjustment;
}

async function main() {
  // Check if tokenId was provided
  const tokenId = process.argv[2];
  if (!tokenId) {
    console.error('Please provide a token ID as an argument');
    process.exit(1);
  }

  console.log('🔍 Querying SushiSwap V3 Position on Katana Tatara Fork...\n');

  // Initialize clients
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

  // Get position data
  const positionResult = await publicClient.readContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    functionName: 'positions',
    args: [BigInt(tokenId)]
  });

  // Extract position data from result array
  const position = {
    nonce: positionResult[0],
    operator: positionResult[1],
    token0: positionResult[2],
    token1: positionResult[3],
    fee: positionResult[4],
    tickLower: positionResult[5],
    tickUpper: positionResult[6],
    liquidity: positionResult[7],
    feeGrowthInside0LastX128: positionResult[8],
    feeGrowthInside1LastX128: positionResult[9],
    tokensOwed0: positionResult[10],
    tokensOwed1: positionResult[11]
  };

  const owner = await publicClient.readContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    functionName: 'ownerOf',
    args: [BigInt(tokenId)]
  });

  // Get token symbols and decimals
  const [token0Symbol, token1Symbol, token0Decimals, token1Decimals] = await Promise.all([
    publicClient.readContract({
      address: position.token0,
      abi: ERC20_ABI,
      functionName: 'symbol'
    }),
    publicClient.readContract({
      address: position.token1,
      abi: ERC20_ABI,
      functionName: 'symbol'
    }),
    publicClient.readContract({
      address: position.token0,
      abi: ERC20_ABI,
      functionName: 'decimals'
    }),
    publicClient.readContract({
      address: position.token1,
      abi: ERC20_ABI,
      functionName: 'decimals'
    })
  ]);

  // Get pool contract
  const poolAddress = await publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: [
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
    ],
    functionName: 'getPool',
    args: [position.token0, position.token1, position.fee]
  });

  const slot0 = await publicClient.readContract({
    address: poolAddress,
    abi: POOL_ABI,
    functionName: 'slot0'
  });
  const currentTick = slot0[1];

  // Format position data
  console.log('Position Details:');
  console.log('================');
  console.log(`NFT Token ID: ${tokenId}`);
  console.log(`Owner: ${owner}`);
  console.log(`\nPool Information:`);
  console.log(`Pool Address: ${poolAddress}`);
  console.log(`Fee Tier: ${position.fee / 10000}%`);
  
  console.log(`\nToken Pair:`);
  console.log(`Token0: ${position.token0} (${token0Symbol})`);
  console.log(`Token1: ${position.token1} (${token1Symbol})`);

  console.log(`\nPosition Range:`);
  const lowerPrice = tickToPrice(position.tickLower, token0Decimals, token1Decimals);
  const upperPrice = tickToPrice(position.tickUpper, token0Decimals, token1Decimals);
  const currentPrice = tickToPrice(currentTick, token0Decimals, token1Decimals);
  
  console.log(`Tick Range: ${position.tickLower} to ${position.tickUpper}`);
  console.log(`Price Range: ${lowerPrice.toFixed(6)} to ${upperPrice.toFixed(6)} ${token1Symbol}/${token0Symbol}`);
  console.log(`Current Price: ${currentPrice.toFixed(6)} ${token1Symbol}/${token0Symbol}`);
  console.log(`Position Status: ${currentTick >= position.tickLower && currentTick < position.tickUpper ? '🟢 In Range' : '🔴 Out of Range'}`);

  console.log(`\nLiquidity:`);
  console.log(`Current Liquidity: ${position.liquidity.toString()}`);
  console.log(`Uncollected Fees:`);
  console.log(`  ${token0Symbol}: ${formatEther(position.tokensOwed0, token0Decimals)}`);
  console.log(`  ${token1Symbol}: ${formatEther(position.tokensOwed1, token1Decimals)}`);

  console.log(`\nPosition Metadata:`);
  console.log(`Nonce: ${position.nonce}`);
  console.log(`Operator: ${position.operator}`);
  console.log(`Fee Growth Inside 0: ${position.feeGrowthInside0LastX128.toString()}`);
  console.log(`Fee Growth Inside 1: ${position.feeGrowthInside1LastX128.toString()}`);

  console.log('\n✅ Position query completed successfully!');
}

main().catch((error) => {
  console.error('\n❌ Position query failed:', error);
  process.exit(1);
}); 