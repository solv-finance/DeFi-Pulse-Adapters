const sdk = require("../../../../sdk");
const factoryAbi = require("./abis/factory.json");
const token0 = require("./abis/token0.json");
const token1 = require("./abis/token1.json");
const assert = require("assert");
const FACTORY = '0xe7fb3e833efe5f9c441105eb65ef8b261266423b';

async function tvl(timestamp, block) {
  let supportedTokens = await (
    sdk
      .api
      .util
      .supportedTokens()
      .then((supportedTokens) => supportedTokens.map((token) => {
        if (token.platforms && token.platforms['polygon-pos']) {
          return token.platforms['polygon-pos'];
        }
      }))
  );
  supportedTokens = supportedTokens.filter(token => token)

  let pairAddresses;

  const pairLength = (await sdk.api.abi.call({
    target: FACTORY,
    abi: factoryAbi.allPairsLength,
    chain: 'polygon',
    block
  })).output
  if (pairLength === null) {
    throw new Error("allPairsLength() failed")
  }
  const pairNums = Array.from(Array(Number(pairLength)).keys());
  const pairs = (await sdk.api.abi.multiCall({
    abi: factoryAbi.allPairs,
    chain: 'polygon',
    calls: pairNums.map(num => ({
      target: FACTORY,
      params: [num]
    })),
    block
  })).output

  pairAddresses = pairs.map(result => result.output.toLowerCase())
  const [token0Addresses, token1Addresses] = await Promise.all([
    (
      await sdk
        .api
        .abi
        .multiCall({
          abi: token0,
          calls: pairAddresses.map((pairAddress) => ({
            target: pairAddress,
          })),
          block,
          chain: 'polygon'
        })
    ).output,
    (
      await sdk
        .api
        .abi
        .multiCall({
          abi: token1,
          calls: pairAddresses.map((pairAddress) => ({
            target: pairAddress,
          })),
          block,
          chain: 'polygon'
        })
    ).output,
  ]);

  const tokenPairs = {}
// add token0Addresses
  token0Addresses.forEach((token0Address, i) => {
    if (supportedTokens.includes(token0Address.output.toLowerCase())) {
      const pairAddress = pairAddresses[i]
      tokenPairs[pairAddress] = {
        token0Address: token0Address.output.toLowerCase(),
      }
    }
  })

// add token1Addresses
  token1Addresses.forEach((token1Address, i) => {
    if (supportedTokens.includes(token1Address.output.toLowerCase())) {
      const pairAddress = pairAddresses[i]
      tokenPairs[pairAddress] = {
        ...(pairs[pairAddress] || {}),
        token1Address: token1Address.output.toLowerCase(),
      }
    }
  })

  let balanceCalls = [];

  for (let pair of Object.keys(tokenPairs)) {
    if (tokenPairs[pair].token0Address) {
      balanceCalls.push({
        target: tokenPairs[pair].token0Address,
        params: pair,
      })
    }

    if (tokenPairs[pair].token1Address) {
      balanceCalls.push({
        target: tokenPairs[pair].token1Address,
        params: pair,
      })
    }
  }

// break into call chunks bc this gets huge fast
  const chunk = 2500;
  let balanceCallChunks = [];
  for (let i = 0, j = balanceCalls.length, count = 0; i < j; i += chunk, count++) {
    balanceCallChunks[count] = balanceCalls.slice(i, i + chunk);
  }
  assert.equal(balanceCalls.length, balanceCallChunks
    .map(arr => arr.length)
    .reduce((accumulator, value) => {
      return accumulator + value
    }, 0))
  let tokenBalances, balances = {};
  for (let balanceCall of balanceCallChunks) {
    tokenBalances = (
      await sdk.api.abi.multiCall({
        abi: 'erc20:balanceOf',
        calls: balanceCall,
        block,
        chain: 'polygon'
      }));
    sdk.util.sumMultiBalanceOf(balances, tokenBalances)
  }

  if (Object.keys(balances).length === 0) {
    balances = {
      '0x0000000000000000000000000000000000000000' : 0
    }
  }

  return balances;
}
module.exports = {
  /* Project Metadata */
  name: 'Dfyn Network',
  token: "DFYN",
  chain: 'polygon',
  category: 'DEXes',
  start: 1602073800, // @ october 10 2020
  /*fetching token balances */
  tvl
};
