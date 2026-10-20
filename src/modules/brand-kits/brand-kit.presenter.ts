import type { BrandKit, LogoEngine, Prisma } from '@prisma/client';
import type { KitContent, KitFont, KitPaletteColor } from '../../render/brand-kit';

/** Version de logo d'un kit : spec pour le rendu, SVG d'origine pour un logo importé. */
export interface KitLogo {
  spec: Prisma.JsonValue;
  svg: string | null;
}

/** Liens de téléchargement en cours de validité (URL signées), null sans fichier ou sans droit. */
export interface KitFiles {
  guidePdfUrl: string | null;
  zipUrl: string | null;
}

/** Contenu figé d'un kit ; un kit antérieur à l'instantané a un contenu vide. */
export function parseKitContent(raw: Prisma.JsonValue): Partial<KitContent> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<KitContent>) : {};
}

/** Kit de marque (type BrandKit du front) ; le hachage du mot de passe n'est jamais exposé. */
export function toBrandKitDto(
  kit: BrandKit,
  logo: KitLogo | null,
  files: KitFiles,
  extra: { guideCost: number },
) {
  const content = parseKitContent(kit.content);
  return {
    id: kit.id,
    projectId: kit.projectId,
    version: kit.version,
    name: content.name ?? null,
    acronym: content.acronym ?? null,
    meaning: content.meaning ?? null,
    devise: content.devise ?? null,
    mission: content.mission ?? null,
    palette: kit.palette as unknown as KitPaletteColor[],
    fonts: kit.fonts as unknown as KitFont[],
    logoSpec: logo?.spec ?? null,
    logoSvg: logo?.svg ?? null,
    slogan: content.slogan ?? null,
    shareToken: kit.shareToken,
    shareExpiresAt: kit.shareExpiresAt,
    hasPassword: !!kit.sharePasswordHash,
    guidePdfUrl: files.guidePdfUrl,
    zipUrl: files.zipUrl,
    guideCost: extra.guideCost,
    restoredFrom: kit.restoredFrom,
    createdAt: kit.createdAt,
  };
}

/** Logo importé non retravaillé : son SVG d'origine fait foi (même règle que logoSource). */
export function kitLogo(version: {
  number: number;
  spec: Prisma.JsonValue;
  svg: string;
  logo: { engine: LogoEngine };
}): KitLogo {
  const original = version.logo.engine === 'UPLOAD' && version.number === 1;
  return { spec: version.spec, svg: original ? version.svg : null };
}
