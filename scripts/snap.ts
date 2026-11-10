import { gzipSync } from 'node:zlib';
import { createWorld, snapshot, step } from '../src/sim';
const w = createWorld(2026);
for (let i = 0; i < 7200; i++) step(w);
const s = snapshot(w);
console.log('snapshot', (s.length / 1024).toFixed(0), 'ko, gzip', (gzipSync(s).length / 1024).toFixed(0), 'ko');
const t = performance.now();
for (let i = 0; i < 7200; i++) step(w);
console.log('une journée (7200 ticks) :', (performance.now() - t).toFixed(0), 'ms');
