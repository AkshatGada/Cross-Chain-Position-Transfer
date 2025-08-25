import { createPublicClient, createWalletClient, http, getContract } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Network Configuration
export const NETWORK_CONFIG = {
  chainId: 471, // Tatara testnet
  name: 'Katana Tatara',
  rpcUrl: 'http://localhost:8545',
  blockExplorer: '', // Add when available
  gasSettings: {
    gasPrice: 1000000000n, // 1 gwei
    gasLimit: 8000000n, // 8M gas
    maxFeePerGas: 2000000000n, // 2 gwei
    maxPriorityFeePerGas: 1000000000n, // 1 gwei
  }
};

// Contract Addresses
export const ADDRESSES = {
  V3_POSITION_MANAGER: '0x1400feFD6F9b897970f00Df6237Ff2B8b27Dc82C',
  V3_FACTORY: '0x9B3336186a38E1b6c21955d112dbb0343Ee061eE',
  SUSHI_ROUTER: '0xAC4c6e212A361c968F1725b4d055b47E63F80b75',
  WETH: '0x17B8Ee96E3bcB3b04b3e8334de4524520C51caB4',
  AUSD: '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC'
};

// Fee Tiers Configuration
export const FEE_TIERS = {
  LOWEST: 100,    // 0.01%
  LOW: 500,       // 0.05%
  MEDIUM: 3000,   // 0.3%
  HIGH: 10000     // 1%
};

// Tick Spacing per Fee Tier
export const TICK_SPACINGS = {
  [FEE_TIERS.LOWEST]: 1,
  [FEE_TIERS.LOW]: 10,
  [FEE_TIERS.MEDIUM]: 60,
  [FEE_TIERS.HIGH]: 200
};

// Position Management Parameters
export const POSITION_PARAMS = {
  minTickRange: -887272, // Min tick for full range
  maxTickRange: 887272,  // Max tick for full range
  defaultSlippage: 0.5,  // 0.5% default slippage
  minLiquidity: 1000n,   // Minimum liquidity to maintain
  maxLiquidity: 2n ** 128n - 1n // Maximum liquidity possible
};

// Token Mapping Strategy
export const TOKEN_MAPPING = {
  // Sepolia to Katana token mapping
  SEPOLIA: {
    'TokenA': {
      katanaEquivalent: ADDRESSES.WETH,
      name: 'Wrapped Ether',
      symbol: 'WETH',
      decimals: 18
    },
    'TokenB': {
      katanaEquivalent: ADDRESSES.AUSD,
      name: 'AUSD Stablecoin',
      symbol: 'AUSD',
      decimals: 18
    }
  }
};

// Contract ABIs
const POSITION_MANAGER_ABI = [
  // Core position management functions
  'function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external returns (address pool)',
  'function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) external returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)',
  'function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)'
];

const ROUTER_ABI = [
  // Core routing functions
  'function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external returns (uint256 amountOut)',
  'function exactInput(tuple(bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum) params) external returns (uint256 amountOut)'
];

// Helper Functions
export async function createKatanaClient(privateKey) {
  const account = privateKeyToAccount(privateKey);
  
  const publicClient = createPublicClient({
    chain: {
      id: NETWORK_CONFIG.chainId,
      name: NETWORK_CONFIG.name,
      network: NETWORK_CONFIG.name.toLowerCase(),
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [NETWORK_CONFIG.rpcUrl] }
      }
    },
    transport: http(NETWORK_CONFIG.rpcUrl)
  });

  const walletClient = createWalletClient({
    account,
    chain: publicClient.chain,
    transport: http(NETWORK_CONFIG.rpcUrl)
  });

  return { publicClient, walletClient };
}

export function getPositionManager(client) {
  return getContract({
    address: ADDRESSES.V3_POSITION_MANAGER,
    abi: POSITION_MANAGER_ABI,
    client
  });
}

export function getSushiRouter(client) {
  return getContract({
    address: ADDRESSES.SUSHI_ROUTER,
    abi: ROUTER_ABI,
    client
  });
}

// Error Handling Wrapper
export async function safeContractCall(contractFn, args = [], errorMessage = 'Contract call failed') {
  try {
    const result = await contractFn(...args);
    return { success: true, data: result };
  } catch (error) {
    console.error(`${errorMessage}:`, error);
    return { 
      success: false, 
      error: error.message,
      code: error.code,
      details: {
        function: contractFn.name,
        args,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Position Management Helpers
export function calculateOptimalTicks(price, fee) {
  const tickSpacing = TICK_SPACINGS[fee];
  if (!tickSpacing) throw new Error(`Invalid fee tier: ${fee}`);
  
  const baseTickLower = Math.floor(Math.log(price * 0.9) / Math.log(1.0001));
  const baseTickUpper = Math.ceil(Math.log(price * 1.1) / Math.log(1.0001));
  
  return {
    tickLower: Math.floor(baseTickLower / tickSpacing) * tickSpacing,
    tickUpper: Math.ceil(baseTickUpper / tickSpacing) * tickSpacing
  };
}

export function validatePositionParams(params) {
  const validations = [
    { condition: params.fee in FEE_TIERS, message: 'Invalid fee tier' },
    { condition: params.tickLower < params.tickUpper, message: 'Invalid tick range' },
    { condition: params.amount0Desired > 0n || params.amount1Desired > 0n, message: 'No liquidity provided' },
    { condition: params.deadline > Math.floor(Date.now() / 1000), message: 'Deadline expired' }
  ];

  const errors = validations
    .filter(v => !v.condition)
    .map(v => v.message);

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Export configuration
export default {
  NETWORK_CONFIG,
  ADDRESSES,
  FEE_TIERS,
  TICK_SPACINGS,
  POSITION_PARAMS,
  TOKEN_MAPPING,
  createKatanaClient,
  getPositionManager,
  getSushiRouter,
  safeContractCall,
  calculateOptimalTicks,
  validatePositionParams
}; 