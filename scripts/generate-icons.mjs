import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

const rootDir = process.cwd();
const buildDir = path.join(rootDir, "build");
const iconsDir = path.join(buildDir, "icons");
const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

await mkdir(iconsDir, { recursive: true });

const pngBySize = new Map();
for (const size of sizes) {
  const png = encodePng(size, size, renderIcon(size));
  pngBySize.set(size, png);
  await writeFile(path.join(iconsDir, `${size}x${size}.png`), png);
}

await writeFile(path.join(buildDir, "icon.png"), pngBySize.get(512));
await writeFile(path.join(buildDir, "icon.ico"), encodeIco([16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngBySize.get(size) }))));
await writeFile(
  path.join(buildDir, "icon.icns"),
  encodeIcns([
    { type: "icp4", png: pngBySize.get(16) },
    { type: "icp5", png: pngBySize.get(32) },
    { type: "icp6", png: pngBySize.get(64) },
    { type: "ic07", png: pngBySize.get(128) },
    { type: "ic08", png: pngBySize.get(256) },
    { type: "ic09", png: pngBySize.get(512) },
    { type: "ic10", png: pngBySize.get(1024) }
  ])
);

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const radius = size * 0.21;
  const padding = size * 0.055;
  const rectSize = size - padding * 2;
  const center = size / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const alpha = roundedRectAlpha(x + 0.5, y + 0.5, padding, padding, rectSize, rectSize, radius);
      const t = (x + y) / (size * 2);
      const vignette = Math.min(1, Math.hypot(x - center, y - center) / (size * 0.72));
      const base = mixColor([19, 130, 120], [23, 43, 60], t * 0.72 + vignette * 0.28);
      const glow = Math.max(0, 1 - Math.hypot(x - size * 0.35, y - size * 0.28) / (size * 0.55));
      const color = mixColor(base, [80, 194, 169], glow * 0.32);
      setPixel(pixels, size, x, y, color[0], color[1], color[2], Math.round(alpha * 255));
    }
  }

  drawLine(pixels, size, size * 0.27, size * 0.63, size * 0.44, size * 0.47, size * 0.055, [245, 248, 250, 238]);
  drawLine(pixels, size, size * 0.44, size * 0.47, size * 0.64, size * 0.53, size * 0.055, [245, 248, 250, 238]);
  drawLine(pixels, size, size * 0.44, size * 0.47, size * 0.68, size * 0.30, size * 0.044, [240, 195, 107, 232]);
  drawLine(pixels, size, size * 0.64, size * 0.53, size * 0.77, size * 0.69, size * 0.044, [122, 167, 255, 232]);

  drawCircle(pixels, size, size * 0.27, size * 0.63, size * 0.082, [247, 250, 252, 255]);
  drawCircle(pixels, size, size * 0.44, size * 0.47, size * 0.09, [247, 250, 252, 255]);
  drawCircle(pixels, size, size * 0.64, size * 0.53, size * 0.082, [247, 250, 252, 255]);
  drawCircle(pixels, size, size * 0.68, size * 0.30, size * 0.072, [240, 195, 107, 255]);
  drawCircle(pixels, size, size * 0.77, size * 0.69, size * 0.072, [122, 167, 255, 255]);

  return pixels;
}

function roundedRectAlpha(px, py, x, y, width, height, radius) {
  const qx = Math.abs(px - x - width / 2) - width / 2 + radius;
  const qy = Math.abs(py - y - height / 2) - height / 2 + radius;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  const distance = outside + inside - radius;
  return clamp(0.5 - distance, 0, 1);
}

function drawLine(pixels, size, x1, y1, x2, y2, width, color) {
  const minX = Math.floor(Math.min(x1, x2) - width * 2);
  const maxX = Math.ceil(Math.max(x1, x2) + width * 2);
  const minY = Math.floor(Math.min(y1, y2) - width * 2);
  const maxY = Math.ceil(Math.max(y1, y2) + width * 2);
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) {
        continue;
      }

      const t = clamp(((x + 0.5 - x1) * dx + (y + 0.5 - y1) * dy) / lengthSq, 0, 1);
      const px = x1 + t * dx;
      const py = y1 + t * dy;
      const distance = Math.hypot(x + 0.5 - px, y + 0.5 - py);
      const alpha = clamp(width / 2 + 0.8 - distance, 0, 1);
      blendPixel(pixels, size, x, y, color[0], color[1], color[2], color[3] * alpha);
    }
  }
}

function drawCircle(pixels, size, cx, cy, radius, color) {
  const minX = Math.floor(cx - radius - 2);
  const maxX = Math.ceil(cx + radius + 2);
  const minY = Math.floor(cy - radius - 2);
  const maxY = Math.ceil(cy + radius + 2);

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (x < 0 || y < 0 || x >= size || y >= size) {
        continue;
      }

      const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      const alpha = clamp(radius + 0.8 - distance, 0, 1);
      blendPixel(pixels, size, x, y, color[0], color[1], color[2], color[3] * alpha);
    }
  }
}

function setPixel(pixels, size, x, y, r, g, b, a) {
  const offset = (y * size + x) * 4;
  pixels[offset] = r;
  pixels[offset + 1] = g;
  pixels[offset + 2] = b;
  pixels[offset + 3] = a;
}

function blendPixel(pixels, size, x, y, r, g, b, a) {
  const offset = (y * size + x) * 4;
  const sourceAlpha = clamp(a / 255, 0, 1);
  const targetAlpha = pixels[offset + 3] / 255;
  const outAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) {
    return;
  }

  pixels[offset] = Math.round((r * sourceAlpha + pixels[offset] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[offset + 1] = Math.round((g * sourceAlpha + pixels[offset + 1] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[offset + 2] = Math.round((b * sourceAlpha + pixels[offset + 2] * targetAlpha * (1 - sourceAlpha)) / outAlpha);
  pixels[offset + 3] = Math.round(outAlpha * 255);
}

function mixColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function encodePng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    scanlines[rowStart] = 0;
    rgba.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  const crc = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  const directory = Buffer.alloc(images.length * 16);
  let imageOffset = header.length + directory.length;
  for (const [index, image] of images.entries()) {
    const entryOffset = index * 16;
    directory[entryOffset] = image.size >= 256 ? 0 : image.size;
    directory[entryOffset + 1] = image.size >= 256 ? 0 : image.size;
    directory[entryOffset + 2] = 0;
    directory[entryOffset + 3] = 0;
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.png.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.png.length;
  }

  return Buffer.concat([header, directory, ...images.map((image) => image.png)]);
}

function encodeIcns(images) {
  const chunks = images.map((image) => {
    const header = Buffer.alloc(8);
    header.write(image.type, 0, 4, "ascii");
    header.writeUInt32BE(image.png.length + header.length, 4);
    return Buffer.concat([header, image.png]);
  });
  const header = Buffer.alloc(8);
  const totalLength = header.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(totalLength, 4);
  return Buffer.concat([header, ...chunks]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
