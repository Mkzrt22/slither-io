'use strict';
const { ethers } = require('ethers');

const ERC20 = new ethers.Interface([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const TRANSFER_TOPIC = ERC20.getEvent('Transfer').topicHash;

// What the house received from `from` in a mined transaction.
function parseEvmDeposit({ tx, receipt, latestBlock }, { house, from, asset, confirmations }) {
  if (!receipt) return { status: 'pending' };
  if (receipt.status !== 1) return { status: 'failed', reason: 'tx_failed' };
  if (latestBlock - receipt.blockNumber + 1 < confirmations) return { status: 'pending' };
  if (!tx || tx.from.toLowerCase() !== from) return { status: 'failed', reason: 'wrong_sender' };
  let units = 0n;
  if (asset.native) {
    if (tx.to && tx.to.toLowerCase() === house) units = BigInt(tx.value);
  } else {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== asset.token.toLowerCase() || log.topics[0] !== TRANSFER_TOPIC) continue;
      const ev = ERC20.parseLog(log);
      if (ev.args.from.toLowerCase() === from && ev.args.to.toLowerCase() === house) units += BigInt(ev.args.value);
    }
  }
  if (units <= 0n) return { status: 'failed', reason: 'nothing_received' };
  return { status: 'confirmed', units };
}

function createEvmAdapter({ chain, rpc, privateKey, houseAddress }) {
  const provider = new ethers.JsonRpcProvider(rpc, chain.chainId, { staticNetwork: true, cacheTimeout: -1 });
  const wallet = privateKey ? new ethers.Wallet(privateKey, provider) : null;
  const house = (wallet ? wallet.address : ethers.getAddress(houseAddress)).toLowerCase();

  return {
    family: 'evm',
    house,
    canSend: !!wallet,

    // Transaction parameters for MetaMask (eth_sendTransaction).
    async buildDeposit({ asset, from, units }) {
      const params = asset.native
        ? { from, to: house, value: ethers.toQuantity(BigInt(units)) }
        : { from, to: asset.token, value: '0x0', data: ERC20.encodeFunctionData('transfer', [house, BigInt(units)]) };
      return {
        kind: 'evm',
        chainId: ethers.toQuantity(chain.chainId),
        chainParams: {
          chainId: ethers.toQuantity(chain.chainId), chainName: chain.name, rpcUrls: [chain.rpc],
          nativeCurrency: chain.native, blockExplorerUrls: [chain.explorer.replace('/tx/{tx}', '')],
        },
        tx: params,
      };
    },

    async verifyDeposit({ txHash, asset, from }) {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (!receipt) return { status: 'pending' };
      const [tx, latestBlock] = await Promise.all([provider.getTransaction(txHash), provider.getBlockNumber()]);
      return parseEvmDeposit({ tx, receipt, latestBlock }, { house, from, asset, confirmations: chain.confirmations });
    },

    async sendWithdrawal({ asset, to, units }) {
      if (!wallet) throw new Error('no_hot_wallet');
      let tx;
      if (asset.native) tx = await wallet.sendTransaction({ to, value: BigInt(units) });
      else tx = await new ethers.Contract(asset.token, ERC20, wallet).transfer(to, BigInt(units));
      return tx.hash;
    },

    async balance(asset) {
      if (asset.native) return BigInt(await provider.getBalance(house));
      return BigInt(await new ethers.Contract(asset.token, ERC20, provider).balanceOf(house));
    },

    validTx: h => typeof h === 'string' && /^0x[0-9a-fA-F]{64}$/.test(h),
    validAddress: a => ethers.isAddress(a),
  };
}

module.exports = { createEvmAdapter, parseEvmDeposit, ERC20, TRANSFER_TOPIC };
