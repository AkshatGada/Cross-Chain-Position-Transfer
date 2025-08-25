const { ethers } = require('hardhat');
const {
  NONFUNGIBLE_POSITION_MANAGER,
  TOKEN_A,
  TOKEN_B
} = require('../../../config/sepoliaConfig');
const {
  UNISWAP_V3_FACTORY,
  FACTORY_ABI
} = require('../../config/v3Config');
const { getPriceFromTick } = require('../../utils/v3PriceUtils');

// ERC20 interface for token info
const ERC20_ABI = [
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)'
];

// NPM interface for positions
const NPM_ABI = [
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
];

// Pool interface for current state
const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];

async function main() {
  try {
    // Get tokenId from command line arguments
    const tokenId = process.env.TOKEN_ID;
    if (!tokenId) {
      throw new Error('Please provide TOKEN_ID environment variable');
    }

    // Validate we're on Sepolia
    const network = await ethers.provider.getNetwork();
    if (network.chainId !== 11155111) {
      throw new Error(`Please connect to Sepolia network. Current network: ${network.name}`);
    }

    console.log(`Querying Uniswap V3 position #${tokenId}...\n`);

    // Get position manager contract
    const positionManager = new ethers.Contract(
      NONFUNGIBLE_POSITION_MANAGER,
      NPM_ABI,
      await ethers.getSigner()
    );

    // Get position data
    const position = await positionManager.positions(tokenId);
    
    // Get token contracts
    const token0Contract = new ethers.Contract(position.token0, ERC20_ABI, ethers.provider);
    const token1Contract = new ethers.Contract(position.token1, ERC20_ABI, ethers.provider);

    // Get token info
    const [
      symbol0,
      symbol1,
      decimals0,
      decimals1
    ] = await Promise.all([
      token0Contract.symbol(),
      token1Contract.symbol(),
      token0Contract.decimals(),
      token1Contract.decimals()
    ]);

    // Get factory contract
    const factory = new ethers.Contract(
      UNISWAP_V3_FACTORY,
      FACTORY_ABI,
      ethers.provider
    );

    // Get pool address
    const poolAddress = await factory.getPool(
      position.token0,
      position.token1,
      position.fee
    );

    // Get pool contract
    const pool = new ethers.Contract(
      poolAddress,
      POOL_ABI,
      ethers.provider
    );

    // Get current pool state
    const slot0 = await pool.slot0();
    const currentTick = slot0.tick;

    // Format position details
    console.log('Position Details:');
    console.log('----------------');
    console.log(`Owner/Operator: ${position.operator}`);
    console.log('\nTokens:');
    console.log(`- Token0: ${symbol0} (${position.token0})`);
    console.log(`- Token1: ${symbol1} (${position.token1})`);
    console.log(`Fee Tier: ${position.fee / 10000}%\n`);

    console.log('Tick Range:');
    console.log(`- Lower: ${position.tickLower} (${getPriceFromTick(position.tickLower)} ${symbol0}/${symbol1})`);
    console.log(`- Upper: ${position.tickUpper} (${getPriceFromTick(position.tickUpper)} ${symbol0}/${symbol1})`);
    console.log(`- Current: ${currentTick} (${getPriceFromTick(currentTick)} ${symbol0}/${symbol1})\n`);

    // Check if position is in range
    const isInRange = currentTick >= position.tickLower && currentTick < position.tickUpper;
    console.log(`Position Status: ${isInRange ? '🟢 In Range' : '🔴 Out of Range'}\n`);

    console.log('Liquidity:');
    console.log(`- Current Liquidity: ${position.liquidity.toString()}`);
    
    console.log('\nUncollected Fees:');
    console.log(`- ${symbol0}: ${ethers.formatUnits(position.tokensOwed0, decimals0)}`);
    console.log(`- ${symbol1}: ${ethers.formatUnits(position.tokensOwed1, decimals1)}`);

    console.log('\nFee Growth:');
    console.log(`- ${symbol0} Inside Last: ${position.feeGrowthInside0LastX128.toString()}`);
    console.log(`- ${symbol1} Inside Last: ${position.feeGrowthInside1LastX128.toString()}`);

  } catch (error) {
    console.error('Error querying position:', error.message);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

main(); 