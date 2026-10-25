'use strict';

// Supported chains and assets, mainnet and testnet. Token addresses are the
// official ones; double-check them on the explorer before going live.
//  - Circle no longer issues USDC on TRON, so TRON uses TRX and USDT.
//  - USDC on BNB Chain is Binance-Peg USDC and has 18 decimals (not 6).

const CHAINS = {
  mainnet: {
    solana: { id: 'solana', family: 'solana', name: 'Solana', rpc: 'https://api.mainnet-beta.solana.com', explorer: 'https://solscan.io/tx/{tx}' },
    ethereum: { id: 'ethereum', family: 'evm', name: 'Ethereum', chainId: 1, rpc: 'https://ethereum-rpc.publicnode.com', confirmations: 12, explorer: 'https://etherscan.io/tx/{tx}', native: { name: 'Ether', symbol: 'ETH', decimals: 18 } },
    bsc: { id: 'bsc', family: 'evm', name: 'BNB Chain', chainId: 56, rpc: 'https://bsc-dataseed.bnbchain.org', confirmations: 15, explorer: 'https://bscscan.com/tx/{tx}', native: { name: 'BNB', symbol: 'BNB', decimals: 18 } },
    tron: { id: 'tron', family: 'tron', name: 'TRON', rpc: 'https://api.trongrid.io', explorer: 'https://tronscan.org/#/transaction/{tx}' },
  },
  testnet: {
    solana: { id: 'solana', family: 'solana', name: 'Solana Devnet', rpc: 'https://api.devnet.solana.com', explorer: 'https://solscan.io/tx/{tx}?cluster=devnet' },
    ethereum: { id: 'ethereum', family: 'evm', name: 'Sepolia', chainId: 11155111, rpc: 'https://ethereum-sepolia-rpc.publicnode.com', confirmations: 3, explorer: 'https://sepolia.etherscan.io/tx/{tx}', native: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 } },
    bsc: { id: 'bsc', family: 'evm', name: 'BNB Chain Testnet', chainId: 97, rpc: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545', confirmations: 3, explorer: 'https://testnet.bscscan.com/tx/{tx}', native: { name: 'tBNB', symbol: 'tBNB', decimals: 18 } },
    tron: { id: 'tron', family: 'tron', name: 'TRON Nile', rpc: 'https://nile.trongrid.io', explorer: 'https://nile.tronscan.org/#/transaction/{tx}' },
  },
};

const ASSETS = {
  mainnet: {
    SOL: { chain: 'solana', symbol: 'SOL', decimals: 9, native: true, priceId: 'solana', coinbase: 'SOL-USD' },
    USDC_SOL: { chain: 'solana', symbol: 'USDC', decimals: 6, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', stable: true },
    ETH: { chain: 'ethereum', symbol: 'ETH', decimals: 18, native: true, priceId: 'ethereum', coinbase: 'ETH-USD' },
    USDC_ETH: { chain: 'ethereum', symbol: 'USDC', decimals: 6, token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', stable: true },
    BNB: { chain: 'bsc', symbol: 'BNB', decimals: 18, native: true, priceId: 'binancecoin', coinbase: 'BNB-USD' },
    USDC_BSC: { chain: 'bsc', symbol: 'USDC', decimals: 18, token: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', stable: true },
    TRX: { chain: 'tron', symbol: 'TRX', decimals: 6, native: true, priceId: 'tron', coinbase: 'TRX-USD' },
    USDT_TRON: { chain: 'tron', symbol: 'USDT', decimals: 6, token: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', stable: true },
  },
  testnet: {
    SOL: { chain: 'solana', symbol: 'SOL', decimals: 9, native: true, priceId: 'solana', coinbase: 'SOL-USD' },
    USDC_SOL: { chain: 'solana', symbol: 'USDC', decimals: 6, mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', stable: true },
    ETH: { chain: 'ethereum', symbol: 'ETH', decimals: 18, native: true, priceId: 'ethereum', coinbase: 'ETH-USD' },
    USDC_ETH: { chain: 'ethereum', symbol: 'USDC', decimals: 6, token: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', stable: true },
    BNB: { chain: 'bsc', symbol: 'tBNB', decimals: 18, native: true, priceId: 'binancecoin', coinbase: 'BNB-USD' },
    TRX: { chain: 'tron', symbol: 'TRX', decimals: 6, native: true, priceId: 'tron', coinbase: 'TRX-USD' },
  },
};

const FAMILIES = ['solana', 'evm', 'tron'];

module.exports = { CHAINS, ASSETS, FAMILIES };
