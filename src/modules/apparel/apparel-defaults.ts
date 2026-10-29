/**
 * Valeurs par défaut du module textile, utilisées par le seed et les contrôles.
 * RÈGLE ABSOLUE : ZÉRO API EXTERNE DE TRAITEMENT D'IMAGE.
 */
import type { GarmentCategory, GarmentView } from '@prisma/client';
import type { PresetRules } from './apparel-rules';

export type SizeScaling = 'FIXED' | 'PROPORTIONAL';

export interface ZoneDefault {
  key: string;
  name?: string;
  view: GarmentView;
  label: string;
  offsetXMm: number;
  offsetYMm: number;
  maxWidthMm: number;
  maxHeightMm: number;
  scaling: SizeScaling;
}

export interface SizeDefault {
  label: string;
  chestWidthMm: number;
  heightMm?: number;
  bodyLengthMm: number;
}

/** Taille de référence pour les zones. */
export const REFERENCE_SIZE = 'M';

/** Tailles par défaut en millimètres. */
export const DEFAULT_SIZES: SizeDefault[] = [
  { label: '4 ANS', chestWidthMm: 330, bodyLengthMm: 460, heightMm: 460 },
  { label: '6 ANS', chestWidthMm: 360, bodyLengthMm: 490, heightMm: 490 },
  { label: '8 ANS', chestWidthMm: 390, bodyLengthMm: 520, heightMm: 520 },
  { label: '10 ANS', chestWidthMm: 420, bodyLengthMm: 560, heightMm: 560 },
  { label: '12 ANS', chestWidthMm: 450, bodyLengthMm: 600, heightMm: 600 },
  { label: '14 ANS', chestWidthMm: 480, bodyLengthMm: 640, heightMm: 640 },
  { label: 'XS', chestWidthMm: 470, bodyLengthMm: 680, heightMm: 680 },
  { label: 'S', chestWidthMm: 490, bodyLengthMm: 700, heightMm: 700 },
  { label: 'M', chestWidthMm: 520, bodyLengthMm: 720, heightMm: 720 },
  { label: 'L', chestWidthMm: 550, bodyLengthMm: 740, heightMm: 740 },
  { label: 'XL', chestWidthMm: 580, bodyLengthMm: 760, heightMm: 760 },
  { label: '2XL', chestWidthMm: 610, bodyLengthMm: 780, heightMm: 780 },
  { label: '3XL', chestWidthMm: 640, bodyLengthMm: 800, heightMm: 800 },
];

export const Z: Record<string, ZoneDefault> = {
  left_chest: {
    key: 'left_chest',
    name: 'Cœur (poitrine gauche)',
    label: 'Cœur (poitrine gauche)',
    view: 'FRONT',
    offsetXMm: 90,
    offsetYMm: 70,
    maxWidthMm: 90,
    maxHeightMm: 90,
    scaling: 'FIXED',
  },
  chest_left: {
    key: 'chest_left',
    name: 'Cœur (poitrine gauche)',
    label: 'Cœur (poitrine gauche)',
    view: 'FRONT',
    offsetXMm: 90,
    offsetYMm: 70,
    maxWidthMm: 90,
    maxHeightMm: 90,
    scaling: 'FIXED',
  },
  right_chest: {
    key: 'right_chest',
    name: 'Poitrine droite',
    label: 'Poitrine droite',
    view: 'FRONT',
    offsetXMm: -90,
    offsetYMm: 70,
    maxWidthMm: 90,
    maxHeightMm: 90,
    scaling: 'FIXED',
  },
  chest_right: {
    key: 'chest_right',
    name: 'Poitrine droite',
    label: 'Poitrine droite',
    view: 'FRONT',
    offsetXMm: -90,
    offsetYMm: 70,
    maxWidthMm: 90,
    maxHeightMm: 90,
    scaling: 'FIXED',
  },
  front_center: {
    key: 'front_center',
    name: 'Torse avant / Sponsor',
    label: 'Torse avant / Sponsor',
    view: 'FRONT',
    offsetXMm: 0,
    offsetYMm: 160,
    maxWidthMm: 280,
    maxHeightMm: 380,
    scaling: 'PROPORTIONAL',
  },
  front_full: {
    key: 'front_full',
    name: 'Devant plein',
    label: 'Devant plein',
    view: 'FRONT',
    offsetXMm: 0,
    offsetYMm: 80,
    maxWidthMm: 300,
    maxHeightMm: 380,
    scaling: 'PROPORTIONAL',
  },
  front_sponsor: {
    key: 'front_sponsor',
    name: 'Sponsor avant',
    label: 'Sponsor avant',
    view: 'FRONT',
    offsetXMm: 0,
    offsetYMm: 180,
    maxWidthMm: 260,
    maxHeightMm: 120,
    scaling: 'PROPORTIONAL',
  },
  front_number: {
    key: 'front_number',
    name: 'Numéro devant',
    label: 'Numéro devant',
    view: 'FRONT',
    offsetXMm: 0,
    offsetYMm: 280,
    maxWidthMm: 120,
    maxHeightMm: 150,
    scaling: 'FIXED',
  },
  team_name_front: {
    key: 'team_name_front',
    name: 'Nom équipe avant',
    label: 'Nom équipe avant',
    view: 'FRONT',
    offsetXMm: 0,
    offsetYMm: 140,
    maxWidthMm: 260,
    maxHeightMm: 80,
    scaling: 'PROPORTIONAL',
  },
  back_center: {
    key: 'back_center',
    name: 'Dos centré',
    label: 'Dos centré',
    view: 'BACK',
    offsetXMm: 0,
    offsetYMm: 80,
    maxWidthMm: 280,
    maxHeightMm: 350,
    scaling: 'PROPORTIONAL',
  },
  back_full: {
    key: 'back_full',
    name: 'Dos plein',
    label: 'Dos plein',
    view: 'BACK',
    offsetXMm: 0,
    offsetYMm: 60,
    maxWidthMm: 300,
    maxHeightMm: 380,
    scaling: 'PROPORTIONAL',
  },
  back_top: {
    key: 'back_top',
    name: 'Dos haut',
    label: 'Dos haut',
    view: 'BACK',
    offsetXMm: 0,
    offsetYMm: 60,
    maxWidthMm: 250,
    maxHeightMm: 100,
    scaling: 'FIXED',
  },
  back_name: {
    key: 'back_name',
    name: 'Nom joueur dos',
    label: 'Nom joueur dos',
    view: 'BACK',
    offsetXMm: 0,
    offsetYMm: 70,
    maxWidthMm: 280,
    maxHeightMm: 75,
    scaling: 'FIXED',
  },
  back_number: {
    key: 'back_number',
    name: 'Numéro dos',
    label: 'Numéro dos',
    view: 'BACK',
    offsetXMm: 0,
    offsetYMm: 185,
    maxWidthMm: 300,
    maxHeightMm: 350,
    scaling: 'FIXED',
  },
  back_sponsor: {
    key: 'back_sponsor',
    name: 'Sponsor dos',
    label: 'Sponsor dos',
    view: 'BACK',
    offsetXMm: 0,
    offsetYMm: 560,
    maxWidthMm: 240,
    maxHeightMm: 80,
    scaling: 'PROPORTIONAL',
  },
  back_sponsor_bottom: {
    key: 'back_sponsor_bottom',
    name: 'Sponsor bas dos',
    label: 'Sponsor bas dos',
    view: 'BACK',
    offsetXMm: 0,
    offsetYMm: 480,
    maxWidthMm: 240,
    maxHeightMm: 80,
    scaling: 'PROPORTIONAL',
  },
  sleeve_left: {
    key: 'sleeve_left',
    name: 'Manche gauche',
    label: 'Manche gauche',
    view: 'LEFT_SLEEVE',
    offsetXMm: 0,
    offsetYMm: 80,
    maxWidthMm: 120,
    maxHeightMm: 120,
    scaling: 'FIXED',
  },
  sleeve_right: {
    key: 'sleeve_right',
    name: 'Manche droite',
    label: 'Manche droite',
    view: 'RIGHT_SLEEVE',
    offsetXMm: 0,
    offsetYMm: 80,
    maxWidthMm: 120,
    maxHeightMm: 120,
    scaling: 'FIXED',
  },
  shorts_crest: {
    key: 'shorts_crest',
    name: 'Écusson cuisse droite',
    label: 'Écusson cuisse droite',
    view: 'SHORTS_FRONT',
    offsetXMm: 60,
    offsetYMm: 80,
    maxWidthMm: 70,
    maxHeightMm: 70,
    scaling: 'FIXED',
  },
  shorts_number: {
    key: 'shorts_number',
    name: 'Numéro cuisse gauche',
    label: 'Numéro cuisse gauche',
    view: 'SHORTS_FRONT',
    offsetXMm: -60,
    offsetYMm: 80,
    maxWidthMm: 150,
    maxHeightMm: 150,
    scaling: 'FIXED',
  },
};

/**
 * 5 gabarits par défaut du module textile :
 * 1. T-shirt Col Rond
 * 2. Polo Piqué
 * 3. Maillot Football
 * 4. Maillot Basketball
 * 5. Short Sport
 */
export const DEFAULT_TEMPLATES: {
  category: GarmentCategory;
  name: string;
  description: string;
  material: string;
  sizes: SizeDefault[];
  zones: ZoneDefault[];
}[] = [
  {
    category: 'T_SHIRT',
    name: 'T-shirt Col Rond',
    description: 'T-shirt coupe unisexe moderne col rond',
    material: '100% Coton peigné 180g',
    sizes: DEFAULT_SIZES,
    zones: [
      Z.left_chest,
      Z.right_chest,
      Z.front_center,
      Z.front_full,
      Z.back_center,
      Z.back_full,
      Z.sleeve_left,
      Z.sleeve_right,
    ],
  },
  {
    category: 'POLO',
    name: 'Polo Piqué',
    description: 'Polo classique à patte de boutonnage 3 boutons',
    material: '100% Coton piqué 220g',
    sizes: DEFAULT_SIZES.filter((s) => ['S', 'M', 'L', 'XL', '2XL', '3XL'].includes(s.label)),
    zones: [
      Z.left_chest,
      Z.back_top,
      Z.sleeve_right,
    ],
  },
  {
    category: 'FOOTBALL_JERSEY',
    name: 'Maillot Football',
    description: 'Maillot de match technique respirant micro-perforé',
    material: '100% Polyester respirant 140g',
    sizes: DEFAULT_SIZES.filter((s) => ['S', 'M', 'L', 'XL', '2XL'].includes(s.label)),
    zones: [
      Z.left_chest,
      Z.right_chest,
      Z.front_sponsor,
      Z.front_number,
      Z.back_name,
      Z.back_number,
      Z.back_sponsor,
      Z.sleeve_left,
      Z.sleeve_right,
    ],
  },
  {
    category: 'BASKETBALL_JERSEY',
    name: 'Maillot Basketball',
    description: 'Chasuble / maillot sans manches basketball',
    material: '100% Polyester mesh aéré 160g',
    sizes: DEFAULT_SIZES.filter((s) => ['M', 'L', 'XL', '2XL', '3XL'].includes(s.label)),
    zones: [
      Z.team_name_front,
      Z.front_number,
      Z.back_name,
      Z.back_number,
    ],
  },
  {
    category: 'SHORTS',
    name: 'Short Sport',
    description: 'Short d’entraînement et de match avec cordon de serrage',
    material: '100% Polyester 130g',
    sizes: DEFAULT_SIZES.filter((s) => ['S', 'M', 'L', 'XL'].includes(s.label)),
    zones: [
      Z.shorts_crest,
      Z.shorts_number,
    ],
  },
];

const FOOTBALL_COMMON: PresetRules = {
  blocking: true,
  numbers: {
    front: { min: 100, max: 150 },
    shorts: { min: 100, max: 150 },
    stroke: { min: 20, max: 50 },
    maxColors: 1,
    min: 1,
    max: 99,
  },
  names: { height: { min: 50, max: 75 }, minGapAboveNumberMm: 40 },
  forbiddenStyles: ['RIBBON_3D'],
};

const fibaNumbers = ['0', '00', ...Array.from({ length: 99 }, (_, i) => String(i + 1))];

/** Préréglages sportifs (FIFA, FIBA, FFF, NBA, Libre) */
export const DEFAULT_RULE_PRESETS: { code: string; name: string; rules: PresetRules }[] = [
  {
    code: 'FOOTBALL_MEN',
    name: 'Football hommes (FIFA / UEFA)',
    rules: {
      ...FOOTBALL_COMMON,
      numbers: { ...FOOTBALL_COMMON.numbers, back: { min: 250, max: 350 } },
    },
  },
  {
    code: 'FOOTBALL_WOMEN',
    name: 'Football femmes (FIFA / UEFA)',
    rules: {
      ...FOOTBALL_COMMON,
      numbers: { ...FOOTBALL_COMMON.numbers, back: { min: 200, max: 350 } },
    },
  },
  {
    code: 'FFF',
    name: 'Fédération Française de Football (FFF)',
    rules: {
      ...FOOTBALL_COMMON,
      numbers: { ...FOOTBALL_COMMON.numbers, back: { min: 250, max: 300 } },
    },
  },
  {
    code: 'FIBA',
    name: 'Basketball (FIBA)',
    rules: {
      blocking: true,
      numbers: {
        back: { min: 200 },
        front: { min: 100 },
        stroke: { min: 20 },
        allowed: fibaNumbers,
      },
      adsGapFromNumbersMm: 50,
    },
  },
  {
    code: 'NBA',
    name: 'Basketball (NBA)',
    rules: {
      blocking: true,
      numbers: {
        back: { min: 200, max: 280 },
        front: { min: 100, max: 150 },
        allowed: fibaNumbers,
      },
      adsGapFromNumbersMm: 40,
    },
  },
  {
    code: 'FREE',
    name: 'Libre (t-shirt, loisir, mode)',
    rules: { blocking: false },
  },
];

export const RULES_DISCLAIMER =
  'Les préréglages reprennent les principales règles connues ; le règlement officiel de la compétition fait foi.';
