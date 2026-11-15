import * as E from './engine.js';
import * as X from './experiment.js';

let pkg = null, pkgId = null;
self.onmessage = ({ data: m }) => {
  try {
    if (m.pkg) { pkg = { man: m.pkg.man, cube: new Float32Array(m.pkg.cube), N: m.pkg.man.native.n, cache: new Map() }; pkgId = m.pkgId; }
    if (!pkg || pkgId !== m.pkgId) throw new Error('worker: package not loaded');
    const grid = E.makeGrid(m.grid.n, m.grid.scale);
    const out = m.job === 'limit' ? X.limit(pkg, grid, m.va, m.vb, m.lam, m.opts) : X.machine(pkg, grid, m.va, m.vb, m.lam, m.opts);
    self.postMessage({ id: m.id, ok: true, out });
  } catch (err) {
    self.postMessage({ id: m.id, ok: false, msg: String((err && err.message) || err) });
  }
};
