/**
 * ============================================================
 * File: scripts/make-icon.js
 * Module: Winstore Desktop
 *
 * Generates a placeholder app icon at build/icon.png (1024×1024) — a Winstore-
 * teal tile with a white "W". electron-builder derives the Windows .ico and
 * macOS .icns from this single PNG at build time.
 *
 * Replace build/icon.png with your real 1024×1024 logo when you have one (same
 * path), or tweak the colors/mark here and rerun: `npm run make-icon`.
 * ============================================================
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const SIZE = 1024;
const TEAL = [15, 111, 99]; // #0f6f63
const WHITE = [255, 255, 255];

const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();
const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
};

// Distance from a point to a line segment (for drawing the "W" strokes).
const distToSegment = (px, py, x1, y1, x2, y2) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

const w = SIZE * 0.52;
const x0 = SIZE * 0.24;
const top = SIZE * 0.32;
const bottom = SIZE * 0.7;
const mid = SIZE * 0.52;
const pts = [
    [x0, top],
    [x0 + w * 0.28, bottom],
    [x0 + w * 0.5, mid],
    [x0 + w * 0.72, bottom],
    [x0 + w, top],
];
const segments = [[0, 1], [1, 2], [2, 3], [3, 4]];
const thickness = SIZE * 0.055;

const rgba = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
        let onStroke = false;
        for (const [a, b] of segments) {
            if (distToSegment(x + 0.5, y + 0.5, pts[a][0], pts[a][1], pts[b][0], pts[b][1]) <= thickness) {
                onStroke = true;
                break;
            }
        }
        const [r, g, bl] = onStroke ? WHITE : TEAL;
        const i = (y * SIZE + x) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = bl;
        rgba[i + 3] = 255;
    }
}

// PNG scanlines: a filter byte (0 = none) before each row of RGBA.
const stride = SIZE * 4 + 1;
const raw = Buffer.alloc(SIZE * stride);
for (let y = 0; y < SIZE; y++) {
    rgba.copy(raw, y * stride + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type: RGBA
const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
]);

const out = path.join(__dirname, "..", "build", "icon.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
// eslint-disable-next-line no-console
console.log(`Wrote ${out} (${png.length} bytes, ${SIZE}x${SIZE}).`);
