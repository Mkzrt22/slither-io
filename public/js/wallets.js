'use strict';
// Browser wallets: Phantom (Solana), MetaMask (Ethereum / BNB Chain), TronLink (TRON).
// Used to sign in (signed message) and to send deposits (the wallet signs and broadcasts).

const Wallets = {
  names: { solana: 'Phantom', evm: 'MetaMask', tron: 'TronLink' },
  icons: { solana: '👻', evm: '🦊', tron: '🔺' },
  install: { solana: 'https://phantom.app/download', evm: 'https://metamask.io/download/', tron: 'https://www.tronlink.org/' },

  provider(family) {
    if (family === 'solana') return (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom ? window.solana : null);
    if (family === 'evm') return window.ethereum || null;
    if (family === 'tron') return window.tronLink || null;
    return null;
  },
  available(family) { return !!this.provider(family); },

  // Wallet apps on phones open dapps in their own browser.
  openApp(family) {
    const url = location.href;
    if (isTouch && family === 'solana') location.href = `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(location.origin)}`;
    else if (isTouch && family === 'evm') location.href = `https://metamask.app.link/dapp/${location.host}${location.pathname}`;
    else window.open(this.install[family], '_blank', 'noopener');
  },

  tronWeb() { return (window.tronLink && window.tronLink.tronWeb) || window.tronWeb; },

  async connect(family) {
    const p = this.provider(family);
    if (family === 'solana') { const r = await p.connect(); return r.publicKey.toString(); }
    if (family === 'evm') { const [a] = await p.request({ method: 'eth_requestAccounts' }); return a; }
    if (family === 'tron') {
      const r = await p.request({ method: 'tron_requestAccounts' });
      if (r && r.code && r.code !== 200) throw new Error(r.message || 'TronLink refused');
      const tw = this.tronWeb();
      if (!tw || !tw.defaultAddress || !tw.defaultAddress.base58) throw new Error('Unlock TronLink first');
      return tw.defaultAddress.base58;
    }
    throw new Error('unknown wallet');
  },

  async sign(family, address, message) {
    const p = this.provider(family);
    if (family === 'solana') {
      const { signature } = await p.signMessage(new TextEncoder().encode(message), 'utf8');
      let bin = '';
      for (const b of signature) bin += String.fromCharCode(b);
      return btoa(bin);
    }
    if (family === 'evm') {
      const hex = '0x' + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('');
      return p.request({ method: 'personal_sign', params: [hex, address] });
    }
    return this.tronWeb().trx.signMessageV2(message);
  },

  loadSolanaWeb3() {
    if (window.solanaWeb3) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/solana-web3.js';
      s.onload = resolve; s.onerror = () => reject(new Error('solana web3 failed to load'));
      document.head.appendChild(s);
    });
  },

  // Sends the deposit prepared by the server from the linked wallet; returns the tx hash.
  async sendDeposit(family, linked, build) {
    const current = (await this.connect(family));
    const same = family === 'evm' ? current.toLowerCase() === linked.toLowerCase() : current === linked;
    if (!same) { const e = new Error('wallet_mismatch'); e.code = 'wallet_mismatch'; throw e; }
    const p = this.provider(family);
    if (build.kind === 'solana') {
      await this.loadSolanaWeb3();
      const bytes = Uint8Array.from(atob(build.tx), c => c.charCodeAt(0));
      const tx = window.solanaWeb3.Transaction.from(bytes);
      const { signature } = await p.signAndSendTransaction(tx);
      return signature;
    }
    if (build.kind === 'evm') {
      try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: build.chainId }] }); }
      catch (e) {
        if (e && (e.code === 4902 || (e.data && e.data.originalError && e.data.originalError.code === 4902))) {
          await p.request({ method: 'wallet_addEthereumChain', params: [build.chainParams] });
        } else throw e;
      }
      return p.request({ method: 'eth_sendTransaction', params: [build.tx] });
    }
    if (build.kind === 'tron') {
      const tw = this.tronWeb();
      if (!build.token) {
        const r = await tw.trx.sendTransaction(build.to, Number(build.amount));
        if (!r || r.result === false) throw new Error('TronLink: transaction refused');
        return r.txid || (r.transaction && r.transaction.txID);
      }
      const c = await tw.contract().at(build.token);
      return c.transfer(build.to, build.amount).send({ feeLimit: build.feeLimit });
    }
    throw new Error('unknown deposit');
  },
};

// ── Sign in / link with a wallet ─────────────────────────────────────────────
function waitFor(event, ms = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(event, h); reject(new Error('timeout')); }, ms);
    const h = data => { clearTimeout(timer); resolve(data); };
    socket.once(event, h);
  });
}
let walletBusy = false;
async function walletLogin(family) {
  if (walletBusy) return;
  if (!Wallets.available(family)) { Wallets.openApp(family); return; }
  walletBusy = true;
  try {
    const address = await Wallets.connect(family);
    const challenge = waitFor('siw:challenge');
    socket.emit('siw:nonce', { family, address });
    const { nonce, message } = await challenge;
    const signature = await Wallets.sign(family, address, message);
    socket.emit('siw:verify', { family, address, nonce, signature });
  } catch (e) {
    if (e && (e.code === 4001 || /reject|denied|cancel/i.test(e.message || ''))) notify(t('err.wallet_rejected'));
    else notify(t('err.wallet_error') + (e && e.message ? ' (' + e.message + ')' : ''));
  } finally { walletBusy = false; }
}

function shortAddr(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }

document.querySelectorAll('[data-wallet-login]').forEach(b => b.addEventListener('click', () => walletLogin(b.dataset.walletLogin)));
