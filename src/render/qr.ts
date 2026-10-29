// Encodeur QR code (ISO/IEC 18004), mode octet, versions 1 à 40 : liens, WhatsApp, vCard et
// Wi-Fi sur les cartes de visite et dans le Studio. Même module côté front (src/lib/render/qr.ts).

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

const LEVEL_INDEX: Record<QrLevel, number> = { L: 0, M: 1, Q: 2, H: 3 };
const FORMAT_BITS: Record<QrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

// Codes correcteurs par bloc et nombre de blocs, par niveau puis par version (index 0 inutilisé).
const ECC_PER_BLOCK = [
  [
    -1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30,
    30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  ],
  [
    -1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30,
    30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
  [
    -1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30,
    30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30,
  ],
];
const BLOCKS = [
  [
    -1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14,
    15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25,
  ],
  [
    -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
    25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
  ],
  [
    -1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34,
    34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68,
  ],
  [
    -1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35,
    37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81,
  ],
];

const bit = (value: number, index: number) => ((value >>> index) & 1) !== 0;

/** Modules disponibles pour les données (hors motifs de fonction), en bits. */
function rawModules(version: number) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number, level: number) {
  return (
    Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[level][version] * BLOCKS[level][version]
  );
}

// ─── Reed-Solomon sur GF(2^8), polynôme 0x11D ───

function gfMultiply(x: number, y: number) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number) {
  const result = Array.from<number>({ length: degree }).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: number[], divisor: number[]) {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0);
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= gfMultiply(coef, factor);
    });
  }
  return result;
}

/** Blocs de données suivis de leurs codes correcteurs, entrelacés. */
function withErrorCorrection(data: number[], version: number, level: number) {
  const blockCount = BLOCKS[level][version];
  const eccLength = ECC_PER_BLOCK[level][version];
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blockCount - (raw % blockCount);
  const shortLength = Math.floor(raw / blockCount);
  const divisor = rsDivisor(eccLength);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < blockCount; i++) {
    const length = shortLength - eccLength + (i < shortBlocks ? 0 : 1);
    const chunk = data.slice(k, k + length);
    k += length;
    const ecc = rsRemainder(chunk, divisor);
    // Les blocs courts reçoivent un octet fictif : tous les blocs ont alors la même longueur.
    if (i < shortBlocks) chunk.push(0);
    blocks.push([...chunk, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]);
    });
  }
  return result;
}

// ─── Matrice ───

class Matrix {
  readonly size: number;
  readonly dark: boolean[][];
  readonly reserved: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = Array.from({ length: this.size }, () =>
      Array.from<boolean>({ length: this.size }).fill(false),
    );
    this.reserved = Array.from({ length: this.size }, () =>
      Array.from<boolean>({ length: this.size }).fill(false),
    );
  }

  fixed(x: number, y: number, dark: boolean) {
    this.dark[y][x] = dark;
    this.reserved[y][x] = true;
  }

  finder(cx: number, cy: number) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const [x, y] = [cx + dx, cy + dy];
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
          this.fixed(x, y, distance !== 2 && distance !== 4);
        }
      }
    }
  }

  alignment(cx: number, cy: number) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.fixed(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  alignmentPositions() {
    if (this.version === 1) return [];
    const count = Math.floor(this.version / 7) + 2;
    const step = Math.floor((this.version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2;
    const result = [6];
    for (let i = 0; i < count - 1; i++) result.splice(1, 0, this.size - 7 - i * step);
    return result;
  }

  functionPatterns(level: QrLevel) {
    for (let i = 0; i < this.size; i++) {
      this.fixed(6, i, i % 2 === 0);
      this.fixed(i, 6, i % 2 === 0);
    }
    this.finder(3, 3);
    this.finder(this.size - 4, 3);
    this.finder(3, this.size - 4);
    const positions = this.alignmentPositions();
    const last = positions.length - 1;
    positions.forEach((x, i) =>
      positions.forEach((y, j) => {
        const corner = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
        if (!corner) this.alignment(x, y);
      }),
    );
    this.format(level, 0);
    this.versionInfo();
  }

  format(level: QrLevel, mask: number) {
    const data = (FORMAT_BITS[level] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const size = this.size;
    for (let i = 0; i <= 5; i++) this.fixed(8, i, bit(bits, i));
    this.fixed(8, 7, bit(bits, 6));
    this.fixed(8, 8, bit(bits, 7));
    this.fixed(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) this.fixed(14 - i, 8, bit(bits, i));
    for (let i = 0; i < 8; i++) this.fixed(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) this.fixed(8, size - 15 + i, bit(bits, i));
    this.fixed(8, size - 8, true);
  }

  versionInfo() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.fixed(a, b, bit(bits, i));
      this.fixed(b, a, bit(bits, i));
    }
  }

  /** Colonne de droite de chaque paire parcourue en zigzag ; la colonne 6 (synchronisation) est sautée. */
  dataColumns() {
    const columns: number[] = [];
    for (let right = this.size - 1; right >= 1; right -= 2)
      columns.push(right > 6 ? right : right - 1);
    return columns;
  }

  codewords(data: number[]) {
    const total = data.length * 8;
    let i = 0;
    for (const right of this.dataColumns()) {
      const upward = ((right + 1) & 2) === 0;
      for (let vert = 0; vert < this.size; vert++) {
        const y = upward ? this.size - 1 - vert : vert;
        for (const x of [right, right - 1]) {
          if (i < total && !this.reserved[y][x]) {
            this.dark[y][x] = bit(data[i >>> 3], 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  applyMask(mask: number) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.reserved[y][x] && maskBit(mask, x, y)) this.dark[y][x] = !this.dark[y][x];
      }
    }
  }

  /** Pénalité de lisibilité (§7.8.3) : le masque retenu est le moins pénalisé. */
  penalty() {
    let score = 0;
    for (let k = 0; k < this.size; k++) {
      score += linePenalty(this.dark[k]) + linePenalty(this.dark.map((row) => row[k]));
    }
    return score + this.blockPenalty() + this.balancePenalty();
  }

  /** Carrés 2 × 2 d'une même couleur. */
  blockPenalty() {
    let score = 0;
    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const c = this.dark[y][x];
        const square =
          c === this.dark[y][x + 1] && c === this.dark[y + 1][x] && c === this.dark[y + 1][x + 1];
        if (square) score += 3;
      }
    }
    return score;
  }

  /** Écart à l'équilibre 50 % de modules sombres. */
  balancePenalty() {
    const total = this.size * this.size;
    const darkCount = this.dark.flat().filter(Boolean).length;
    return (Math.ceil(Math.abs(darkCount * 20 - total * 10) / total) - 1) * 10;
  }
}

/** Suites de 5 modules ou plus d'une même couleur, et motifs proches d'un repère. */
function linePenalty(cells: boolean[]) {
  let score = 0;
  let run = 1;
  for (let i = 1; i <= cells.length; i++) {
    if (i < cells.length && cells[i] === cells[i - 1]) {
      run++;
      continue;
    }
    if (run >= 5) score += 3 + run - 5;
    run = 1;
  }
  const text = cells.map((dark) => (dark ? '1' : '0')).join('');
  for (const pattern of ['10111010000', '00001011101']) {
    for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1)) score += 40;
  }
  return score;
}

function maskBit(mask: number, x: number, y: number) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** Modules du QR code (true = sombre), sans marge. */
export function qrMatrix(text: string, level: QrLevel = 'M'): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const li = LEVEL_INDEX[level];
  let version = 1;
  const bitsNeeded = (v: number) => 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
  while (version <= 40 && bitsNeeded(version) > dataCodewords(version, li) * 8) version++;
  if (version > 40) throw new Error('Texte trop long pour un QR code');

  const capacity = dataCodewords(version, li) * 8;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  bytes.forEach((byte) => push(byte, 8));
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0));
  }
  // Octets de bourrage alternés 0xEC, 0x11 jusqu'à la capacité.
  const padding = capacity / 8 - data.length;
  for (let k = 0; k < padding; k++) data.push(k % 2 === 0 ? 0xec : 0x11);

  const codewords = withErrorCorrection(data, version, li);
  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const matrix = new Matrix(version);
    matrix.functionPatterns(level);
    matrix.codewords(codewords);
    matrix.applyMask(mask);
    matrix.format(level, mask);
    const score = matrix.penalty();
    if (score < bestScore) {
      best = matrix;
      bestScore = score;
    }
  }
  return best!.dark;
}

/** QR code en SVG : un seul tracé, marge de 4 modules (zone de silence). */
export function qrSvg(
  text: string,
  options: { color?: string; background?: string | null; level?: QrLevel; margin?: number } = {},
) {
  const { color = '#111111', background = '#ffffff', level = 'M', margin = 4 } = options;
  const modules = qrMatrix(text, level);
  const size = modules.length + margin * 2;
  const path: string[] = [];
  modules.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let run = 1;
      while (x + run < row.length && row[x + run]) run++;
      path.push(`M${x + margin} ${y + margin}h${run}v1h-${run}z`);
      x += run - 1;
    }
  });
  const fill = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">${fill}<path d="${path.join('')}" fill="${color}"/></svg>`;
}

// ─── Contenus ───

/** Lien WhatsApp (wa.me) : numéro au format international, message prérempli facultatif. */
export function whatsappLink(phone: string, message = '') {
  const digits = phone.replace(/\D/g, '').replace(/^00/, '');
  const text = message ? `?text=${encodeURIComponent(message)}` : '';
  return `https://wa.me/${digits}${text}`;
}

// « \$& » : la barre oblique inversée suivie du caractère trouvé.
const vcardEscape = (value: string) =>
  value.replace(/[\\;,]/g, String.raw`\$&`).replaceAll('\n', String.raw`\n`);

export interface VCardInput {
  fullName: string;
  organization?: string;
  title?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
}

/** Fiche contact vCard 3.0 : un scan l'ajoute au répertoire du téléphone. */
export function vcard(input: VCardInput) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${vcardEscape(input.fullName)}`,
    `N:${vcardEscape(input.fullName)};;;;`,
  ];
  if (input.organization) lines.push(`ORG:${vcardEscape(input.organization)}`);
  if (input.title) lines.push(`TITLE:${vcardEscape(input.title)}`);
  if (input.phone) lines.push(`TEL;TYPE=CELL:${input.phone.replace(/[^\d+]/g, '')}`);
  if (input.email) lines.push(`EMAIL:${input.email}`);
  if (input.website) lines.push(`URL:${input.website}`);
  if (input.address) lines.push(`ADR:;;${vcardEscape(input.address)};;;;`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

const wifiEscape = (value: string) => value.replace(/[\\;,:"]/g, String.raw`\$&`);

/** Accès Wi-Fi (boutique, restaurant, salle de réunion) : un scan connecte le téléphone. */
export function wifiPayload(ssid: string, password = '') {
  const security = password ? 'WPA' : 'nopass';
  const secret = password ? `P:${wifiEscape(password)};` : '';
  return `WIFI:T:${security};S:${wifiEscape(ssid)};${secret};`;
}
