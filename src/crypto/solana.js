'use strict';
const web3 = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const bs58 = (m => m.default || m)(require('bs58'));

function parseSecret(secret) {
  const s = String(secret).trim();
  const bytes = s.startsWith('[') ? Uint8Array.from(JSON.parse(s)) : bs58.decode(s);
  return web3.Keypair.fromSecretKey(bytes);
}

// What the house received in a parsed transaction, signed by `from`.
// Returns { status: 'confirmed'|'failed', units, reason }.
function parseSolanaDeposit(tx, { house, from, asset }) {
  if (!tx) return { status: 'pending' };
  if (tx.meta && tx.meta.err) return { status: 'failed', reason: 'tx_failed' };
  const keys = tx.transaction.message.accountKeys.map(k => ({ key: k.pubkey.toString(), signer: !!k.signer }));
  if (!keys.some(k => k.signer && k.key === from)) return { status: 'failed', reason: 'wrong_sender' };
  let units = 0n;
  if (asset.native) {
    const i = keys.findIndex(k => k.key === house);
    if (i >= 0) units = BigInt(tx.meta.postBalances[i]) - BigInt(tx.meta.preBalances[i]);
  } else {
    const bal = list => (list || []).filter(b => b.owner === house && b.mint === asset.mint).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
    units = bal(tx.meta.postTokenBalances) - bal(tx.meta.preTokenBalances);
  }
  if (units <= 0n) return { status: 'failed', reason: 'nothing_received' };
  return { status: 'confirmed', units };
}

function createSolanaAdapter({ rpc, secret, houseAddress }) {
  const conn = new web3.Connection(rpc, 'confirmed');
  const hot = secret ? parseSecret(secret) : null;
  const house = hot ? hot.publicKey : new web3.PublicKey(houseAddress);

  return {
    family: 'solana',
    house: house.toBase58(),
    canSend: !!hot,

    // Unsigned transaction for the player's wallet (Phantom) to sign and send.
    async buildDeposit({ asset, from, units }) {
      const payer = new web3.PublicKey(from);
      const tx = new web3.Transaction();
      if (asset.native) {
        tx.add(web3.SystemProgram.transfer({ fromPubkey: payer, toPubkey: house, lamports: BigInt(units) }));
      } else {
        const mint = new web3.PublicKey(asset.mint);
        const src = spl.getAssociatedTokenAddressSync(mint, payer);
        const dst = spl.getAssociatedTokenAddressSync(mint, house);
        tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(payer, dst, house, mint));
        tx.add(spl.createTransferCheckedInstruction(src, mint, dst, payer, BigInt(units), asset.decimals));
      }
      const { blockhash } = await conn.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;
      tx.feePayer = payer;
      return { kind: 'solana', tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') };
    },

    async verifyDeposit({ txHash, asset, from }) {
      const tx = await conn.getParsedTransaction(txHash, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
      return parseSolanaDeposit(tx, { house: house.toBase58(), from, asset });
    },

    async sendWithdrawal({ asset, to, units }) {
      if (!hot) throw new Error('no_hot_wallet');
      const dest = new web3.PublicKey(to);
      const tx = new web3.Transaction();
      if (asset.native) {
        tx.add(web3.SystemProgram.transfer({ fromPubkey: hot.publicKey, toPubkey: dest, lamports: BigInt(units) }));
      } else {
        const mint = new web3.PublicKey(asset.mint);
        const src = spl.getAssociatedTokenAddressSync(mint, hot.publicKey);
        const dst = spl.getAssociatedTokenAddressSync(mint, dest);
        tx.add(spl.createAssociatedTokenAccountIdempotentInstruction(hot.publicKey, dst, dest, mint));
        tx.add(spl.createTransferCheckedInstruction(src, mint, dst, hot.publicKey, BigInt(units), asset.decimals));
      }
      return web3.sendAndConfirmTransaction(conn, tx, [hot], { commitment: 'confirmed' });
    },

    async balance(asset) {
      if (asset.native) return BigInt(await conn.getBalance(house));
      try {
        const ata = spl.getAssociatedTokenAddressSync(new web3.PublicKey(asset.mint), house);
        return BigInt((await conn.getTokenAccountBalance(ata)).value.amount);
      } catch (e) { return 0n; }
    },

    validTx: h => typeof h === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(h),
    validAddress: a => { try { return bs58.decode(a).length === 32; } catch (e) { return false; } },
  };
}

module.exports = { createSolanaAdapter, parseSolanaDeposit, parseSecret };
