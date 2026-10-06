import { LAND_PATH } from '/Users/mboeira@seatgeek.com/Development/marcelobeira/awesome-expat/src/lib/land.ts';
import { CENTROIDS } from '../../src/lib/centroids.ts';
import { readdirSync } from 'node:fs';

const rings: [number, number][][] = LAND_PATH.split('M').slice(1)
  .map((s) => s.replace('Z', '').split('L').map((p) => p.trim().split(' ').map(Number) as [number, number]))
  .filter((r) => r.length > 2);
const inLand = (x: number, y: number): boolean => {
  let inside = false;
  for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
    const [xi, yi] = r[a]!, [xj, yj] = r[b]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

const W = 960, H = 500, T = 84, B = -60;
const proj = (lat: number, lng: number): [number, number] => [((lng + 180) / 360) * W, ((T - lat) / (T - B)) * H];
const CODES = readdirSync('content/countries')
  .map((f) => f.replace(/\.yaml$/, '')).filter((c) => c !== 'global');

const COLS = 118, ROWS = 30;
const grid: string[][] = Array.from({ length: ROWS }, () => Array(COLS).fill(' '));
for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
  const x = ((c + 0.5) / COLS) * W, y = ((r + 0.5) / ROWS) * H;
  grid[r]![c] = inLand(x, y) ? '.' : ' ';
}
// Overlay the dots so land-vs-dot placement is visible together.
for (const code of CODES) {
  const k = CENTROIDS[code]; if (!k) continue;
  const [x, y] = proj(k.lat, k.lng);
  const c = Math.floor((x / W) * COLS), r = Math.floor((y / H) * ROWS);
  if (r >= 0 && r < ROWS && c >= 0 && c < COLS) grid[r]![c] = '@';
}
console.log(grid.map((r) => r.join('')).join('\n'));
