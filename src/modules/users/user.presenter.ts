import type { Prisma } from '@prisma/client';

/** Champs du profil exposés (type User du front) ; le secret TOTP n'est lu que pour son existence. */
export const USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  fullName: true,
  avatarUrl: true,
  locale: true,
  country: true,
  role: true,
  emailVerifiedAt: true,
  totpSecret: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export function toUserDto({ totpSecret, ...user }: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>) {
  return { ...user, totpEnabled: !!totpSecret };
}
