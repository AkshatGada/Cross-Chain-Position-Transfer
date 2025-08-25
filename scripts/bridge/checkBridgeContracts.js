import { ethers } from 'ethers';
import { NETWORKS, ADDRESSES } from './config/bridgeConfig.js';

async function checkContractExists(provider, address, networkName) {
  try {
    console.log(`\nChecking contract at ${address} on ${networkName}...`);
    
    // Get the code at the address
    const code = await provider.getCode(address);
    
    if (code === '0x' || code === '0x0') {
      console.log(`❌ No contract found at ${address} on ${networkName}`);
      return false;
    } else {
      console.log(`✅ Contract exists at ${address} on ${networkName}`);
      console.log(`   Code size: ${(code.length - 2) / 2} bytes`);
      return true;
    }
  } catch (error) {
    console.log(`❌ Error checking contract at ${address} on ${networkName}: ${error.message}`);
    return false;
  }
}

async function main() {
  console.log('=================================================================');
  console.log('              CHECKING BRIDGE CONTRACTS');
  console.log('=================================================================');
  
  // Create providers
  const sepoliaProvider = new ethers.JsonRpcProvider(NETWORKS.SEPOLIA.RPC_URL);
  const tataraProvider = new ethers.JsonRpcProvider(NETWORKS.TATARA.RPC_URL);
  
  console.log(`Sepolia RPC: ${NETWORKS.SEPOLIA.RPC_URL}`);
  console.log(`Tatara RPC: ${NETWORKS.TATARA.RPC_URL}`);
  
  // Check Sepolia contracts
  console.log('\n--- SEPOLIA CONTRACTS ---');
  const sepoliaBridgeExists = await checkContractExists(
    sepoliaProvider, 
    ADDRESSES.SEPOLIA.BRIDGE_CONTRACT, 
    'Sepolia'
  );
  const sepoliaBridgeExtExists = await checkContractExists(
    sepoliaProvider, 
    ADDRESSES.SEPOLIA.BRIDGE_EXTENSION, 
    'Sepolia'
  );
  
  // Check Tatara contracts
  console.log('\n--- TATARA CONTRACTS ---');
  const tataraBridgeExists = await checkContractExists(
    tataraProvider, 
    ADDRESSES.TATARA.BRIDGE_CONTRACT, 
    'Tatara'
  );
  const tataraBridgeExtExists = await checkContractExists(
    tataraProvider, 
    ADDRESSES.TATARA.BRIDGE_EXTENSION, 
    'Tatara'
  );
  
  // Check counter contract on Tatara
  const counterAddress = '0xb1d30e9B13Dd571D3b95d022255CAFA5FEACC5D3';
  console.log('\n--- COUNTER CONTRACT ---');
  const counterExists = await checkContractExists(
    tataraProvider, 
    counterAddress, 
    'Tatara'
  );
  
  // Summary
  console.log('\n=================================================================');
  console.log('                        SUMMARY');
  console.log('=================================================================');
  console.log(`Sepolia Bridge Contract: ${sepoliaBridgeExists ? '✅' : '❌'}`);
  console.log(`Sepolia Bridge Extension: ${sepoliaBridgeExtExists ? '✅' : '❌'}`);
  console.log(`Tatara Bridge Contract: ${tataraBridgeExists ? '✅' : '❌'}`);
  console.log(`Tatara Bridge Extension: ${tataraBridgeExtExists ? '✅' : '❌'}`);
  console.log(`Tatara Counter Contract: ${counterExists ? '✅' : '❌'}`);
  
  const allContractsExist = sepoliaBridgeExists && sepoliaBridgeExtExists && 
                           tataraBridgeExists && tataraBridgeExtExists && counterExists;
  
  if (allContractsExist) {
    console.log('\n🎉 All contracts are deployed and ready for testing!');
  } else {
    console.log('\n⚠️  Some contracts are missing. Please deploy them before proceeding.');
  }
  
  return allContractsExist;
}

// Run the check
main().catch(console.error); 