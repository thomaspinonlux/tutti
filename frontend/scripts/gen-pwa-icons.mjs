#!/usr/bin/env node
/**
 * gen-pwa-icons.mjs — feat/pwa-installable
 *
 * Génère les icônes PWA à partir du monogram SVG existant
 * (public/logo-monogram-dark.svg). Sortie dans public/icons/.
 *
 * Variantes :
 *   - icon-192.png       : icône standard 192x192 (manifest)
 *   - icon-512.png       : icône standard 512x512 (manifest)
 *   - icon-maskable-512.png : icône maskable Android (safe-zone 40% centrée,
 *     padding 20% pour éviter clipping squircle/circle/teardrop)
 *   - apple-touch-icon-180.png : iOS home screen (déjà présent au même format,
 *     on régénère pour cohérence visuelle)
 *
 * Idempotent : run `node scripts/gen-pwa-icons.mjs` après modif du SVG.
 *
 * Le maskable utilise le même contenu mais composite sur un fond carré dark
 * (#1A1814) avec scale = 0.6 (60% du carré) pour respecter la safe-zone des
 * lanceurs Android.
 */
import sharp from 'sharp';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
const iconsDir = join(publicDir, 'icons');

await mkdir(iconsDir, { recursive: true });

const svgBuffer = await readFile(join(publicDir, 'logo-monogram-dark.svg'));

async function renderStandard(size, outName) {
  const out = join(iconsDir, outName);
  await sharp(svgBuffer, { density: 384 }).resize(size, size).png().toFile(out);
  console.log(`✓ ${outName} (${size}x${size})`);
}

async function renderMaskable(size, outName) {
  const out = join(iconsDir, outName);
  // Safe-zone Android : icône doit tenir dans cercle de rayon 0.4*size centré.
  // On rend le SVG à 60% du carré, sur fond dark #1A1814 (cohérent avec le
  // SVG monogram).
  const inner = Math.round(size * 0.6);
  const inset = Math.round((size - inner) / 2);
  const innerBuf = await sharp(svgBuffer, { density: 384 }).resize(inner, inner).png().toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0x1a, g: 0x18, b: 0x14, alpha: 1 },
    },
  })
    .composite([{ input: innerBuf, left: inset, top: inset }])
    .png()
    .toFile(out);
  console.log(`✓ ${outName} (${size}x${size}, maskable safe-zone 60%)`);
}

await renderStandard(192, 'icon-192.png');
await renderStandard(512, 'icon-512.png');
await renderMaskable(512, 'icon-maskable-512.png');
await renderStandard(180, 'apple-touch-icon-180.png');

console.log('\nPWA icons generated in public/icons/');
