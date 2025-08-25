const { ethers } = require('hardhat');
const {
  UNISWAP_V3_FACTORY,
  TOKEN_A,
  TOKEN_B,
  FEE_TIERS,
  FACTORY_ABI
} = require('../../../config/sepoliaConfig');
const { encodePriceSqrt } = require('../shared/v3PriceUtils');

// Pool ABI with initialize function
const POOL_ABI = [
  'function initialize(uint160 sqrtPriceX96) external',
  'function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)'
];

async function main() {
  try {
    // Validate we're on Sepolia
    const network = await ethers.provider.getNetwork();
    if (network.chainId !== 11155111) {
      throw new Error(`Please connect to Sepolia network. Current network: ${network.name}`);
    }

    console.log('Starting Uniswap V3 pool creation...');
    console.log(`TokenA: ${TOKEN_A}`);
    console.log(`TokenB: ${TOKEN_B}`);
    console.log(`Fee Tier: ${FEE_TIERS.MEDIUM} (0.3%)\n`);

    // Get factory contract
    const factory = new ethers.Contract(
      UNISWAP_V3_FACTORY,
      FACTORY_ABI,
      await ethers.getSigner()
    );

    // Check if pool already exists
    let poolAddress = await factory.getPool(
      TOKEN_A,
      TOKEN_B,
      FEE_TIERS.MEDIUM
    );

    if (poolAddress === '0x0000000000000000000000000000000000000000') {
      console.log('Creating new pool...');
      
      // Create pool
      const tx = await factory.createPool(
        TOKEN_A,
        TOKEN_B,
        FEE_TIERS.MEDIUM
      );
      
      console.log('Waiting for transaction confirmation...');
      const receipt = await tx.wait();
      console.log(`Pool creation transaction confirmed! Gas used: ${receipt.gasUsed.toString()}\n`);

      // Get new pool address
      poolAddress = await factory.getPool(
        TOKEN_A,
        TOKEN_B,
        FEE_TIERS.MEDIUM
      );
    } else {
      console.log('Pool already exists!');
      return;
    }

    console.log(`Pool created at: ${poolAddress}`);

    // Get pool contract
    const pool = new ethers.Contract(
      poolAddress,
      POOL_ABI,
      await ethers.getSigner()
    );

    // Calculate initial sqrt price for 1:1 ratio
    const sqrtPriceX96 = encodePriceSqrt(1, 1);
    console.log(`\nInitializing pool with sqrt price: ${sqrtPriceX96}`);

    // Initialize pool
    const initTx = await pool.initialize(sqrtPriceX96);
    console.log('Waiting for initialization transaction confirmation...');
    const initReceipt = await initTx.wait();
    console.log(`Pool initialization confirmed! Gas used: ${initReceipt.gasUsed.toString()}\n`);

    // Verify initialization
    const slot0 = await pool.slot0();
    console.log('Pool initialization verified:');
    console.log(`Current sqrt price: ${slot0.sqrtPriceX96.toString()}`);
    console.log(`Current tick: ${slot0.tick}`);

    console.log('\nPool creation and initialization complete! 🎉');

  } catch (error) {
    console.error('Error creating pool:', error.message);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

main(); 