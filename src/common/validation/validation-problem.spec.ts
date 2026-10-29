import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  ValidateNested,
  validate,
} from 'class-validator';
import { z } from 'zod';
import { fieldErrors, frenchZodErrorMap, invalidInput, zodFieldErrors } from './validation-problem';

enum Size {
  S = 'S',
  M = 'M',
}

class ItemDto {
  @IsInt() @Max(99) quantity: number;
  @IsEnum(Size) size: Size;
}

class SignupDto {
  @IsEmail() email: string;
  @IsString() @Length(8, 72) password: string;
  @IsString() @Length(1, 120) title: string;
  @IsOptional() @MaxLength(3) code?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/) color?: string;
  @IsOptional() @Matches(/^[a-z]+$/, { message: 'Minuscules seulement' }) slug?: string;

  @IsOptional()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items?: ItemDto[];
}

async function errorsOf(raw: Record<string, unknown>) {
  const errors = await validate(plainToInstance(SignupDto, raw), {
    forbidNonWhitelisted: true,
    whitelist: true,
  });
  return fieldErrors(errors);
}

const valid = { email: 'a@b.gn', password: 'motdepasse', title: 'Projet' };

describe('messages de validation', () => {
  it('traduit les contraintes par champ, avec leurs valeurs', async () => {
    const fields = await errorsOf({
      email: 'pas-un-email',
      password: 'court',
      title: '',
      code: 'ABCD',
    });
    expect(fields).toEqual({
      email: ['Adresse e-mail invalide'],
      password: ['8 caractères au moins'],
      title: ['Champ obligatoire'],
      code: ['3 caractères au plus'],
    });
  });

  it('distingue trop court et trop long', async () => {
    const fields = await errorsOf({ ...valid, title: 'x'.repeat(121) });
    expect(fields).toEqual({ title: ['120 caractères au plus'] });
  });

  it('reconnaît les formats courants et garde un message personnalisé', async () => {
    const fields = await errorsOf({ ...valid, color: 'rouge', slug: 'ABC' });
    expect(fields).toEqual({
      color: ['Couleur au format #RRGGBB attendue'],
      slug: ['Minuscules seulement'],
    });
  });

  it('donne le chemin des champs imbriqués et les valeurs possibles', async () => {
    const fields = await errorsOf({
      ...valid,
      items: [
        { quantity: 1, size: 'S' },
        { quantity: 120, size: 'XL' },
      ],
    });
    expect(fields).toEqual({
      'items.1.quantity': ['Doit être inférieur ou égal à 99'],
      'items.1.size': ['Valeur non autorisée (valeurs possibles : S, M)'],
    });
  });

  it('refuse les champs inconnus en français', async () => {
    const fields = await errorsOf({ ...valid, hack: true });
    expect(fields).toEqual({ hack: ['Champ non autorisé'] });
  });

  it('met le message seul en détail quand il n’y a qu’une erreur', () => {
    const single = invalidInput({ email: ['Adresse e-mail invalide'] }).getResponse();
    expect(single).toEqual({
      message: 'Adresse e-mail invalide',
      errors: ['email : Adresse e-mail invalide'],
      fields: { email: ['Adresse e-mail invalide'] },
    });
    const many = invalidInput({ a: ['x'], b: ['y'] }).getResponse() as { message: string };
    expect(many.message).toBe('Données invalides');
  });

  it('traduit les messages zod sans écraser ceux des schémas', () => {
    const schema = z.object({
      name: z.string().min(1).max(5),
      email: z.string().email(),
      age: z.number().int().positive(),
      kind: z.enum(['A', 'B']),
      color: z.string().regex(/^#/, 'Couleur invalide'),
    });
    const result = schema.safeParse(
      { name: 'trop long', email: 'x', age: 0, kind: 'C', color: 'rouge' },
      { errorMap: frenchZodErrorMap },
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(zodFieldErrors(result.error)).toEqual({
      name: ['5 caractères au plus'],
      email: ['Adresse e-mail invalide'],
      age: ['Doit être strictement supérieur à 0'],
      kind: ['Valeur non autorisée (valeurs possibles : A, B)'],
      color: ['Couleur invalide'],
    });
    const missing = z.object({ name: z.string() }).safeParse({}, { errorMap: frenchZodErrorMap });
    expect(missing.success || zodFieldErrors(missing.error)).toEqual({
      name: ['Champ obligatoire'],
    });
  });
});
