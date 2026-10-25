#!/usr/bin/env node
'use strict';
// Generates fresh hot wallets for the house (Solana, EVM for Ethereum + BNB Chain, TRON)
// and prints the environment variables to paste in your host's settings.
// Run it on a trusted machine, never commit the output, and back the keys up offline.
//   node scripts/new-wallets.js

const web3 = require('@solana/web3.js');
const bs58 = (m => m.default || m)(require('bs58'));
const { ethers } = require('ethers');
const { TronWeb } = require('tronweb');

(async () => {
  const sol = web3.Keypair.generate();
  const evm = ethers.Wallet.createRandom();
  const tron = await new TronWeb({ fullHost: 'https://api.trongrid.io' }).createAccount();

  console.log('# Public addresses (players send deposits here; fund them for withdrawals):');
  console.log(`#   Solana:                ${sol.publicKey.toBase58()}`);
  console.log(`#   Ethereum + BNB Chain:  ${evm.address}`);
  console.log(`#   TRON:                  ${tron.address.base58}`);
  console.log('#');
  console.log('# Secret keys — keep them private:');
  console.log(`SOLANA_HOT_WALLET_SECRET=${bs58.encode(sol.secretKey)}`);
  console.log(`EVM_HOT_WALLET_KEY=${evm.privateKey}`);
  console.log(`TRON_HOT_WALLET_KEY=${tron.privateKey}`);
})();
