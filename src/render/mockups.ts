import { hashSeed, renderArtwork } from './artwork';
import { mix, readableOn } from './color';
import { n, onPrimary, place, wrap, type BrandAsset, type BrandAssets } from './compose';
import { SOCIAL_KIT, socialKitSvg } from './social-kit';

// Mises en situation : le logo sur une devanture, un t-shirt, des mugs, des cartes de visite, un
// téléphone, un véhicule, des sacs et un stand. Scènes vectorielles dessinées aux couleurs de la
// marque (aucune photo), tramées en JPG pour l'archive. Même module côté front
// (src/lib/render/mockups.ts).

export const MOCKUP_WIDTH = 1600;
export const MOCKUP_HEIGHT = 1200;

export interface MockupScene {
  id: string;
  file: string;
}

export const MOCKUP_SCENES: readonly MockupScene[] = [
  { id: 'storefront', file: 'devanture' },
  { id: 'tshirt', file: 't-shirt' },
  { id: 'mugs', file: 'mugs' },
  { id: 'cards', file: 'cartes-de-visite' },
  { id: 'phone', file: 'telephone' },
  { id: 'van', file: 'vehicule' },
  { id: 'bags', file: 'sacs' },
  { id: 'stand', file: 'stand' },
];

const W = MOCKUP_WIDTH;
const H = MOCKUP_HEIGHT;
const GREY = '#9ca3af';
const DARK = '#1f2328';

const shade = (color: string, amount: number) => mix(color, '#000000', amount);
const tint = (color: string, amount: number) => mix(color, '#ffffff', amount);

function linear(id: string, stops: [number, string, number?][], vertical = false) {
  const end = vertical ? 'x2="0" y2="1"' : 'x2="1" y2="0"';
  const body = stops
    .map(
      ([offset, color, opacity]) =>
        `<stop offset="${offset}" stop-color="${color}"${opacity === undefined ? '' : ` stop-opacity="${opacity}"`}/>`,
    )
    .join('');
  return `<linearGradient id="${id}" x1="0" y1="0" ${end}>${body}</linearGradient>`;
}

/** Ombre portée douce, sans filtre (dégradé radial). */
function shadow(cx: number, cy: number, rx: number, ry: number, opacity = 0.3) {
  return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" fill="url(#mk-shadow)" opacity="${opacity}"/>`;
}

const SHADOW_DEF =
  '<radialGradient id="mk-shadow"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>';

/** Visuel déjà composé (kit réseaux sociaux) utilisé comme image dans une scène. */
function asAsset(svg: string, width: number, height: number): BrandAsset {
  return { svg, width, height };
}

/** Symbole lisible sur une couleur quelconque. */
function markOn(assets: BrandAssets, color: string) {
  return readableOn(color) === '#ffffff' ? assets.mark.white : assets.mark.black;
}

function storefront(a: BrandAssets) {
  const { primary: P, secondary: S } = a.colors;
  const wall = '#efe9df';
  const stripes: string[] = [];
  const count = 14;
  const top = 1160 / count;
  const bottom = 1220 / count;
  // Ombrage du store : même géométrie, dégradé en coordonnées de la scène.
  const shading: string[] = [];
  for (let i = 0; i < count; i++) {
    const fill = i % 2 === 0 ? S : '#fafafa';
    const x0 = 220 + i * top;
    const b0 = 190 + i * bottom;
    const stripe = `<polygon points="${n(x0)},395 ${n(x0 + top)},395 ${n(b0 + bottom)},500 ${n(b0)},500"`;
    const scallop = `<path d="M${n(b0)} 499a${n(bottom / 2)} 26 0 0 0 ${n(bottom)} 0z"`;
    stripes.push(
      `${stripe} fill="${fill}"/>`,
      `${scallop} fill="${fill}" stroke="${shade(S, 0.3)}" stroke-opacity="0.35" stroke-width="2"/>`,
    );
    shading.push(`${stripe} fill="url(#mk-awn)"/>`, `${scallop} fill="url(#mk-awn)"/>`);
  }
  const windowAt = (x: number, id: string) => {
    const [x0, y0, x1, y1] = [x + 14, 574, x + 446, 966];
    return (
      `<rect x="${x}" y="560" width="460" height="420" fill="#2f3640"/>` +
      `<clipPath id="${id}"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/></clipPath>` +
      `<g clip-path="url(#${id})"><rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="url(#mk-glass)"/>` +
      `<rect x="${x0}" y="${y0 + 140}" width="${x1 - x0}" height="10" fill="#1f2937" fill-opacity="0.14"/>` +
      `<rect x="${x0}" y="${y0 + 270}" width="${x1 - x0}" height="10" fill="#1f2937" fill-opacity="0.14"/>` +
      `<polygon points="${x0 + 70},${y0} ${x0 + 210},${y0} ${x0 + 90},${y1} ${x0 - 50},${y1}" fill="#fff" fill-opacity="0.22"/>` +
      `<polygon points="${x0 + 250},${y0} ${x0 + 290},${y0} ${x0 + 170},${y1} ${x0 + 130},${y1}" fill="#fff" fill-opacity="0.16"/></g>` +
      `<rect x="${x - 10}" y="980" width="480" height="16" fill="#d6cfc3"/>`
    );
  };
  const lamp = (x: number) =>
    `<path d="M${x} 92q0 30 24 46" stroke="#374151" stroke-width="8" fill="none"/><path d="M${x + 6} 132h40l-8 18h-24z" fill="#374151"/>`;
  const plant = (x: number) =>
    `<path d="M${x - 40} 990h80l-12 70h-56z" fill="#3b3f46"/>` +
    [-30, -10, 10, 30]
      .map(
        (dx, i) =>
          `<ellipse cx="${x + dx}" cy="${960 - (i % 2) * 30}" rx="18" ry="46" fill="${i % 2 ? '#3f7d4e' : '#4f9460'}" transform="rotate(${dx} ${x + dx} ${960 - (i % 2) * 30})"/>`,
      )
      .join('');
  return (
    `<defs>${linear(
      'mk-sky',
      [
        [0, '#dfe9ef'],
        [1, '#f3f6f8'],
      ],
      true,
    )}${linear('mk-glass', [
      [0, '#bdd5de'],
      [1, '#86a5b1'],
    ])}<linearGradient id="mk-awn" gradientUnits="userSpaceOnUse" x1="0" y1="395" x2="0" y2="526"><stop offset="0" stop-opacity="0"/><stop offset="1" stop-opacity="0.2"/></linearGradient>${linear(
      'mk-under',
      [
        [0, '#000', 0.16],
        [1, '#000', 0],
      ],
      true,
    )}${SHADOW_DEF}</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#mk-sky)"/>` +
    `<rect x="160" y="60" width="1280" height="1000" fill="${wall}"/>` +
    `<rect x="160" y="60" width="60" height="1000" fill="#e2dbcf"/><rect x="1380" y="60" width="60" height="1000" fill="#e2dbcf"/>` +
    `<rect x="140" y="50" width="1320" height="34" fill="#d8d0c3"/>` +
    [420, 800, 1180].map(lamp).join('') +
    `<rect x="220" y="150" width="1160" height="230" rx="10" fill="${P}" stroke="${shade(P, 0.25)}" stroke-width="8"/>` +
    `<rect x="226" y="156" width="1148" height="22" fill="#fff" fill-opacity="0.12"/>` +
    place(onPrimary(a, 'logo'), 300, 190, 1000, 150, 'l1-') +
    stripes.join('') +
    shading.join('') +
    `<rect x="208" y="386" width="1184" height="14" rx="4" fill="${shade(S, 0.35)}"/>` +
    `<rect x="220" y="526" width="1160" height="40" fill="url(#mk-under)"/>` +
    windowAt(260, 'mk-w1') +
    windowAt(880, 'mk-w2') +
    `<rect x="740" y="540" width="120" height="520" fill="#2f3640"/>` +
    `<rect x="752" y="552" width="96" height="350" fill="url(#mk-glass)"/>` +
    `<rect x="752" y="912" width="96" height="136" fill="${P}"/>` +
    place(a.mark.white, 764, 600, 72, 72, 'm1-') +
    `<rect x="830" y="740" width="8" height="70" rx="4" fill="#d1d5db"/>` +
    plant(250) +
    plant(1350) +
    `<rect y="1060" width="${W}" height="140" fill="#cfcac2"/><rect y="1060" width="${W}" height="14" fill="#b8b2a8"/>` +
    shadow(800, 1074, 680, 14, 0.25)
  );
}

function tshirt(a: BrandAssets) {
  const { primary: P, background: B } = a.colors;
  const shirt =
    'M690 200L520 250L330 470L440 555L540 470L545 1060Q800 1078 1055 1060L1060 470L1160 555L1270 470L1080 250L910 200Q800 300 690 200Z';
  const seam = shade(P, 0.3);
  return (
    `<defs>${linear(
      'mk-bg',
      [
        [0, mix(B, '#d9d4cc', 0.5)],
        [1, mix(B, '#c9c3ba', 0.55)],
      ],
      true,
    )}${linear('mk-fold', [
      [0, '#000', 0.14],
      [0.22, '#fff', 0.08],
      [0.5, '#fff', 0],
      [0.78, '#000', 0.04],
      [1, '#000', 0.16],
    ])}</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#mk-bg)"/>` +
    `<path d="${shirt}" transform="translate(18 26)" fill="#000" fill-opacity="0.08"/>` +
    `<path d="${shirt}" transform="translate(8 12)" fill="#000" fill-opacity="0.12"/>` +
    `<path d="${shirt}" fill="${P}" stroke="${P}" stroke-width="6" stroke-linejoin="round"/>` +
    `<path d="M690 200Q800 236 910 200Q800 300 690 200Z" fill="${shade(P, 0.35)}"/>` +
    `<path d="M690 200Q800 300 910 200" fill="none" stroke="${shade(P, 0.18)}" stroke-width="24" stroke-linecap="round"/>` +
    `<path d="M520 250Q562 360 540 470M1080 250Q1038 360 1060 470" fill="none" stroke="${seam}" stroke-opacity="0.5" stroke-width="4"/>` +
    `<path d="M352 488L452 572M1248 488L1148 572M548 1030Q800 1046 1052 1030" fill="none" stroke="${seam}" stroke-opacity="0.45" stroke-width="4" stroke-dasharray="10 8"/>` +
    `<path d="M610 700Q650 860 620 1010M990 720Q955 860 985 1000" fill="none" stroke="#000" stroke-opacity="0.06" stroke-width="22" stroke-linecap="round"/>` +
    place(onPrimary(a, 'logo'), 610, 360, 380, 230, 'l1-') +
    `<path d="${shirt}" fill="url(#mk-fold)"/>`
  );
}

function mug(
  o: { cx: number; top: number; rx: number; height: number; color: string; asset: BrandAsset },
  handle: 'left' | 'right',
  id: string,
) {
  const { cx, top, rx, height, color, asset } = o;
  const ry = rx * 0.21;
  const bottom = top + height;
  const [x0, x1] = [cx - rx, cx + rx];
  const side = handle === 'right' ? 1 : -1;
  const hx = cx + side * (rx - 4);
  const reach = side * rx * 0.7;
  const handlePath = `M${n(hx)} ${n(top + height * 0.18)}C${n(hx + reach)} ${n(top + height * 0.18)} ${n(hx + reach)} ${n(top + height * 0.72)} ${n(hx)} ${n(top + height * 0.72)}`;
  return (
    `<defs>${linear(`${id}-body`, [
      [0, shade(color, 0.2)],
      [0.2, color],
      [0.42, tint(color, 0.45)],
      [0.68, color],
      [1, shade(color, 0.24)],
    ])}</defs>` +
    shadow(cx + side * rx * 0.15, bottom + 4, rx * 1.35, ry * 1.1, 0.35) +
    `<path d="${handlePath}" fill="none" stroke="${shade(color, 0.22)}" stroke-width="${n(rx * 0.25)}" stroke-linecap="round"/>` +
    `<path d="${handlePath}" fill="none" stroke="${color}" stroke-width="${n(rx * 0.17)}" stroke-linecap="round"/>` +
    `<path d="M${n(x0)} ${n(top)}V${n(bottom - ry)}A${n(rx)} ${n(ry)} 0 0 0 ${n(x1)} ${n(bottom - ry)}V${n(top)}Z" fill="url(#${id}-body)"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(top)}" rx="${n(rx)}" ry="${n(ry)}" fill="${tint(color, 0.2)}"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(top)}" rx="${n(rx * 0.92)}" ry="${n(ry * 0.84)}" fill="${shade(color, 0.22)}"/>` +
    `<ellipse cx="${n(cx)}" cy="${n(top + ry * 0.22)}" rx="${n(rx * 0.86)}" ry="${n(ry * 0.62)}" fill="#4a2c1a"/>` +
    place(asset, x0 + rx * 0.22, top + height * 0.22, rx * 1.56, height * 0.5, `${id}-l-`)
  );
}

function mugs(a: BrandAssets) {
  const { primary: P, background: B } = a.colors;
  return (
    `<defs>${linear(
      'mk-wall',
      [
        [0, mix(B, '#ece6dc', 0.5)],
        [1, mix(B, '#e1d9cc', 0.55)],
      ],
      true,
    )}${linear(
      'mk-table',
      [
        [0, '#d8cbb8'],
        [1, '#c4b49c'],
      ],
      true,
    )}${SHADOW_DEF}</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#mk-wall)"/>` +
    `<rect y="860" width="${W}" height="340" fill="url(#mk-table)"/><rect y="860" width="${W}" height="6" fill="#fff" fill-opacity="0.35"/>` +
    mug(
      { cx: 1150, top: 560, rx: 150, height: 360, color: P, asset: onPrimary(a, 'mark') },
      'right',
      'mk-m2',
    ) +
    mug({ cx: 660, top: 400, rx: 240, height: 580, color: B, asset: a.logo.color }, 'left', 'mk-m1')
  );
}

function card(cx: number, cy: number, angle: number, fill: string, content: string, edge: string) {
  return (
    `<g transform="translate(${cx} ${cy}) rotate(${angle})">` +
    `<rect x="-400" y="-212" width="840" height="480" rx="14" fill="#000" fill-opacity="0.12"/>` +
    `<rect x="-410" y="-224" width="840" height="480" rx="14" fill="#000" fill-opacity="0.2"/>` +
    `<rect x="-414" y="-234" width="840" height="480" rx="12" fill="${edge}"/>` +
    `<rect x="-420" y="-240" width="840" height="480" rx="12" fill="${fill}"/>` +
    content +
    '</g>'
  );
}

function cards(a: BrandAssets) {
  const { primary: P, background: B } = a.colors;
  const ink = readableOn(B) === '#ffffff' ? '#ffffff' : '#111827';
  const line = (y: number, w: number) =>
    `<rect x="-360" y="${y}" width="${w}" height="16" rx="8" fill="${ink}" fill-opacity="0.28"/>`;
  const front =
    place(a.logo.color, -360, -190, 420, 170, 'l1-') +
    line(70, 300) +
    line(108, 240) +
    line(146, 270) +
    `<rect x="356" y="-170" width="8" height="340" rx="4" fill="${P}"/>`;
  const back = place(onPrimary(a, 'mark'), -120, -120, 240, 240, 'm1-');
  return (
    `<defs><radialGradient id="mk-desk" cx="0.45" cy="0.4" r="0.8"><stop offset="0" stop-color="#4a5059"/><stop offset="1" stop-color="#25292f"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#mk-desk)"/>` +
    card(960, 470, -12, P, back, shade(P, 0.3)) +
    card(700, 720, 6, B, front, shade(B, 0.12))
  );
}

function phone(a: BrandAssets) {
  const { primary: P, secondary: S, background: B } = a.colors;
  const format = (id: string) => SOCIAL_KIT.find((f) => f.id === id)!;
  const visual = (id: string) => {
    const f = format(id);
    return asAsset(socialKitSvg(a, f), f.width, f.height);
  };
  const tile = 132;
  const tiles = [
    { fill: P, asset: onPrimary(a, 'mark') },
    { fill: B, asset: a.mark.color },
    { fill: S, asset: markOn(a, S) },
  ];
  const grid: string[] = [];
  tiles.forEach((t, i) => {
    const x = 598 + i * (tile + 4);
    grid.push(
      `<rect x="${x}" y="520" width="${tile}" height="${tile}" fill="${t.fill}"/>`,
      place(t.asset, x + 30, 550, tile - 60, tile - 60, `mk-t${i}-`),
    );
  });
  grid.push(
    place(visual('profile-inverse'), 598, 656, tile, tile, 'mk-pi-'),
    `<rect x="${598 + tile + 4}" y="656" width="${tile}" height="${tile}" fill="${tint(P, 0.75)}"/>`,
    place(a.logo.color, 598 + tile + 16, 700, tile - 24, 44, 'mk-pl-'),
    `<rect x="${598 + 2 * (tile + 4)}" y="656" width="${tile}" height="${tile}" fill="${shade(P, 0.3)}"/>`,
  );
  for (let i = 0; i < 3; i++) {
    grid.push(
      `<rect x="${598 + i * (tile + 4)}" y="792" width="${tile}" height="${tile}" fill="#e5e7eb"/>`,
    );
  }
  return (
    `<defs>${linear('mk-bg', [
      [0, mix(B, P, 0.14)],
      [1, mix(B, S, 0.16)],
    ])}<clipPath id="mk-scr"><rect x="598" y="108" width="404" height="984" rx="56"/></clipPath><clipPath id="mk-av"><circle cx="680" cy="314" r="56"/></clipPath>${SHADOW_DEF}</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#mk-bg)"/>` +
    `<circle cx="260" cy="240" r="190" fill="${P}" fill-opacity="0.08"/><circle cx="1360" cy="960" r="240" fill="${S}" fill-opacity="0.1"/>` +
    shadow(820, 1120, 300, 28, 0.35) +
    `<rect x="574" y="250" width="10" height="90" rx="4" fill="#0b0f19"/><rect x="1016" y="300" width="10" height="140" rx="4" fill="#0b0f19"/>` +
    `<rect x="580" y="90" width="440" height="1020" rx="72" fill="#111827"/>` +
    `<g clip-path="url(#mk-scr)"><rect x="598" y="108" width="404" height="984" fill="#fff"/>` +
    place(visual('facebook'), 598, 160, 404, 154, 'mk-bn-') +
    `<circle cx="680" cy="314" r="62" fill="#fff"/>` +
    `<g clip-path="url(#mk-av)">${place(visual('profile'), 624, 258, 112, 112, 'mk-av-')}</g>` +
    `<rect x="862" y="330" width="124" height="40" rx="20" fill="${P}"/>` +
    `<rect x="610" y="392" width="220" height="22" rx="11" fill="#111827"/>` +
    `<rect x="610" y="426" width="150" height="14" rx="7" fill="${GREY}"/>` +
    `<rect x="610" y="458" width="360" height="12" rx="6" fill="#d1d5db"/><rect x="610" y="482" width="290" height="12" rx="6" fill="#d1d5db"/>` +
    grid.join('') +
    `<rect x="598" y="1032" width="404" height="60" fill="#fff"/><rect x="598" y="1032" width="404" height="1" fill="#e5e7eb"/>` +
    [660, 740, 820, 900, 960]
      .map((x) => `<circle cx="${x}" cy="1058" r="11" fill="${GREY}"/>`)
      .join('') +
    `<rect x="598" y="108" width="404" height="48" fill="#fff"/>` +
    `<rect x="622" y="124" width="46" height="14" rx="7" fill="#111827"/><rect x="930" y="124" width="48" height="14" rx="7" fill="#111827"/>` +
    `<rect x="740" y="118" width="120" height="32" rx="16" fill="#111827"/></g>`
  );
}

function van(a: BrandAssets) {
  const { primary: P, secondary: S, background: B } = a.colors;
  const body = B;
  const wheel = (cx: number) =>
    `<circle cx="${cx}" cy="900" r="108" fill="#2b2f36"/><circle cx="${cx}" cy="908" r="90" fill="${DARK}"/><circle cx="${cx}" cy="908" r="50" fill="#9ca3af"/><circle cx="${cx}" cy="908" r="18" fill="#6b7280"/>`;
  return (
    `<defs>${linear(
      'mk-sky',
      [
        [0, '#dbe8f0'],
        [1, '#f4f7f9'],
      ],
      true,
    )}${linear(
      'mk-body',
      [
        [0, tint(body, 0.4)],
        [0.6, body],
        [1, shade(body, 0.16)],
      ],
      true,
    )}${linear('mk-glass', [
      [0, '#a9c1cc'],
      [1, '#6f8a96'],
    ])}${SHADOW_DEF}</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#mk-sky)"/>` +
    `<path d="M0 820V560h180v-80h140v120h120v-160h200v240h160v-120h220v90h180v-190h240v140h160v300z" fill="#c9d3da" fill-opacity="0.6"/>` +
    `<rect y="820" width="${W}" height="70" fill="#c9c5bd"/><rect y="890" width="${W}" height="310" fill="#5b616a"/>` +
    [0, 1, 2, 3, 4, 5]
      .map((i) => `<rect x="${i * 300 + 40}" y="1100" width="160" height="14" fill="#e5e7eb"/>`)
      .join('') +
    shadow(820, 1000, 640, 34, 0.45) +
    `<path d="M230 400Q230 360 270 360H1090V900H230Z" fill="url(#mk-body)"/>` +
    `<path d="M1090 420H1250Q1290 420 1310 450L1380 640V880Q1380 900 1360 900H1090Z" fill="url(#mk-body)"/>` +
    `<path d="M1110 450H1240Q1270 450 1285 475L1340 620H1110Z" fill="url(#mk-glass)"/>` +
    `<path d="M1100 440V880M240 380V890" stroke="#000" stroke-opacity="0.12" stroke-width="4"/>` +
    `<rect x="1120" y="660" width="54" height="12" rx="6" fill="${shade(body, 0.35)}"/>` +
    `<path d="M230 790C600 770 900 712 1380 700V770C900 780 600 830 230 860Z" fill="${P}"/>` +
    `<path d="M230 760C600 742 900 686 1380 674V690C900 702 600 756 230 776Z" fill="${S}"/>` +
    `<rect x="1366" y="640" width="20" height="54" rx="6" fill="#fde68a"/><rect x="1360" y="830" width="36" height="64" rx="8" fill="#374151"/>` +
    place(a.logo.color, 300, 420, 720, 250, 'l1-') +
    wheel(450) +
    wheel(1220)
  );
}

function bag(
  o: { x: number; y: number; w: number; h: number; color: string; asset: BrandAsset },
  id: string,
) {
  const { x, y, w, h, color, asset } = o;
  const depth = w * 0.24;
  const rise = depth * 0.45;
  const [hl, hr] = [x + w * 0.27, x + w * 0.73];
  return (
    `<defs>${linear(`${id}-f`, [
      [0, tint(color, 0.08)],
      [1, shade(color, 0.1)],
    ])}</defs>` +
    `<path d="M${n(hl + depth * 0.6)} ${n(y - rise)}C${n(hl + depth * 0.6)} ${n(y - h * 0.32)} ${n(hr + depth * 0.6)} ${n(y - h * 0.32)} ${n(hr + depth * 0.6)} ${n(y - rise)}" fill="none" stroke="${shade(color, 0.45)}" stroke-width="${n(w * 0.026)}" stroke-linecap="round"/>` +
    `<polygon points="${x},${y} ${n(x + depth)},${n(y - rise)} ${n(x + w + depth)},${n(y - rise)} ${x + w},${y}" fill="${shade(color, 0.42)}"/>` +
    `<polygon points="${x + w},${y} ${n(x + w + depth)},${n(y - rise)} ${n(x + w + depth)},${n(y + h - rise)} ${x + w},${y + h}" fill="${shade(color, 0.2)}"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${id}-f)"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${n(h * 0.06)}" fill="#000" fill-opacity="0.06"/>` +
    `<path d="M${n(hl)} ${y + 18}C${n(hl)} ${n(y - h * 0.3)} ${n(hr)} ${n(y - h * 0.3)} ${n(hr)} ${y + 18}" fill="none" stroke="${shade(color, 0.32)}" stroke-width="${n(w * 0.03)}" stroke-linecap="round"/>` +
    `<circle cx="${n(hl)}" cy="${y + 20}" r="${n(w * 0.02)}" fill="${shade(color, 0.5)}"/><circle cx="${n(hr)}" cy="${y + 20}" r="${n(w * 0.02)}" fill="${shade(color, 0.5)}"/>` +
    place(asset, x + w * 0.12, y + h * 0.24, w * 0.76, h * 0.44, `${id}-l-`)
  );
}

function bags(a: BrandAssets) {
  const { primary: P, background: B } = a.colors;
  return (
    `<defs>${linear(
      'mk-wall',
      [
        [0, mix(B, '#e9e4dc', 0.6)],
        [1, mix(B, '#ddd5c9', 0.6)],
      ],
      true,
    )}${linear(
      'mk-table',
      [
        [0, '#d5c9b8'],
        [1, '#c2b39c'],
      ],
      true,
    )}${SHADOW_DEF}</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#mk-wall)"/>` +
    `<rect y="940" width="${W}" height="260" fill="url(#mk-table)"/><rect y="940" width="${W}" height="6" fill="#fff" fill-opacity="0.35"/>` +
    shadow(820, 990, 560, 40, 0.4) +
    bag({ x: 330, y: 560, w: 330, h: 420, color: B, asset: a.logo.color }, 'mk-b2') +
    bag({ x: 640, y: 380, w: 460, h: 600, color: P, asset: onPrimary(a, 'logo') }, 'mk-b1')
  );
}

function stand(a: BrandAssets) {
  const { primary: P, secondary: S } = a.colors;
  const end = mix(P, S, 0.5);
  const art = renderArtwork({
    style: 'waves',
    palette: [S, tint(P, 0.35), shade(P, 0.3)],
    width: 400,
    height: 960,
    seed: hashSeed(`${a.name}:stand`),
  });
  return (
    `<defs>${linear(
      'mk-wall',
      [
        [0, '#eef0f3'],
        [1, '#dfe3e8'],
      ],
      true,
    )}${linear(
      'mk-roll',
      [
        [0, P],
        [1, end],
      ],
      true,
    )}${linear(
      'mk-floor',
      [
        [0, '#cfd3d8'],
        [1, '#b9bec5'],
      ],
      true,
    )}<clipPath id="mk-rc"><rect x="380" y="80" width="400" height="960"/></clipPath>${SHADOW_DEF}</defs>` +
    `<rect width="${W}" height="${H}" fill="url(#mk-wall)"/>` +
    `<rect y="1000" width="${W}" height="200" fill="url(#mk-floor)"/>` +
    shadow(580, 1080, 280, 26, 0.4) +
    shadow(1150, 1050, 330, 24, 0.35) +
    `<g clip-path="url(#mk-rc)"><rect x="380" y="80" width="400" height="960" fill="url(#mk-roll)"/>` +
    `<g opacity="0.22">${place({ svg: art, width: 400, height: 960 }, 380, 80, 400, 960, 'mk-a-')}</g>` +
    place(onPrimary(a, 'logo'), 420, 180, 320, 200, 'l1-') +
    `<g opacity="0.14">${place(onPrimary(a, 'mark'), 430, 470, 300, 300, 'm1-')}</g>` +
    `<rect x="380" y="880" width="400" height="160" fill="#000" fill-opacity="0.22"/>` +
    `<rect x="430" y="930" width="200" height="16" rx="8" fill="#fff" fill-opacity="0.75"/><rect x="430" y="964" width="140" height="14" rx="7" fill="#fff" fill-opacity="0.55"/></g>` +
    `<rect x="372" y="70" width="416" height="16" rx="6" fill="#9ca3af"/>` +
    `<rect x="350" y="1040" width="460" height="40" rx="12" fill="#4b5563"/><rect x="350" y="1040" width="460" height="8" rx="4" fill="#fff" fill-opacity="0.2"/>` +
    `<rect x="880" y="700" width="540" height="30" rx="6" fill="#e5e7eb"/><rect x="880" y="726" width="540" height="6" fill="#000" fill-opacity="0.12"/>` +
    `<rect x="900" y="732" width="500" height="300" fill="${P}"/>` +
    `<rect x="900" y="732" width="500" height="300" fill="url(#mk-floor)" fill-opacity="0.12"/>` +
    place(onPrimary(a, 'logo'), 950, 790, 400, 180, 'l2-') +
    `<rect x="1180" y="612" width="120" height="88" rx="8" fill="#374151"/><rect x="1192" y="624" width="96" height="64" rx="4" fill="${tint(P, 0.6)}"/>` +
    `<rect x="980" y="640" width="70" height="60" rx="6" fill="${S}"/><rect x="1060" y="660" width="70" height="40" rx="6" fill="${tint(S, 0.4)}"/>`
  );
}

const SCENES: Record<string, (a: BrandAssets) => string> = {
  storefront,
  tshirt,
  mugs,
  cards,
  phone,
  van,
  bags,
  stand,
};

/** Image d'une mise en situation, en SVG (1600 × 1200, à tramer en JPG ou PNG). */
export function mockupSvg(assets: BrandAssets, scene: MockupScene): string {
  const draw = SCENES[scene.id];
  if (!draw) throw new Error(`Mise en situation inconnue : ${scene.id}`);
  return wrap(W, H, draw(assets));
}
