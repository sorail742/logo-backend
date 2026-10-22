import { hashSeed, renderArtwork } from './artwork';
import { mix, readableOn } from './color';
import { place, wrap, type BrandAsset, type BrandAssets } from './compose';

// Kit réseaux sociaux : photos de profil et bannières aux dimensions de chaque réseau, le logo
// placé dans la zone sûre (hors de l'avatar qui recouvre la bannière, hors du recadrage mobile),
// sur un fond aux couleurs de la marque. Même module côté front (src/lib/render/social-kit.ts).

type Kind = 'profile' | 'profile-inverse' | 'cover' | 'story';

export interface SocialFormat {
  id: string;
  file: string;
  width: number;
  height: number;
  kind: Kind;
  /** Zone sûre [x, y, largeur, hauteur], en proportions du format. */
  safe: readonly [number, number, number, number];
}

export const SOCIAL_KIT: readonly SocialFormat[] = [
  // Photo de profil : affichée en cercle partout, d'où une marge qui tient dans le disque.
  {
    id: 'profile',
    file: 'profil-1080x1080',
    width: 1080,
    height: 1080,
    kind: 'profile',
    safe: [0.2, 0.2, 0.6, 0.6],
  },
  {
    id: 'profile-inverse',
    file: 'profil-couleur-1080x1080',
    width: 1080,
    height: 1080,
    kind: 'profile-inverse',
    safe: [0.2, 0.2, 0.6, 0.6],
  },
  // Facebook : le mobile ne montre que le centre de la couverture.
  {
    id: 'facebook',
    file: 'facebook-couverture-1640x624',
    width: 1640,
    height: 624,
    kind: 'cover',
    safe: [0.26, 0.2, 0.48, 0.5],
  },
  // LinkedIn, X : l'avatar recouvre le bas à gauche.
  {
    id: 'linkedin',
    file: 'linkedin-banniere-1584x396',
    width: 1584,
    height: 396,
    kind: 'cover',
    safe: [0.38, 0.2, 0.54, 0.56],
  },
  {
    id: 'linkedin-page',
    file: 'linkedin-page-1128x191',
    width: 1128,
    height: 191,
    kind: 'cover',
    safe: [0.32, 0.2, 0.6, 0.6],
  },
  {
    id: 'x',
    file: 'x-banniere-1500x500',
    width: 1500,
    height: 500,
    kind: 'cover',
    safe: [0.36, 0.22, 0.54, 0.48],
  },
  // YouTube : seule la bande centrale de 1546 × 423 px est visible sur tous les appareils.
  {
    id: 'youtube',
    file: 'youtube-banniere-2560x1440',
    width: 2560,
    height: 1440,
    kind: 'cover',
    safe: [0.23, 0.37, 0.54, 0.26],
  },
  // Statut WhatsApp, story Instagram et Facebook.
  {
    id: 'story',
    file: 'story-1080x1920',
    width: 1080,
    height: 1920,
    kind: 'story',
    safe: [0.16, 0.38, 0.68, 0.24],
  },
];

/** Image d'un format du kit, en SVG (à tramer en PNG à sa taille). */
export function socialKitSvg(input: BrandAssets, format: SocialFormat): string {
  const { width: W, height: H } = format;
  const { primary, secondary, background } = input.colors;
  const [sx, sy, sw, sh] = format.safe;
  const area = [sx * W, sy * H, sw * W, sh * H] as const;

  if (format.kind === 'profile') {
    const mark = place(input.mark.color, ...area, 'm-');
    return wrap(W, H, `<rect width="${W}" height="${H}" fill="${background}"/>${mark}`);
  }

  // Fond : dégradé de la couleur principale quand elle est foncée, logo en blanc. Une couleur claire
  // (jaune, pastel) noierait le symbole qui la porte : le fond clair de la marque prend le relais,
  // teinté de la couleur principale, et le logo garde ses couleurs d'origine.
  const onDark = readableOn(primary) === '#ffffff';
  const inverse = format.kind === 'profile-inverse';
  const base = onDark || inverse ? primary : background;
  const end = onDark || inverse ? mix(primary, secondary, 0.5) : mix(background, primary, 0.45);
  const art = renderArtwork({
    style: 'waves',
    palette: onDark
      ? [secondary, mix(primary, '#ffffff', 0.35), mix(primary, '#000000', 0.3)]
      : [primary, secondary, mix(primary, '#ffffff', 0.4)],
    width: W,
    height: H,
    seed: hashSeed(`${input.name}:${format.id}`),
  });
  const backdrop =
    `<defs><linearGradient id="sk-bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${base}"/><stop offset="1" stop-color="${end}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#sk-bg)"/>` +
    `<g opacity="${onDark ? 0.2 : 0.25}">${place({ svg: art, width: W, height: H }, 0, 0, W, H, 'a-')}</g>`;
  const darkBase = readableOn(base) === '#ffffff';
  let asset: BrandAsset;
  if (inverse) asset = onDark ? input.mark.white : input.mark.black;
  else asset = darkBase ? input.logo.white : input.logo.color;
  return wrap(W, H, backdrop + place(asset, ...area, 'l-'));
}
