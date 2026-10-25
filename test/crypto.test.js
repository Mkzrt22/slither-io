'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nacl = require('tweetnacl');
const bs58 = (m => m.default || m)(require('bs58'));
const { ethers } = require('ethers');
const { TronWeb } = require('tronweb');
const { createSiw } = require('../src/crypto/siw');
const { parseSolanaDeposit } = require('../src/crypto/solana');
const { parseEvmDeposit, ERC20, TRANSFER_TOPIC } = require('../src/crypto/evm');
const { parseTronDeposit } = require('../src/crypto/tron');
const { unitsToUsd, usdToUnits, formatUnits } = require('../src/crypto/prices');
const { createPayments } = require('../src/payments');
const { createAccounts } = require('../src/auth');
const { arenaWorld, usd } = require('./helpers');

// ── Sign in with wallet ──────────────────────────────────────────────────────
test('SIW: Solana signature (Phantom)', async () => {
  const siw = createSiw({ domain: 'game.test' });
  const kp = nacl.sign.keyPair();
  const address = bs58.encode(kp.publicKey);
  const { nonce, message } = siw.issue('solana', address);
  assert.match(message, /game\.test/);
  const signature = Buffer.from(nacl.sign.detached(Buffer.from(message), kp.secretKey)).toString('base64');
  assert.equal(await siw.verify({ family: 'solana', address, nonce, signature }), address);
  assert.equal(await siw.verify({ family: 'solana', address, nonce, signature }), null, 'nonce is single-use');
});

test('SIW: EVM signature (MetaMask)', async () => {
  const siw = createSiw({ domain: 'game.test' });
  const w = ethers.Wallet.createRandom();
  const { nonce, message } = siw.issue('evm', w.address);
  const other = ethers.Wallet.createRandom();
  assert.equal(await siw.verify({ family: 'evm', address: w.address, nonce, signature: await other.signMessage(message) }), null, 'wrong signer');
  const n2 = siw.issue('evm', w.address);
  assert.equal(await siw.verify({ family: 'evm', address: w.address, nonce: n2.nonce, signature: await w.signMessage(n2.message) }), w.address.toLowerCase());
});

test('SIW: TRON signature (TronLink)', async () => {
  const siw = createSiw({ domain: 'game.test' });
  const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' });
  const acct = await tw.createAccount();
  const { nonce, message } = siw.issue('tron', acct.address.base58);
  const signature = await tw.trx.signMessageV2(message, acct.privateKey);
  assert.equal(await siw.verify({ family: 'tron', address: acct.address.base58, nonce, signature }), acct.address.base58);
});

test('SIW rejects bad input', async () => {
  const siw = createSiw({ domain: 'game.test' });
  assert.equal(siw.issue('solana', 'not-an-address'), null);
  assert.equal(siw.issue('evm', '0x123'), null);
  const w = ethers.Wallet.createRandom();
  const { nonce, message } = siw.issue('evm', w.address);
  const sig = await w.signMessage(message);
  assert.equal(await siw.verify({ family: 'solana', address: w.address, nonce, signature: sig }), null, 'family mismatch');
});

// ── On-chain deposit parsing ─────────────────────────────────────────────────
const HOUSE_SOL = bs58.encode(nacl.sign.keyPair().publicKey);
const USER_SOL = bs58.encode(nacl.sign.keyPair().publicKey);
const pk = s => ({ toString: () => s });

test('Solana deposit parsing: SOL and USDC', () => {
  const sol = { native: true, decimals: 9 };
  const usdc = { native: false, decimals: 6, mint: 'MintUSDC' };
  const tx = {
    meta: {
      err: null, preBalances: [5e9, 1e9], postBalances: [3.9e9, 2e9],
      preTokenBalances: [{ owner: HOUSE_SOL, mint: 'MintUSDC', uiTokenAmount: { amount: '1000000' } }],
      postTokenBalances: [{ owner: HOUSE_SOL, mint: 'MintUSDC', uiTokenAmount: { amount: '26000000' } }],
    },
    transaction: { message: { accountKeys: [{ pubkey: pk(USER_SOL), signer: true }, { pubkey: pk(HOUSE_SOL), signer: false }] } },
  };
  assert.deepEqual(parseSolanaDeposit(tx, { house: HOUSE_SOL, from: USER_SOL, asset: sol }), { status: 'confirmed', units: 1000000000n });
  assert.deepEqual(parseSolanaDeposit(tx, { house: HOUSE_SOL, from: USER_SOL, asset: usdc }), { status: 'confirmed', units: 25000000n });
  assert.equal(parseSolanaDeposit(tx, { house: HOUSE_SOL, from: HOUSE_SOL, asset: sol }).reason, 'wrong_sender');
  assert.equal(parseSolanaDeposit(null, { house: HOUSE_SOL, from: USER_SOL, asset: sol }).status, 'pending');
  assert.equal(parseSolanaDeposit({ ...tx, meta: { ...tx.meta, err: { x: 1 } } }, { house: HOUSE_SOL, from: USER_SOL, asset: sol }).status, 'failed');
});

test('EVM deposit parsing: native, ERC-20 and confirmations', () => {
  const house = ethers.Wallet.createRandom().address.toLowerCase();
  const user = ethers.Wallet.createRandom().address.toLowerCase();
  const token = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
  const pad = a => ethers.zeroPadValue(a, 32);
  const log = { address: token, topics: [TRANSFER_TOPIC, pad(user), pad(house)], data: ethers.zeroPadValue(ethers.toBeHex(5000000n), 32) };
  const fakeLog = { ...log, address: '0x0000000000000000000000000000000000000001' };
  const receipt = { status: 1, blockNumber: 100, logs: [log, fakeLog] };
  const eth = { native: true, decimals: 18 };
  const usdc = { native: false, token, decimals: 6 };
  const opts = { house, from: user, confirmations: 3 };
  assert.deepEqual(parseEvmDeposit({ tx: { from: user, to: house, value: 10n ** 17n }, receipt, latestBlock: 102 }, { ...opts, asset: eth }), { status: 'confirmed', units: 10n ** 17n });
  assert.equal(parseEvmDeposit({ tx: { from: user, to: house, value: 1n }, receipt, latestBlock: 101 }, { ...opts, asset: eth }).status, 'pending', 'not enough confirmations');
  assert.deepEqual(parseEvmDeposit({ tx: { from: user, to: token, value: 0n }, receipt, latestBlock: 110 }, { ...opts, asset: usdc }), { status: 'confirmed', units: 5000000n }, 'fake token log ignored');
  assert.equal(parseEvmDeposit({ tx: { from: house, to: house, value: 1n }, receipt, latestBlock: 110 }, { ...opts, asset: eth }).reason, 'wrong_sender');
  assert.equal(parseEvmDeposit({ tx: { from: user }, receipt: { ...receipt, status: 0 }, latestBlock: 110 }, { ...opts, asset: eth }).status, 'failed');
  assert.ok(ERC20.encodeFunctionData('transfer', [house, 1n]).startsWith('0xa9059cbb'));
});

test('TRON deposit parsing: TRX and TRC-20', async () => {
  const tw = new TronWeb({ fullHost: 'https://api.trongrid.io' });
  const house = (await tw.createAccount()).address;
  const user = (await tw.createAccount()).address;
  const token = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
  const trx = { raw_data: { contract: [{ type: 'TransferContract', parameter: { value: { owner_address: user.hex, to_address: house.hex, amount: 2500000 } } }] }, ret: [{ contractRet: 'SUCCESS' }] };
  assert.deepEqual(parseTronDeposit(trx, { house: house.base58, from: user.base58, asset: { native: true } }), { status: 'confirmed', units: 2500000n });
  const data = 'a9059cbb' + house.hex.slice(2).padStart(64, '0') + (7000000).toString(16).padStart(64, '0');
  const trc = { raw_data: { contract: [{ type: 'TriggerSmartContract', parameter: { value: { owner_address: user.hex, contract_address: TronWeb.address.toHex(token), data } } }] }, ret: [{ contractRet: 'SUCCESS' }] };
  assert.deepEqual(parseTronDeposit(trc, { house: house.base58, from: user.base58, asset: { native: false, token } }), { status: 'confirmed', units: 7000000n });
  assert.equal(parseTronDeposit({ ...trc, ret: [{ contractRet: 'REVERT' }] }, { house: house.base58, from: user.base58, asset: { native: false, token } }).status, 'failed');
  assert.equal(parseTronDeposit({}, { house: house.base58, from: user.base58, asset: { native: true } }).status, 'pending');
});

test('USD conversion math', () => {
  assert.equal(unitsToUsd(1500000000n, 9, 100000000), 150000000); // 1.5 SOL at $100 = $150
  assert.equal(usdToUnits(150000000, 9, 100000000), 1500000000n);
  assert.equal(unitsToUsd(10n ** 18n, 18, 1000000), 1000000); // 1 Binance-Peg USDC (18 dec) = $1
  assert.equal(formatUnits(1234567890n, 9), '1.234567');
  assert.equal(formatUnits(1234567890n, 9, 2), '1.23');
  assert.equal(formatUnits(5000000n, 6), '5');
});

// ── Accounts from wallets ────────────────────────────────────────────────────
test('wallet accounts: create, reuse, link, rename', async () => {
  const w = arenaWorld();
  const accounts = createAccounts(w.db);
  const a = accounts.walletLogin('solana', USER_SOL);
  assert.ok(a.created && /^sol_/.test(a.user.username) && a.user.auto_name === 1);
  const again = accounts.walletLogin('solana', USER_SOL);
  assert.equal(again.user.id, a.user.id);
  assert.equal(again.created, false);
  const reg = await accounts.register('kevin', 'secret123');
  assert.equal(accounts.linkWallet(reg.user.id, 'solana', USER_SOL).error, 'wallet_in_use');
  assert.equal(accounts.linkWallet(reg.user.id, 'evm', '0xabc').ok, true);
  assert.equal(accounts.linkWallet(reg.user.id, 'evm', '0xdef').error, 'wallet_already_linked');
  assert.deepEqual(accounts.links(reg.user.id), { evm: '0xabc' });
  assert.equal((await accounts.login(a.user.username, '!')).ok, false, 'wallet accounts have no password');
  assert.equal(accounts.rename(a.user.id, 'kevin').error, 'username_taken');
  assert.equal(accounts.rename(a.user.id, 'snakeking').ok, true);
  assert.equal(accounts.rename(a.user.id, 'again').error, 'rename_not_allowed');
});

// ── Deposits & withdrawals with a fake chain ─────────────────────────────────
function cryptoWorld() {
  const w = arenaWorld({ PAYMENTS_MODE: 'crypto', CURRENCY: 'USD' });
  const chain = {
    verify: { status: 'pending' }, sent: [], failSend: false, hotBalance: 10n ** 12n,
    house: HOUSE_SOL, canSend: true,
    async buildDeposit({ units }) { return { kind: 'solana', tx: 'base64', units: String(units) }; },
    async verifyDeposit() { return chain.verify; },
    async sendWithdrawal({ to, units }) { if (chain.failSend) throw new Error('rpc timeout'); chain.sent.push({ to, units }); return 'TXID' + chain.sent.length; },
    async balance() { return chain.hotBalance; },
    validTx: h => /^[A-Za-z0-9]{10,}$/.test(h),
  };
  const assets = {
    SOL: { id: 'SOL', chain: 'solana', family: 'solana', symbol: 'SOL', decimals: 9, native: true, priceId: 'solana', chainName: 'Solana' },
    USDC_SOL: { id: 'USDC_SOL', chain: 'solana', family: 'solana', symbol: 'USDC', decimals: 6, stable: true, mint: 'M', chainName: 'Solana' },
  };
  const crypto = {
    network: 'testnet', enabled: true, assets, adapters: { solana: chain },
    prices: { priceMicros: a => (a.stable ? 1000000 : 100000000), start() {}, stop() {} },
    explorerUrl: (c, tx) => 'https://x/' + tx, publicAssets: () => [], canAutoSend: () => chain.canSend,
  };
  const accounts = createAccounts(w.db);
  const events = [];
  const payments = createPayments({ db: w.db, ledger: w.ledger, config: w.config, crypto, getLinks: uid => accounts.links(uid), onWalletChange: (uid, ev) => events.push(ev) });
  const user = w.user('player', 0);
  accounts.linkWallet(user.id, 'solana', USER_SOL);
  return { ...w, makeUser: w.user, chain, payments, user, accounts, events };
}
const flush = () => new Promise(r => setImmediate(r));

test('deposit: pending → confirmed credits USD once, with spread on volatile assets', async () => {
  const w = cryptoWorld();
  const prep = await w.payments.prepareDeposit(w.user, null, 'SOL', usd(50));
  assert.equal(prep.ok, true);
  assert.equal(prep.units, '500000000'); // $50 at $100 = 0.5 SOL
  const r = w.payments.submitDeposit(w.user, null, 'SOL', 'TXabcdef1234567890');
  assert.equal(r.ok, true);
  await flush();
  assert.equal(w.ledger.balance(w.user.id, 'USD'), 0, 'not credited while pending');
  w.chain.verify = { status: 'confirmed', units: 500000000n };
  const dep = w.db.prepare('SELECT * FROM deposits WHERE id=?').get(r.id);
  await w.payments.checkDeposit(dep);
  assert.equal(w.ledger.balance(w.user.id, 'USD'), usd(49.5), '1% spread on SOL');
  await w.payments.checkDeposit(w.db.prepare('SELECT * FROM deposits WHERE id=?').get(r.id));
  assert.equal(w.ledger.balance(w.user.id, 'USD'), usd(49.5), 'credited once');
  assert.equal(w.payments.submitDeposit(w.user, null, 'SOL', 'TXabcdef1234567890').ok, true, 'same user resubmits: fine');
  const other = w.makeUser('other', 0);
  w.accounts.linkWallet(other.id, 'solana', HOUSE_SOL);
  assert.equal(w.payments.submitDeposit(other, null, 'SOL', 'TXabcdef1234567890').error, 'tx_already_used');
});

test('deposit: stablecoins credit 1:1, failures are recorded', async () => {
  const w = cryptoWorld();
  w.chain.verify = { status: 'confirmed', units: 20000000n };
  w.payments.submitDeposit(w.user, null, 'USDC_SOL', 'TXusdc0000000001');
  await flush(); await flush();
  assert.equal(w.ledger.balance(w.user.id, 'USD'), usd(20));
  w.chain.verify = { status: 'failed', reason: 'wrong_sender' };
  const r = w.payments.submitDeposit(w.user, null, 'USDC_SOL', 'TXusdc0000000002');
  await flush(); await flush();
  assert.equal(w.db.prepare('SELECT status, note FROM deposits WHERE id=?').get(r.id).note, 'wrong_sender');
  assert.equal(w.ledger.balance(w.user.id, 'USD'), usd(20));
});

test('deposit checks: wallet link, region, compliance', async () => {
  const w = cryptoWorld();
  const unlinked = w.makeUser('nolink', 0);
  assert.equal((await w.payments.prepareDeposit(unlinked, null, 'SOL', usd(10))).error, 'wallet_not_linked');
  assert.equal((await w.payments.prepareDeposit(w.user, 'XX', 'SOL', usd(10))).error, 'region_blocked');
  assert.equal((await w.payments.prepareDeposit(w.user, null, 'DOGE', usd(10))).error, 'unknown_asset');
  assert.equal((await w.payments.prepareDeposit(w.user, null, 'SOL', usd(0.5))).error, 'invalid_amount');
  assert.equal(w.payments.submitDeposit(w.user, null, 'SOL', 'bad hash!').error, 'invalid_tx');
});

test('withdrawals: automatic under the cap, to the linked wallet, minus fee and spread', async () => {
  const w = cryptoWorld();
  w.ledger.transfer(w.user.id, 'USD', usd(500), 'adjust', 'test');
  const r = w.payments.requestWithdrawal(w.user, null, 'SOL', usd(50.1));
  assert.equal(r.ok, true);
  assert.equal(r.auto, true);
  await flush(); await flush(); await flush();
  assert.equal(w.chain.sent.length, 1);
  assert.equal(w.chain.sent[0].to, USER_SOL);
  // ($50.10 - $0.10 fee) at $101 (price + 1%) = 0.495049504 SOL
  assert.equal(w.chain.sent[0].units, 495049504n);
  assert.equal(w.db.prepare('SELECT status, txid FROM withdrawals WHERE id=?').get(r.id).status, 'sent');
  assert.equal(w.ledger.balance(w.user.id, 'USD'), usd(449.9));
});

test('withdrawals: manual above the cap or daily limit, admin send and reject', async () => {
  const w = cryptoWorld();
  w.ledger.transfer(w.user.id, 'USD', usd(1000), 'adjust', 'test');
  const big = w.payments.requestWithdrawal(w.user, null, 'USDC_SOL', usd(200));
  assert.equal(big.auto, false);
  const a = w.payments.requestWithdrawal(w.user, null, 'USDC_SOL', usd(90));
  assert.equal(a.auto, true);
  await flush(); await flush(); await flush();
  const b = w.payments.requestWithdrawal(w.user, null, 'USDC_SOL', usd(90));
  assert.equal(b.auto, false, 'daily auto limit reached');
  assert.equal((await w.payments.admin.approve(big.id)).ok, true);
  assert.equal(w.db.prepare('SELECT status FROM withdrawals WHERE id=?').get(big.id).status, 'sent');
  assert.equal(w.ledger.balance(0, 'USD'), usd(0.3), 'house keeps the network fees (3 × $0.10)');
  assert.equal(w.payments.admin.reject(b.id, 'test').ok, true);
  assert.equal(w.ledger.balance(w.user.id, 'USD'), usd(1000 - 200 - 90));
  assert.equal(w.ledger.balance(0, 'USD'), usd(0.2), 'fee returned with the rejected withdrawal');
});

test('withdrawals: a failed send goes to review and is never auto-refunded', async () => {
  const w = cryptoWorld();
  w.ledger.transfer(w.user.id, 'USD', usd(100), 'adjust', 'test');
  w.chain.failSend = true;
  const r = w.payments.requestWithdrawal(w.user, null, 'USDC_SOL', usd(20));
  await flush(); await flush(); await flush();
  const row = w.db.prepare('SELECT status, admin_note FROM withdrawals WHERE id=?').get(r.id);
  assert.equal(row.status, 'review');
  assert.match(row.admin_note, /rpc timeout/);
  assert.equal(w.ledger.balance(w.user.id, 'USD'), usd(80));
  assert.equal((await w.payments.admin.approve(r.id)).error, 'not_pending', 'no blind resend');
  assert.equal(w.payments.admin.markSent(r.id, 'TXonchain').ok, true);
});

test('withdrawals: low hot wallet keeps the request pending, insufficient balance refused', async () => {
  const w = cryptoWorld();
  w.ledger.transfer(w.user.id, 'USD', usd(30), 'adjust', 'test');
  w.chain.hotBalance = 0n;
  const r = w.payments.requestWithdrawal(w.user, null, 'USDC_SOL', usd(20));
  await flush(); await flush(); await flush();
  assert.equal(w.db.prepare('SELECT status, admin_note FROM withdrawals WHERE id=?').get(r.id).admin_note, 'hot_wallet_low');
  assert.equal(w.payments.requestWithdrawal(w.user, null, 'USDC_SOL', usd(20)).error, 'insufficient_funds');
  assert.equal(w.payments.requestWithdrawal(w.user, null, 'USDC_SOL', usd(0.05)).error, 'invalid_amount');
});
