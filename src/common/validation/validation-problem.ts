import { BadRequestException } from '@nestjs/common';
import { getMetadataStorage, type ValidationError } from 'class-validator';
import { z } from 'zod';

// Erreurs de saisie en français, rattachées au champ concerné : `fields` associe le chemin du
// champ (« email », « elements.2.widthMm ») à ses messages, pour que le front les affiche sous le
// bon champ ; `errors` garde la liste lisible « chemin : message ».

export type FieldErrors = Record<string, string[]>;

const REQUIRED = 'Champ obligatoire';
const OBJECT_EXPECTED = 'Objet attendu';
const CHARACTER = 'caractère';

const plural = (n: number, word: string) => `${n} ${word}${Math.abs(n) > 1 ? 's' : ''}`;

/** Valeurs possibles d'une liste fermée, si elle est courte. */
function allowed(values: unknown) {
  const list = Array.isArray(values) ? values : Object.values(values ?? {});
  const shown = list.filter((v) => typeof v === 'string' || typeof v === 'number');
  return shown.length && shown.length <= 10
    ? `Valeur non autorisée (valeurs possibles : ${shown.join(', ')})`
    : 'Valeur non autorisée';
}

/** Formats `@Matches` connus, reconnus à leur expression. */
const PATTERNS: [RegExp, string][] = [
  [/^\^#\[0-9a-f/i, 'Couleur au format #RRGGBB attendue'],
  [/^\^data:image/, 'Image invalide (fichier encodé en base64 attendu)'],
  [/^\^\\d\{6\}\$$/, 'Code à 6 chiffres attendu'],
  [/^\^\\\+\\d/, 'Numéro au format international attendu (+224…)'],
  [/\(fr\|en\)/, 'Langue non prise en charge'],
  [/^\^\[A-Z\]\{2\}\$$/, 'Code pays à deux lettres attendu'],
  [/\\d\{3\}\\s\?\\d\{3\}/, 'Code de vérification invalide'],
];

function patternMessage(pattern: unknown) {
  const source = pattern instanceof RegExp ? pattern.source : String(pattern);
  return PATTERNS.find(([test]) => test.test(source))?.[1] ?? 'Format invalide';
}

function lengthMessage([min, max]: unknown[], value: unknown) {
  const length = typeof value === 'string' ? value.length : undefined;
  if (typeof min === 'number' && (length === undefined || length < min)) {
    return length === 0 || (length === undefined && min <= 1)
      ? REQUIRED
      : `${plural(min, CHARACTER)} au moins`;
  }
  return typeof max === 'number' ? `${plural(max, CHARACTER)} au plus` : 'Longueur invalide';
}

type Describe = (constraints: unknown[], value: unknown) => string;

const MESSAGES: Record<string, Describe> = {
  isDefined: () => REQUIRED,
  isNotEmpty: () => REQUIRED,
  isString: () => 'Texte attendu',
  isBoolean: () => 'Valeur oui / non attendue',
  isInt: () => 'Nombre entier attendu',
  isNumber: () => 'Nombre attendu',
  isArray: () => 'Liste attendue',
  isObject: () => OBJECT_EXPECTED,
  isEmail: () => 'Adresse e-mail invalide',
  isUrl: () => 'Adresse web invalide (https://…)',
  isUuid: () => 'Identifiant invalide',
  isDateString: () => 'Date invalide',
  matches: ([pattern]) => patternMessage(pattern),
  isEnum: ([entity]) => allowed(entity),
  isIn: ([values]) => allowed(values),
  notEquals: ([forbidden]) => `La valeur ${String(forbidden)} n’est pas acceptée`,
  min: ([n]) => `Doit être supérieur ou égal à ${String(n)}`,
  max: ([n]) => `Doit être inférieur ou égal à ${String(n)}`,
  isLength: lengthMessage,
  minLength: ([n]) => `${plural(Number(n), CHARACTER)} au moins`,
  maxLength: ([n]) => `${plural(Number(n), CHARACTER)} au plus`,
  arrayMinSize: ([n]) => `${plural(Number(n), 'élément')} au moins`,
  arrayMaxSize: ([n]) => `${plural(Number(n), 'élément')} au plus`,
  arrayNotEmpty: () => 'Liste vide',
  arrayUnique: () => 'Valeurs en double',
  whitelistValidation: () => 'Champ non autorisé',
  nestedValidation: () => OBJECT_EXPECTED,
  unknownValue: () => 'Données inattendues',
};

/** Contraintes déclarées sur un champ : arguments et message personnalisé éventuel. */
function declared(target: object | undefined, property: string) {
  const found = new Map<string, { constraints: unknown[]; custom: boolean }>();
  if (!target) return found;
  const metadatas = getMetadataStorage().getTargetValidationMetadatas(
    target.constructor,
    '',
    false,
    false,
  );
  for (const m of metadatas) {
    if (m.propertyName !== property || !m.name) continue;
    found.set(m.name, { constraints: m.constraints ?? [], custom: Boolean(m.message) });
  }
  return found;
}

/** Message français d'une contrainte non respectée (le message personnalisé est conservé). */
export function constraintMessage(
  name: string,
  original: string,
  meta?: { constraints: unknown[]; custom: boolean },
  value?: unknown,
) {
  if (meta?.custom) return original;
  return MESSAGES[name]?.(meta?.constraints ?? [], value) ?? 'Valeur invalide';
}

/** Erreurs de class-validator, à plat, par chemin de champ. */
export function fieldErrors(errors: ValidationError[], parent = ''): FieldErrors {
  const fields: FieldErrors = {};
  for (const error of errors) {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const metas = declared(error.target, error.property);
    const messages = Object.entries(error.constraints ?? {}).map(([name, original]) =>
      constraintMessage(name, original, metas.get(name), error.value),
    );
    if (messages.length) fields[path] = [...new Set(messages)];
    Object.assign(fields, fieldErrors(error.children ?? [], path));
  }
  return fields;
}

/** Erreur 400 problem+json : premier message en `detail` s'il est seul, détail par champ. */
export function invalidInput(fields: FieldErrors, message = 'Données invalides') {
  const entries = Object.entries(fields).flatMap(([path, list]) => list.map((m) => [path, m]));
  const [only] = entries;
  return new BadRequestException({
    message: entries.length === 1 && only ? only[1] : message,
    errors: entries.map(([path, m]) => (path ? `${path} : ${m}` : m)),
    fields,
  });
}

/** `exceptionFactory` du ValidationPipe global. */
export const validationExceptionFactory = (errors: ValidationError[]) =>
  invalidInput(fieldErrors(errors));

/** Erreurs d'un schéma zod, par chemin de champ (`limit` premières anomalies). */
export function zodFieldErrors(error: z.ZodError, limit = 20): FieldErrors {
  const fields: FieldErrors = {};
  for (const issue of error.issues.slice(0, limit)) {
    const path = issue.path.join('.');
    fields[path] = [...(fields[path] ?? []), issue.message];
  }
  return fields;
}

/** Erreur 400 pour un contenu refusé par un schéma zod. */
export const zodProblem = (error: z.ZodError, message: string, limit?: number) =>
  invalidInput(zodFieldErrors(error, limit), message);

/** Messages zod en français (les messages déjà écrits dans les schémas sont conservés). */
export const frenchZodErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.received === 'undefined') return { message: REQUIRED };
      return { message: `Type invalide : ${TYPE_NAMES[issue.expected] ?? issue.expected} attendu` };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: allowed(issue.options) };
    case z.ZodIssueCode.invalid_literal:
      return { message: `Valeur attendue : ${String(issue.expected)}` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Champ non autorisé : ${issue.keys.join(', ')}` };
    case z.ZodIssueCode.invalid_union:
    case z.ZodIssueCode.invalid_union_discriminator:
      return { message: 'Valeur invalide' };
    case z.ZodIssueCode.invalid_string:
      return { message: stringMessage(issue.validation) };
    case z.ZodIssueCode.too_small:
      return { message: sizeMessage(issue.type, Number(issue.minimum), 'min', issue) };
    case z.ZodIssueCode.too_big:
      return { message: sizeMessage(issue.type, Number(issue.maximum), 'max', issue) };
    case z.ZodIssueCode.not_multiple_of:
      return { message: `Doit être un multiple de ${String(issue.multipleOf)}` };
    case z.ZodIssueCode.not_finite:
      return { message: 'Nombre fini attendu' };
    case z.ZodIssueCode.invalid_date:
      return { message: 'Date invalide' };
    default:
      return { message: ctx.defaultError };
  }
};

const TYPE_NAMES: Record<string, string> = {
  string: 'texte',
  number: 'nombre',
  integer: 'nombre entier',
  boolean: 'oui / non',
  array: 'liste',
  object: 'objet',
  date: 'date',
};

function stringMessage(validation: z.StringValidation) {
  if (validation === 'email') return 'Adresse e-mail invalide';
  if (validation === 'url') return 'Adresse web invalide';
  if (validation === 'uuid' || validation === 'cuid') return 'Identifiant invalide';
  if (validation === 'datetime' || validation === 'date') return 'Date invalide';
  return 'Format invalide';
}

function sizeMessage(
  type: string,
  n: number,
  bound: 'min' | 'max',
  { exact, inclusive }: { exact?: boolean; inclusive: boolean },
) {
  const unit: Record<string, string> = { string: CHARACTER, array: 'élément', set: 'élément' };
  const word = unit[type];
  if (!word) {
    const side = bound === 'min' ? 'supérieur' : 'inférieur';
    return inclusive ? `Doit être ${side} ou égal à ${n}` : `Doit être strictement ${side} à ${n}`;
  }
  if (exact) return `${plural(n, word)} exactement`;
  if (bound === 'min' && n === 1 && type === 'string') return REQUIRED;
  return `${plural(n, word)} ${bound === 'min' ? 'au moins' : 'au plus'}`;
}
