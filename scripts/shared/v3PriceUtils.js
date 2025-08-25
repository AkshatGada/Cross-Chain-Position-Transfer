const JSBI = require('jsbi');
const { BigNumber } = require('big-number');

// Constants from Uniswap SDK Core
const Q96 = JSBI.exponentiate(JSBI.BigInt(2), JSBI.BigInt(96));
const Q192 = JSBI.exponentiate(Q96, JSBI.BigInt(2));
const MAX_TICK = 887272;
const MIN_TICK = -887272;

/**
 * Converts price ratio to sqrt price format used by Uniswap V3
 * @param {string|number} reserve1 The reserve of token1
 * @param {string|number} reserve0 The reserve of token0
 * @returns {string} The sqrt price in Q96.64 format
 * @throws {Error} If inputs are invalid or calculation fails
 */
function encodePriceSqrt(reserve1, reserve0) {
  try {
    // Input validation
    if (!reserve0 || !reserve1) {
      throw new Error('Both reserves must be provided');
    }
    if (Number(reserve0) <= 0 || Number(reserve1) <= 0) {
      throw new Error('Reserves must be positive numbers');
    }

    // Handle equal reserves precisely
    if (reserve1.toString() === reserve0.toString()) {
      return Q96.toString();
    }

    // For non-equal reserves we approximate using JS numbers
    const ratio = Number(reserve1) / Number(reserve0);
    const sqrtRatio = Math.sqrt(ratio);

    // Multiply by 2^96 using BigInt math to avoid precision issues
    const sqrtPriceX96 = JSBI.BigInt(Math.floor(sqrtRatio * 1e12)); // scale to preserve precision
    // Scale back up to Q96 by multiplying and dividing appropriately
    const result = JSBI.divide(JSBI.multiply(sqrtPriceX96, Q96), JSBI.BigInt(1e12));
    return result.toString();
  } catch (error) {
    throw new Error(`Failed to encode sqrt price: ${error.message}`);
  }
}

/**
 * Converts a price to its corresponding tick value
 * @param {number|string} price The price to convert
 * @returns {number} The corresponding tick value
 * @throws {Error} If price is invalid or calculation fails
 */
function getTickFromPrice(price) {
  try {
    if (!price || Number(price) <= 0) {
      throw new Error('Price must be a positive number');
    }

    // Convert price to log base 1.0001
    // tick = log(price) / log(1.0001)
    const log = Math.log(Number(price));
    const tick = Math.floor(log / Math.log(1.0001));

    // Validate tick is within bounds
    if (tick < MIN_TICK || tick > MAX_TICK) {
      throw new Error('Price is out of valid tick range');
    }

    return tick;
  } catch (error) {
    throw new Error(`Failed to convert price to tick: ${error.message}`);
  }
}

/**
 * Converts a tick value back to a readable price
 * @param {number} tick The tick value to convert
 * @returns {string} The price with 18 decimals of precision
 * @throws {Error} If tick is invalid or calculation fails
 */
function getPriceFromTick(tick) {
  try {
    if (typeof tick !== 'number') {
      throw new Error('Tick must be a number');
    }
    if (tick < MIN_TICK || tick > MAX_TICK) {
      throw new Error('Tick is out of valid range');
    }

    // price = 1.0001^tick
    const price = Math.pow(1.0001, tick);
    
    // Convert to string with 18 decimals
    return BigNumber(Math.floor(price * 1e18).toString()).toString();
  } catch (error) {
    throw new Error(`Failed to convert tick to price: ${error.message}`);
  }
}

/**
 * Finds the nearest tick that can be used based on the tick spacing
 * @param {number} tick The target tick
 * @param {number} tickSpacing The spacing between usable ticks
 * @returns {number} The nearest usable tick
 * @throws {Error} If inputs are invalid
 */
function nearestUsableTick(tick, tickSpacing) {
  try {
    if (typeof tick !== 'number' || typeof tickSpacing !== 'number') {
      throw new Error('Tick and tickSpacing must be numbers');
    }
    if (tickSpacing <= 0) {
      throw new Error('Tick spacing must be positive');
    }
    if (tick < MIN_TICK || tick > MAX_TICK) {
      throw new Error('Tick is out of valid range');
    }

    const rounded = Math.round(tick / tickSpacing) * tickSpacing;
    
    // Ensure the rounded tick is within bounds
    return Math.min(Math.max(rounded, MIN_TICK), MAX_TICK);
  } catch (error) {
    throw new Error(`Failed to find nearest usable tick: ${error.message}`);
  }
}

/**
 * Validates a tick value is within acceptable range
 * @param {number} tick The tick to validate
 * @returns {boolean} True if tick is valid
 */
function isValidTick(tick) {
  return Number.isInteger(tick) && tick >= MIN_TICK && tick <= MAX_TICK;
}

module.exports = {
  // Constants
  Q96,
  Q192,
  MAX_TICK,
  MIN_TICK,
  
  // Core functions
  encodePriceSqrt,
  getTickFromPrice,
  getPriceFromTick,
  nearestUsableTick,
  
  // Validation helpers
  isValidTick
}; 