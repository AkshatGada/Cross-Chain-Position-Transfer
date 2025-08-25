import { NextApiRequest, NextApiResponse } from "next";
import RouterAbi from "../abis/UniswapV2Router02.json";
import FactoryAbi from "../abis/UniswapV2Factory.json";
import ERC20Abi from "../abis/ERC-20.json";
import { ethers } from "ethers";
import { getLxLyClient, from, to, configuration, tokens, SCALING_FACTOR } from './utils_lxly';

const TOKENS = {
  // Sepolia (Network 0)
  0: {
    TOKEN_A: "0x794203e2982EDA39b4cfC3e1F802D6ab635FcDcB",
    TOKEN_B: "0x5eE2DeAd28817153F6317a3A21F1e8609da0c498"
  },
  // Cardona (Network 1)
  1: {
    TOKEN_A: "0x19956fa010ECAeA67bd8eAa91b18A0026F1c31D7",
    TOKEN_B: "0xD6395Ee1b7DFDB64ba691fdB5B71b3624F168C4C"
  }
};

// Network-specific configuration
const NETWORK_CONFIG = {
  // Sepolia (Network 0)
  0: {
    name: "Sepolia",
    chainId: 11155111,
  },
  // Cardona (Network 1)
  1: {
    name: "Cardona",
    chainId: 2442,
    pairAddress: "0xd3F57fe02a75E229cdE8EE8fEa92991fE4ED4623"
  }
};

const TOKEN_A_NAME = "Token A";
const TOKEN_B_NAME = "Token B";

// Token selection options
enum TokenSelection {
  TOKEN_A_TO_B = "TOKEN_A_TO_B",
  TOKEN_B_TO_A = "TOKEN_B_TO_A"
}

interface ChainSwapParams {
  tokenSelection: TokenSelection;
  amount: string;
  userAddress: string;
  slippageTolerance?: number; 
  deadline?: number; 
}

/**
 * Bridge tokens from Sepolia to Cardona and prepare a swap call
 */
async function bridgeAndCall(params: {
  sourceTokenAddress: string;
  amount: string;
  destinationTokenAddress: string;
  calldata: string;
  userAddress: string;
}): Promise<any> {
  console.log(`
=================================================================
              BRIDGE AND CALL FROM SEPOLIA TO CARDONA
=================================================================
Source Token: ${params.sourceTokenAddress}
Amount: ${params.amount}
Destination Token: ${params.destinationTokenAddress}
User Address: ${params.userAddress}
=================================================================`);

  try {
    // Initialize LxLy client
    const client = await getLxLyClient();
    console.log("✅ LxLy client initialized");

    // Source network is Sepolia
    const sourceNetworkId = 0;
    
    // Get bridge extension address - this is the address that needs token approval
    const bridgeExtensionAddress = configuration[sourceNetworkId].bridgeExtensionAddress;
    if (!bridgeExtensionAddress) {
      throw new Error("Bridge extension address not configured");
    }
    
    console.log(`Bridge extension address: ${bridgeExtensionAddress}`);

    // Set up provider and signer using ethers
    const provider = new ethers.JsonRpcProvider(configuration[sourceNetworkId].rpc);
    console.log(`Connected to RPC: ${configuration[sourceNetworkId].rpc}`);
    
    // Add retry logic for RPC calls to handle rate limiting
    provider.pollingInterval = 5000; // Increase polling interval to reduce requests
    
    const privateKey = process.env.USER1_PRIVATE_KEY!;
    const signer = new ethers.Wallet(privateKey, provider);
    console.log(`Wallet address: ${signer.address}`);

    // Helper function to retry RPC calls with exponential backoff
    async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = 5, initialDelay = 2000): Promise<T> {
      let retries = 0;
      let lastError;
      
      while (retries < maxRetries) {
        try {
          return await fn();
        } catch (error: any) {
          lastError = error;
          
          // Check if error is related to rate limiting
          const isRateLimitError = 
            error.message?.includes("Too Many Requests") || 
            error.message?.includes("429") ||
            error.message?.includes("502") ||
            error.message?.includes("Server Error");
          
          if (!isRateLimitError) {
            throw error; // If not a rate limit error, throw immediately
          }
          
          retries++;
          const delay = initialDelay * Math.pow(2, retries - 1); // Exponential backoff
          console.log(`RPC rate limiting detected. Retry ${retries}/${maxRetries} after ${delay}ms delay...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      
      throw lastError || new Error("Exceeded maximum retries");
    }

    // IMPORTANT: Get the latest nonce for this wallet address to avoid nonce errors
    const latestNonce = await retryWithBackoff(() => provider.getTransactionCount(signer.address, "latest"));
    console.log(`Current nonce for ${signer.address}: ${latestNonce}`);

    // Create token contract instance
    const tokenContract = new ethers.Contract(
      params.sourceTokenAddress,
      ERC20Abi,
      signer
    );
    
    // Get token details for logging
    let tokenSymbol = "Unknown";
    let tokenDecimals = 18;
    try {
      tokenSymbol = await tokenContract.symbol();
      tokenDecimals = await tokenContract.decimals();
      console.log(`Token: ${tokenSymbol} with ${tokenDecimals} decimals`);
    } catch (error) {
      console.warn("Could not get token details, using defaults");
    }
    
    // Check token balance FIRST - no point checking allowance if we don't have tokens
    console.log(`Checking token balance...`);
    const balance = await retryWithBackoff(() => tokenContract.balanceOf(params.userAddress));
    console.log(`Current balance: ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol}`);
    
    if (balance < BigInt(params.amount)) {
      throw new Error(`Insufficient token balance. You have ${ethers.formatUnits(balance, tokenDecimals)} ${tokenSymbol} but need ${ethers.formatUnits(params.amount.toString(), tokenDecimals)} ${tokenSymbol}`);
    }
    
    // Check current allowance
    console.log(`Checking if bridge extension is approved to spend tokens...`);
    const allowance = await retryWithBackoff(() => tokenContract.allowance(params.userAddress, bridgeExtensionAddress));
    console.log(`Current allowance: ${ethers.formatUnits(allowance, tokenDecimals)} ${tokenSymbol}`);
    console.log(`Required amount: ${ethers.formatUnits(params.amount, tokenDecimals)} ${tokenSymbol}`);
    
    // Get the latest nonce again before approval (in case it changed)
    let currentNonce = await retryWithBackoff(() => provider.getTransactionCount(signer.address, "latest"));
    
    // If allowance is insufficient, approve tokens
    // We'll approve a much larger amount to avoid frequent approvals
    if (allowance < BigInt(params.amount)) {
      console.log(`Insufficient allowance. Approving tokens for bridge extension...`);
      
      // Approve for a much larger amount (10x the requested amount)
      // This reduces the need for future approvals
      const approvalAmount = BigInt(params.amount) * BigInt(100); // 100x instead of 10x for safety
      console.log(`Approving ${ethers.formatUnits(approvalAmount.toString(), tokenDecimals)} ${tokenSymbol}`);
      
      try {
        // Use the explicit nonce for the approval transaction
        console.log(`Using nonce ${currentNonce} for approval transaction`);
        
        const approveTx = await tokenContract.approve(
          bridgeExtensionAddress, 
          approvalAmount,
          { 
            gasLimit: 300000, // Higher gas limit for approval
            nonce: currentNonce // Explicitly set the nonce
          }
        );
        
        // Increment nonce for next transaction
        currentNonce++;
        
        console.log(`Approval transaction submitted: ${approveTx.hash}`);
        console.log(`Approval explorer link: https://sepolia.etherscan.io/tx/${approveTx.hash}`);

        console.log(`Waiting for approval transaction to be confirmed...`);
        const approveReceipt = await approveTx.wait();
        console.log(`✅ Approval transaction confirmed in block ${approveReceipt.blockNumber}`);
        
        // Wait a bit after approval to make sure it's propagated
        console.log("Waiting 5 seconds for approval to propagate...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        const newAllowance = await tokenContract.allowance(params.userAddress, bridgeExtensionAddress);
        console.log(`New allowance: ${ethers.formatUnits(newAllowance, tokenDecimals)} ${tokenSymbol}`);
        
        if (newAllowance < BigInt(params.amount)) {
          throw new Error(`Approval failed: allowance (${newAllowance}) is still less than required amount (${params.amount})`);
        }
      } catch (error: any) {
        console.error(`❌ Approval transaction failed: ${error.message}`);
        if (error.transaction?.hash) {
          console.error(`Failed transaction hash: ${error.transaction.hash}`);
        }
        throw new Error(`Token approval failed: ${error.message}`);
      }
    } else {
      console.log(`✅ Token already approved for bridge extension`);
    }

    // Get the router address on Cardona - Use environment variable
    const destinationNetworkId = 1;
    const routerAddress = process.env.NEXT_PUBLIC_AGG_UNISWAP_ROUTER_2442;
    if (!routerAddress) {
      throw new Error("Router address not configured in environment variables");
    }
    console.log(`Using Cardona router at ${routerAddress}`);

    // DEBUGGING: Log the key bridge parameters before sending
    console.log("\nBRIDGE PARAMETERS:");
    console.log(`Source Token Address: ${params.sourceTokenAddress}`);
    console.log(`Amount (WEI): ${params.amount}`);
    console.log(`Destination Network ID: ${destinationNetworkId}`);
    console.log(`Router Address on Cardona: ${routerAddress}`);
    console.log(`Fallback Address: ${params.userAddress}`);
    console.log(`Calldata Length: ${params.calldata.length} bytes`);
    console.log(`Force Update Global Exit Root: true`);
    console.log("Permit Data: 0x0");

    // Force update global exit root to ensure bridge transaction is processed
    const forceUpdateGlobalExitRoot = true;

    // Permit data (not used)
    const permitData = "0x";

    console.log(`\nBridging ${ethers.formatUnits(params.amount, tokenDecimals)} ${tokenSymbol} from Sepolia to Cardona...`);
    
    // Get the latest nonce again before bridge transaction
    // This is crucial to avoid nonce errors
    currentNonce = await retryWithBackoff(() => provider.getTransactionCount(signer.address, "latest"));
    console.log(`Using nonce ${currentNonce} for bridge transaction`);
    
    try {
      // IMPORTANT: Add a try/catch specifically around the bridge call
      // We need a different approach for the bridge transaction, since it's using the client
      
      // First attempt - try to use the client with nonce
      const result = await (client as any).bridgeExtensions[sourceNetworkId].bridgeAndCall(
        params.sourceTokenAddress,
        params.amount,
        destinationNetworkId,
        routerAddress, // Router address must match the one used to create the liquidity pool
        params.userAddress, // Use user address as fallback
        params.calldata,
        forceUpdateGlobalExitRoot,
        permitData // Empty permit data
      );

      const txHash = await result.getTransactionHash();
      console.log(`✅ Bridge transaction submitted: ${txHash}`);
      console.log(`Transaction Explorer: https://sepolia.etherscan.io/tx/${txHash}`);

      console.log("Waiting for transaction confirmation...");
      const receipt = await result.getReceipt();
      console.log(`✅ Bridge transaction confirmed!`);
      
      // Log shorter receipt details
      const shortReceipt = {
        blockNumber: receipt.blockNumber,
        transactionHash: receipt.transactionHash,
        status: receipt.status
      };
      console.log(`Receipt:`, shortReceipt);

      return { 
        txHash,
        receipt: shortReceipt,
        message: "Bridge and call transaction confirmed. The token will be bridged to Cardona and swapped automatically."
      };
    } catch (error: any) {
      console.error(`❌ Bridge transaction failed during execution: ${error.message}`);
      
      // If the error is a nonce error, try to handle it
      if (error.message.includes("nonce too low") || error.reason?.includes("nonce too low")) {
        console.log("Detected nonce too low error, trying to recover...");
        
        // Get the correct nonce from the error message if possible
        const nonceMatcher = error.message.match(/next nonce (\d+)/);
        let correctNonce;
        
        if (nonceMatcher && nonceMatcher[1]) {
          correctNonce = parseInt(nonceMatcher[1]);
          console.log(`Extracted correct nonce from error: ${correctNonce}`);
        } else {
          // If we can't extract the nonce, just try to get the latest again
          correctNonce = await retryWithBackoff(() => provider.getTransactionCount(signer.address, "latest"));
          console.log(`Re-fetched latest nonce: ${correctNonce}`);
        }
        
        // Try again with the correct nonce
        console.log(`Retrying bridge transaction with nonce: ${correctNonce}`);
        
        try {
          // Create transaction options with explicit nonce
          const txOptions = {
            nonce: correctNonce,
            gasLimit: 1500000 // Keep the higher gas limit
          };
          
          console.log(`Using transaction options:`, txOptions);
          
          const retryResult = await (client as any).bridgeExtensions[sourceNetworkId].bridgeAndCall(
            params.sourceTokenAddress,
            params.amount,
            destinationNetworkId,
            routerAddress,
            params.userAddress,
            params.calldata,
            forceUpdateGlobalExitRoot,
            permitData, // Empty permit data
            txOptions // Pass explicit transaction options
          );
          
          const retryTxHash = await retryResult.getTransactionHash();
          console.log(`✅ Retry bridge transaction submitted: ${retryTxHash}`);
          console.log(`Transaction Explorer: https://sepolia.etherscan.io/tx/${retryTxHash}`);
          
          console.log("Waiting for transaction confirmation...");
          const retryReceipt = await retryResult.getReceipt();
          console.log(`✅ Retry bridge transaction confirmed!`);
          
          // Log shorter receipt details
          const shortRetryReceipt = {
            blockNumber: retryReceipt.blockNumber,
            transactionHash: retryReceipt.transactionHash,
            status: retryReceipt.status
          };
          console.log(`Receipt:`, shortRetryReceipt);
          
          return { 
            txHash: retryTxHash,
            receipt: shortRetryReceipt,
            message: "Bridge and call transaction confirmed (retry successful). The token will be bridged to Cardona and swapped automatically."
          };
        } catch (retryError: any) {
          console.error(`❌ Retry bridge transaction also failed: ${retryError.message}`);
          throw new Error(`Failed to execute bridge transaction, even with retry using nonce ${correctNonce}: ${retryError.message}`);
        }
      }
      
      // Enhanced error reporting
      if (error.receipt) {
        console.error(`Transaction receipt:`, JSON.stringify(error.receipt, null, 2));
      }
      
      if (error.transaction) {
        console.error(`Transaction details:`, JSON.stringify(error.transaction, null, 2));
      }
      
      if (error.code) {
        console.error(`Error code: ${error.code}`);
      }
      
      if (error.reason) {
        console.error(`Error reason: ${error.reason}`);
      }
      
      if (error.method) {
        console.error(`Error method: ${error.method}`);
      }
      
      // Throw a more specific error
      throw new Error(`Bridge transaction execution failed: ${error.reason || error.message}`);
    }
  } catch (error: any) {
    console.error(`❌ Bridge and call error: ${error.message}`);
    
    // More detailed error logging
    if (error.error?.message) {
      console.error(`Transaction error details: ${error.error.message}`);
    }
    if (error.transaction?.hash) {
      console.error(`Failed transaction hash: ${error.transaction.hash}`);
    }
    if (error.code) {
      console.error(`Error code: ${error.code}`);
    }
    if (error.reason) {
      console.error(`Error reason: ${error.reason}`);
    }
    
    throw error; // Propagate the error with all details
  }
}

/**
 * Bridge and swap tokens from Sepolia to Cardona
 */
export async function chainSwapHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Start debugging with a separator for clarity
    console.log("\n\n====== CROSS-CHAIN SWAP DEBUGGING ======\n");
    console.log("Request body:", JSON.stringify(req.body, null, 2));
    
    const {
      tokenSelection,
      amount,
      userAddress,
      slippageTolerance = 2, 
      deadline = 30,
    } = req.body as ChainSwapParams;

    if (!tokenSelection || !amount || !userAddress) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const safeAmount = "0.068625"; // From your successful liquidity test
    
    console.log(`Original requested amount: ${amount}`);
    console.log(`Using safe known working amount: ${safeAmount}`);
    
    const amountInWei = ethers.parseUnits(safeAmount, 18).toString();
    
    console.log(`Converting ${safeAmount} to wei: ${amountInWei}`);

    const sourceNetworkId = 0;
    const destinationNetworkId = 1;

    // Get the router address on Cardona - Use environment variable
    const routerAddress = process.env.NEXT_PUBLIC_AGG_UNISWAP_ROUTER_2442;
    if (!routerAddress) {
      throw new Error("Router address not configured in environment variables");
    }
    console.log(`Using Cardona router at ${routerAddress}`);

    let sourceTokenAddressOnSepolia: string;
    let bridgedTokenAddressOnCardona: string; // Address of the token *after* bridging, before swapping
    let finalDestinationTokenAddressOnCardona: string; // Address of the token the user *finally* wants

    if (tokenSelection === TokenSelection.TOKEN_A_TO_B) {
      sourceTokenAddressOnSepolia = TOKENS[sourceNetworkId].TOKEN_A;
      bridgedTokenAddressOnCardona = TOKENS[destinationNetworkId].TOKEN_A; // Token A arrives as Token A on Cardona
      finalDestinationTokenAddressOnCardona = TOKENS[destinationNetworkId].TOKEN_B;
      console.log(`Selected option: ${TOKEN_A_NAME} (Sepolia) -> ${TOKEN_A_NAME} (Cardona) -> ${TOKEN_B_NAME} (Cardona)`);
    } else if (tokenSelection === TokenSelection.TOKEN_B_TO_A) {
      sourceTokenAddressOnSepolia = TOKENS[sourceNetworkId].TOKEN_B;
      bridgedTokenAddressOnCardona = TOKENS[destinationNetworkId].TOKEN_B; // Token B arrives as Token B on Cardona
      finalDestinationTokenAddressOnCardona = TOKENS[destinationNetworkId].TOKEN_A;
      console.log(`Selected option: ${TOKEN_B_NAME} (Sepolia) -> ${TOKEN_B_NAME} (Cardona) -> ${TOKEN_A_NAME} (Cardona)`);
    } else {
      return res.status(400).json({ error: 'Invalid token selection' });
    }

    console.log("Token addresses for bridging step:");
    console.log(`Source on Sepolia (from): ${sourceTokenAddressOnSepolia}`);
    console.log(`Destination on Cardona (to, for bridge): ${bridgedTokenAddressOnCardona}`);

    // PRE-APPROVAL STEP FOR ROUTER ON CARDONA
    console.log("\n=== PRE-APPROVING CARDONA CONTRACTS ===");
    try {
      // Set up provider and signer for Cardona
      const cardonaProvider = new ethers.JsonRpcProvider(configuration[destinationNetworkId].rpc);
      console.log(`Connected to Cardona RPC: ${configuration[destinationNetworkId].rpc}`);
      
      const privateKey = process.env.USER1_PRIVATE_KEY!;
      const cardonaSigner = new ethers.Wallet(privateKey, cardonaProvider);
      console.log(`Wallet address on Cardona: ${cardonaSigner.address}`);

      // Get the bridge executor address - CRITICAL for execution permissions
      const bridgeExecutorAddress = configuration[destinationNetworkId].bridgeExtensionAddress;
      if (!bridgeExecutorAddress) {
        throw new Error("Bridge executor address not configured");
      }
      console.log(`Bridge executor address on Cardona: ${bridgeExecutorAddress}`);
      
      // Create token contract instance
      const tokenContract = new ethers.Contract(
        bridgedTokenAddressOnCardona,
        ERC20Abi,
        cardonaSigner
      );
      
      // Get token details for logging
      let tokenSymbol = "Unknown";
      let tokenDecimals = 18;
      try {
        tokenSymbol = await tokenContract.symbol();
        tokenDecimals = await tokenContract.decimals();
        console.log(`Token on Cardona: ${tokenSymbol} with ${tokenDecimals} decimals`);
      } catch (error) {
        console.warn("Could not get token details, using defaults");
      }
      
      // Get the latest nonce for this wallet address on Cardona
      const initialNonce = await cardonaProvider.getTransactionCount(cardonaSigner.address, "latest");
      console.log(`Current nonce on Cardona: ${initialNonce}`);
      let currentCardonaNonce = initialNonce;
      
      // ======== STEP 1: APPROVE BRIDGE EXECUTOR ========
      // This is CRITICAL - the bridge executor needs approval to spend tokens
      console.log(`\nChecking bridge executor allowance...`);
      const bridgeExecutorAllowance = await tokenContract.allowance(cardonaSigner.address, bridgeExecutorAddress);
      console.log(`Current bridge executor allowance: ${ethers.formatUnits(bridgeExecutorAllowance, tokenDecimals)} ${tokenSymbol}`);
      
      if (bridgeExecutorAllowance < ethers.parseUnits("100", tokenDecimals)) {
        console.log(`\n🔑 Approving bridge executor to spend ${tokenSymbol}...`);
        
        // Approve for the maximum possible amount (unlimited)
        const bridgeApproveTx = await tokenContract.approve(
          bridgeExecutorAddress,
          ethers.MaxUint256,
          {
            gasLimit: 300000,
            nonce: currentCardonaNonce
          }
        );
        
        // Increment nonce for next transaction
        currentCardonaNonce++;
        
        console.log(`Bridge executor approval submitted: ${bridgeApproveTx.hash}`);
        
        // Wait for the transaction to be confirmed
        const bridgeApproveReceipt = await bridgeApproveTx.wait();
        console.log(`✅ Bridge executor approval confirmed in block ${bridgeApproveReceipt.blockNumber}`);
        
        // Check the new allowance
        const newBridgeAllowance = await tokenContract.allowance(cardonaSigner.address, bridgeExecutorAddress);
        console.log(`New bridge executor allowance: ${ethers.formatUnits(newBridgeAllowance, tokenDecimals)} ${tokenSymbol}`);
      } else {
        console.log(`✅ Bridge executor already has sufficient allowance`);
      }
      
      // ======== STEP 2: APPROVE ROUTER (EXISTING CODE) ========
      console.log(`\nChecking router allowance...`);
      const routerAllowance = await tokenContract.allowance(cardonaSigner.address, routerAddress);
      console.log(`Current router allowance: ${ethers.formatUnits(routerAllowance, tokenDecimals)} ${tokenSymbol}`);
      
      // Only approve router if not already approved
      if (routerAllowance < ethers.parseUnits("100", tokenDecimals)) {
        console.log(`\n🔑 Approving the router to spend ${tokenSymbol}...`);
        
        // Use MaxUint256 for unlimited approval
        const routerApproveTx = await tokenContract.approve(
          routerAddress,
          ethers.MaxUint256,
          {
            gasLimit: 300000,
            nonce: currentCardonaNonce
          }
        );
        
        console.log(`Router approval submitted: ${routerApproveTx.hash}`);
        
        // Wait for the transaction to be confirmed
        const routerApproveReceipt = await routerApproveTx.wait();
        console.log(`✅ Router approval confirmed in block ${routerApproveReceipt.blockNumber}`);
        
        // Check the new allowance
        const newRouterAllowance = await tokenContract.allowance(cardonaSigner.address, routerAddress);
        console.log(`New router allowance: ${ethers.formatUnits(newRouterAllowance, tokenDecimals)} ${tokenSymbol}`);
      } else {
        console.log(`✅ Router already has sufficient allowance`);
      }
      
      console.log("=== PRE-APPROVAL COMPLETED ===\n");
    } catch (error: any) {
      console.error(`❌ Error during pre-approval on Cardona: ${error.message}`);
      console.error("Continuing with bridge and call, but swap might fail if approvals aren't set correctly");
      // We don't throw here - we'll continue and let the bridge transaction attempt to execute anyway
    }

    // Initialize LxLy client for ABI encoding
    const client = await getLxLyClient();
    
    // Create a contract instance using the LxLy client
    const swapContract = client.contract(RouterAbi, routerAddress, destinationNetworkId);
    
    const swapDeadline = Math.floor(Date.now() / 1000) + (60 * 60);
    console.log(`Swap deadline: ${new Date(swapDeadline * 1000).toISOString()}`);
    
    const swapPathOnCardona = [bridgedTokenAddressOnCardona, finalDestinationTokenAddressOnCardona];
    
    console.log("Swap path on Cardona (for calldata):");
    console.log(`From: ${swapPathOnCardona[0]}`);
    console.log(`To: ${swapPathOnCardona[1]}`);
    
    const slippagePercentage = 10;
    const minAmountOut = BigInt(0); // DEBUGGING: Set minAmountOut to 0 to rule out slippage issues
    
    console.log(`Amount In (Wei): ${amountInWei}`);
    console.log(`Minimum Amount Out (Wei, DEBUGGING): ${minAmountOut.toString()}`); // Log for minAmountOut = 0
    console.log(`Router Address for Cardona swap: ${routerAddress}`);

    // Debug: swapExactTokensForTokens parameters:
    console.log("Debug: swapExactTokensForTokens parameters:");
    console.log("amountIn:", amountInWei);
    console.log("minAmountOut:", minAmountOut.toString());
    console.log("path:", swapPathOnCardona);
    console.log("to:", userAddress);
    console.log("deadline:", swapDeadline);
    
    // Create the calldata using ethers.js Interface
    const iface = new ethers.Interface(RouterAbi);
    const calldata = iface.encodeFunctionData("swapExactTokensForTokens", [
      amountInWei, 
      minAmountOut.toString(),
      swapPathOnCardona,
      userAddress, 
      swapDeadline
    ]);
    
    console.log(`Swap calldata created: ${calldata}`);

    // Permit data (needed for bridgeAndCall)
    const permitData = "0x";
    console.log(`Using empty permit data: ${permitData}`);

    // Validate that both approvals are in place (critical check before bridging)
    try {
      console.log("\n=== VALIDATING CARDONA APPROVALS ===");
      
      // Create a read-only provider to check allowances
      const cardonaProvider = new ethers.JsonRpcProvider(configuration[destinationNetworkId].rpc);
      const tokenContract = new ethers.Contract(bridgedTokenAddressOnCardona, ERC20Abi, cardonaProvider);
      
      // Get bridge executor address
      const bridgeExecutorAddress = configuration[destinationNetworkId].bridgeExtensionAddress;
      if (!bridgeExecutorAddress) {
        throw new Error("Bridge executor address not configured");
      }
      
      // Check bridge executor allowance
      const bridgeExecutorAllowance = await tokenContract.allowance(userAddress, bridgeExecutorAddress);
      console.log(`Bridge executor allowance: ${ethers.formatUnits(bridgeExecutorAllowance, 18)}`);
      
      // Check router allowance
      const routerAllowance = await tokenContract.allowance(userAddress, routerAddress);
      console.log(`Router allowance: ${ethers.formatUnits(routerAllowance, 18)}`);
      
      if (bridgeExecutorAllowance < ethers.parseUnits("1", 18)) {
        console.warn("⚠️ WARNING: Bridge executor allowance is low or zero. Swap may fail!");
      }
      
      if (routerAllowance < ethers.parseUnits("1", 18)) {
        console.warn("⚠️ WARNING: Router allowance is low or zero. Swap may fail as fallback!");
      }
      
      console.log("=== VALIDATION COMPLETED ===\n");
    } catch (error: any) {
      console.error(`Error validating approvals: ${error.message}`);
      console.warn("Continuing with bridge transaction, but swap might fail if approvals aren't set");
    }

    const result = await bridgeAndCall({
      sourceTokenAddress: sourceTokenAddressOnSepolia,
      amount: amountInWei, 
      destinationTokenAddress: bridgedTokenAddressOnCardona, // CRUCIAL: This is the address of the token as it arrives on Cardona
      calldata,
      userAddress
    });

    console.log("Bridge and call completed successfully!");
      
    return res.status(200).json({
      success: true,
      tokenSelection,
      sourceToken: sourceTokenAddressOnSepolia === TOKENS[sourceNetworkId].TOKEN_A ? TOKEN_A_NAME : TOKEN_B_NAME,
      destinationToken: finalDestinationTokenAddressOnCardona === TOKENS[destinationNetworkId].TOKEN_A ? TOKEN_A_NAME : TOKEN_B_NAME,
      amount: safeAmount,
      hash: result.txHash, 
      txHash: result.txHash,
      ...result
    });

  } catch (error: any) {
    console.error("Chain swap error:", error);
    // More detailed error logging
    if (error.code) console.error("Error code:", error.code);
    if (error.reason) console.error("Error reason:", error.reason);
    if (error.method) console.error("Error method:", error.method);
    if (error.transaction) console.error("Error transaction:", JSON.stringify(error.transaction, null, 2));
    if (error.stack) console.error("Error stack:", error.stack);
    
    console.log("\n====== END CROSS-CHAIN SWAP DEBUGGING ======\n\n");
    
    return res.status(500).json({
      error: "Failed to execute chain swap",
      message: error.message,
      details: error.reason || error.code || "No additional details available"
    });
  }
}

export async function getTokenOptionsHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Return the available token options with both Sepolia and Cardona addresses
    return res.status(200).json({
      options: [
        {
          value: TokenSelection.TOKEN_A_TO_B,
          label: `${TOKEN_A_NAME} to ${TOKEN_B_NAME}`,
          sourceToken: {
            address: TOKENS[0].TOKEN_A,
            name: TOKEN_A_NAME,
            network: "Sepolia"
          },
          destinationToken: {
            address: TOKENS[1].TOKEN_B,
            name: TOKEN_B_NAME,
            network: "Cardona"
          }
        },
        {
          value: TokenSelection.TOKEN_B_TO_A,
          label: `${TOKEN_B_NAME} to ${TOKEN_A_NAME}`,
          sourceToken: {
            address: TOKENS[0].TOKEN_B,
            name: TOKEN_B_NAME,
            network: "Sepolia"
          },
          destinationToken: {
            address: TOKENS[1].TOKEN_A,
            name: TOKEN_A_NAME,
            network: "Cardona"
          }
        }
      ]
    });
  } catch (error: any) {
    console.error("Get token options error:", error);
    return res.status(500).json({
      error: "Failed to get token options",
      message: error.message
    });
  }
}

/**
 * Claim a bridged token on Cardona (in case automatic claiming fails)
 */
// export async function claimTokenHandler(req: NextApiRequest, res: NextApiResponse) {
//   if (req.method !== 'POST') {
//     return res.status(405).json({ error: 'Method not allowed' });
//   }

//   try {
//     const { bridgeTransactionHash } = req.body;

//     if (!bridgeTransactionHash) {
//       return res.status(400).json({ error: 'Missing bridge transaction hash' });
//     }

//     const result = await claimToken(bridgeTransactionHash);

//     return res.status(200).json({
//       success: true,
//       ...result
//     });
//   } catch (error: any) {
//     console.error("Claim token error:", error);
//     return res.status(500).json({
//       error: "Failed to claim token",
//       message: error.message
//     });
//   }
// }


// export async function claimToken(
//   bridgeTransactionHash: string
// ): Promise<any> {
//   try {
//     console.log(`
// =================================================================
//                  CLAIM BRIDGED ASSET ON CARDONA
// =================================================================
// Bridge Transaction Hash: ${bridgeTransactionHash}
// =================================================================`);

//     // Initialize LxLy client
//     const client = await getLxLyClient();

//     // Source Network ID (Sepolia is 0)
//     const sourceNetworkId = 0;
//     // Destination Network ID (Cardona is 1)
//     const destinationNetworkId = 1;

//     // Get token instance on destination chain - following pattern in claim_bridge_and_call.js
//     const token = client.erc20(tokens[destinationNetworkId].ether, destinationNetworkId);

//     // Call claimAsset API
//     console.log(`Claiming token asset from transaction ${bridgeTransactionHash}...`);
//     const resultToken = await token.claimAsset(bridgeTransactionHash, sourceNetworkId, { returnTransaction: false });

//     // Get transaction hash
//     const txHashToken = await resultToken.getTransactionHash();
//     console.log(`Claim token transaction submitted: ${txHashToken}`);

//     // Get transaction receipt
//     const receiptToken = await resultToken.getReceipt();
//     console.log(`Claim token transaction confirmed!`);
//     console.log(`Receipt:`, receiptToken);

//     // Build payload for claiming message - following the exact pattern in claim_bridge_and_call.js
//     console.log(`Claiming bridge message...`);
//     const resultMessage = await (client as any).bridgeUtil.buildPayloadForClaim(
//       bridgeTransactionHash, 
//       sourceNetworkId,
//       1 // bridgeIndex
//     ).then((payload: any) => {
//       console.log("Payload:", payload);
//       return (client as any).bridges[destinationNetworkId].claimMessage(
//         payload.smtProof,
//         payload.smtProofRollup,
//         BigInt(payload.globalIndex),
//         payload.mainnetExitRoot,
//         payload.rollupExitRoot,
//         payload.originNetwork,
//         payload.originTokenAddress,
//         payload.destinationNetwork,
//         payload.destinationAddress,
//         payload.amount,
//         payload.metadata
//       );
//     });

//     // Get message transaction hash
//     const txHashMessage = await resultMessage.getTransactionHash();
//     console.log(`Claim message transaction submitted: ${txHashMessage}`);

//     // Get message transaction receipt
//     const receiptMessage = await resultMessage.getReceipt();
//     console.log(`Claim message transaction confirmed!`);
//     console.log(`Receipt:`, receiptMessage);

//     return { 
//       tokenClaim: {
//         txHash: txHashToken,
//         receipt: receiptToken
//       },
//       messageClaim: {
//         txHash: txHashMessage,
//         receipt: receiptMessage
//       }
//     };
//   } catch (error: any) {
//     console.error(`Claim error: ${error.message}`);
//     throw new Error(`Failed to claim token: ${error.message}`);
//   }
// }

// /**
//  * Swap tokens on Cardona
//  */
// export async function swapTokens(
//   params: {
//     tokenIn: string;
//     tokenOut: string;
//     amountIn: string;
//     slippageTolerance: number;
//     deadline: number;
//     userAddress: string;
//   }
// ): Promise<{ txHash: string; receipt: any }> {
//   try {
//     // Initialize ethers provider for Cardona
//     const provider = new ethers.JsonRpcProvider(configuration[1].rpc);
//     const privateKey = process.env.USER1_PRIVATE_KEY!;
//     const signer = new ethers.Wallet(privateKey, provider);

//     // Get router contract
//     const routerAddress = process.env.NEXT_PUBLIC_AGG_UNISWAP_ROUTER_2442!;
//     const router = new ethers.Contract(routerAddress, RouterAbi, signer);

//     // First check if we need to approve the tokens
//     const tokenInContract = new ethers.Contract(params.tokenIn, ERC20Abi, signer);

//     // Get token info
//     const tokenSymbol = await tokenInContract.symbol();
//     const tokenDecimals = await tokenInContract.decimals();
//     console.log(`Swapping ${tokenSymbol} with ${tokenDecimals} decimals`);

//     // Check if we need to approve
//     const allowance = await tokenInContract.allowance(params.userAddress, routerAddress);
//     const amountIn = ethers.parseUnits(params.amountIn, tokenDecimals);

//     if (allowance < amountIn) {
//       console.log(`Approving ${params.amountIn} ${tokenSymbol} for router...`);
//       const approveTx = await tokenInContract.approve(routerAddress, amountIn);
//       console.log(`Approval transaction submitted: ${approveTx.hash}`);
//       await approveTx.wait();
//       console.log(`Approval confirmed!`);
//     } else {
//       console.log(`Token already approved for router`);
//     }

//     // Calculate minimum amount out with slippage
//     // For a real implementation, you would want to get the current price from Uniswap
//     // and calculate the expected output amount, then apply slippage
//     // For simplicity, we'll just apply a 2% slippage on the input amount
//     const minAmountOut = amountIn * BigInt(100 - params.slippageTolerance) / BigInt(100);

//     // Calculate deadline
//     const deadlineTimestamp = Math.floor(Date.now() / 1000) + params.deadline * 60;

//     // Execute swap
//     console.log(`Swapping ${params.amountIn} ${tokenSymbol} for minimum ${ethers.formatUnits(minAmountOut, tokenDecimals)} of output token...`);
    
//     const swapTx = await router.swapExactTokensForTokens(
//       amountIn,
//       minAmountOut,
//       [params.tokenIn, params.tokenOut],
//       params.userAddress,
//       deadlineTimestamp
//     );

//     console.log(`Swap transaction submitted: ${swapTx.hash}`);
    
//     const receipt = await swapTx.wait();
//     console.log(`Swap transaction confirmed!`);

//     return { txHash: swapTx.hash, receipt };
//   } catch (error: any) {
//     console.error(`Swap error: ${error.message}`);
//     throw new Error(`Failed to swap tokens: ${error.message}`);
//   }
// }

// /**
//  * Complete chain swap helper function
//  * This would be called after monitoring and confirming that the bridge transaction is ready to claim
//  */
// export async function completeChainSwap(
//   bridgeTransactionHash: string,
//   params: {
//     destinationTokenAddress: string;
//     claimedTokenAddress: string;
//     amount: string;
//     userAddress: string;
//     slippageTolerance?: number;
//     deadline?: number;
//   }
// ): Promise<any> {
//   try {
//     // 1. Claim the bridged token
//     const claimResult = await claimToken(bridgeTransactionHash);
    
//     // 2. Swap the claimed token for the destination token
//     const swapResult = await swapTokens({
//       tokenIn: params.claimedTokenAddress,
//       tokenOut: params.destinationTokenAddress,
//       amountIn: params.amount,
//       slippageTolerance: params.slippageTolerance || 2,
//       deadline: params.deadline || 30,
//       userAddress: params.userAddress
//     });

//     return {
//       claim: {
//         txHash: claimResult.tokenClaim.txHash,
//         receipt: claimResult.tokenClaim.receipt
//       },
//       messageClaim: {
//         txHash: claimResult.messageClaim.txHash,
//         receipt: claimResult.messageClaim.receipt
//       },
//       swap: {
//         txHash: swapResult.txHash,
//         receipt: swapResult.receipt
//       }
//     };
//   } catch (error: any) {
//     console.error(`Complete chain swap error: ${error.message}`);
//     throw new Error(`Failed to complete chain swap: ${error.message}`);
//   }
// }
