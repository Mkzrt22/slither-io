// Simple 2D spatial hash. World wraps; we just floor-divide and use modular indices.
// Used for collision broadphase: insert all snake segments, then query head positions.

class SpatialHash {
  constructor(cellSize, w, h) {
    this.cellSize = cellSize;
    this.w = w; this.h = h;
    this.cells = new Map();
  }

  _key(cx, cy) { return cx * 73856093 ^ cy * 19349663; }

  insert(x, y, payload) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const k = this._key(cx, cy);
    let arr = this.cells.get(k);
    if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push(payload);
  }

  // Yields payloads in cells overlapping the radius-search box around (x,y).
  *query(x, y, radius) {
    const r = Math.ceil(radius / this.cellSize);
    const cx0 = Math.floor(x / this.cellSize);
    const cy0 = Math.floor(y / this.cellSize);
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const arr = this.cells.get(this._key(cx0 + dx, cy0 + dy));
        if (!arr) continue;
        for (const p of arr) yield p;
      }
    }
  }

  clear() { this.cells.clear(); }
}

module.exports = SpatialHash;
