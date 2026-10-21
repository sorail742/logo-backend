/**
 * Signature e-mail (SIG-10 à SIG-15) : HTML compatible Gmail, Outlook (bureau et web),
 * Apple Mail et Thunderbird — tableaux, styles en ligne, images PNG en URL HTTPS absolues,
 * aucune classe CSS ni feuille de style. Tout texte saisi est échappé.
 */
import { escapeHtml } from '../../shared/text';

export const SOCIAL_NETWORKS = [
  'facebook',
  'instagram',
  'linkedin',
  'x',
  'tiktok',
  'whatsapp',
  'youtube',
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export interface EmailSignatureData {
  fullName: string;
  jobTitle?: string | null;
  organization?: string | null;
  /** Format international (+224…) (SIG-10). */
  phones?: string[];
  email?: string | null;
  website?: string | null;
  address?: string | null;
  socials?: Partial<Record<SocialNetwork, string>>;
  /** Mention légale libre : agrément, RCCM, confidentialité (SIG-11). */
  legalNotice?: string | null;
  /** Bannière cliquable (SIG-17). */
  banner?: { text: string; url: string } | null;
}

export interface EmailBrand {
  primary: string;
  secondary?: string | null;
  text: string;
  /** Pile de polices CSS, police du kit en tête. */
  fontFamily: string;
  logo?: { url: string; width: number; height: number } | null;
  photo?: { url: string; size: number } | null;
  socialIcons?: Partial<Record<SocialNetwork, string>>;
}

/** Contenu d'un modèle (Template.content, seed) : disposition et options. */
export interface EmailTemplateContent {
  layout: 'logo-left' | 'logo-top' | 'text-only' | 'inline';
  divider?: boolean;
  accentBar?: boolean;
  legalLine?: boolean;
  banner?: boolean;
}

export interface PlatformMention {
  name: string;
  url: string;
}

const GRAY = '#6B7280';

/** +224620000000 → « +224 620 00 00 00 » (affichage) ; le lien garde le format brut. */
export function formatPhone(e164: string): string {
  const digits = e164.replace(/[^\d]/g, '');
  if (digits.startsWith('224') && digits.length === 12) {
    return `+224 ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)} ${digits.slice(10)}`;
  }
  if (digits.startsWith('33') && digits.length === 11) {
    return `+33 ${digits[2]} ${digits.slice(3).match(/.{2}/g)!.join(' ')}`;
  }
  return `+${digits.slice(0, digits.length - 9)} ${digits
    .slice(-9)
    .match(/.{1,3}/g)!
    .join(' ')}`;
}

/** URL sûre pour un lien : http(s) uniquement, sinon rien. */
export function safeUrl(url?: string | null): string | null {
  if (!url) return null;
  const u = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
}

// ─── Fragments ───

const td = (style: string, content: string, attrs = '') =>
  `<td ${attrs} style="${style}">${content}</td>`;

const table = (content: string, font: string, extra = '') =>
  `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;font-family:${font};${extra}">${content}</table>`;

const img = (src: string, w: number, h: number, alt: string, extra = '') =>
  `<img src="${escapeHtml(src)}" width="${w}" height="${h}" alt="${escapeHtml(alt)}" style="display:block;border:0;outline:none;text-decoration:none;width:${w}px;height:${h}px;${extra}" />`;

const link = (href: string, label: string, color: string) =>
  `<a href="${escapeHtml(href)}" style="color:${color};text-decoration:none;">${escapeHtml(label)}</a>`;

function identity(d: EmailSignatureData, b: EmailBrand, opts: { upper?: boolean } = {}): string {
  const org = d.organization
    ? escapeHtml(opts.upper ? d.organization.toUpperCase() : d.organization)
    : '';
  return (
    `<div style="font-size:16px;font-weight:bold;color:${b.text};line-height:1.3;">${escapeHtml(d.fullName)}</div>` +
    (d.jobTitle
      ? `<div style="font-size:13px;color:${b.primary};line-height:1.4;">${escapeHtml(d.jobTitle)}</div>`
      : '') +
    (org
      ? `<div style="font-size:13px;color:${GRAY};line-height:1.4;${opts.upper ? 'letter-spacing:1px;' : ''}">${org}</div>`
      : '')
  );
}

function contactLines(d: EmailSignatureData, b: EmailBrand): string[] {
  const lines: string[] = [];
  const phones = (d.phones ?? []).map((p) =>
    link(`tel:${p.replace(/[^\d+]/g, '')}`, formatPhone(p), b.text),
  );
  if (phones.length) lines.push(phones.join(' &nbsp;|&nbsp; '));
  if (d.email) lines.push(link(`mailto:${d.email}`, d.email, b.primary));
  const site = safeUrl(d.website);
  if (site) lines.push(link(site, displayUrl(site), b.primary));
  if (d.address) lines.push(`<span style="color:${GRAY};">${escapeHtml(d.address)}</span>`);
  return lines;
}

function socialRow(d: EmailSignatureData, b: EmailBrand): string {
  const cells = SOCIAL_NETWORKS.flatMap((net) => {
    const url = safeUrl(d.socials?.[net]);
    if (!url) return [];
    const icon = b.socialIcons?.[net];
    const inner = icon
      ? `<a href="${escapeHtml(url)}" style="text-decoration:none;">${img(icon, 20, 20, net)}</a>`
      : link(url, net, b.primary);
    return [td('padding:0 6px 0 0;', inner)];
  });
  return cells.length ? table(`<tr>${cells.join('')}</tr>`, b.fontFamily, 'margin-top:8px;') : '';
}

function legal(d: EmailSignatureData): string {
  return d.legalNotice
    ? `<div style="font-size:11px;color:${GRAY};line-height:1.4;margin-top:10px;max-width:480px;">${escapeHtml(d.legalNotice)}</div>`
    : '';
}

function bannerBlock(d: EmailSignatureData, b: EmailBrand): string {
  const url = safeUrl(d.banner?.url);
  if (!d.banner?.text || !url) return '';
  return table(
    `<tr>${td(`background-color:${b.primary};padding:10px 16px;border-radius:4px;`, `<a href="${escapeHtml(url)}" style="color:#FFFFFF;text-decoration:none;font-weight:bold;font-size:13px;">${escapeHtml(d.banner.text)} &rarr;</a>`)}</tr>`,
    b.fontFamily,
    'margin-top:12px;',
  );
}

function mention(m: PlatformMention | null, font: string): string {
  return m
    ? `<div style="font-family:${font};font-size:10px;color:#9CA3AF;margin-top:10px;">Signature créée avec <a href="${escapeHtml(m.url)}" style="color:#9CA3AF;">${escapeHtml(m.name)}</a></div>`
    : '';
}

// ─── Rendu ───

export function renderEmailSignatureHtml(
  d: EmailSignatureData,
  b: EmailBrand,
  t: EmailTemplateContent,
  platform: PlatformMention | null,
): string {
  const base = `font-size:13px;line-height:1.5;color:${b.text};`;
  const contacts = contactLines(d, b)
    .map((l) => `<div style="font-size:13px;line-height:1.5;">${l}</div>`)
    .join('');
  const photo = b.photo
    ? img(b.photo.url, b.photo.size, b.photo.size, d.fullName, 'border-radius:50%;')
    : '';
  const logo = b.logo
    ? img(b.logo.url, b.logo.width, b.logo.height, d.organization ?? d.fullName)
    : '';
  let body: string;

  switch (t.layout) {
    case 'logo-top':
      body = table(
        (logo ? `<tr>${td('padding:0 0 10px 0;', logo)}</tr>` : '') +
          (t.accentBar
            ? `<tr>${td(`border-top:3px solid ${b.primary};font-size:0;line-height:0;height:8px;`, '&nbsp;')}</tr>`
            : '') +
          `<tr>${td(base, identity(d, b) + `<div style="height:6px;"></div>` + contacts + socialRow(d, b))}</tr>`,
        b.fontFamily,
      );
      break;

    case 'text-only':
      body = table(
        `<tr>${td(base, identity(d, b) + `<div style="height:6px;"></div>` + contacts + socialRow(d, b))}</tr>`,
        b.fontFamily,
      );
      break;

    case 'inline': {
      const parts = [
        `<strong style="color:${b.text};">${escapeHtml(d.fullName)}</strong>`,
        d.jobTitle ? `<span style="color:${b.primary};">${escapeHtml(d.jobTitle)}</span>` : '',
        d.organization ? `<span style="color:${GRAY};">${escapeHtml(d.organization)}</span>` : '',
        ...contactLines(d, b),
      ].filter(Boolean);
      body = table(
        `<tr>${td(base, parts.join(` <span style="color:#D1D5DB;">|</span> `))}</tr>`,
        b.fontFamily,
      );
      break;
    }

    case 'logo-left':
    default: {
      const left = photo || logo;
      const leftCell = left
        ? td(
            `vertical-align:top;padding:0 14px 0 0;${t.divider !== false ? `border-right:2px solid ${b.primary};` : ''}`,
            left + (photo && logo ? `<div style="height:8px;"></div>${logo}` : ''),
            'valign="top"',
          )
        : '';
      const rightCell = td(
        `vertical-align:top;padding:0 0 0 ${left ? 14 : 0}px;${base}`,
        identity(d, b, { upper: t.legalLine }) +
          `<div style="height:6px;"></div>` +
          contacts +
          socialRow(d, b),
        'valign="top"',
      );
      body = table(`<tr>${leftCell}${rightCell}</tr>`, b.fontFamily);
    }
  }

  return [
    `<!-- Signature e-mail -->`,
    body,
    t.banner ? bannerBlock(d, b) : '',
    legal(d),
    mention(platform, b.fontFamily),
  ].join('');
}

/** Version texte brut (SIG-15). */
export function renderEmailSignatureText(
  d: EmailSignatureData,
  platform: PlatformMention | null,
): string {
  const lines = [
    '--',
    d.fullName,
    [d.jobTitle, d.organization].filter(Boolean).join(' — '),
    ...(d.phones ?? []).map((p) => `Tél. : ${formatPhone(p)}`),
    d.email ? `E-mail : ${d.email}` : '',
    safeUrl(d.website) ? `Site : ${displayUrl(safeUrl(d.website)!)}` : '',
    d.address ?? '',
    ...SOCIAL_NETWORKS.flatMap((n) =>
      safeUrl(d.socials?.[n]) ? [`${n} : ${safeUrl(d.socials?.[n])}`] : [],
    ),
    d.banner?.text && safeUrl(d.banner.url) ? `${d.banner.text} : ${safeUrl(d.banner.url)}` : '',
    d.legalNotice ? `\n${d.legalNotice}` : '',
    platform ? `\nSignature créée avec ${platform.name} — ${platform.url}` : '',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

/** Guide d'installation par messagerie (SIG-14). */
export const INSTALL_GUIDE = [
  {
    client: 'Gmail (web)',
    steps: [
      'Cliquez sur « Copier la signature ».',
      'Dans Gmail : roue dentée → Voir tous les paramètres → onglet Général → Signature.',
      'Créez une signature, collez (Ctrl+V / Cmd+V), puis « Enregistrer les modifications » en bas de page.',
    ],
  },
  {
    client: 'Outlook (bureau, Windows)',
    steps: [
      'Copiez la signature.',
      'Fichier → Options → Courrier → Signatures… → Nouveau.',
      'Collez dans la zone d’édition, choisissez-la par défaut pour les nouveaux messages et les réponses, puis OK.',
    ],
  },
  {
    client: 'Outlook (web, Microsoft 365)',
    steps: [
      'Copiez la signature.',
      'Paramètres → Courrier → Composer et répondre → Signature électronique.',
      'Collez, nommez la signature, choisissez-la par défaut, Enregistrer.',
    ],
  },
  {
    client: 'Apple Mail (macOS)',
    steps: [
      'Ouvrez la signature dans Safari et copiez-la.',
      'Mail → Réglages → Signatures → « + ».',
      'Décochez « Toujours utiliser ma police par défaut », collez la signature, fermez la fenêtre.',
    ],
  },
  {
    client: 'Thunderbird',
    steps: [
      'Téléchargez la version HTML de la signature.',
      'Paramètres des comptes → votre compte → « Utiliser un fichier comme signature » → choisissez le fichier .html.',
    ],
  },
];
