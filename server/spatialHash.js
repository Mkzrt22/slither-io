// Simple 2D spatial hash. World wraps; we just floor-divide and use modular indices.
// Used for collision broadphase: insert all snake segments, then query head positions.

class SpatialHash {
  constructor(cellSize, w, h) {
    this.cellSize = cellSize;
    this.w = w; this.h = h;
    this.cells = new Map();
  }

  // Szudzik pairing: a stable bijection from (cx, cy) ∈ ℤ² to ℤ with no
  // collisions. Avoids the false-positive collisions that bitwise XOR
  // produced when paired with multipliers — those would let segments of
  // two unrelated snakes share a bucket and cause phantom hits.
  _key(cx, cy) {
    const a = cx >= 0 ? cx * 2 : -cx * 2 - 1;
    const b = cy >= 0 ? cy * 2 : -cy * 2 - 1;
    return a >= b ? a * a + a + b : a + b * b;
  }

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
