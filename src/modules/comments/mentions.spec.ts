import { mentionTokens, resolveMentions } from './mentions';

const members = [
  { userId: 'u1', fullName: 'Aminata Diallo', email: 'aminata.diallo@example.org' },
  { userId: 'u2', fullName: 'Élodie Camara', email: null },
  { userId: 'u3', fullName: 'Mamadou Bah', email: 'mb@example.org' },
];

describe('mentions dans les commentaires (COL-02)', () => {
  it('extrait les mots mentionnés, sans les adresses e-mail', () => {
    expect(mentionTokens('Merci @Aminata et @élodie ! Écrire à x@y.org')).toEqual([
      'aminata',
      'elodie',
    ]);
  });

  it('reconnaît prénom, nom complet ou partie locale de l’e-mail, sans casse ni accents', () => {
    const ids = (body: string) => resolveMentions(body, members).map((m) => m.userId);
    expect(ids('@aminata')).toEqual(['u1']);
    expect(ids('Avis de @ElodieCamara ?')).toEqual(['u2']);
    expect(ids('cc @mb')).toEqual(['u3']);
    expect(ids('@aminata.diallo et @Mamadou')).toEqual(['u1', 'u3']);
    expect(ids('Personne ici @inconnu')).toEqual([]);
    expect(ids('sans mention')).toEqual([]);
  });
});
