/**
 * Valeurs par défaut du module textile (§16.2, §16.3), utilisées par le seed et les tests.
 * Les mesures sont proposées pour un adulte M et doivent être validées sur un vêtement réel
 * avant la première production (profil atelier, TEX-05).
 */
import type { GarmentView, ProductCategory, SizeScaling } from '@prisma/client';
import type { PresetRules } from './apparel-rules';

export interface ZoneDefault {
  key: string;
  view: GarmentView;
  label: string;
  offsetXMm: number;
  offsetYMm: number;
  maxWidthMm: number;
  maxHeightMm: number;
  scaling: SizeScaling;
}

/** Taille de référence pour les zones ci-dessous. */
export const REFERENCE_SIZE = 'M';

/** Largeur de poitrine à plat et longueur, en mm (valeurs indicatives à valider). */
export const DEFAULT_SIZES: { label: string; chestWidthMm: number; bodyLengthMm: number }[] = [
  { label: '4 ANS', chestWidthMm: 330, bodyLengthMm: 460 },
  { label: '6 ANS', chestWidthMm: 360, bodyLengthMm: 490 },
  { label: '8 ANS', chestWidthMm: 390, bodyLengthMm: 520 },
  { label: '10 ANS', chestWidthMm: 420, bodyLengthMm: 560 },
  { label: '12 ANS', chestWidthMm: 450, bodyLengthMm: 600 },
  { label: '14 ANS', chestWidthMm: 480, bodyLengthMm: 640 },
  { label: 'XS', chestWidthMm: 470, bodyLengthMm: 680 },
  { label: 'S', chestWidthMm: 490, bodyLengthMm: 700 },
  { label: 'M', chestWidthMm: 520, bodyLengthMm: 720 },
  { label: 'L', chestWidthMm: 550, bodyLengthMm: 740 },
  { label: 'XL', chestWidthMm: 580, bodyLengthMm: 760 },
  { label: '2XL', chestWidthMm: 610, bodyLengthMm: 780 },
  { label: '3XL', chestWidthMm: 640, bodyLengthMm: 800 },
];

const Z: Record<string, ZoneDefault> = {
  right_chest: {
    key: 'right_chest',
    view: 'FRONT',
    label: 'Poitrine droite du porteur',
    offsetXMm: -90,
    offsetYMm: 70,
    maxWidthMm: 90,
    maxHeightMm: 90,
    scaling: 'FIXED',
  },
  left_chest: {
    key: 'left_chest',
    view: 'FRONT',
    label: 'Cœur (poitrine gauche)',
    offsetXMm: 90,
    offsetYMm: 70,
    maxWidthMm: 90,
    maxHeightMm: 90,
    scaling: 'FIXED',
  },
  front_sponsor: {
    key: 'front_sponsor',
    view: 'FRONT',
    label: 'Sponsor ou logo principal',
    offsetXMm: 0,
    offsetYMm: 180,
    maxWidthMm: 250,
    maxHeightMm: 100,
    scaling: 'PROPORTIONAL',
  },
  front_number: {
    key: 'front_number',
    view: 'FRONT',
    label: 'Numéro devant',
    offsetXMm: 0,
    offsetYMm: 300,
    maxWidthMm: 200,
    maxHeightMm: 150,
    scaling: 'FIXED',
  },
  front_full: {
    key: 'front_full',
    view: 'FRONT',
    label: 'Devant plein',
    offsetXMm: 0,
    offsetYMm: 80,
    maxWidthMm: 300,
    maxHeightMm: 380,
    scaling: 'PROPORTIONAL',
  },
  nape: {
    key: 'nape',
    view: 'BACK',
    label: 'Nuque',
    offsetXMm: 0,
    offsetYMm: 20,
    maxWidthMm: 80,
    maxHeightMm: 40,
    scaling: 'FIXED',
  },
  back_name: {
    key: 'back_name',
    view: 'BACK',
    label: 'Nom du joueur',
    offsetXMm: 0,
    offsetYMm: 70,
    maxWidthMm: 280,
    maxHeightMm: 75,
    scaling: 'FIXED',
  },
  back_number: {
    key: 'back_number',
    view: 'BACK',
    label: 'Numéro dos',
    offsetXMm: 0,
    offsetYMm: 185,
    maxWidthMm: 300,
    maxHeightMm: 350,
    scaling: 'FIXED',
  },
  back_sponsor: {
    key: 'back_sponsor',
    view: 'BACK',
    label: 'Sponsor dos',
    offsetXMm: 0,
    offsetYMm: 560,
    maxWidthMm: 200,
    maxHeightMm: 80,
    scaling: 'PROPORTIONAL',
  },
  back_full: {
    key: 'back_full',
    view: 'BACK',
    label: 'Dos plein',
    offsetXMm: 0,
    offsetYMm: 60,
    maxWidthMm: 300,
    maxHeightMm: 380,
    scaling: 'PROPORTIONAL',
  },
  sleeve_left: {
    key: 'sleeve_left',
    view: 'LEFT_SLEEVE',
    label: 'Manche gauche',
    offsetXMm: 0,
    offsetYMm: 80,
    maxWidthMm: 80,
    maxHeightMm: 80,
    scaling: 'FIXED',
  },
  sleeve_right: {
    key: 'sleeve_right',
    view: 'RIGHT_SLEEVE',
    label: 'Manche droite',
    offsetXMm: 0,
    offsetYMm: 80,
    maxWidthMm: 80,
    maxHeightMm: 80,
    scaling: 'FIXED',
  },
  shorts_number: {
    key: 'shorts_number',
    view: 'SHORTS_FRONT',
    label: 'Numéro de short',
    offsetXMm: 0,
    offsetYMm: 60,
    maxWidthMm: 150,
    maxHeightMm: 150,
    scaling: 'FIXED',
  },
};

const footballSleeve = (z: ZoneDefault): ZoneDefault => ({ ...z, maxWidthMm: 120 });

export const DEFAULT_TEMPLATES: {
  category: ProductCategory;
  name: string;
  zones: ZoneDefault[];
}[] = [
  {
    category: 'TSHIRT',
    name: 'T-shirt',
    zones: [
      Z.left_chest,
      Z.right_chest,
      Z.front_sponsor,
      Z.front_full,
      Z.nape,
      Z.back_full,
      Z.back_sponsor,
      Z.sleeve_left,
      Z.sleeve_right,
    ],
  },
  {
    category: 'POLO',
    name: 'Polo',
    zones: [Z.left_chest, Z.right_chest, Z.back_full, Z.sleeve_left, Z.sleeve_right],
  },
  {
    category: 'FOOTBALL_JERSEY',
    name: 'Maillot de football',
    zones: [
      Z.left_chest,
      Z.right_chest,
      Z.front_sponsor,
      Z.front_number,
      Z.nape,
      Z.back_name,
      Z.back_number,
      Z.back_sponsor,
      footballSleeve(Z.sleeve_left),
      footballSleeve(Z.sleeve_right),
    ],
  },
  {
    category: 'BASKETBALL_JERSEY',
    name: 'Maillot de basket',
    zones: [Z.front_sponsor, Z.front_number, Z.back_name, Z.back_number],
  },
  {
    category: 'SHORTS',
    name: 'Short',
    zones: [Z.shorts_number],
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

/** Préréglages sportifs (§16.3) ; le règlement officiel de la compétition fait foi (TEX-13). */
export const DEFAULT_RULE_PRESETS: { code: string; name: string; rules: PresetRules }[] = [
  {
    code: 'FOOTBALL_MEN',
    name: 'Football hommes (FIFA, UEFA)',
    rules: {
      ...FOOTBALL_COMMON,
      numbers: { ...FOOTBALL_COMMON.numbers, back: { min: 250, max: 350 } },
    },
  },
  {
    code: 'FOOTBALL_WOMEN',
    name: 'Football femmes (FIFA, UEFA)',
    rules: {
      ...FOOTBALL_COMMON,
      numbers: { ...FOOTBALL_COMMON.numbers, back: { min: 200, max: 350 } },
    },
  },
  {
    code: 'FIBA',
    name: 'Basket (FIBA)',
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
  { code: 'FREE', name: 'Libre (t-shirt, loisir)', rules: { blocking: false } },
];

export const RULES_DISCLAIMER =
  'Les préréglages reprennent les principales règles connues ; le règlement officiel de la compétition fait foi.';
