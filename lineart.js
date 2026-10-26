import {gridDimensions} from './core.js';
// Line-art extraction for the bead chart: grayscale -> Sobel edges -> binary
// lines -> optional dilation (thicken lines so they survive as beads).
// Output is RGBA: dark opaque pixels on lines, transparent elsewhere, so the
// result feeds the same pattern pipeline (empty cells stay empty beads).
export function extractLineArt(rgba, width, height, options={}) {
  gridDimensions(width, height, 1, false);
  if (rgba.length !== width * height * 4) throw Error('线稿像素长度不匹配');
  const threshold = Math.max(0, Math.min(1442, Number(options.threshold) || 0));
  const thickness = Math.max(0, Math.min(2, Math.round(Number(options.thickness) || 0)));
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    // Transparent pixels read as white, so a subject on transparency gets an outline.
    gray[i] = rgba[o + 3] < 128 ? 255 : rgba[o] * .299 + rgba[o + 1] * .587 + rgba[o + 2] * .114;
  }
  const mag = new Float32Array(width * height);
  const g = (x, y) => gray[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = -g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1) + g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1);
    const gy = -g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1) + g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1);
    mag[y * width + x] = Math.sqrt(gx * gx + gy * gy);
  }
  let line = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) line[i] = mag[i] > threshold ? 1 : 0;
  for (let t = 0; t < thickness; t++) {
    const next = new Uint8Array(line);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (line[y * width + x]) continue;
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && line[ny * width + nx]) { hit = true; break; }
      }
      if (hit) next[y * width + x] = 1;
    }
    line = next;
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  let lineCells = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (line[i]) { pixels[o] = 35; pixels[o + 1] = 30; pixels[o + 2] = 40; pixels[o + 3] = 255; lineCells++; }
  }
  return {pixels, lineCells, mask: line};
}
// Downsample a binary line mask to grid size with max-pooling: a grid cell
// is a line if ANY source pixel in its block is a line, so thin lines survive
// instead of being averaged away.
export function downsampleLineMask(mask, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH);
  let lineCells = 0;
  for (let y = 0; y < dstH; y++) for (let x = 0; x < dstW; x++) {
    const x0 = Math.floor(x * srcW / dstW), x1 = Math.max(x0 + 1, Math.floor((x + 1) * srcW / dstW));
    const y0 = Math.floor(y * srcH / dstH), y1 = Math.max(y0 + 1, Math.floor((y + 1) * srcH / dstH));
    let hit = 0;
    for (let yy = y0; yy < y1 && !hit; yy++) for (let xx = x0; xx < x1; xx++) {
      if (mask[yy * srcW + xx]) { hit = 1; break; }
    }
    out[y * dstW + x] = hit;
    if (hit) lineCells++;
  }
  const pixels = new Uint8ClampedArray(dstW * dstH * 4);
  for (let i = 0; i < dstW * dstH; i++) {
    const o = i * 4;
    if (out[i]) { pixels[o] = 35; pixels[o + 1] = 30; pixels[o + 2] = 40; pixels[o + 3] = 255; }
  }
  return {pixels, lineCells};
}
// Merge a grid line mask with a color pattern: black lines win, other cells
// keep their photo colors (shifted by one for the black entry), and colors
// left unused after the override are dropped so ids stay sequential.
export function mergeLineArtWithColors(grid, colorPattern) {
  if (!grid.lineCells) return {palette: colorPattern.palette, cells: colorPattern.cells, fillColors: colorPattern.palette.length};
  const black = {id: 'C01', rgb: [35, 30, 40], hex: '#231E28'};
  let palette = [black, ...colorPattern.palette.map(p => ({...p}))];
  let cells = colorPattern.cells.map((c, i) => grid.pixels[i * 4 + 3] >= 128 ? 0 : (c >= 0 ? c + 1 : -1));
  const used = [...new Set(cells.filter(c => c >= 0))].sort((a, b) => a - b);
  const remap = new Map(used.map((v, i) => [v, i]));
  palette = used.map((v, i) => ({...palette[v], id: `C${String(i + 1).padStart(2, '0')}`}));
  cells = cells.map(c => c < 0 ? -1 : remap.get(c));
  return {palette, cells, fillColors: palette.length - 1};
}
