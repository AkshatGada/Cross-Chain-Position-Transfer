import { createPublicClient, createWalletClient, http, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import config from '../../../config/katanaConfig.js';

const AUSD_FAUCET_ADDRESS = '0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C';
const AUSD_ADDRESS = '0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC';

const AUSD_FAUCET_ABI = [
  {
    "inputs": [],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "InsufficientFunds",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidInitialization",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MaxAllowedExceeded",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "MaxFrequencyExceeded",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotInitializing",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "token",
        "type": "address"
      }
    ],
    "name": "SafeERC20FailedOperation",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "address",
        "name": "receiver",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint256",
        "name": "amount",
        "type": "uint256"
      }
    ],
    "name": "FundsRequested",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "faucetDripAmount",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxAmountToOwn",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "maxDripFrequency",
    "outputs": [
      {
        "internalType": "uint256",
        "name": "",
        "type": "uint256"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "_receiver",
        "type": "address"
      }
    ],
    "name": "requestFunds",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address" }],
    outputs: [{ type: "uint256" }]
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }]
  }
];

async function main() {
  console.log('🚰 Requesting AUSD from faucet...');

  const publicClient = createPublicClient({
    transport: http(config.NETWORK.RPC_URL),
    chain: config.CHAIN_CONFIG
  });

  const walletClient = createWalletClient({
    transport: http(config.NETWORK.RPC_URL),
    chain: config.CHAIN_CONFIG,
    account: privateKeyToAccount(config.DEFAULTS.PRIVATE_KEY)
  });

  // Get initial AUSD balance
  const decimals = await publicClient.readContract({
    address: AUSD_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'decimals'
  });

  const initialBalance = await publicClient.readContract({
    address: AUSD_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletClient.account.address]
  });

  console.log(`Initial AUSD balance: ${formatUnits(initialBalance, decimals)} AUSD`);

  // Get faucet configuration
  const [dripAmount, maxAmount, maxFrequency] = await Promise.all([
    publicClient.readContract({
      address: AUSD_FAUCET_ADDRESS,
      abi: AUSD_FAUCET_ABI,
      functionName: 'faucetDripAmount'
    }),
    publicClient.readContract({
      address: AUSD_FAUCET_ADDRESS,
      abi: AUSD_FAUCET_ABI,
      functionName: 'maxAmountToOwn'
    }),
    publicClient.readContract({
      address: AUSD_FAUCET_ADDRESS,
      abi: AUSD_FAUCET_ABI,
      functionName: 'maxDripFrequency'
    })
  ]);

  console.log('\nFaucet Configuration:');
  console.log(`Drip Amount: ${formatUnits(dripAmount, decimals)} AUSD`);
  console.log(`Max Amount to Own: ${formatUnits(maxAmount, decimals)} AUSD`);
  console.log(`Max Drip Frequency: ${maxFrequency} seconds`);

  // Request AUSD
  console.log('\nRequesting AUSD...');
  try {
    const hash = await walletClient.writeContract({
      address: AUSD_FAUCET_ADDRESS,
      abi: AUSD_FAUCET_ABI,
      functionName: 'requestFunds',
      args: [walletClient.account.address]
    });

    console.log(`Transaction hash: ${hash}`);
    
    // Wait for transaction
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log('✅ Successfully received AUSD from faucet');

    // Get final balance
    const finalBalance = await publicClient.readContract({
      address: AUSD_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletClient.account.address]
    });

    console.log(`\nFinal AUSD balance: ${formatUnits(finalBalance, decimals)} AUSD`);
    console.log(`Received: ${formatUnits(finalBalance - initialBalance, decimals)} AUSD`);
  } catch (error) {
    console.error('\n❌ Error requesting funds:');
    if (error.message.includes('MaxFrequencyExceeded')) {
      console.error('You must wait longer between requests');
    } else if (error.message.includes('MaxAllowedExceeded')) {
      console.error('You already have the maximum allowed AUSD');
    } else if (error.message.includes('InsufficientFunds')) {
      console.error('The faucet is out of funds');
    } else {
      console.error(error.message);
    }
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  main().catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
}

export default main; 