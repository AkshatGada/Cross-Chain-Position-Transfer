import { createPublicClient, createWalletClient, http, parseEther, formatEther, getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import config from '../../../config/katanaConfig.js';

// Configuration
const POSITION_MANAGER_ADDRESS = config.ADDRESSES.V3_POSITION_MANAGER;
const POSITION_AMOUNT = config.DEFAULTS.POSITION_AMOUNT;
const FEE = config.FEE_TIERS.MEDIUM;
const TICK_LOWER = config.DEFAULTS.TICK_LOWER;
const TICK_UPPER = config.DEFAULTS.TICK_UPPER;

// Use WETH and AUSD addresses directly
const TOKEN_A = config.ADDRESSES.WETH;  // WETH
const TOKEN_B = config.ADDRESSES.AUSD;  // AUSD

// Position Manager ABI (minimal required functions)
const POSITION_MANAGER_ABI = [
  {
    inputs: [{
      components: [
        { name: 'token0', type: 'address' },
        { name: 'token1', type: 'address' },
        { name: 'fee', type: 'uint24' },
        { name: 'tickLower', type: 'int24' },
        { name: 'tickUpper', type: 'int24' },
        { name: 'amount0Desired', type: 'uint256' },
        { name: 'amount1Desired', type: 'uint256' },
        { name: 'amount0Min', type: 'uint256' },
        { name: 'amount1Min', type: 'uint256' },
        { name: 'recipient', type: 'address' },
        { name: 'deadline', type: 'uint256' }
      ],
      name: 'params',
      type: 'tuple'
    }],
    name: 'mint',
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' }
    ],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: 'from', type: 'address' },
      { indexed: true, name: 'to', type: 'address' },
      { indexed: true, name: 'tokenId', type: 'uint256' }
    ],
    name: 'Transfer',
    type: 'event'
  }
];

// ERC20 ABI for approvals
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ type: 'bool' }]
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }]
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }]
  }
];

function sortTokens(tokenA, tokenB) {
  // Sort tokens by address (SushiSwap V3 requires token0 < token1)
  return tokenA.toLowerCase() < tokenB.toLowerCase() ? [tokenA, tokenB] : [tokenB, tokenA];
}

async function main() {
  console.log('🚀 Creating liquidity position on Katana Tatara Fork...\n');

  // Initialize client
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
  console.log(`Connected to Katana Tatara Fork (Chain ID: ${chainId})`);

  // Sort tokens (SushiSwap V3 requires token0 < token1)
  const [token0, token1] = sortTokens(TOKEN_A, TOKEN_B);
  console.log(`\n🔄 Using tokens:`);
  console.log(`  Token0: ${token0}`);
  console.log(`  Token1: ${token1}`);

  // Get token info and balances
  const [token0Decimals, token1Decimals, token0Balance, token1Balance] = await Promise.all([
    publicClient.readContract({
      address: token0,
      abi: ERC20_ABI,
      functionName: 'decimals'
    }),
    publicClient.readContract({
      address: token1,
      abi: ERC20_ABI,
      functionName: 'decimals'
    }),
    publicClient.readContract({
      address: token0,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletClient.account.address]
    }),
    publicClient.readContract({
      address: token1,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletClient.account.address]
    })
  ]);

  console.log(`\n💰 Token balances:`);
  console.log(`  Token0: ${formatEther(token0Balance, token0Decimals)}`);
  console.log(`  Token1: ${formatEther(token1Balance, token1Decimals)}`);

  // Calculate amounts based on decimals
  const amount0Desired = parseEther('0.00005', token0Decimals); // 0.00005 WETH
  const amount1Desired = parseEther('100', token1Decimals); // 100 AUSD

  console.log(`\n📝 Approving tokens...`);
  
  // Approve Token0
  const approve0Hash = await walletClient.writeContract({
    address: token0,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [POSITION_MANAGER_ADDRESS, amount0Desired]
  });
  await publicClient.waitForTransactionReceipt({ hash: approve0Hash });
  console.log('✅ Token0 approved');

  // Approve Token1
  const approve1Hash = await walletClient.writeContract({
    address: token1,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [POSITION_MANAGER_ADDRESS, amount1Desired]
  });
  await publicClient.waitForTransactionReceipt({ hash: approve1Hash });
  console.log('✅ Token1 approved');

  // Create position
  console.log('\n📝 Creating liquidity position...');

  const mintHash = await walletClient.writeContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    functionName: 'mint',
    args: [{
      token0: token0,
      token1: token1,
      fee: FEE,
      tickLower: TICK_LOWER,
      tickUpper: TICK_UPPER,
      amount0Desired: amount0Desired,
      amount1Desired: amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: walletClient.account.address,
      deadline: BigInt(Math.floor(Date.now() / 1000) + 3600) // 1 hour from now
    }]
  });

  const mintReceipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
  console.log('✅ Position created');
  console.log(`   Transaction hash: ${mintHash}`);

  // Get position details
  const events = await publicClient.getContractEvents({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    eventName: 'Transfer',
    fromBlock: mintReceipt.blockNumber,
    toBlock: mintReceipt.blockNumber
  });

  const tokenId = events[0].args.tokenId;
  console.log(`\n🎉 Position created with Token ID: ${tokenId}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 