// Récupère les polices de la bibliothèque interne (§5.5, licence OFL) depuis les paquets
// @fontsource du registre npm et les copie dans assets/fonts, avec un manifeste lu par le
// moteur de rendu. Les fichiers sont versionnés : le rendu ne dépend d'aucun réseau.
//
// Usage : node scripts/fetch-fonts.mjs
// Pour ajouter une police : compléter FONTS (même identifiant que le front), relancer.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const FONTSOURCE_VERSION = '5.3.0';
const SUBSETS = ['latin', 'latin-ext'];

/** Même catalogue que le front (src/lib/render/fonts.ts). */
const FONTS = [
  { id: 'montserrat', pkg: 'montserrat', name: 'Montserrat', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'poppins', pkg: 'poppins', name: 'Poppins', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'space-grotesk', pkg: 'space-grotesk', name: 'Space Grotesk', category: 'sans', weights: [400, 600, 700] },
  { id: 'nunito', pkg: 'nunito', name: 'Nunito', category: 'sans', weights: [400, 700, 800] },
  { id: 'raleway', pkg: 'raleway', name: 'Raleway', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'oswald', pkg: 'oswald', name: 'Oswald', category: 'display', weights: [400, 600, 700] },
  { id: 'bebas-neue', pkg: 'bebas-neue', name: 'Bebas Neue', category: 'display', weights: [400] },
  { id: 'playfair', pkg: 'playfair-display', name: 'Playfair Display', category: 'serif', weights: [400, 600, 700, 800] },
  { id: 'lora', pkg: 'lora', name: 'Lora', category: 'serif', weights: [400, 600, 700] },
  { id: 'merriweather', pkg: 'merriweather', name: 'Merriweather', category: 'serif', weights: [400, 700, 900] },
  { id: 'great-vibes', pkg: 'great-vibes', name: 'Great Vibes', category: 'script', weights: [400] },
  { id: 'dancing-script', pkg: 'dancing-script', name: 'Dancing Script', category: 'script', weights: [400, 700] },
  { id: 'allura', pkg: 'allura', name: 'Allura', category: 'script', weights: [400] },
  { id: 'satisfy', pkg: 'satisfy', name: 'Satisfy', category: 'script', weights: [400] },
  { id: 'sacramento', pkg: 'sacramento', name: 'Sacramento', category: 'script', weights: [400] },
];

const out = resolve(import.meta.dirname, '..', 'assets', 'fonts');
mkdirSync(out, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'fonts-'));

const manifest = [];
try {
  for (const font of FONTS) {
    const spec = `@fontsource/${font.pkg}@${FONTSOURCE_VERSION}`;
    const tarball = execFileSync('npm', ['pack', spec, '--silent', '--pack-destination', tmp], { encoding: 'utf8' }).trim();
    const dir = join(tmp, font.pkg);
    mkdirSync(dir);
    execFileSync('tar', ['xzf', join(tmp, tarball), '-C', dir]);

    const files = {};
    for (const weight of font.weights) {
      files[weight] = [];
      for (const subset of SUBSETS) {
        const name = `${font.pkg}-${subset}-${weight}-normal.woff`;
        const source = join(dir, 'package', 'files', name);
        if (!existsSync(source)) continue;
        copyFileSync(source, join(out, name));
        files[weight].push(name);
      }
      if (files[weight].length === 0) throw new Error(`${spec} : graisse ${weight} introuvable`);
    }
    const { pkg: _pkg, ...meta } = font;
    manifest.push({ ...meta, license: 'OFL', source: spec, files });
    console.log(`${font.name} : ${Object.values(files).flat().length} fichiers`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Manifeste écrit dans ${join(out, 'manifest.json')}`);
