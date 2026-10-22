// Mentions @ dans les commentaires (COL-02) : « @Aminata », « @AminataDiallo » ou « @aminata.diallo »
// (partie locale de l'e-mail) désignent un membre de l'espace, sans tenir compte de la casse ni
// des accents.

export interface Mentionable {
  userId: string;
  fullName: string;
  email: string | null;
}

const MENTION = /(?:^|[^\p{L}\d_.@-])@([\p{L}\d_.-]+)/gu;

function fold(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Mots mentionnés dans un texte, normalisés. */
export function mentionTokens(body: string): string[] {
  return [...body.matchAll(MENTION)].map((m) => fold(m[1])).filter(Boolean);
}

/** Clés par lesquelles un membre peut être mentionné. */
function keys(member: Mentionable) {
  const words = member.fullName.trim().split(/\s+/);
  return new Set(
    [member.fullName, words[0], member.email?.split('@')[0]]
      .filter((v): v is string => !!v)
      .map(fold)
      .filter(Boolean),
  );
}

/** Membres mentionnés (un prénom partagé par plusieurs membres les mentionne tous). */
export function resolveMentions<T extends Mentionable>(body: string, members: T[]): T[] {
  const tokens = new Set(mentionTokens(body));
  if (!tokens.size) return [];
  return members.filter((member) => [...keys(member)].some((key) => tokens.has(key)));
}
