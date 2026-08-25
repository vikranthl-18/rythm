// ---------------------------------------------------------------------------
// rythm — app icon generator (dependency-free)
//
// Draws the rythm mark (cream field + sage dot + brick "◢" triangle) and
// writes public/icon-192.png, public/icon-512.png and public/icon.svg.
//
//   node scripts/gen-icons.mjs
//
// PNG encoding uses only node:zlib (deflate) + a hand-rolled CRC32 — no
// packages required. Run from the repo root.
// ---------------------------------------------------------------------------

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public");
mkdirSync(outDir, { recursive: true });

// ---- palette (matches the app) -------------------------------------------
const CREAM = [241, 222, 196, 255]; // #F1DEC4
const BRICK = [189, 68, 68, 255]; // #BD4444
const SAGE = [115, 151, 106, 255]; // #73976A

// ---- minimal PNG encoder ---------------------------------------------------
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- drawing ----------------------------------------------------------------
// Returns [r,g,b,a] at normalized (u,v) in [0,1].
function pixel(u, v) {
  // sage dot (upper-left)
  const dx = u - 0.3;
  const dy = v - 0.3;
  if (dx * dx + dy * dy <= 0.16 * 0.16) return SAGE;
  // brick "◢" triangle: right angle at top-right, hypotenuse from top-left
  // to bottom-right — the region below the diagonal v = u, inset by 4%.
  if (u >= 0.04 && v >= 0.04 && v <= u - 0.04) return BRICK;
  return CREAM;
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size);
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

// ---- svg version (same geometry) --------------------------------------------
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#F1DEC4"/>
  <circle cx="154" cy="154" r="82" fill="#73976A"/>
  <path d="M41 41h430v430z" fill="#BD4444"/>
</svg>`;

writeFileSync(join(outDir, "icon.svg"), svg);
writeFileSync(join(outDir, "icon-192.png"), png(192, render(192)));
writeFileSync(join(outDir, "icon-512.png"), png(512, render(512)));
console.log("wrote public/icon.svg, public/icon-192.png, public/icon-512.png");
