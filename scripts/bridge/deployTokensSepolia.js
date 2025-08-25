import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { NETWORKS } from './config/bridgeConfig.js';

// Use the provided private key
const PRIVATE_KEY = 'c54698db0aca65242f49e5e84485d859c0fa41ee7a075d741eaa811da4b441c9';
const EXPECTED_ADDRESS = '0xCA3953e536bDA86D1F152eEfA8aC7b0C82b6eC00'.toLowerCase();

// Load compiled contract artifacts
const TokenAJson = JSON.parse(fs.readFileSync(path.resolve('../../TokenA.sol/TokenA.json'), 'utf-8'));
const TokenBJson = JSON.parse(fs.readFileSync(path.resolve('../../TokenB.sol/TokenB.json'), 'utf-8'));

async function deployToken(signer, artifact, name) {
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const initialSupply = ethers.parseEther('1000'); // 1000 tokens
  console.log(`Deploying ${name}...`);
  const contract = await factory.deploy(initialSupply);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`✅ ${name} deployed at: ${address}`);
  return address;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(NETWORKS.SEPOLIA.RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log(`Using account: ${signer.address}`);
  if (signer.address.toLowerCase() !== EXPECTED_ADDRESS) {
    console.warn(`⚠️  WARNING: Deployer address does not match expected address!\nExpected: ${EXPECTED_ADDRESS}\nActual:   ${signer.address}`);
  }

  // Deploy TokenA
  const tokenAAddress = await deployToken(signer, TokenAJson, 'TokenA');
  // Deploy TokenB
  const tokenBAddress = await deployToken(signer, TokenBJson, 'TokenB');

  console.log('\nUpdate your config with these addresses:');
  console.log(`TokenA: ${tokenAAddress}`);
  console.log(`TokenB: ${tokenBAddress}`);
}

main().catch(console.error); 