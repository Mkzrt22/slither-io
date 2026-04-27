#!/usr/bin/env node
// Atomically snapshots data.db into backups/data-YYYYMMDD-HHMMSS.db.
// Uses better-sqlite3's online backup so it works while the server is running.
// Old backups beyond BACKUP_KEEP (default 14) are pruned.

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const DB_PATH = path.join(DATA_DIR, 'data.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP = parseInt(process.env.BACKUP_KEEP || '14', 10);

if (!fs.existsSync(DB_PATH)) {
  console.error('No data.db found at', DB_PATH);
  process.exit(1);
}
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const stamp = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+/, '');
const target = path.join(BACKUP_DIR, `data-${stamp}.db`);

let Database;
try { Database = require('better-sqlite3'); }
catch (e) {
  console.warn('better-sqlite3 not available; falling back to plain copy.');
  fs.copyFileSync(DB_PATH, target);
  console.log('Backup written to', target);
  return;
}

(async () => {
  const db = new Database(DB_PATH, { readonly: true });
  await db.backup(target);
  db.close();
  console.log('Backup written to', target);

  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('data-') && f.endsWith('.db'))
    .sort();
  if (files.length > KEEP) {
    for (const f of files.slice(0, files.length - KEEP)) {
      fs.unlinkSync(path.join(BACKUP_DIR, f));
      console.log('Pruned old backup', f);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
