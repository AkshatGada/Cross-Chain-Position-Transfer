const { ethers } = require('hardhat');
const {
  UNISWAP_V3_FACTORY,
  TOKEN_A,
  TOKEN_B,
  FEE_TIERS,
  FACTORY_ABI
} = require('../../../config/sepoliaConfig');
const { getPriceFromTick } = require('../../utils/v3PriceUtils');

// Minimal Pool ABI for getting pool state
const POOL_ABI = [
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
  'function liquidity() external view returns (uint128)'
];

async function main() {
  try {
    // Validate we're on Sepolia
    const network = await ethers.provider.getNetwork();
    if (network.chainId !== 11155111) { // Sepolia chainId
      throw new Error(`Please connect to Sepolia network. Current network: ${network.name}`);
    }

    console.log('Checking Uniswap V3 pool status...');
    console.log(`TokenA: ${TOKEN_A}`);
    console.log(`TokenB: ${TOKEN_B}`);
    console.log(`Fee Tier: ${FEE_TIERS.MEDIUM} (0.3%)\n`);

    // Get factory contract
    const factory = new ethers.Contract(
      UNISWAP_V3_FACTORY,
      FACTORY_ABI,
      await ethers.getSigner()
    );

    // Check if pool exists
    const poolAddress = await factory.getPool(
      TOKEN_A,
      TOKEN_B,
      FEE_TIERS.MEDIUM
    );

    if (poolAddress === '0x0000000000000000000000000000000000000000') {
      console.log('Pool does not exist yet!');
      
      // Estimate gas for pool creation
      const gasEstimate = await factory.createPool.estimateGas(
        TOKEN_A,
        TOKEN_B,
        FEE_TIERS.MEDIUM
      );
      
      const gasPrice = await ethers.provider.getGasPrice();
      const estimatedCost = ethers.formatEther(gasEstimate * gasPrice);
      
      console.log('\nTo create pool:');
      console.log(`Estimated gas: ${gasEstimate.toString()}`);
      console.log(`Estimated cost: ${estimatedCost} ETH`);
      
      return;
    }

    console.log(`Pool exists at: ${poolAddress}\n`);

    // Get pool contract
    const pool = new ethers.Contract(
      poolAddress,
      POOL_ABI,
      await ethers.getSigner()
    );

    // Get current pool state
    const [slot0Data, liquidity] = await Promise.all([
      pool.slot0(),
      pool.liquidity()
    ]);

    console.log('Current Pool State:');
    console.log(`Liquidity: ${liquidity.toString()}`);
    console.log(`Sqrt Price X96: ${slot0Data.sqrtPriceX96.toString()}`);
    console.log(`Current Tick: ${slot0Data.tick}`);
    
    // Calculate readable price
    const price = getPriceFromTick(slot0Data.tick);
    console.log(`\nPrice: ${price} TokenA per TokenB`);

  } catch (error) {
    console.error('Error checking pool:', error.message);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

main(); 