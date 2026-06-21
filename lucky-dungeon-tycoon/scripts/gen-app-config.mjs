/**
 * gen-app-config.mjs — Writes dist-web/app-config.js from the LCT_API_BASE env.
 *
 * Cloud sync is opt-in. When LCT_API_BASE is set (even to "" for same origin),
 * the generated file enables it; otherwise it is a no-op comment and the game
 * stays offline-only. Run as the last step of build:web.
 */

import { writeFileSync } from 'node:fs';

const value = process.env.LCT_API_BASE;
const body =
  value === undefined
    ? '/* Cloud sync disabled. Set LCT_API_BASE (e.g. "" for same origin, or an\n' +
      '   absolute URL for mobile) and rebuild to enable — see server/README.md. */\n'
    : `window.LCT_API_BASE=${JSON.stringify(value)};\n`;

writeFileSync('dist-web/app-config.js', body);
console.log(
  '[build:web] app-config.js ' +
    (value === undefined ? '(cloud sync disabled)' : `(LCT_API_BASE=${JSON.stringify(value)})`),
);
