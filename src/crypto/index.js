'use strict';
const { CHAINS, ASSETS, FAMILIES } = require('./assets');
const { createPrices } = require('./prices');

// Builds the chain adapters and the list of enabled assets from the environment.
// A chain is enabled when it has a house address (deposits) — and a hot wallet key
// for automatic withdrawals.
function createCrypto({ env = process.env, warnings = [], adapters: injected } = {}) {
  const network = env.CRYPTO_NETWORK === 'testnet' ? 'testnet' : 'mainnet';
  const chains = CHAINS[network];
  const allAssets = ASSETS[network];
  const wanted = env.CRYPTO_ASSETS ? env.CRYPTO_ASSETS.split(',').map(s => s.trim().toUpperCase()) : Object.keys(allAssets);

  const adapters = injected || {};
  if (!injected) {
    const make = {
      solana: () => {
        if (!env.SOLANA_HOT_WALLET_SECRET && !env.SOLANA_HOUSE_ADDRESS) return null;
        return require('./solana').createSolanaAdapter({ rpc: env.SOLANA_RPC_URL || chains.solana.rpc, secret: env.SOLANA_HOT_WALLET_SECRET, houseAddress: env.SOLANA_HOUSE_ADDRESS });
      },
      ethereum: () => {
        if (!env.EVM_HOT_WALLET_KEY && !env.EVM_HOUSE_ADDRESS) return null;
        return require('./evm').createEvmAdapter({ chain: chains.ethereum, rpc: env.ETH_RPC_URL || chains.ethereum.rpc, privateKey: env.EVM_HOT_WALLET_KEY, houseAddress: env.EVM_HOUSE_ADDRESS });
      },
      bsc: () => {
        if (!env.EVM_HOT_WALLET_KEY && !env.EVM_HOUSE_ADDRESS) return null;
        return require('./evm').createEvmAdapter({ chain: chains.bsc, rpc: env.BSC_RPC_URL || chains.bsc.rpc, privateKey: env.EVM_HOT_WALLET_KEY, houseAddress: env.EVM_HOUSE_ADDRESS });
      },
      tron: () => {
        if (!env.TRON_HOT_WALLET_KEY && !env.TRON_HOUSE_ADDRESS) return null;
        return require('./tron').createTronAdapter({ rpc: env.TRON_RPC_URL || chains.tron.rpc, apiKey: env.TRON_API_KEY, privateKey: env.TRON_HOT_WALLET_KEY, houseAddress: env.TRON_HOUSE_ADDRESS });
      },
    };
    for (const id of Object.keys(make)) {
      try { const a = make[id](); if (a) adapters[id] = a; }
      catch (e) { warnings.push(`Crypto chain ${id} disabled: ${e.message}`); }
    }
  }

  const assets = {};
  for (const [id, a] of Object.entries(allAssets)) {
    if (wanted.includes(id) && adapters[a.chain]) assets[id] = { id, ...a, family: chains[a.chain].family, chainName: chains[a.chain].name };
  }
  const prices = createPrices({ assets, fetchFn: env.__fetch || globalThis.fetch });

  const explorerUrl = (chainId, tx) => (chains[chainId] ? chains[chainId].explorer.replace('{tx}', encodeURIComponent(tx)) : '');

  // Public description for the browser (no secrets, no private RPC URLs).
  function publicAssets() {
    return Object.values(assets).map(a => ({
      id: a.id, chain: a.chain, chainName: a.chainName, family: a.family, symbol: a.symbol, decimals: a.decimals,
      stable: !!a.stable, priceMicros: prices.priceMicros(a), house: adapters[a.chain].house,
    }));
  }

  return {
    network, chains, assets, adapters, prices, FAMILIES,
    enabled: Object.keys(assets).length > 0,
    explorerUrl, publicAssets,
    canAutoSend: chainId => !!(adapters[chainId] && adapters[chainId].canSend),
  };
}

module.exports = { createCrypto };
