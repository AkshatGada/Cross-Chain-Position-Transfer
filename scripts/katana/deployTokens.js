import { createPublicClient, createWalletClient, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs/promises';
import path from 'path';

// Default private key from Anvil
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Token deployment parameters
const TOKEN_PARAMS = {
  TokenA: {
    name: 'TokenA',
    symbol: 'TKA',
    initialSupply: parseEther('1000000') // 1M tokens
  },
  TokenB: {
    name: 'TokenB',
    symbol: 'TKB',
    initialSupply: parseEther('1000000') // 1M tokens
  }
};

async function main() {
  console.log('🚀 Deploying test tokens to Katana Tatara Fork...\n');

  // Initialize client
  const publicClient = createPublicClient({
    transport: http('https://katana-tatara.gateway.tenderly.co/x53Hr4hpNj4buY178WZiS'),
    chain: {
      id: 129399,
      name: 'Katana Tatara Fork',
      network: 'katana-tatara',
      nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH',
      },
      rpcUrls: {
        default: {
          http: ['https://katana-tatara.gateway.tenderly.co/x53Hr4hpNj4buY178WZiS'],
        },
        public: {
          http: ['https://katana-tatara.gateway.tenderly.co/x53Hr4hpNj4buY178WZiS'],
        },
      },
    }
  });

  const walletClient = createWalletClient({
    transport: http('https://katana-tatara.gateway.tenderly.co/x53Hr4hpNj4buY178WZiS'),
    chain: {
      id: 129399,
      name: 'Katana Tatara Fork',
      network: 'katana-tatara',
      nativeCurrency: {
        decimals: 18,
        name: 'Ether',
        symbol: 'ETH',
      },
      rpcUrls: {
        default: {
          http: ['https://katana-tatara.gateway.tenderly.co/x53Hr4hpNj4buY178WZiS'],
        },
        public: {
          http: ['https://katana-tatara.gateway.tenderly.co/x53Hr4hpNj4buY178WZiS'],
        },
      },
    },
    account: privateKeyToAccount(PRIVATE_KEY)
  });

  const chainId = await publicClient.getChainId();
  console.log(`Connected to Katana Tatara Fork (Chain ID: ${chainId})`);

  // Load token artifacts
  const tokenAJson = JSON.parse(await fs.readFile(path.join(process.cwd(), 'specialk/examples/TokenA.sol/TokenA.json'), 'utf8'));
  const tokenBJson = JSON.parse(await fs.readFile(path.join(process.cwd(), 'specialk/examples/TokenB.sol/TokenB.json'), 'utf8'));

  // Deploy TokenA
  console.log('\n📝 Deploying TokenA...');
  const tokenAHash = await walletClient.deployContract({
    abi: tokenAJson.abi,
    bytecode: tokenAJson.bytecode,
    args: [TOKEN_PARAMS.TokenA.initialSupply],
  });

  const tokenAReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenAHash });
  const tokenAAddress = tokenAReceipt.contractAddress;
  console.log(`✅ TokenA deployed to: ${tokenAAddress}`);

  // Deploy TokenB
  console.log('\n📝 Deploying TokenB...');
  const tokenBHash = await walletClient.deployContract({
    abi: tokenBJson.abi,
    bytecode: tokenBJson.bytecode,
    args: [TOKEN_PARAMS.TokenB.initialSupply],
  });

  const tokenBReceipt = await publicClient.waitForTransactionReceipt({ hash: tokenBHash });
  const tokenBAddress = tokenBReceipt.contractAddress;
  console.log(`✅ TokenB deployed to: ${tokenBAddress}`);

  // Save deployed addresses
  const deployedAddresses = {
    TokenA: tokenAAddress,
    TokenB: tokenBAddress
  };

  await fs.mkdir(path.join(process.cwd(), 'specialk/config'), { recursive: true });
  await fs.writeFile(
    path.join(process.cwd(), 'specialk/config/deployedAddresses.json'),
    JSON.stringify(deployedAddresses, null, 2)
  );

  console.log('\n📋 Deployment Summary:');
  console.log(`TokenA: ${tokenAAddress}`);
  console.log(`TokenB: ${tokenBAddress}`);
  console.log('\nAddresses saved to specialk/config/deployedAddresses.json');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}); 