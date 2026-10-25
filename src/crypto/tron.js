'use strict';
const { TronWeb } = require('tronweb');

const hexToBase58 = hex => TronWeb.address.fromHex(hex);

// What the house received from `from` in a solidified (confirmed) transaction.
function parseTronDeposit(tx, { house, from, asset }) {
  if (!tx || !tx.raw_data) return { status: 'pending' };
  const ret = tx.ret && tx.ret[0] && tx.ret[0].contractRet;
  if (ret && ret !== 'SUCCESS') return { status: 'failed', reason: 'tx_failed' };
  const c = tx.raw_data.contract && tx.raw_data.contract[0];
  if (!c) return { status: 'failed', reason: 'nothing_received' };
  const v = c.parameter.value;
  if (hexToBase58(v.owner_address) !== from) return { status: 'failed', reason: 'wrong_sender' };
  let units = 0n;
  if (asset.native) {
    if (c.type === 'TransferContract' && hexToBase58(v.to_address) === house) units = BigInt(v.amount);
  } else if (c.type === 'TriggerSmartContract' && hexToBase58(v.contract_address) === asset.token) {
    const data = String(v.data || '');
    if (data.startsWith('a9059cbb') && data.length >= 136) {
      const to = hexToBase58('41' + data.slice(8 + 24, 8 + 64));
      if (to === house) units = BigInt('0x' + data.slice(72, 136));
    }
  }
  if (units <= 0n) return { status: 'failed', reason: 'nothing_received' };
  return { status: 'confirmed', units };
}

function createTronAdapter({ rpc, apiKey, privateKey, houseAddress }) {
  const opts = { fullHost: rpc };
  if (apiKey) opts.headers = { 'TRON-PRO-API-KEY': apiKey };
  if (privateKey) opts.privateKey = privateKey;
  const tw = new TronWeb(opts);
  const house = privateKey ? TronWeb.address.fromPrivateKey(privateKey) : houseAddress;

  return {
    family: 'tron',
    house,
    canSend: !!privateKey,

    // Parameters for TronLink (sendTransaction / TRC20 transfer).
    async buildDeposit({ asset, units }) {
      return { kind: 'tron', to: house, token: asset.token || null, amount: BigInt(units).toString(), feeLimit: 100000000 };
    },

    async verifyDeposit({ txHash, asset, from }) {
      let tx = null;
      try { tx = await tw.trx.getConfirmedTransaction(txHash); } catch (e) { tx = null; }
      return parseTronDeposit(tx, { house, from, asset });
    },

    async sendWithdrawal({ asset, to, units }) {
      if (!privateKey) throw new Error('no_hot_wallet');
      if (asset.native) {
        const r = await tw.trx.sendTransaction(to, Number(units));
        if (!r || r.result !== true) throw new Error('broadcast_failed: ' + JSON.stringify(r).slice(0, 200));
        return r.txid || (r.transaction && r.transaction.txID);
      }
      const contract = await tw.contract().at(asset.token);
      return contract.transfer(to, BigInt(units).toString()).send({ feeLimit: 100000000 });
    },

    async balance(asset) {
      if (asset.native) return BigInt(await tw.trx.getBalance(house));
      const contract = await tw.contract().at(asset.token);
      return BigInt((await contract.balanceOf(house).call()).toString());
    },

    validTx: h => typeof h === 'string' && /^[0-9a-fA-F]{64}$/.test(h),
    validAddress: a => TronWeb.isAddress(a) && String(a).startsWith('T'),
  };
}

module.exports = { createTronAdapter, parseTronDeposit };
