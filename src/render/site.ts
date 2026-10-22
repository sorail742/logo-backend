import { hashSeed, renderArtwork } from './artwork';
import { ensureContrast, mix, readableOn } from './color';
import { prefixIds } from './compose';
import { getIcon, type IconNode } from './icons';
import { escapeXml as esc } from './svg';

// Site web de la marque : une page complète (accueil, à propos, services, galerie, témoignages,
// questions, contact) générée depuis le kit, en HTML autonome (styles et script en ligne).
// Le même rendu sert l'aperçu de l'éditeur, le site publié et l'export ZIP.
// Même module côté front (src/lib/render/site.ts).

export type SiteTheme = 'modern' | 'elegant' | 'bold';
export const SITE_THEMES: readonly SiteTheme[] = ['modern', 'elegant', 'bold'];
export type SiteLanguage = 'fr' | 'en';

export const SITE_SECTION_TYPES = [
  'hero',
  'about',
  'services',
  'gallery',
  'testimonials',
  'faq',
  'contact',
] as const;
export type SiteSectionType = (typeof SITE_SECTION_TYPES)[number];

export interface SiteServiceItem {
  title: string;
  text: string;
  icon: string;
}
export interface SiteTestimonial {
  quote: string;
  author: string;
  role: string;
}
export interface SiteQuestion {
  question: string;
  answer: string;
}

interface SectionBase {
  visible: boolean;
  title: string;
}
export type SiteSection =
  | (SectionBase & {
      type: 'hero';
      subtitle: string;
      cta: string;
      ctaTarget: 'contact' | 'whatsapp' | 'services';
      /** Visuel : image téléversée, mise en situation, ou rien (symbole de la marque). */
      image: SiteImage | null;
    })
  | (SectionBase & { type: 'about'; text: string; values: string[] })
  | (SectionBase & { type: 'services'; intro: string; items: SiteServiceItem[] })
  | (SectionBase & { type: 'gallery'; images: SiteImage[] })
  | (SectionBase & { type: 'testimonials'; items: SiteTestimonial[] })
  | (SectionBase & { type: 'faq'; items: SiteQuestion[] })
  | (SectionBase & { type: 'contact'; text: string; form: boolean });

/** Image du site : téléversée (media) ou mise en situation du logo (mockup). */
export type SiteImage =
  { kind: 'media'; id: string; alt: string } | { kind: 'mockup'; scene: string };

export interface SiteContact {
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  hours: string;
}

export const SITE_SOCIALS = [
  'facebook',
  'instagram',
  'linkedin',
  'tiktok',
  'x',
  'youtube',
] as const;
export type SiteSocial = (typeof SITE_SOCIALS)[number];

export interface SiteFont {
  id: string;
  weight: number;
}

export interface SiteContent {
  language: SiteLanguage;
  theme: SiteTheme;
  colors: { primary: string; secondary: string; text: string; background: string };
  fonts: { heading: SiteFont; body: SiteFont };
  sections: SiteSection[];
  contact: SiteContact;
  social: Partial<Record<SiteSocial, string>>;
  seo: { title: string; description: string };
  /** Mention discrète de la plateforme en pied de page. */
  credit: boolean;
}

export interface SiteUrls {
  /** Fichier WOFF d'une police ; null si ce sous-ensemble n'existe pas. */
  font(id: string, weight: number, subset: 'latin' | 'latin-ext'): string | null;
  media(id: string): string;
  mockup(scene: string): string;
  /** og.png (1200 × 630), favicon.png (64), icon-180.png. */
  file(name: 'og.png' | 'favicon.png' | 'icon-180.png'): string | null;
  /** Point d'envoi du formulaire de contact ; null : formulaire inactif (aperçu). */
  form: string | null;
  canonical: string | null;
}

export interface SiteRenderInput {
  content: SiteContent;
  name: string;
  /** SVG autonomes du logo complet et du symbole. */
  logo: { color: string; white: string; mark: string };
  urls: SiteUrls;
  /** Mention de la plateforme (libellé et lien), si le site l'affiche. */
  platform: { name: string; url: string } | null;
  /** Aperçu de l'éditeur : non indexé, liens externes inactifs. */
  preview?: boolean;
}

const ANCHORS: Record<SiteLanguage, Record<SiteSectionType, string>> = {
  fr: {
    hero: 'accueil',
    about: 'a-propos',
    services: 'services',
    gallery: 'galerie',
    testimonials: 'temoignages',
    faq: 'questions',
    contact: 'contact',
  },
  en: {
    hero: 'home',
    about: 'about',
    services: 'services',
    gallery: 'gallery',
    testimonials: 'testimonials',
    faq: 'faq',
    contact: 'contact',
  },
};

const LABELS = {
  fr: {
    nav: {
      about: 'À propos',
      services: 'Services',
      gallery: 'Galerie',
      testimonials: 'Témoignages',
      faq: 'Questions',
      contact: 'Contact',
    },
    menu: 'Menu',
    more: 'En savoir plus',
    phone: 'Téléphone',
    whatsapp: 'WhatsApp',
    email: 'E-mail',
    address: 'Adresse',
    hours: 'Horaires',
    map: 'Voir sur la carte',
    chat: 'Écrire sur WhatsApp',
    form: {
      name: 'Votre nom',
      email: 'Votre e-mail',
      phone: 'Votre téléphone',
      message: 'Votre message',
      send: 'Envoyer',
      sending: 'Envoi…',
      sent: 'Merci ! Votre message a bien été envoyé.',
      error: 'L’envoi a échoué. Réessayez ou contactez-nous directement.',
      preview: 'Formulaire actif une fois le site publié.',
      noscript: 'Activez JavaScript pour envoyer ce formulaire, ou contactez-nous directement.',
    },
    rights: 'Tous droits réservés.',
    credit: 'Site créé avec',
    follow: 'Suivez-nous',
  },
  en: {
    nav: {
      about: 'About',
      services: 'Services',
      gallery: 'Gallery',
      testimonials: 'Testimonials',
      faq: 'FAQ',
      contact: 'Contact',
    },
    menu: 'Menu',
    more: 'Learn more',
    phone: 'Phone',
    whatsapp: 'WhatsApp',
    email: 'Email',
    address: 'Address',
    hours: 'Opening hours',
    map: 'View on the map',
    chat: 'Chat on WhatsApp',
    form: {
      name: 'Your name',
      email: 'Your email',
      phone: 'Your phone',
      message: 'Your message',
      send: 'Send',
      sending: 'Sending…',
      sent: 'Thank you! Your message has been sent.',
      error: 'Sending failed. Please try again or contact us directly.',
      preview: 'The form works once the site is published.',
      noscript: 'Enable JavaScript to send this form, or contact us directly.',
    },
    rights: 'All rights reserved.',
    credit: 'Website made with',
    follow: 'Follow us',
  },
};

const SOCIAL_LABELS: Record<SiteSocial, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  tiktok: 'TikTok',
  x: 'X',
  youtube: 'YouTube',
};

// Icônes d'interface (lucide, licence ISC).
const UI_ICONS: Record<string, string> = {
  phone:
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  menu: '<line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="18" y2="18"/>',
  arrow: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
};

/** SVG intégré à la page : sans déclaration XML, identifiants préfixés (plusieurs logos par page). */
function inlineSvg(svg: string, prefix: string) {
  return prefixIds(svg.replace(/^<\?xml[^>]*>\s*/, ''), prefix);
}

function icon(markup: string, size = 20) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${markup}</svg>`;
}

function nodeMarkup(node: IconNode) {
  return node
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .map(([key, value]) => `${key}="${esc(String(value))}"`)
        .join(' ');
      return `<${tag} ${attributes}/>`;
    })
    .join('');
}

function libraryIcon(id: string) {
  const found = getIcon(id) ?? getIcon('sparkles');
  return found ? icon(nodeMarkup(found.node), 26) : '';
}

/** Lien sûr : web, courriel, téléphone ; sinon null. */
export function safeHref(value: string): string | null {
  const url = value.trim();
  if (!url) return null;
  if (/^(mailto|tel):[^\s"'<>]+$/i.test(url)) return url;
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(withScheme);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function whatsappHref(phone: string, text = '') {
  const digits = phone.replaceAll(/\D/g, '').replace(/^00/, '');
  if (!digits) return null;
  const message = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/${digits}${message}`;
}

function telHref(phone: string) {
  const digits = phone.replaceAll(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : null;
}

function paragraphs(text: string) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${esc(block).replaceAll('\n', '<br>')}</p>`)
    .join('');
}

function imageUrl(image: SiteImage, urls: SiteUrls) {
  return image.kind === 'media' ? urls.media(image.id) : urls.mockup(image.scene);
}

function imageAlt(image: SiteImage, name: string) {
  return image.kind === 'media' ? image.alt || name : `${name} — ${image.scene}`;
}

// ─── Styles ───

interface Palette {
  primary: string;
  onPrimary: string;
  secondary: string;
  onSecondary: string;
  text: string;
  muted: string;
  background: string;
  surface: string;
  accent: string;
  line: string;
  dark: string;
}

function palette(colors: SiteContent['colors']): Palette {
  const background = colors.background;
  const text = ensureContrast(colors.text, background, 7);
  return {
    primary: colors.primary,
    onPrimary: readableOn(colors.primary),
    secondary: colors.secondary,
    onSecondary: readableOn(colors.secondary),
    text,
    muted: mix(text, background, 0.35),
    background,
    surface: mix(background, colors.primary, 0.05),
    accent: ensureContrast(colors.primary, background, 4.5),
    line: mix(background, text, 0.12),
    dark: mix(colors.primary, '#000000', 0.78),
  };
}

const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const LATIN_EXT =
  'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

function fontFaces(fonts: SiteContent['fonts'], urls: SiteUrls) {
  const faces = new Map<string, SiteFont>();
  const body = fonts.body;
  for (const font of [fonts.heading, body, { id: body.id, weight: 700 }]) {
    faces.set(`${font.id}-${font.weight}`, font);
  }
  return [...faces.values()]
    .flatMap(({ id, weight }) =>
      (['latin', 'latin-ext'] as const).map((subset) => {
        const url = urls.font(id, weight, subset);
        const range = subset === 'latin' ? LATIN : LATIN_EXT;
        return url
          ? `@font-face{font-family:'${id}';font-style:normal;font-weight:${weight};font-display:swap;src:url('${url}') format('woff');unicode-range:${range}}`
          : '';
      }),
    )
    .join('');
}

function themeCss(theme: SiteTheme, p: Palette) {
  if (theme === 'elegant') {
    return `body{background:${p.background}}.btn{border-radius:2px;letter-spacing:.08em;text-transform:uppercase;font-size:.82rem}.btn-ghost{border-color:${p.text}}.hero{text-align:center;background:${p.surface};border-bottom:1px solid ${p.line}}.hero .grid{grid-template-columns:1fr}.hero .lead{margin-inline:auto}.hero .actions{justify-content:center}.hero-visual{max-width:640px;margin:2rem auto 0}.eyebrow{letter-spacing:.24em}h2{font-weight:inherit}.card{border:1px solid ${p.line};box-shadow:none;border-radius:2px}.section-alt{background:${p.surface}}`;
  }
  if (theme === 'bold') {
    return `.hero{background:${p.primary} var(--art) center/cover;color:${p.onPrimary}}.hero .lead{color:inherit;opacity:.88}.hero .btn{background:${p.secondary};color:${p.onSecondary}}.hero .btn-ghost{background:transparent;color:inherit;border-color:currentColor}.hero .eyebrow{color:inherit;opacity:.8}.btn{border-radius:14px}.card{border-radius:18px;border:0;box-shadow:0 18px 40px -24px rgba(0,0,0,.35)}.section-alt{background:${p.dark};color:#fff}.section-alt .lead,.section-alt .card p{color:rgba(255,255,255,.78)}.section-alt .card{background:rgba(255,255,255,.06);color:#fff}.section-alt .eyebrow{color:${p.secondary}}`;
  }
  return `.hero{background:radial-gradient(circle at 85% 20%,${mix(p.primary, p.background, 0.82)} 0,transparent 55%),radial-gradient(circle at 10% 90%,${mix(p.secondary, p.background, 0.85)} 0,transparent 45%),${p.background}}.btn{border-radius:999px}.card{border-radius:16px}.section-alt{background:${p.surface}}`;
}

function baseCss(content: SiteContent, p: Palette, art: string) {
  const heading = `'${content.fonts.heading.id}',system-ui,sans-serif`;
  const body = `'${content.fonts.body.id}',system-ui,sans-serif`;
  return `*,*::before,*::after{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}body{margin:0;font-family:${body};font-weight:${content.fonts.body.weight};color:${p.text};background:${p.background};line-height:1.65;font-size:17px}img{max-width:100%;display:block}a{color:${p.accent}}h1,h2,h3{font-family:${heading};font-weight:${content.fonts.heading.weight};line-height:1.15;margin:0 0 .6em}h1{font-size:clamp(2.2rem,5vw,3.6rem)}h2{font-size:clamp(1.7rem,3.4vw,2.5rem)}h3{font-size:1.2rem}p{margin:0 0 1em}.container{width:min(1120px,100% - 40px);margin-inline:auto}section{padding:88px 0;scroll-margin-top:72px}.section-alt{}.eyebrow{display:inline-block;font-size:.78rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${p.accent};margin-bottom:.8rem}.lead{font-size:1.15rem;color:${p.muted};max-width:640px}.btn{display:inline-flex;align-items:center;gap:.5rem;padding:.85rem 1.5rem;border:2px solid transparent;background:${p.primary};color:${p.onPrimary};font-weight:700;text-decoration:none;cursor:pointer;font:inherit;font-weight:700}.btn:hover{filter:brightness(1.07)}.btn-ghost{background:transparent;color:inherit;border-color:${p.line}}.actions{display:flex;flex-wrap:wrap;gap:.8rem;margin-top:1.8rem}
.site-header{position:sticky;top:0;z-index:20;background:${p.background};border-bottom:1px solid ${p.line}}.site-header .container{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:68px}.brand{display:flex;align-items:center;height:44px}.brand svg{height:44px;width:auto;max-width:220px}.nav{display:flex;gap:1.4rem;align-items:center}.nav a{color:${p.text};text-decoration:none;font-weight:600;font-size:.95rem}.nav a:hover{color:${p.accent}}.nav .btn{padding:.55rem 1.1rem;color:${p.onPrimary}}.nav-toggle,.nav-button{display:none}
@media (max-width:820px){.nav-button{display:inline-flex;cursor:pointer;padding:.4rem;color:${p.text}}.nav{display:none;position:absolute;top:68px;left:0;right:0;flex-direction:column;align-items:stretch;gap:0;background:${p.background};border-bottom:1px solid ${p.line};padding:.5rem 20px 1rem}.nav a{padding:.75rem 0;border-bottom:1px solid ${p.line}}.nav .btn{margin-top:.8rem;justify-content:center}.nav-toggle:checked~.nav{display:flex}section{padding:64px 0}}
.hero{--art:url("${art}");padding:96px 0 104px}.hero .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:3rem;align-items:center}.hero-visual img,.hero-visual svg{width:100%;height:auto;border-radius:18px}.hero-mark{display:flex;justify-content:center}.hero-mark svg{max-width:320px;height:auto}@media (max-width:820px){.hero .grid{grid-template-columns:1fr}.hero{padding:64px 0}}
.about .grid{display:grid;grid-template-columns:1.3fr .7fr;gap:3rem}.values{list-style:none;padding:0;margin:0;display:grid;gap:.75rem}.values li{display:flex;gap:.6rem;align-items:center;font-weight:600}.values svg{color:${p.accent};flex:none}@media (max-width:820px){.about .grid{grid-template-columns:1fr}}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1.4rem;margin-top:2.4rem}.card{background:${p.background};padding:1.8rem;box-shadow:0 10px 30px -20px rgba(0,0,0,.25);border:1px solid ${p.line}}.card .card-icon{display:inline-flex;padding:.7rem;border-radius:12px;background:${mix(p.primary, p.background, 0.86)};color:${ensureContrast(p.primary, mix(p.primary, p.background, 0.86), 3)};margin-bottom:1rem}.card p{color:${p.muted};margin:0}
.gallery-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;margin-top:2.4rem}.gallery-grid img{width:100%;height:auto;aspect-ratio:4/3;object-fit:cover;border-radius:12px}
blockquote{margin:0}.quote{font-size:1.08rem}.quote footer{margin-top:1rem;font-weight:700}.quote footer span{display:block;font-weight:400;opacity:.7;font-size:.9rem}
details{border-bottom:1px solid ${p.line};padding:1.1rem 0}summary{cursor:pointer;font-weight:700;font-size:1.05rem}details p{margin:.8rem 0 0;color:${p.muted}}.faq-list{max-width:820px;margin-top:2rem}
.contact .grid{display:grid;grid-template-columns:.9fr 1.1fr;gap:3rem}.contact-list{list-style:none;padding:0;margin:1.6rem 0 0;display:grid;gap:1rem}.contact-list li{display:flex;gap:.8rem;align-items:flex-start}.contact-list svg{color:${p.accent};flex:none;margin-top:.2rem}.contact-list a{color:inherit}.form{display:grid;gap:.9rem;background:${p.background};padding:1.8rem;border:1px solid ${p.line};border-radius:16px;color:${p.text}}.form label{display:grid;gap:.35rem;font-weight:600;font-size:.92rem}.form input,.form textarea{font:inherit;padding:.75rem .9rem;border:1px solid ${p.line};border-radius:10px;background:${p.background};color:${p.text}}.form textarea{min-height:140px;resize:vertical}.form .row{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}.form-status{margin:0;font-weight:600}.hp{position:absolute;left:-9999px}@media (max-width:820px){.contact .grid,.form .row{grid-template-columns:1fr}}
.site-footer{background:${p.dark};color:rgba(255,255,255,.82);padding:48px 0 32px;font-size:.92rem}.site-footer .container{display:flex;flex-wrap:wrap;gap:1.5rem;justify-content:space-between;align-items:center}.site-footer a{color:#fff}.socials{display:flex;flex-wrap:wrap;gap:.6rem}.socials a{text-decoration:none;border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:.35rem .9rem}.credit{width:100%;opacity:.6;font-size:.8rem}
.chat{position:fixed;right:20px;bottom:20px;z-index:30;display:inline-flex;align-items:center;gap:.5rem;background:#1f9d55;color:#fff;padding:.8rem 1.1rem;border-radius:999px;text-decoration:none;font-weight:700;box-shadow:0 12px 30px -10px rgba(0,0,0,.45)}`;
}

// ─── Sections ───

type Section<T extends SiteSectionType> = Extract<SiteSection, { type: T }>;

interface Ctx {
  input: SiteRenderInput;
  labels: (typeof LABELS)['fr'];
  anchors: Record<SiteSectionType, string>;
  whatsapp: string | null;
}

function heading(eyebrow: string, title: string) {
  return `<span class="eyebrow">${esc(eyebrow)}</span><h2>${esc(title)}</h2>`;
}

function heroSection(s: Section<'hero'>, ctx: Ctx) {
  const { input, labels, anchors } = ctx;
  const targets = {
    contact: `#${anchors.contact}`,
    services: `#${anchors.services}`,
    whatsapp: ctx.whatsapp ?? `#${anchors.contact}`,
  };
  const mark = input.content.theme === 'bold' ? input.logo.white : input.logo.mark;
  const visual = s.image
    ? `<img src="${esc(imageUrl(s.image, input.urls))}" alt="${esc(imageAlt(s.image, input.name))}" width="800" height="600">`
    : `<div class="hero-mark">${inlineSvg(mark, 'hm-')}</div>`;
  const subtitle = s.subtitle ? `<p class="lead">${esc(s.subtitle)}</p>` : '';
  const external =
    s.ctaTarget === 'whatsapp' && ctx.whatsapp ? ' target="_blank" rel="noopener"' : '';
  return `<section class="hero" id="${anchors.hero}"><div class="container grid"><div><h1>${esc(s.title)}</h1>${subtitle}<div class="actions"><a class="btn" href="${esc(targets[s.ctaTarget])}"${external}>${esc(s.cta)} ${icon(UI_ICONS.arrow, 18)}</a><a class="btn btn-ghost" href="#${anchors.about}">${esc(labels.more)}</a></div></div><div class="hero-visual">${visual}</div></div></section>`;
}

function aboutSection(s: Section<'about'>, ctx: Ctx, alt: boolean) {
  const items = s.values
    .filter(Boolean)
    .map((v) => `<li>${icon(UI_ICONS.check)}${esc(v)}</li>`)
    .join('');
  const list = items ? `<ul class="values">${items}</ul>` : '';
  return `<section class="about${alt ? ' section-alt' : ''}" id="${ctx.anchors.about}"><div class="container grid"><div>${heading(ctx.labels.nav.about, s.title)}<div class="lead">${paragraphs(s.text)}</div></div>${list}</div></section>`;
}

function servicesSection(s: Section<'services'>, ctx: Ctx, alt: boolean) {
  const cards = s.items
    .map(
      (item) =>
        `<article class="card"><span class="card-icon">${libraryIcon(item.icon)}</span><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></article>`,
    )
    .join('');
  const intro = s.intro ? `<p class="lead">${esc(s.intro)}</p>` : '';
  return `<section class="services${alt ? ' section-alt' : ''}" id="${ctx.anchors.services}"><div class="container">${heading(ctx.labels.nav.services, s.title)}${intro}<div class="cards">${cards}</div></div></section>`;
}

function gallerySection(s: Section<'gallery'>, ctx: Ctx, alt: boolean) {
  const { urls, name } = ctx.input;
  const images = s.images
    .map(
      (image) =>
        `<img src="${esc(imageUrl(image, urls))}" alt="${esc(imageAlt(image, name))}" loading="lazy" width="800" height="600">`,
    )
    .join('');
  return `<section class="gallery${alt ? ' section-alt' : ''}" id="${ctx.anchors.gallery}"><div class="container">${heading(ctx.labels.nav.gallery, s.title)}<div class="gallery-grid">${images}</div></div></section>`;
}

function testimonialsSection(s: Section<'testimonials'>, ctx: Ctx, alt: boolean) {
  const quotes = s.items
    .map((item) => {
      const role = item.role ? `<span>${esc(item.role)}</span>` : '';
      return `<blockquote class="card quote"><p>« ${esc(item.quote)} »</p><footer>${esc(item.author)}${role}</footer></blockquote>`;
    })
    .join('');
  return `<section class="testimonials${alt ? ' section-alt' : ''}" id="${ctx.anchors.testimonials}"><div class="container">${heading(ctx.labels.nav.testimonials, s.title)}<div class="cards">${quotes}</div></div></section>`;
}

function faqSection(s: Section<'faq'>, ctx: Ctx, alt: boolean) {
  const items = s.items
    .map(
      (item) =>
        `<details><summary>${esc(item.question)}</summary><p>${esc(item.answer)}</p></details>`,
    )
    .join('');
  return `<section class="faq${alt ? ' section-alt' : ''}" id="${ctx.anchors.faq}"><div class="container">${heading(ctx.labels.nav.faq, s.title)}<div class="faq-list">${items}</div></div></section>`;
}

function contactItems(ctx: Ctx) {
  const { contact } = ctx.input.content;
  const { labels } = ctx;
  const items: string[] = [];
  const tel = telHref(contact.phone);
  if (tel)
    items.push(
      `<li>${icon(UI_ICONS.phone)}<div><strong>${labels.phone}</strong><br><a href="${esc(tel)}">${esc(contact.phone)}</a></div></li>`,
    );
  if (ctx.whatsapp)
    items.push(
      `<li>${icon(UI_ICONS.chat)}<div><strong>${labels.whatsapp}</strong><br><a href="${esc(ctx.whatsapp)}" target="_blank" rel="noopener">${esc(contact.whatsapp)}</a></div></li>`,
    );
  if (contact.email)
    items.push(
      `<li>${icon(UI_ICONS.mail)}<div><strong>${labels.email}</strong><br><a href="mailto:${esc(contact.email)}">${esc(contact.email)}</a></div></li>`,
    );
  if (contact.address) {
    const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`;
    items.push(
      `<li>${icon(UI_ICONS.pin)}<div><strong>${labels.address}</strong><br>${esc(contact.address)}<br><a href="${esc(map)}" target="_blank" rel="noopener">${labels.map}</a></div></li>`,
    );
  }
  if (contact.hours)
    items.push(
      `<li>${icon(UI_ICONS.clock)}<div><strong>${labels.hours}</strong><br>${esc(contact.hours).replaceAll('\n', '<br>')}</div></li>`,
    );
  return items.join('');
}

function contactForm(ctx: Ctx) {
  const f = ctx.labels.form;
  const action = ctx.input.urls.form;
  const status = action ? '' : esc(f.preview);
  const disabled = action ? '' : ' disabled';
  return `<form class="form" id="contact-form" data-action="${esc(action ?? '')}" novalidate><div class="row"><label>${f.name}<input name="name" required maxlength="120" autocomplete="name"></label><label>${f.phone}<input name="phone" maxlength="40" autocomplete="tel" inputmode="tel"></label></div><label>${f.email}<input name="email" type="email" maxlength="200" autocomplete="email"></label><label>${f.message}<textarea name="message" required maxlength="4000"></textarea></label><input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true"><button class="btn" type="submit"${disabled}>${f.send}</button><p class="form-status" role="status" aria-live="polite">${status}</p><noscript><p>${f.noscript}</p></noscript></form>`;
}

function contactSection(s: Section<'contact'>, ctx: Ctx, alt: boolean) {
  const text = s.text ? `<p class="lead">${esc(s.text)}</p>` : '';
  const side = s.form ? contactForm(ctx) : '';
  return `<section class="contact${alt ? ' section-alt' : ''}" id="${ctx.anchors.contact}"><div class="container grid"><div>${heading(ctx.labels.nav.contact, s.title)}${text}<ul class="contact-list">${contactItems(ctx)}</ul></div>${side}</div></section>`;
}

function renderSection(section: SiteSection, ctx: Ctx, alt: boolean) {
  switch (section.type) {
    case 'hero':
      return heroSection(section, ctx);
    case 'about':
      return aboutSection(section, ctx, alt);
    case 'services':
      return servicesSection(section, ctx, alt);
    case 'gallery':
      return gallerySection(section, ctx, alt);
    case 'testimonials':
      return testimonialsSection(section, ctx, alt);
    case 'faq':
      return faqSection(section, ctx, alt);
    default:
      return contactSection(section, ctx, alt);
  }
}

/** Une section n'est montrée que si elle est visible et a de quoi s'afficher. */
function hasContent(section: SiteSection) {
  if (!section.visible) return false;
  switch (section.type) {
    case 'services':
    case 'testimonials':
    case 'faq':
      return section.items.length > 0;
    case 'gallery':
      return section.images.length > 0;
    default:
      return true;
  }
}

// ─── Page ───

const FORM_SCRIPT = (sent: string, error: string, sending: string) =>
  `(function(){var f=document.getElementById('contact-form');if(!f||!f.dataset.action)return;var s=f.querySelector('.form-status'),b=f.querySelector('button');f.addEventListener('submit',function(e){e.preventDefault();if(!f.reportValidity())return;var d=new URLSearchParams(new FormData(f));b.disabled=true;s.textContent=${JSON.stringify(sending)};fetch(f.dataset.action,{method:'POST',body:d}).then(function(r){if(!r.ok)throw r;f.reset();s.textContent=${JSON.stringify(sent)}}).catch(function(){s.textContent=${JSON.stringify(error)}}).finally(function(){b.disabled=false})})})();`;

function structuredData(input: SiteRenderInput) {
  const { content, name, urls } = input;
  const { contact, social } = content;
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name,
    description: content.seo.description || undefined,
    url: urls.canonical ?? undefined,
    logo: urls.file('icon-180.png') ?? undefined,
    telephone: contact.phone || undefined,
    email: contact.email || undefined,
    address: contact.address || undefined,
    sameAs: Object.values(social)
      .map((url) => (url ? safeHref(url) : null))
      .filter(Boolean),
  };
  // Aucun « < » dans un script en ligne : ni « </script> », ni « <!-- ».
  return JSON.stringify(data).replaceAll('<', String.raw`\u003c`);
}

function headMarkup(input: SiteRenderInput, css: string) {
  const { content, name, urls, preview } = input;
  const title = content.seo.title || name;
  const description = content.seo.description;
  const og = urls.file('og.png');
  const favicon = urls.file('favicon.png');
  const touch = urls.file('icon-180.png');
  const tags = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(title)}</title>`,
    description && `<meta name="description" content="${esc(description)}">`,
    preview && '<meta name="robots" content="noindex">',
    urls.canonical && `<link rel="canonical" href="${esc(urls.canonical)}">`,
    `<meta name="theme-color" content="${esc(content.colors.primary)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:title" content="${esc(title)}">`,
    description && `<meta property="og:description" content="${esc(description)}">`,
    og && `<meta property="og:image" content="${esc(og)}">`,
    urls.canonical && `<meta property="og:url" content="${esc(urls.canonical)}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    favicon && `<link rel="icon" type="image/png" href="${esc(favicon)}">`,
    touch && `<link rel="apple-touch-icon" href="${esc(touch)}">`,
    `<script type="application/ld+json">${structuredData(input)}</script>`,
    `<style>${css}</style>`,
  ];
  return tags.filter(Boolean).join('');
}

function navMarkup(sections: SiteSection[], ctx: Ctx) {
  const links = sections
    .filter((s) => s.type !== 'hero' && s.type !== 'contact')
    .map(
      (s) =>
        `<a href="#${ctx.anchors[s.type]}">${esc(ctx.labels.nav[s.type as keyof typeof ctx.labels.nav])}</a>`,
    )
    .join('');
  const contact = sections.some((s) => s.type === 'contact')
    ? `<a class="btn" href="#${ctx.anchors.contact}">${esc(ctx.labels.nav.contact)}</a>`
    : '';
  return `<input type="checkbox" id="nav-toggle" class="nav-toggle"><label for="nav-toggle" class="nav-button" aria-label="${esc(ctx.labels.menu)}">${icon(UI_ICONS.menu, 26)}</label><nav class="nav" aria-label="${esc(ctx.labels.menu)}">${links}${contact}</nav>`;
}

function footerMarkup(ctx: Ctx) {
  const { content, name, platform } = ctx.input;
  const socials = SITE_SOCIALS.map((key) => {
    const href = content.social[key] ? safeHref(content.social[key]) : null;
    return href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener">${SOCIAL_LABELS[key]}</a>`
      : '';
  }).join('');
  const follow = socials
    ? `<div><span class="eyebrow" style="color:inherit">${esc(ctx.labels.follow)}</span><div class="socials">${socials}</div></div>`
    : '';
  const credit =
    content.credit && platform
      ? `<p class="credit">${esc(ctx.labels.credit)} <a href="${esc(platform.url)}" target="_blank" rel="noopener">${esc(platform.name)}</a></p>`
      : '';
  const year = new Date().getFullYear();
  return `<footer class="site-footer"><div class="container"><div><strong>${esc(name)}</strong><br>© ${year} ${esc(name)}. ${esc(ctx.labels.rights)}</div>${follow}${credit}</div></footer>`;
}

/** Page HTML complète du site, autonome (styles, polices et script en ligne). */
export function renderSiteHtml(input: SiteRenderInput): string {
  const { content } = input;
  const labels = LABELS[content.language] ?? LABELS.fr;
  const anchors = ANCHORS[content.language] ?? ANCHORS.fr;
  const p = palette(content.colors);
  const whatsapp = content.contact.whatsapp ? whatsappHref(content.contact.whatsapp) : null;
  const ctx: Ctx = { input, labels, anchors, whatsapp };

  const art = renderArtwork({
    style: 'waves',
    palette: [mix(p.primary, '#000000', 0.12), mix(p.primary, '#ffffff', 0.12), p.secondary],
    width: 1600,
    height: 900,
    seed: hashSeed(`${input.name}:site`),
  });
  const artUrl = `data:image/svg+xml,${encodeURIComponent(art)}`;
  const css =
    fontFaces(content.fonts, input.urls) + baseCss(content, p, artUrl) + themeCss(content.theme, p);

  const shown = content.sections.filter(hasContent);
  const body = shown
    .map((section, index) =>
      renderSection(section, ctx, section.type !== 'hero' && index % 2 === 0),
    )
    .join('');
  const chat = whatsapp
    ? `<a class="chat" href="${esc(whatsapp)}" target="_blank" rel="noopener" aria-label="${esc(labels.chat)}">${icon(UI_ICONS.chat)}<span>${esc(labels.whatsapp)}</span></a>`
    : '';
  const script = content.sections.some((s) => s.type === 'contact' && s.visible && s.form)
    ? `<script>${FORM_SCRIPT(labels.form.sent, labels.form.error, labels.form.sending)}</script>`
    : '';

  return `<!doctype html><html lang="${content.language}"><head>${headMarkup(input, css)}</head><body class="theme-${content.theme}"><header class="site-header"><div class="container"><a class="brand" href="#${anchors.hero}" aria-label="${esc(input.name)}">${inlineSvg(input.logo.color, 'hd-')}</a>${navMarkup(shown, ctx)}</div></header><main>${body}</main>${footerMarkup(ctx)}${chat}${script}</body></html>`;
}

// ─── Contenu de départ ───

export interface SiteDefaultsInput {
  name: string;
  slogan: string | null;
  mission: string | null;
  sector: string | null;
  values: string[];
  audience: string | null;
  language: SiteLanguage;
  colors: SiteContent['colors'];
  fonts: SiteContent['fonts'];
  contact: Partial<SiteContact>;
  social: Partial<Record<SiteSocial, string>>;
  /** Icônes suggérées pour les services (secteur du brief). */
  icons: string[];
}

const capitalize = (value: string) => (value ? value[0].toUpperCase() + value.slice(1) : value);

const DEFAULT_SCENES = ['storefront', 'tshirt', 'cards', 'bags', 'van', 'stand'];

const DEFAULT_TEXTS = {
  fr: {
    values: ['Qualité', 'Proximité', 'Engagement'],
    service: (name: string, value: string) =>
      `Décrivez ici ce que ${name} propose autour de « ${value} » : bénéfice, public, prix indicatif.`,
    about: (name: string, audience: string) =>
      `${name} accompagne ${audience || 'ses clients'} avec exigence et proximité.`,
    cta: 'Nous contacter',
    aboutTitle: 'Qui sommes-nous ?',
    servicesTitle: 'Nos services',
    servicesIntro: (name: string, sector: string) => `Ce que ${name} vous apporte en ${sector}.`,
    galleryTitle: 'Notre marque',
    testimonialsTitle: 'Ils nous font confiance',
    quote: 'Remplacez ce texte par l’avis d’un client.',
    author: 'Prénom Nom',
    faqTitle: 'Questions fréquentes',
    question: 'Comment passer commande ?',
    answer: 'Contactez-nous par téléphone, WhatsApp ou via le formulaire ci-dessous.',
    contactTitle: 'Contactez-nous',
    contact: 'Une question, un devis ? Écrivez-nous, nous répondons rapidement.',
  },
  en: {
    values: ['Quality', 'Proximity', 'Commitment'],
    service: (name: string, value: string) =>
      `Describe what ${name} offers around “${value}”: benefit, audience, indicative price.`,
    about: (name: string, audience: string) =>
      `${name} supports ${audience || 'its customers'} with care and commitment.`,
    cta: 'Contact us',
    aboutTitle: 'Who we are',
    servicesTitle: 'Our services',
    servicesIntro: (name: string, sector: string) => `What ${name} brings you in ${sector}.`,
    galleryTitle: 'Our brand',
    testimonialsTitle: 'They trust us',
    quote: 'Replace this text with a customer review.',
    author: 'First Last',
    faqTitle: 'Frequently asked questions',
    question: 'How do I order?',
    answer: 'Contact us by phone, WhatsApp or the form below.',
    contactTitle: 'Contact us',
    contact: 'A question or a quote? Write to us, we reply quickly.',
  },
} satisfies Record<SiteLanguage, unknown>;

/** Site complet de départ : textes tirés du brief et du kit, à compléter par l'utilisateur. */
export function defaultSiteContent(input: SiteDefaultsInput): SiteContent {
  const t = DEFAULT_TEXTS[input.language] ?? DEFAULT_TEXTS.fr;
  const { name } = input;
  const sector = input.sector?.trim() ?? '';
  const mission = input.mission?.trim() ?? '';
  const slogan = input.slogan?.trim() ?? '';
  const values = input.values
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 4);
  const iconAt = (i: number) => input.icons[i % Math.max(input.icons.length, 1)] ?? 'sparkles';
  const services: SiteServiceItem[] = (values.length ? values : t.values)
    .slice(0, 3)
    .map((value, i) => ({
      title: capitalize(value),
      text: t.service(name, value),
      icon: iconAt(i),
    }));
  const about = mission
    ? `${capitalize(mission.replace(/\.$/, ''))}.`
    : t.about(name, input.audience?.trim() ?? '');
  const whatsapp = input.contact.whatsapp || input.contact.phone || '';
  const sectorLabel = sector ? ` · ${capitalize(sector)}` : '';

  return {
    language: input.language,
    theme: 'modern',
    colors: input.colors,
    fonts: input.fonts,
    sections: [
      {
        type: 'hero',
        visible: true,
        title: name,
        subtitle: slogan || capitalize(sector),
        cta: t.cta,
        ctaTarget: whatsapp ? 'whatsapp' : 'contact',
        image: { kind: 'mockup', scene: 'storefront' },
      },
      {
        type: 'about',
        visible: true,
        title: t.aboutTitle,
        text: about,
        values: values.map(capitalize),
      },
      {
        type: 'services',
        visible: true,
        title: t.servicesTitle,
        intro: sector ? t.servicesIntro(name, sector.toLowerCase()) : '',
        items: services,
      },
      {
        type: 'gallery',
        visible: true,
        title: t.galleryTitle,
        images: DEFAULT_SCENES.map((scene) => ({ kind: 'mockup' as const, scene })),
      },
      {
        type: 'testimonials',
        visible: false,
        title: t.testimonialsTitle,
        items: [{ quote: t.quote, author: t.author, role: '' }],
      },
      {
        type: 'faq',
        visible: false,
        title: t.faqTitle,
        items: [{ question: t.question, answer: t.answer }],
      },
      { type: 'contact', visible: true, title: t.contactTitle, text: t.contact, form: true },
    ],
    contact: {
      phone: input.contact.phone ?? '',
      whatsapp,
      email: input.contact.email ?? '',
      address: input.contact.address ?? '',
      hours: input.contact.hours ?? '',
    },
    social: input.social,
    seo: {
      title: slogan ? `${name} — ${slogan}` : name,
      description: (mission ? about : name + sectorLabel).slice(0, 160),
    },
    credit: true,
  };
}

/** Mises en situation utilisées par le site (visuel d'accueil, galerie). */
export function siteMockupScenes(content: SiteContent): string[] {
  const scenes = new Set<string>();
  for (const section of content.sections) {
    if (!section.visible) continue;
    if (section.type === 'hero' && section.image?.kind === 'mockup')
      scenes.add(section.image.scene);
    if (section.type === 'gallery')
      section.images.forEach((image) => image.kind === 'mockup' && scenes.add(image.scene));
  }
  return [...scenes];
}

/** Médias téléversés utilisés par le site. */
export function siteMediaIds(content: SiteContent): string[] {
  const ids = new Set<string>();
  for (const section of content.sections) {
    if (section.type === 'hero' && section.image?.kind === 'media') ids.add(section.image.id);
    if (section.type === 'gallery')
      section.images.forEach((image) => image.kind === 'media' && ids.add(image.id));
  }
  return [...ids];
}
