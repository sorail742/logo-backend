// Récupère les polices de la bibliothèque interne (§5.5, licence OFL) depuis les paquets
// @fontsource du registre npm et les copie dans assets/fonts, avec un manifeste lu par le
// moteur de rendu. Les fichiers sont versionnés : le rendu ne dépend d'aucun réseau.
//
// Usage : node scripts/fetch-fonts.mjs [identifiant…]
// Pour ajouter une police : compléter FONTS (même identifiant que le front), relancer avec son
// identifiant (les autres polices du manifeste sont conservées telles quelles).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import opentype from 'opentype.js';

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
  // Studio de création : bibliothèque élargie
  { id: 'inter', pkg: 'inter', name: 'Inter', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'dm-sans', pkg: 'dm-sans', name: 'DM Sans', category: 'sans', weights: [400, 700] },
  { id: 'work-sans', pkg: 'work-sans', name: 'Work Sans', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'rubik', pkg: 'rubik', name: 'Rubik', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'manrope', pkg: 'manrope', name: 'Manrope', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'outfit', pkg: 'outfit', name: 'Outfit', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'plus-jakarta-sans', pkg: 'plus-jakarta-sans', name: 'Plus Jakarta Sans', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'archivo', pkg: 'archivo', name: 'Archivo', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'josefin-sans', pkg: 'josefin-sans', name: 'Josefin Sans', category: 'sans', weights: [400, 600, 700] },
  { id: 'quicksand', pkg: 'quicksand', name: 'Quicksand', category: 'sans', weights: [400, 600, 700] },
  { id: 'comfortaa', pkg: 'comfortaa', name: 'Comfortaa', category: 'sans', weights: [400, 700] },
  { id: 'ubuntu', pkg: 'ubuntu', name: 'Ubuntu', category: 'sans', weights: [400, 700] },
  { id: 'barlow-condensed', pkg: 'barlow-condensed', name: 'Barlow Condensed', category: 'display', weights: [400, 600, 700] },
  { id: 'anton', pkg: 'anton', name: 'Anton', category: 'display', weights: [400] },
  { id: 'archivo-black', pkg: 'archivo-black', name: 'Archivo Black', category: 'display', weights: [400] },
  { id: 'righteous', pkg: 'righteous', name: 'Righteous', category: 'display', weights: [400] },
  { id: 'abril-fatface', pkg: 'abril-fatface', name: 'Abril Fatface', category: 'display', weights: [400] },
  { id: 'syne', pkg: 'syne', name: 'Syne', category: 'display', weights: [400, 600, 700, 800] },
  { id: 'unbounded', pkg: 'unbounded', name: 'Unbounded', category: 'display', weights: [400, 600, 700, 800] },
  { id: 'bricolage-grotesque', pkg: 'bricolage-grotesque', name: 'Bricolage Grotesque', category: 'display', weights: [400, 600, 700, 800] },
  { id: 'teko', pkg: 'teko', name: 'Teko', category: 'display', weights: [400, 600, 700] },
  { id: 'alfa-slab-one', pkg: 'alfa-slab-one', name: 'Alfa Slab One', category: 'display', weights: [400] },
  { id: 'lobster', pkg: 'lobster', name: 'Lobster', category: 'display', weights: [400] },
  { id: 'dm-serif-display', pkg: 'dm-serif-display', name: 'DM Serif Display', category: 'serif', weights: [400] },
  { id: 'fraunces', pkg: 'fraunces', name: 'Fraunces', category: 'serif', weights: [400, 600, 700, 800] },
  { id: 'cormorant-garamond', pkg: 'cormorant-garamond', name: 'Cormorant Garamond', category: 'serif', weights: [400, 600, 700] },
  { id: 'libre-baskerville', pkg: 'libre-baskerville', name: 'Libre Baskerville', category: 'serif', weights: [400, 700] },
  { id: 'roboto-slab', pkg: 'roboto-slab', name: 'Roboto Slab', category: 'serif', weights: [400, 600, 700, 800] },
  { id: 'pacifico', pkg: 'pacifico', name: 'Pacifico', category: 'script', weights: [400] },
  { id: 'caveat', pkg: 'caveat', name: 'Caveat', category: 'script', weights: [400, 700] },
  { id: 'permanent-marker', pkg: 'permanent-marker', name: 'Permanent Marker', category: 'script', weights: [400] },
  { id: 'kaushan-script', pkg: 'kaushan-script', name: 'Kaushan Script', category: 'script', weights: [400] },
  // Maillots et sport : numéros et noms de joueurs (collège, condensées, liseré, pochoir, relief).
  { id: 'graduate', pkg: 'graduate', name: 'Graduate', category: 'sport', weights: [400] },
  { id: 'big-shoulders', pkg: 'big-shoulders-display', name: 'Big Shoulders', category: 'sport', weights: [400, 700, 900] },
  { id: 'big-shoulders-inline', pkg: 'big-shoulders-inline-display', name: 'Big Shoulders Inline', category: 'sport', weights: [700, 900] },
  { id: 'big-shoulders-stencil', pkg: 'big-shoulders-stencil-display', name: 'Big Shoulders Stencil', category: 'sport', weights: [700, 900] },
  { id: 'bungee', pkg: 'bungee', name: 'Bungee', category: 'sport', weights: [400] },
  { id: 'bungee-inline', pkg: 'bungee-inline', name: 'Bungee Inline', category: 'sport', weights: [400] },
  { id: 'bungee-shade', pkg: 'bungee-shade', name: 'Bungee Shade', category: 'sport', weights: [400] },
  { id: 'russo-one', pkg: 'russo-one', name: 'Russo One', category: 'sport', weights: [400] },
  { id: 'squada-one', pkg: 'squada-one', name: 'Squada One', category: 'sport', weights: [400] },
  { id: 'staatliches', pkg: 'staatliches', name: 'Staatliches', category: 'sport', weights: [400] },
  { id: 'saira-condensed', pkg: 'saira-condensed', name: 'Saira Condensed', category: 'sport', weights: [500, 700, 900] },
  { id: 'saira-extra-condensed', pkg: 'saira-extra-condensed', name: 'Saira Extra Condensed', category: 'sport', weights: [500, 700, 900] },
  { id: 'saira-stencil', pkg: 'saira-stencil-one', name: 'Saira Stencil One', category: 'sport', weights: [400] },
  { id: 'chakra-petch', pkg: 'chakra-petch', name: 'Chakra Petch', category: 'sport', weights: [500, 700] },
  { id: 'black-ops-one', pkg: 'black-ops-one', name: 'Black Ops One', category: 'sport', weights: [400] },
  { id: 'racing-sans-one', pkg: 'racing-sans-one', name: 'Racing Sans One', category: 'sport', weights: [400] },
  { id: 'orbitron', pkg: 'orbitron', name: 'Orbitron', category: 'sport', weights: [500, 700, 900] },
  { id: 'audiowide', pkg: 'audiowide', name: 'Audiowide', category: 'sport', weights: [400] },
  { id: 'kanit', pkg: 'kanit', name: 'Kanit', category: 'sport', weights: [500, 700, 900] },
  { id: 'rajdhani', pkg: 'rajdhani', name: 'Rajdhani', category: 'sport', weights: [500, 700] },
  { id: 'exo-2', pkg: 'exo-2', name: 'Exo 2', category: 'sport', weights: [500, 700, 900] },
  { id: 'changa-one', pkg: 'changa-one', name: 'Changa One', category: 'sport', weights: [400] },
  { id: 'bowlby-one-sc', pkg: 'bowlby-one-sc', name: 'Bowlby One SC', category: 'sport', weights: [400] },
  { id: 'holtwood-one-sc', pkg: 'holtwood-one-sc', name: 'Holtwood One SC', category: 'sport', weights: [400] },
  { id: 'monoton', pkg: 'monoton', name: 'Monoton', category: 'sport', weights: [400] },
  { id: 'tourney', pkg: 'tourney', name: 'Tourney', category: 'sport', weights: [600, 800] },
  { id: 'goldman', pkg: 'goldman', name: 'Goldman', category: 'sport', weights: [400, 700] },
  { id: 'zen-dots', pkg: 'zen-dots', name: 'Zen Dots', category: 'sport', weights: [400] },
  { id: 'michroma', pkg: 'michroma', name: 'Michroma', category: 'sport', weights: [400] },
  { id: 'anta', pkg: 'anta', name: 'Anta', category: 'sport', weights: [400] },
  { id: 'oxanium', pkg: 'oxanium', name: 'Oxanium', category: 'sport', weights: [500, 700, 800] },
  { id: 'tektur', pkg: 'tektur', name: 'Tektur', category: 'sport', weights: [500, 700, 900] },
  { id: 'bevan', pkg: 'bevan', name: 'Bevan', category: 'sport', weights: [400] },
  { id: 'sarpanch', pkg: 'sarpanch', name: 'Sarpanch', category: 'sport', weights: [500, 700, 900] },
  { id: 'jockey-one', pkg: 'jockey-one', name: 'Jockey One', category: 'sport', weights: [400] },
  { id: 'passion-one', pkg: 'passion-one', name: 'Passion One', category: 'sport', weights: [400, 700, 900] },
  { id: 'fugaz-one', pkg: 'fugaz-one', name: 'Fugaz One', category: 'sport', weights: [400] },
  { id: 'days-one', pkg: 'days-one', name: 'Days One', category: 'sport', weights: [400] },
  // Les plus utilisées au monde (vues Google Fonts), fêtes et événements, manuscrites.
  { id: 'roboto', pkg: 'roboto', name: 'Roboto', category: 'sans', weights: [400, 500, 700, 900] },
  { id: 'open-sans', pkg: 'open-sans', name: 'Open Sans', category: 'sans', weights: [400, 600, 700, 800] },
  { id: 'lato', pkg: 'lato', name: 'Lato', category: 'sans', weights: [400, 700, 900] },
  { id: 'roboto-condensed', pkg: 'roboto-condensed', name: 'Roboto Condensed', category: 'sans', weights: [400, 700] },
  { id: 'noto-sans', pkg: 'noto-sans', name: 'Noto Sans', category: 'sans', weights: [400, 700] },
  { id: 'source-sans-3', pkg: 'source-sans-3', name: 'Source Sans 3', category: 'sans', weights: [400, 600, 700] },
  { id: 'nunito-sans', pkg: 'nunito-sans', name: 'Nunito Sans', category: 'sans', weights: [400, 700, 900] },
  { id: 'pt-sans', pkg: 'pt-sans', name: 'PT Sans', category: 'sans', weights: [400, 700] },
  { id: 'mukta', pkg: 'mukta', name: 'Mukta', category: 'sans', weights: [400, 700] },
  { id: 'fira-sans', pkg: 'fira-sans', name: 'Fira Sans', category: 'sans', weights: [400, 600, 800] },
  { id: 'barlow', pkg: 'barlow', name: 'Barlow', category: 'sans', weights: [400, 600, 800] },
  { id: 'titillium-web', pkg: 'titillium-web', name: 'Titillium Web', category: 'sans', weights: [400, 600, 700] },
  { id: 'heebo', pkg: 'heebo', name: 'Heebo', category: 'sans', weights: [400, 700, 900] },
  { id: 'ibm-plex-sans', pkg: 'ibm-plex-sans', name: 'IBM Plex Sans', category: 'sans', weights: [400, 600, 700] },
  { id: 'karla', pkg: 'karla', name: 'Karla', category: 'sans', weights: [400, 700] },
  { id: 'libre-franklin', pkg: 'libre-franklin', name: 'Libre Franklin', category: 'sans', weights: [400, 700, 900] },
  { id: 'mulish', pkg: 'mulish', name: 'Mulish', category: 'sans', weights: [400, 700, 900] },
  { id: 'hind', pkg: 'hind', name: 'Hind', category: 'sans', weights: [400, 600, 700] },
  { id: 'arimo', pkg: 'arimo', name: 'Arimo', category: 'sans', weights: [400, 700] },
  { id: 'dosis', pkg: 'dosis', name: 'Dosis', category: 'sans', weights: [400, 700] },
  { id: 'cabin', pkg: 'cabin', name: 'Cabin', category: 'sans', weights: [400, 700] },
  { id: 'oxygen', pkg: 'oxygen', name: 'Oxygen', category: 'sans', weights: [400, 700] },
  { id: 'lexend', pkg: 'lexend', name: 'Lexend', category: 'sans', weights: [400, 700] },
  { id: 'abel', pkg: 'abel', name: 'Abel', category: 'sans', weights: [400] },
  { id: 'cairo', pkg: 'cairo', name: 'Cairo', category: 'sans', weights: [400, 700] },
  { id: 'fjalla-one', pkg: 'fjalla-one', name: 'Fjalla One', category: 'display', weights: [400] },
  { id: 'signika', pkg: 'signika', name: 'Signika', category: 'sans', weights: [400, 700] },
  { id: 'prompt', pkg: 'prompt', name: 'Prompt', category: 'sans', weights: [400, 700] },
  { id: 'varela-round', pkg: 'varela-round', name: 'Varela Round', category: 'sans', weights: [400] },
  { id: 'overpass', pkg: 'overpass', name: 'Overpass', category: 'sans', weights: [400, 800] },
  { id: 'asap', pkg: 'asap', name: 'Asap', category: 'sans', weights: [400, 700] },
  { id: 'maven-pro', pkg: 'maven-pro', name: 'Maven Pro', category: 'sans', weights: [400, 700] },
  { id: 'questrial', pkg: 'questrial', name: 'Questrial', category: 'sans', weights: [400] },
  { id: 'sora', pkg: 'sora', name: 'Sora', category: 'sans', weights: [400, 700] },
  { id: 'figtree', pkg: 'figtree', name: 'Figtree', category: 'sans', weights: [400, 700, 900] },
  { id: 'urbanist', pkg: 'urbanist', name: 'Urbanist', category: 'sans', weights: [400, 700, 900] },
  { id: 'jost', pkg: 'jost', name: 'Jost', category: 'sans', weights: [400, 700] },
  { id: 'red-hat-display', pkg: 'red-hat-display', name: 'Red Hat Display', category: 'sans', weights: [400, 700, 900] },
  { id: 'archivo-narrow', pkg: 'archivo-narrow', name: 'Archivo Narrow', category: 'sans', weights: [400, 700] },
  { id: 'pt-sans-narrow', pkg: 'pt-sans-narrow', name: 'PT Sans Narrow', category: 'sans', weights: [400, 700] },
  { id: 'public-sans', pkg: 'public-sans', name: 'Public Sans', category: 'sans', weights: [400, 700] },
  { id: 'noto-serif', pkg: 'noto-serif', name: 'Noto Serif', category: 'serif', weights: [400, 700] },
  { id: 'pt-serif', pkg: 'pt-serif', name: 'PT Serif', category: 'serif', weights: [400, 700] },
  { id: 'eb-garamond', pkg: 'eb-garamond', name: 'EB Garamond', category: 'serif', weights: [400, 700] },
  { id: 'crimson-text', pkg: 'crimson-text', name: 'Crimson Text', category: 'serif', weights: [400, 700] },
  { id: 'bitter', pkg: 'bitter', name: 'Bitter', category: 'serif', weights: [400, 700] },
  { id: 'zilla-slab', pkg: 'zilla-slab', name: 'Zilla Slab', category: 'serif', weights: [400, 700] },
  { id: 'alegreya', pkg: 'alegreya', name: 'Alegreya', category: 'serif', weights: [400, 700] },
  { id: 'cinzel', pkg: 'cinzel', name: 'Cinzel', category: 'serif', weights: [400, 700, 900] },
  { id: 'arvo', pkg: 'arvo', name: 'Arvo', category: 'serif', weights: [400, 700] },
  { id: 'domine', pkg: 'domine', name: 'Domine', category: 'serif', weights: [400, 700] },
  { id: 'patua-one', pkg: 'patua-one', name: 'Patua One', category: 'serif', weights: [400] },
  { id: 'courier-prime', pkg: 'courier-prime', name: 'Courier Prime', category: 'serif', weights: [400, 700] },
  { id: 'bangers', pkg: 'bangers', name: 'Bangers', category: 'festive', weights: [400] },
  { id: 'fredoka', pkg: 'fredoka', name: 'Fredoka', category: 'festive', weights: [400, 600, 700] },
  { id: 'lilita-one', pkg: 'lilita-one', name: 'Lilita One', category: 'festive', weights: [400] },
  { id: 'carter-one', pkg: 'carter-one', name: 'Carter One', category: 'festive', weights: [400] },
  { id: 'concert-one', pkg: 'concert-one', name: 'Concert One', category: 'festive', weights: [400] },
  { id: 'paytone-one', pkg: 'paytone-one', name: 'Paytone One', category: 'festive', weights: [400] },
  { id: 'bubblegum-sans', pkg: 'bubblegum-sans', name: 'Bubblegum Sans', category: 'festive', weights: [400] },
  { id: 'henny-penny', pkg: 'henny-penny', name: 'Henny Penny', category: 'festive', weights: [400] },
  { id: 'emilys-candy', pkg: 'emilys-candy', name: 'Emilys Candy', category: 'festive', weights: [400] },
  { id: 'press-start-2p', pkg: 'press-start-2p', name: 'Press Start 2P', category: 'festive', weights: [400] },
  { id: 'baloo-2', pkg: 'baloo-2', name: 'Baloo 2', category: 'festive', weights: [400, 700, 800] },
  { id: 'lobster-two', pkg: 'lobster-two', name: 'Lobster Two', category: 'festive', weights: [400, 700] },
  { id: 'rye', pkg: 'rye', name: 'Rye', category: 'festive', weights: [400] },
  { id: 'cinzel-decorative', pkg: 'cinzel-decorative', name: 'Cinzel Decorative', category: 'festive', weights: [400, 700, 900] },
  { id: 'creepster', pkg: 'creepster', name: 'Creepster', category: 'festive', weights: [400] },
  { id: 'titan-one', pkg: 'titan-one', name: 'Titan One', category: 'festive', weights: [400] },
  { id: 'sniglet', pkg: 'sniglet', name: 'Sniglet', category: 'festive', weights: [400, 800] },
  { id: 'berkshire-swash', pkg: 'berkshire-swash', name: 'Berkshire Swash', category: 'festive', weights: [400] },
  { id: 'bowlby-one', pkg: 'bowlby-one', name: 'Bowlby One', category: 'festive', weights: [400] },
  { id: 'shadows-into-light', pkg: 'shadows-into-light', name: 'Shadows Into Light', category: 'script', weights: [400] },
  { id: 'indie-flower', pkg: 'indie-flower', name: 'Indie Flower', category: 'script', weights: [400] },
  { id: 'amatic-sc', pkg: 'amatic-sc', name: 'Amatic SC', category: 'script', weights: [400, 700] },
  { id: 'kalam', pkg: 'kalam', name: 'Kalam', category: 'script', weights: [400, 700] },
  { id: 'courgette', pkg: 'courgette', name: 'Courgette', category: 'script', weights: [400] },
  { id: 'damion', pkg: 'damion', name: 'Damion', category: 'script', weights: [400] },
  { id: 'cookie', pkg: 'cookie', name: 'Cookie', category: 'script', weights: [400] },
  { id: 'playball', pkg: 'playball', name: 'Playball', category: 'script', weights: [400] },
  { id: 'parisienne', pkg: 'parisienne', name: 'Parisienne', category: 'script', weights: [400] },
  { id: 'alex-brush', pkg: 'alex-brush', name: 'Alex Brush', category: 'script', weights: [400] },
  { id: 'pinyon-script', pkg: 'pinyon-script', name: 'Pinyon Script', category: 'script', weights: [400] },
  { id: 'tangerine', pkg: 'tangerine', name: 'Tangerine', category: 'script', weights: [400, 700] },
  { id: 'grand-hotel', pkg: 'grand-hotel', name: 'Grand Hotel', category: 'script', weights: [400] },
  // Polices de secours, hors bibliothèque : écritures absentes des polices ci-dessus.
  { id: 'noto-sans-nko', pkg: 'noto-sans-nko', name: 'Noto Sans NKo', category: 'sans', weights: [400], subsets: ['nko'], fallback: true },
];

/** Écritures repérées par leurs lettres : toutes doivent être présentes dans la graisse normale. */
const SCRIPTS = {
  latin: 'AZaz09éèçà',
  pular: 'ɓɗŋƴƁƊŊƳ',
  nko: 'ߊߒߞߏ',
};

/** Fichiers d'une archive tar (format ustar des paquets npm), par chemin. */
function untar(archive) {
  const files = new Map();
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').split('\0')[0];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = [field(header, 345, 155), field(header, 0, 100)].filter(Boolean).join('/');
    const size = Number.parseInt(field(header, 124, 12).trim() || '0', 8);
    const type = field(header, 156, 1);
    offset += 512;
    if (type === '0' || type === '') files.set(name, archive.subarray(offset, offset + size));
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Paquet @fontsource téléchargé depuis le registre npm (sans commande système). */
async function fetchPackage(pkg) {
  const url = `https://registry.npmjs.org/@fontsource/${pkg}/-/${pkg}-${FONTSOURCE_VERSION}.tgz`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} : ${response.status}`);
  const files = untar(gunzipSync(Buffer.from(await response.arrayBuffer())));
  // Bibliothèque redistribuée avec les exports : licence OFL exigée.
  const { license } = JSON.parse(files.get('package/package.json').toString('utf8'));
  if (license !== 'OFL-1.1') throw new Error(`@fontsource/${pkg} : licence ${license}, OFL-1.1 attendue`);
  return files;
}

const out = resolve(import.meta.dirname, '..', 'assets', 'fonts');
mkdirSync(out, { recursive: true });

const manifestPath = join(out, 'manifest.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const only = new Set(process.argv.slice(2));
const wanted = (font) => !only.size || only.has(font.id) || !previous.some((p) => p.id === font.id);

const packages = await Promise.all(FONTS.map((font) => (wanted(font) ? fetchPackage(font.pkg) : null)));
const fetched = FONTS.map((font, index) => {
  if (!packages[index]) return previous.find((p) => p.id === font.id);
  const spec = `@fontsource/${font.pkg}@${FONTSOURCE_VERSION}`;
  const files = {};
  for (const weight of font.weights) {
    files[weight] = [];
    for (const subset of font.subsets ?? SUBSETS) {
      const name = `${font.pkg}-${subset}-${weight}-normal.woff`;
      const data = packages[index].get(`package/files/${name}`);
      if (!data) continue;
      writeFileSync(join(out, name), data);
      files[weight].push(name);
    }
    if (files[weight].length === 0) throw new Error(`${spec} : graisse ${weight} introuvable`);
  }
  // Hauteurs au-dessus et au-dessous de la ligne de base, en em : placement des lignes de
  // texte du Studio, identique dans le navigateur et dans le rendu serveur.
  const regular = opentype.loadSync(join(out, files[font.weights[0]][0]));
  const ascent = Math.round((regular.ascender / regular.unitsPerEm) * 1000) / 1000;
  const descent = Math.round((-regular.descender / regular.unitsPerEm) * 1000) / 1000;
  const { id, name, category, weights, fallback } = font;
  console.log(`${name} : ${Object.values(files).flat().length} fichiers`);
  return { id, name, category, weights, license: 'OFL', source: spec, ascent, descent, files, ...(fallback && { fallback }) };
});

// Écritures couvertes par chaque police (graisse normale, tous sous-ensembles confondus) : le
// front prévient quand une lettre sera dessinée avec la police de secours.
const manifest = fetched.map((font) => {
  const regular = font.files[String(font.weights[0])].map((file) => opentype.loadSync(join(out, file)));
  const covers = (letters) => Array.from(letters).every((c) => regular.some((f) => f.charToGlyphIndex(c) > 0));
  return { ...font, scripts: Object.keys(SCRIPTS).filter((script) => covers(SCRIPTS[script])) };
});

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Manifeste écrit dans ${manifestPath}`);
