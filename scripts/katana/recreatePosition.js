import { createPublicClient, createWalletClient, http, parseEther, formatEther, getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs/promises';
import path from 'path';
import katanaConfig from '../../../config/katanaConfig.js';

const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const POSITION_MANAGER_ADDRESS = katanaConfig.ADDRESSES.V3_POSITION_MANAGER;

// Example token addresses from SushiSwap on Katana Tatara
const EXAMPLE_TOKENS = {
  WETH: '0x99bba657f2bbc93c02d617f8ba121cb8fc104acf',
  USDC: '0x959922be3caee4b8cd9a407cc3ac1c251c2007b1'  // Using your TokenA address as USDC for example
};

// ABIs
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
  'function symbol() external view returns (string)'
];

const POSITION_MANAGER_ABI = [
  'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
];

const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];

async function getTokenInfo(tokenAddress, publicClient, walletClient) {
  const tokenContract = getContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    client: { public: publicClient, wallet: walletClient }
  });

  const [symbol, decimals, balance] = await Promise.all([
    tokenContract.read.symbol(),
    tokenContract.read.decimals(),
    tokenContract.read.balanceOf([walletClient.account.address])
  ]);

  return { symbol, decimals, balance };
}

async function approveToken(tokenContract, spender, amount) {
  const tx = await tokenContract.write.approve([spender, amount]);
  return tx;
}

async function recreatePositionFromTokens(tokenAAmount, tokenBAmount, tickLower, tickUpper) {
  console.log('🔄 Recreating SushiSwap V3 Position on Forked Katana Tatara...\n');

  // Initialize clients
  const { publicClient, walletClient } = await katanaConfig.createKatanaClient(PRIVATE_KEY);
  const chainId = await publicClient.getChainId();
  if (chainId !== 129399) throw new Error(`Wrong chain ID. Expected 129399 (Katana Tatara), got ${chainId}`);

  // Use example tokens
  const [token0, token1] = [EXAMPLE_TOKENS.WETH, EXAMPLE_TOKENS.USDC].sort((a, b) => 
    a.toLowerCase() < b.toLowerCase() ? -1 : 1
  );

  // Get token information and balances
  const [token0Info, token1Info] = await Promise.all([
    getTokenInfo(token0, publicClient, walletClient),
    getTokenInfo(token1, publicClient, walletClient)
  ]);

  console.log('Token Information:');
  console.log(`${token0Info.symbol}: Balance = ${formatEther(token0Info.balance, token0Info.decimals)}`);
  console.log(`${token1Info.symbol}: Balance = ${formatEther(token1Info.balance, token1Info.decimals)}\n`);

  // Check if we have sufficient balance
  const amount0Desired = parseEther(token0 === EXAMPLE_TOKENS.WETH ? tokenAAmount : tokenBAmount, token0Info.decimals);
  const amount1Desired = parseEther(token1 === EXAMPLE_TOKENS.WETH ? tokenAAmount : tokenBAmount, token1Info.decimals);

  if (amount0Desired > token0Info.balance) {
    throw new Error(`Insufficient ${token0Info.symbol} balance. Have ${formatEther(token0Info.balance, token0Info.decimals)}, need ${tokenAAmount}`);
  }
  if (amount1Desired > token1Info.balance) {
    throw new Error(`Insufficient ${token1Info.symbol} balance. Have ${formatEther(token1Info.balance, token1Info.decimals)}, need ${tokenBAmount}`);
  }

  // Get pool information to check current price
  const poolAddress = await katanaConfig.computePoolAddress(token0, token1, katanaConfig.FEE_TIERS.MEDIUM);
  const poolContract = getContract({
    address: poolAddress,
    abi: POOL_ABI,
    client: { public: publicClient, wallet: walletClient }
  });

  const slot0 = await poolContract.read.slot0();
  const currentTick = slot0[1];
  console.log('Pool Information:');
  console.log(`Current Tick: ${currentTick}`);
  console.log(`Target Range: ${tickLower} to ${tickUpper}`);
  if (currentTick < tickLower || currentTick > tickUpper) {
    console.log('⚠️  Warning: Current price is outside the target range');
  }

  // Approve tokens
  console.log('\nApproving tokens...');
  const token0Contract = getContract({
    address: token0,
    abi: ERC20_ABI,
    client: { public: publicClient, wallet: walletClient }
  });
  const token1Contract = getContract({
    address: token1,
    abi: ERC20_ABI,
    client: { public: publicClient, wallet: walletClient }
  });

  const [approve0Tx, approve1Tx] = await Promise.all([
    approveToken(token0Contract, POSITION_MANAGER_ADDRESS, amount0Desired),
    approveToken(token1Contract, POSITION_MANAGER_ADDRESS, amount1Desired)
  ]);

  await Promise.all([
    publicClient.waitForTransactionReceipt({ hash: approve0Tx }),
    publicClient.waitForTransactionReceipt({ hash: approve1Tx })
  ]);
  console.log('Tokens approved!\n');

  // Prepare mint parameters
  const mintParams = {
    token0,
    token1,
    fee: katanaConfig.FEE_TIERS.MEDIUM,
    tickLower,
    tickUpper,
    amount0Desired,
    amount1Desired,
    amount0Min: 0n,
    amount1Min: 0n,
    recipient: walletClient.account.address,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 600)
  };

  // Mint position
  console.log('Minting new position...');
  const positionManager = getContract({
    address: POSITION_MANAGER_ADDRESS,
    abi: POSITION_MANAGER_ABI,
    client: { public: publicClient, wallet: walletClient }
  });

  const mintTx = await positionManager.write.mint([mintParams]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: mintTx });

  // Get position details
  const events = receipt.logs;
  // Note: In a production environment, we would decode the event logs to get the tokenId
  // For this example, we'll query recent positions to find the new one
  console.log('\nPosition created successfully! 🎉');
  console.log(`Transaction Hash: ${mintTx}`);
  console.log(`Gas Used: ${receipt.gasUsed.toString()}`);

  return {
    transactionHash: mintTx,
    token0Amount: formatEther(amount0Desired, token0Info.decimals),
    token1Amount: formatEther(amount1Desired, token1Info.decimals),
    token0Symbol: token0Info.symbol,
    token1Symbol: token1Info.symbol,
    tickLower,
    tickUpper
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4) {
    console.error('Usage: bun katana:recreate-position <tokenAAmount> <tokenBAmount> <tickLower> <tickUpper>');
    process.exit(1);
  }

  const [tokenAAmount, tokenBAmount, tickLower, tickUpper] = args;
  
  try {
    const result = await recreatePositionFromTokens(
      tokenAAmount,
      tokenBAmount,
      parseInt(tickLower),
      parseInt(tickUpper)
    );
    
    console.log('\nRecreated Position Details:');
    console.log('=========================');
    console.log(`Token Amounts: ${result.token0Amount} ${result.token0Symbol} / ${result.token1Amount} ${result.token1Symbol}`);
    console.log(`Tick Range: ${result.tickLower} to ${result.tickUpper}`);
    console.log(`Transaction: ${result.transactionHash}`);
  } catch (error) {
    console.error('\n❌ Error recreating position:', error.message);
    process.exit(1);
  }
}

main(); 