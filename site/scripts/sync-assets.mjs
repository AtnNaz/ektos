import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const site = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(site, '..');

const copies = [
  ['assets/interface-difference.png', 'img/comparator-difference.png'],
  ['assets/vr-preview.png', 'img/vr-preview.png'],
  ['assets/wavelength-map.png', 'img/wavelength-map.png'],
  ['assets/wise0855-track.png', 'img/wise0855-track.png'],
  ['assets/wise0855-parallax.png', 'img/wise0855-parallax.png'],
  ['assets/smdet1-control.png', 'img/smdet1-control.png'],
  ['assets/blind-test.png', 'img/blind-test.png'],
  ['web/sky/spherex_dr1_rgb_icrs_2048.jpg', 'sky/spherex_dr1_rgb_icrs_2048.jpg'],
  ['assets/presentation.pdf', 'docs/Ektos-presentation.pdf'],
];
for (const f of readdirSync(join(repo, 'web/vendor'))) {
  if (f.startsWith('ibm-plex-sans-') && f.endsWith('.woff2')) copies.push([`web/vendor/${f}`, `fonts/${f}`]);
}
for (const [from, to] of copies) {
  const dest = join(site, 'public', to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(repo, from), dest);
}

const faces = readFileSync(join(repo, 'web/style.css'), 'utf8')
  .split('\n')
  .filter(line => line.startsWith('@font-face'))
  .map(line => line.replaceAll('url("vendor/', 'url("/fonts/'));
writeFileSync(join(site, 'app/fonts.generated.css'), `${faces.join('\n')}\n`);

const index = JSON.parse(readFileSync(join(repo, 'web/data/index.json'), 'utf8'));
const slugs = Object.keys(index);
writeFileSync(join(site, 'content/fields.generated.json'), JSON.stringify({
  total: slugs.length,
  coldDwarfs: slugs.filter(s => s.startsWith('y_')).length,
  named: slugs.filter(s => !s.startsWith('y_')).map(s => ({ slug: s, name: index[s].name, center: index[s].center })),
}, null, 1) + '\n');

console.log(`sync-assets: ${copies.length} files, ${faces.length} font faces, ${slugs.length} fields`);
