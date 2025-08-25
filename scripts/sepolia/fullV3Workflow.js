const { ethers } = require('hardhat');
const {
  UNISWAP_V3_FACTORY,
  NONFUNGIBLE_POSITION_MANAGER,
  TOKEN_A,
  TOKEN_B,
  FEE_TIERS,
  FACTORY_ABI
} = require('../../../config/sepoliaConfig');
const { encodePriceSqrt } = require('../shared/v3PriceUtils');

// ERC20 interface
const ERC20_ABI = [
  'function balanceOf(address account) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)'
];

// Pool interface
const POOL_ABI = [
  'function initialize(uint160 sqrtPriceX96) external',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];

// NPM interface
const NPM_ABI = [
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
  'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function decreaseLiquidity(tuple(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) external payable returns (uint256 amount0, uint256 amount1)',
  'function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) external payable returns (uint256 amount0, uint256 amount1)',
  'event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
];

async function getTokenInfo(tokenAddress, signer) {
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const [symbol, decimals] = await Promise.all([
    token.symbol(),
    token.decimals()
  ]);
  return { contract: token, symbol, decimals };
}

async function logTokenBalances(token0Info, token1Info, address, label = '') {
  const [balance0, balance1] = await Promise.all([
    token0Info.contract.balanceOf(address),
    token1Info.contract.balanceOf(address)
  ]);

  console.log(`${label ? label + ' ' : ''}Token Balances:`);
  console.log(`- ${token0Info.symbol}: ${ethers.formatUnits(balance0, token0Info.decimals)}`);
  console.log(`- ${token1Info.symbol}: ${ethers.formatUnits(balance1, token1Info.decimals)}\n`);
  
  return { balance0, balance1 };
}

async function main() {
  try {
    let totalGasUsed = ethers.getBigInt(0);
    
    // Validate we're on Sepolia
    const network = await ethers.provider.getNetwork();
    if (network.chainId !== 11155111n) {
      throw new Error(`Please connect to Sepolia network. Current network: ${network.name} (chainId: ${network.chainId})`);
    }

    console.log('Starting Uniswap V3 Full Workflow\n');
    console.log('Step 1: Pool Setup 🏊‍♂️');
    console.log('-----------------');

    const signerList = await ethers.getSigners();
    console.log(`DEBUG signers length: ${signerList.length}`);
    if (signerList[0]) {
      console.log(`DEBUG first signer: ${signerList[0].address}`);
    } else {
      console.log('DEBUG no signers available');
    }

    const signer = signerList[0];
    if (!signer) throw new Error('No signer available');

    console.log(`Operator: ${signer.address}\n`);

    // Sort token addresses
    const [token0, token1] = TOKEN_A.toLowerCase() < TOKEN_B.toLowerCase() 
      ? [TOKEN_A, TOKEN_B] 
      : [TOKEN_B, TOKEN_A];

    console.log(`DEBUG token0: ${token0}, token1: ${token1}`);

    // Get token information
    const token0Info = await getTokenInfo(token0, signer);
    const token1Info = await getTokenInfo(token1, signer);

    console.log('Tokens:');
    console.log(`- Token0: ${token0Info.symbol} (${token0})`);
    console.log(`- Token1: ${token1Info.symbol} (${token1})`);
    console.log(`Fee Tier: ${FEE_TIERS.MEDIUM / 10000}%\n`);

    // Get initial balances
    const initialBalances = await logTokenBalances(token0Info, token1Info, signer.address, 'Initial');

    // Check/create pool
    const factory = new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, signer);
    let poolAddress = await factory.getPool(token0, token1, FEE_TIERS.MEDIUM);

    if (poolAddress === '0x0000000000000000000000000000000000000000') {
      console.log('Creating new pool...');
      const createTx = await factory.createPool(token0, token1, FEE_TIERS.MEDIUM);
      const createReceipt = await createTx.wait();
      totalGasUsed += createReceipt.gasUsed;
      
      poolAddress = await factory.getPool(token0, token1, FEE_TIERS.MEDIUM);
      console.log(`Pool created at: ${poolAddress}`);

      // Initialize pool
      const pool = new ethers.Contract(poolAddress, POOL_ABI, signer);
      const initTx = await pool.initialize(encodePriceSqrt(1, 1));
      const initReceipt = await initTx.wait();
      totalGasUsed += initReceipt.gasUsed;
      console.log('Pool initialized with 1:1 price\n');
    } else {
      console.log(`Using existing pool: ${poolAddress}`);
      // Check if pool is initialized (sqrtPriceX96 > 0)
      const pool = new ethers.Contract(poolAddress, POOL_ABI, signer);
      const slot0 = await pool.slot0();
      if (slot0.sqrtPriceX96 === 0n) {
        console.log('Pool found but not initialized. Initializing with 1:1 price...');
        const initTx = await pool.initialize(encodePriceSqrt(1, 1));
        const initReceipt = await initTx.wait();
        totalGasUsed += initReceipt.gasUsed;
        console.log('Pool initialized with 1:1 price\n');
      } else {
        console.log('Pool already initialized\n');
      }
    }

    console.log('Step 2: Position Creation 🎯');
    console.log('----------------------');

    // Calculate amounts with decimals
    const amount0Desired = ethers.parseUnits('1000', token0Info.decimals);
    const amount1Desired = ethers.parseUnits('1000', token1Info.decimals);

    // Approve tokens sequentially
    console.log('Approving tokens...');
    const npm = NONFUNGIBLE_POSITION_MANAGER;

    console.log('Approving token0...');
    const approveTx0 = await token0Info.contract.approve(npm, amount0Desired);
    const approveReceipt0 = await approveTx0.wait();
    console.log(`token0 approved (gas: ${approveReceipt0.gasUsed.toString()})`);
    totalGasUsed += approveReceipt0.gasUsed;

    console.log('Approving token1...');
    const approveTx1 = await token1Info.contract.approve(npm, amount1Desired);
    const approveReceipt1 = await approveTx1.wait();
    console.log(`token1 approved (gas: ${approveReceipt1.gasUsed.toString()})`);
    totalGasUsed += approveReceipt1.gasUsed;

    // Prepare mint parameters
    const mintParams = {
      token0: token0,
      token1: token1,
      fee: FEE_TIERS.MEDIUM,
      tickLower: -887220,
      tickUpper: 887220,
      amount0Desired,
      amount1Desired,
      amount0Min: 0,
      amount1Min: 0,
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000) + 600
    };

    // Mint position
    console.log('Minting position...');
    const positionManager = new ethers.Contract(npm, NPM_ABI, signer);
    const mintTx = await positionManager.mint(mintParams);
    const mintReceipt = await mintTx.wait();
    totalGasUsed += mintReceipt.gasUsed;

    // Parse IncreaseLiquidity event to get tokenId
    const iface = new ethers.Interface(NPM_ABI);
    let tokenId;
    for (const log of mintReceipt.logs) {
      if (log.address.toLowerCase() === npm.toLowerCase()) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed && parsed.name === 'IncreaseLiquidity') {
            tokenId = parsed.args.tokenId.toString();
            break;
          }
        } catch (_) {}
      }
    }

    if (!tokenId) {
      throw new Error('IncreaseLiquidity event not found to extract tokenId');
    }

    console.log(`Position minted with NFT ID: ${tokenId}\n`);

    // Get post-mint balances
    const postMintBalances = await logTokenBalances(token0Info, token1Info, signer.address, 'Post-Mint');

    console.log('Step 3: Position Details 📊');
    console.log('----------------------');
    
    const position = await positionManager.positions(tokenId);
    console.log('Position State:');
    console.log(`- Liquidity: ${position.liquidity.toString()}`);
    console.log(`- Token Range: [${position.tickLower}, ${position.tickUpper}]`);
    console.log(`- Fees Owed: ${ethers.formatUnits(position.tokensOwed0, token0Info.decimals)} ${token0Info.symbol}, ${ethers.formatUnits(position.tokensOwed1, token1Info.decimals)} ${token1Info.symbol}\n`);

    console.log('Step 4: Position Unwinding 🔄');
    console.log('-----------------------');

    // Remove all liquidity
    if (position.liquidity.toString() !== '0') {
      console.log('Removing liquidity...');
      const decreaseParams = {
        tokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline: Math.floor(Date.now() / 1000) + 600
      };

      const decreaseTx = await positionManager.decreaseLiquidity(decreaseParams);
      const decreaseReceipt = await decreaseTx.wait();
      totalGasUsed += decreaseReceipt.gasUsed;
    }

    // Collect all tokens
    console.log('Collecting tokens...');
    const MAX_UINT128 = (1n << 128n) - 1n;
    const collectParams = {
      tokenId,
      recipient: signer.address,
      amount0Max: MAX_UINT128,
      amount1Max: MAX_UINT128
    };

    const collectTx = await positionManager.collect(collectParams);
    const collectReceipt = await collectTx.wait();
    totalGasUsed += collectReceipt.gasUsed;

    // Get final balances
    const finalBalances = await logTokenBalances(token0Info, token1Info, signer.address, 'Final');

    console.log('Workflow Summary 📝');
    console.log('----------------');
    console.log(`Total Gas Used: ${totalGasUsed.toString()}`);
    
    // Calculate token changes
    const token0Change = finalBalances.balance0 - initialBalances.balance0;
    const token1Change = finalBalances.balance1 - initialBalances.balance1;
    
    console.log('\nToken Changes:');
    console.log(`- ${token0Info.symbol}: ${ethers.formatUnits(token0Change, token0Info.decimals)}`);
    console.log(`- ${token1Info.symbol}: ${ethers.formatUnits(token1Change, token1Info.decimals)}`);

    // Validate amounts
    const token0Loss = token0Change < 0 ? Math.abs(Number(ethers.formatUnits(token0Change, token0Info.decimals))) : 0;
    const token1Loss = token1Change < 0 ? Math.abs(Number(ethers.formatUnits(token1Change, token1Info.decimals))) : 0;

    if (token0Loss > 0.01 || token1Loss > 0.01) {
      console.log('\n⚠️ Warning: Significant token loss detected (>1%). This could be due to:');
      console.log('- Price impact from pool initialization');
      console.log('- Accumulated fees not yet collected');
      console.log('- Slippage during liquidity operations');
    } else {
      console.log('\n✅ Token amounts validated successfully!');
    }

    console.log('\nWorkflow completed successfully! 🎉');

  } catch (error) {
    console.error('Error in workflow:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

main(); 