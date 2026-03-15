# 🐍 Slither.io Clone — Multiplayer

A real-time multiplayer snake game built with Node.js, Socket.io and Canvas.

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
npm start
```

### 3. Open in browser
Go to → **http://localhost:3000**

To test multiplayer: open the same URL in multiple browser tabs or share your local IP (`http://YOUR_IP:3000`) with others on the same network.

---

## How to Play

| Control | Action |
|---|---|
| **Move mouse** | Steer your snake |
| **Hold left click** | Boost (uses your tail) |

- **Eat glowing pellets** to grow and increase your score
- **Kill other snakes** by making them crash into your body
- **Avoid** running into other snakes' bodies (you'll die!)
- Dead snakes burst into food — be there to collect it

---

## Project Structure

```
slither-game/
├── server.js         ← Game server (Node.js + Socket.io)
├── package.json
└── public/
    └── index.html    ← Game client (HTML5 Canvas)
```

## Features

- ⚡ 25 TPS server-side game loop
- 🌍 4000×4000 world with wrapping
- 🚀 Boost mechanic (shrinks your tail)
- 🍎 500 food pellets + burst food on death
- 🏆 Live leaderboard
- 🗺️ Minimap
- 💥 Kill detection & death screen
- 🎨 Colorful neon aesthetic

## Dev Mode (auto-restart)
```bash
npm run dev
```
Requires `nodemon` (included in devDependencies).
