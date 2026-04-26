const SpatialHash = require('../server/spatialHash');

describe('SpatialHash', () => {
  test('finds inserted points within radius', () => {
    const g = new SpatialHash(50, 1000, 1000);
    g.insert(100, 100, 'a');
    g.insert(120, 110, 'b');
    g.insert(900, 900, 'far');
    const found = [...g.query(105, 105, 30)];
    expect(found).toContain('a');
    expect(found).toContain('b');
    expect(found).not.toContain('far');
  });

  test('clear empties the grid', () => {
    const g = new SpatialHash(10, 100, 100);
    g.insert(0, 0, 'x');
    g.clear();
    expect([...g.query(0, 0, 50)]).toHaveLength(0);
  });

  test('handles many points without crashing', () => {
    const g = new SpatialHash(64, 4000, 4000);
    for (let i = 0; i < 5000; i++) g.insert(Math.random()*4000, Math.random()*4000, i);
    const found = [...g.query(2000, 2000, 100)];
    // density ~5000/(4000^2) per px², expect roughly a couple hits in a 200²px box
    expect(found.length).toBeLessThan(200);
  });
});
