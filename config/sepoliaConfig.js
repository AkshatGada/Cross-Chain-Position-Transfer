const { ethers } = require("ethers");

// Contract Addresses on Sepolia
const UNISWAP_V3_FACTORY = "0x0227628f3F023bb0B980b67D528571c95c6DaC1c";
const NONFUNGIBLE_POSITION_MANAGER = "0x1238536071E1c677A632429e3655c799b22cDA52";
const SWAP_ROUTER_02 = "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E";
const QUOTER_V2 = "0xEd1f6473345F45b75F8179591dd5bA1888cf2FB3";
const WETH = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";

// Our deployed tokens
const TOKEN_A = "0x18Ae0780D1d9325ce7fe45c68F6879b24Ff63FBe";
const TOKEN_B = "0xb9B04519126d3d6D13FE9B5B69cF7e00A1eBFa49";

// Fee tiers
const FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.3%
  HIGH: 10000     // 1%
};

// Minimal ABIs
const FACTORY_ABI = [
  "function owner() external view returns (address)",
  "function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool)",
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
  "function enableFeeAmount(uint24 fee, int24 tickSpacing) external"
];

const POSITION_MANAGER_ABI = [
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
  "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)"
];

const ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)",
  "function exactOutputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountIn)"
];

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountOut, uint160 sqrtPriceLimitX96) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)"
];

/**
 * Get contract instances with a signer
 * @param {ethers.Signer} signer - Signer to use for contract interactions
 * @returns {Object} Object containing contract instances
 */
function getContracts(signer) {
  return {
    factory: new ethers.Contract(UNISWAP_V3_FACTORY, FACTORY_ABI, signer),
    nfpm: new ethers.Contract(NONFUNGIBLE_POSITION_MANAGER, POSITION_MANAGER_ABI, signer),
    router: new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, signer),
    quoter: new ethers.Contract(QUOTER_V2, QUOTER_ABI, signer)
  };
}

module.exports = {
  // Addresses
  UNISWAP_V3_FACTORY,
  NONFUNGIBLE_POSITION_MANAGER,
  SWAP_ROUTER_02,
  QUOTER_V2,
  WETH,
  TOKEN_A,
  TOKEN_B,
  
  // Constants
  FEE_TIERS,
  
  // ABIs
  FACTORY_ABI,
  POSITION_MANAGER_ABI,
  ROUTER_ABI,
  QUOTER_ABI,
  
  // Helper functions
  getContracts
}; 