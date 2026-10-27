import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'src/test-site-reset/plugin/assets');
await mkdir(out, { recursive: true });
const colors = ['#416561', '#8d7057', '#566b80', '#7d667d', '#9b8457', '#526d8d'];
for (const [i, color] of colors.entries()) {
  const svg = `<svg width="1000" height="1000" xmlns="http://www.w3.org/2000/svg"><rect width="1000" height="1000" fill="#f3f1ed"/><ellipse cx="500" cy="828" rx="240" ry="34" fill="#ddd8ce"/><rect x="355" y="285" width="290" height="520" rx="58" fill="${color}"/><rect x="395" y="190" width="210" height="130" rx="20" fill="#242a2d"/><rect x="380" y="465" width="240" height="190" rx="12" fill="#faf8f3"/><text x="500" y="545" text-anchor="middle" fill="${color}" font-family="Arial" font-size="30">CLONEWP</text><text x="500" y="605" text-anchor="middle" fill="#777" font-family="Arial" font-size="23">TEST 0${i+1}</text></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(out, `product-${i+1}.png`));
}
console.log('Generated six neutral test-product images.');
