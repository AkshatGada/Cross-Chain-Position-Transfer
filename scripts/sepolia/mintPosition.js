const { ethers } = require('hardhat');
const {
  NONFUNGIBLE_POSITION_MANAGER,
  TOKEN_A,
  TOKEN_B,
  FEE_TIERS
} = require('../../../config/sepoliaConfig');

// ERC20 interface for approvals
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function decimals() external view returns (uint8)'
];

// NPM interface for minting
const NPM_ABI = [
  'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)'
];

async function main() {
  try {
    // Validate we're on Sepolia
    const network = await ethers.provider.getNetwork();
    if (network.chainId !== 11155111) {
      throw new Error(`Please connect to Sepolia network. Current network: ${network.name}`);
    }

    const signer = await ethers.getSigner();
    console.log('Minting new Uniswap V3 position...');
    console.log(`Deployer: ${signer.address}\n`);

    // Sort token addresses
    const [token0, token1] = TOKEN_A.toLowerCase() < TOKEN_B.toLowerCase() 
      ? [TOKEN_A, TOKEN_B] 
      : [TOKEN_B, TOKEN_A];
    
    console.log('Sorted tokens:');
    console.log(`token0: ${token0}`);
    console.log(`token1: ${token1}\n`);

    // Get token contracts and decimals
    const token0Contract = new ethers.Contract(token0, ERC20_ABI, signer);
    const token1Contract = new ethers.Contract(token1, ERC20_ABI, signer);
    
    const [decimals0, decimals1] = await Promise.all([
      token0Contract.decimals(),
      token1Contract.decimals()
    ]);

    // Calculate amounts with decimals
    const amount0Desired = ethers.parseUnits('1000', decimals0);
    const amount1Desired = ethers.parseUnits('1000', decimals1);

    // Prepare mint parameters
    const mintParams = {
      token0: token0,
      token1: token1,
      fee: FEE_TIERS.MEDIUM,
      tickLower: -887220,  // Full range
      tickUpper: 887220,   // Full range
      amount0Desired: amount0Desired,
      amount1Desired: amount1Desired,
      amount0Min: 0,       // No slippage protection for testing
      amount1Min: 0,       // No slippage protection for testing
      recipient: signer.address,
      deadline: Math.floor(Date.now() / 1000) + 600 // 10 minutes
    };

    console.log('Approving tokens...');
    
    // Approve tokens
    const npm = NONFUNGIBLE_POSITION_MANAGER;
    const approveTx0 = await token0Contract.approve(npm, amount0Desired);
    const approveTx1 = await token1Contract.approve(npm, amount1Desired);
    
    console.log('Waiting for approval transactions...');
    await Promise.all([
      approveTx0.wait(),
      approveTx1.wait()
    ]);
    console.log('Tokens approved!\n');

    // Get NPM contract
    const positionManager = new ethers.Contract(
      npm,
      NPM_ABI,
      signer
    );

    console.log('Minting position...');
    const mintTx = await positionManager.mint(mintParams);
    console.log('Waiting for mint transaction...');
    const receipt = await mintTx.wait();

    // Find the mint event in the logs
    const mintEvent = receipt.logs.find(
      log => log.address.toLowerCase() === npm.toLowerCase() &&
             log.topics[0] === ethers.id('IncreaseLiquidity(uint256,uint128,uint256,uint256)')
    );

    if (!mintEvent) {
      throw new Error('Mint event not found in transaction logs');
    }

    // Parse the event data
    const [tokenId, liquidity, amount0, amount1] = ethers.AbiCoder.defaultAbiCoder.decode(
      ['uint256', 'uint128', 'uint256', 'uint256'],
      mintEvent.data
    );

    console.log('\nPosition minted successfully! 🎉');
    console.log('Details:');
    console.log(`NFT Token ID: ${tokenId}`);
    console.log(`Liquidity: ${liquidity.toString()}`);
    console.log(`Amount0 used: ${ethers.formatUnits(amount0, decimals0)} tokens`);
    console.log(`Amount1 used: ${ethers.formatUnits(amount1, decimals1)} tokens`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);

  } catch (error) {
    console.error('Error minting position:', error.message);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
  process.exit(1);
});

main(); 