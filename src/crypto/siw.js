'use strict';
const crypto = require('crypto');

// "Sign in with wallet": the server issues a one-time message, the wallet signs
// it, the server checks the signature. Nothing is sent on-chain, no key is stored.

const NONCE_TTL_MS = 5 * 60 * 1000;

function lazy() {
  // Loaded on first use so the game still runs if a library is missing.
  return {
    nacl: require('tweetnacl'),
    bs58: (m => m.default || m)(require('bs58')),
    ethers: require('ethers'),
    TronWeb: require('tronweb').TronWeb,
  };
}

function normalizeAddress(family, address) {
  if (typeof address !== 'string' || address.length > 100) return null;
  const a = address.trim();
  const { bs58, ethers, TronWeb } = lazy();
  try {
    if (family === 'solana') return bs58.decode(a).length === 32 ? a : null;
    if (family === 'evm') return ethers.getAddress(a).toLowerCase();
    if (family === 'tron') return TronWeb.isAddress(a) && a.startsWith('T') ? a : null;
  } catch (e) { return null; }
  return null;
}

function createSiw({ domain }) {
  const nonces = new Map();
  let tronWeb = null;
  const sweep = () => { const now = Date.now(); for (const [k, v] of nonces) if (v.exp < now) nonces.delete(k); };

  function issue(family, address) {
    const addr = normalizeAddress(family, address);
    if (!addr) return null;
    sweep();
    const nonce = crypto.randomBytes(16).toString('hex');
    const message = [
      `${domain} wants you to sign in with your ${family === 'evm' ? 'Ethereum / BNB Chain' : family === 'solana' ? 'Solana' : 'TRON'} wallet:`,
      address.trim(),
      '',
      'Sign in to NeonSlither. This does not send a transaction or cost any fee.',
      '',
      `Nonce: ${nonce}`,
      `Issued At: ${new Date().toISOString()}`,
    ].join('\n');
    nonces.set(nonce, { family, address: addr, message, exp: Date.now() + NONCE_TTL_MS });
    return { nonce, message };
  }

  // Returns the normalized address when the signature is valid, else null. One use per nonce.
  async function verify({ family, address, nonce, signature }) {
    const entry = nonces.get(String(nonce || ''));
    if (!entry) return null;
    nonces.delete(nonce);
    if (entry.exp < Date.now() || entry.family !== family) return null;
    const addr = normalizeAddress(family, address);
    if (!addr || addr !== entry.address || typeof signature !== 'string' || signature.length > 400) return null;
    const { nacl, bs58, ethers, TronWeb } = lazy();
    try {
      if (family === 'solana') {
        const sig = Buffer.from(signature, 'base64');
        if (sig.length !== 64) return null;
        return nacl.sign.detached.verify(Buffer.from(entry.message, 'utf8'), sig, bs58.decode(addr)) ? addr : null;
      }
      if (family === 'evm') {
        return ethers.verifyMessage(entry.message, signature).toLowerCase() === addr ? addr : null;
      }
      if (family === 'tron') {
        if (!tronWeb) tronWeb = new TronWeb({ fullHost: 'https://api.trongrid.io' });
        const signer = await tronWeb.trx.verifyMessageV2(entry.message, signature);
        return signer === addr ? addr : null;
      }
    } catch (e) { return null; }
    return null;
  }

  return { issue, verify, _nonces: nonces };
}

module.exports = { createSiw, normalizeAddress };
