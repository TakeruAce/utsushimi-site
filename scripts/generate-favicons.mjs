import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// The header uses a CSS alpha mask. Favicons need their own baked-in colors
// and a square canvas, with the original mark's proportions preserved.
const theme = await readFile(new URL('../src/styles/site-settings.css', import.meta.url), 'utf8');
const color = (name) => {
  const value = theme.match(new RegExp(`--color-${name}:\\s*(#[\\da-f]{6})`, 'i'))?.[1];
  if (!value) throw new Error(`Missing theme color: ${name}`);
  return value;
};
const brand = color('brand');
const background = color('ivory');
const output = (name) => new URL(`../public/${name}`, import.meta.url);
const { data, info } = await sharp(fileURLToPath(new URL('../public/images/utsushimi-logo-c-mask-20261009.png', import.meta.url)))
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const rgb = brand.slice(1).match(/../g).map((hex) => parseInt(hex, 16));
let left = info.width, top = info.height, right = -1, bottom = -1;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const offset = (y * info.width + x) * 4;
    if (data[offset + 3] > 10) {
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    data[offset] = rgb[0]; data[offset + 1] = rgb[1]; data[offset + 2] = rgb[2];
  }
}
if (right < left) throw new Error('Logo mask is empty');
const mark = await sharp(data, { raw: info })
  .extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png().toBuffer();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="10" fill="${background}"/><image x="6" y="6" width="52" height="52" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,${mark.toString('base64')}"/></svg>\n`;
await writeFile(output('favicon.svg'), svg);
const render = (size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
for (const size of [16, 32, 48]) await writeFile(output(`favicon-${size}.png`), await render(size));
// Apple applies its own corner mask; give it an opaque square background.
await writeFile(output('apple-touch-icon.png'), await sharp(await render(180)).flatten({ background }).png().toBuffer());
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(render));
const header = Buffer.alloc(6 + sizes.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index]; header[entry + 1] = sizes[index];
  header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8); header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});
await writeFile(output('favicon.ico'), Buffer.concat([header, ...frames]));
console.log(`Generated square favicons: ${brand} on ${background}`);
