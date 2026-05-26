import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';

const root = process.cwd();
const buildDir = path.join(root, 'build');
const jpgPath = path.join(root, '123.jpg');
const svgPath = path.join(buildDir, 'icon.svg');
const pngPath = path.join(buildDir, 'icon.png');
const icoPath = path.join(buildDir, 'icon.ico');

await fs.mkdir(buildDir, { recursive: true });

let sourcePath = jpgPath;
try {
  await fs.access(sourcePath);
} catch {
  sourcePath = svgPath;
}

await sharp(sourcePath).resize(512, 512, { fit: 'cover' }).png().toFile(pngPath);

const icoBuffer = await pngToIco(pngPath);
await fs.writeFile(icoPath, icoBuffer);

console.log(`Generated build/icon.png and build/icon.ico from ${path.relative(root, sourcePath)}`);
