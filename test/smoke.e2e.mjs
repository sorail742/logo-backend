// Test de fumée de bout en bout (phases 1 à 5, module 5, Studio, avis, images et photos) contre une API et un worker lancés localement.
// Usage : npm run test:smoke   (API=http://hote/api/v1 pour une autre cible, hôte déclaré dans TRUSTED_HOSTS)
import { PrismaClient } from '@prisma/client';
import otplib from 'otplib';

// Le test ne contacte que l'environnement de test : la cible et les liens signés renvoyés par
// l'API (téléchargements, images) sont vérifiés contre ces listes avant toute requête.
const TRUSTED_PROTOCOLS = ['http:', 'https:'];
const TRUSTED_HOSTS = ['localhost', '127.0.0.1'];

function trusted(address) {
  const url = new URL(address);
  if (!TRUSTED_PROTOCOLS.includes(url.protocol) || !TRUSTED_HOSTS.includes(url.hostname)) {
    throw new Error(`Adresse hors de l'environnement de test : ${url.origin}`);
  }
  return url;
}

const API = trusted(process.env.API ?? 'http://localhost:3001/api/v1').href.replace(/\/$/, '');

/** URL d'une route de l'API, segments encodés : un identifiant renvoyé ne peut pas changer la route. */
function apiUrl(path) {
  const [pathname, search] = path.split('?');
  const segments = pathname.split('/').map((segment) => encodeURIComponent(decodeURIComponent(segment)));
  return trusted(`${API}${segments.join('/')}${search === undefined ? '' : `?${search}`}`);
}

let failures = 0;

function check(label, cond, extra) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
  if (!cond) failures++;
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token && { authorization: `Bearer ${token}` }),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json, headers: res.headers };
}

/** Suit le flux SSE d'une tâche jusqu'à son état final. */
async function waitJob(jobId, token, timeoutMs = 30000) {
  const sse = await fetch(apiUrl(`/jobs/${jobId}/events`), { headers: { authorization: `Bearer ${token}` } });
  const reader = sse.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let finalStatus;
  const deadline = Date.now() + timeoutMs;
  while (!finalStatus && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
    for (const m of buf.matchAll(/data: (.*)/g)) {
      const e = JSON.parse(m[1]);
      if (['SUCCEEDED', 'FAILED'].includes(e.status)) finalStatus = e.status;
    }
  }
  reader.cancel().catch(() => {});
  return finalStatus;
}

/** Noms des fichiers d'une archive ZIP (en-têtes locaux). */
function zipEntries(buffer) {
  const names = [];
  for (let i = 0; i + 30 <= buffer.length; ) {
    if (buffer.readUInt32LE(i) !== 0x04034b50) break;
    const size = buffer.readUInt32LE(i + 18);
    const nameLength = buffer.readUInt16LE(i + 26);
    const extra = buffer.readUInt16LE(i + 28);
    names.push(buffer.subarray(i + 30, i + 30 + nameLength).toString('utf8'));
    i += 30 + nameLength + extra + size;
  }
  return names;
}

const email = `e2e-${Date.now()}@example.org`;
const password = 'Kx9!vQ2#mLp7-unique-' + Date.now();

const reg = await call('POST', '/auth/register', { body: { email, password, fullName: 'Testeur E2E' } });
check('inscription', reg.status === 201, reg.status);
check('session avec le profil (type Session du front)', reg.json.user?.email === email && reg.json.user.totpEnabled === false && !('totpSecret' in reg.json.user));
check('cookie de rafraîchissement httpOnly', /refresh_token=.*HttpOnly/i.test(reg.headers.get('set-cookie') ?? ''));
const token = reg.json.accessToken;
const cookie = (reg.headers.get('set-cookie') ?? '').split(';')[0];

const login = await call('POST', '/auth/login', { body: { email, password: 'mauvais' } });
check('mauvais mot de passe refusé en problem+json', login.status === 401 && login.json.status === 401, login.json.detail);

const me = await call('GET', '/me', { token });
check('profil + espace personnel', me.status === 200 && me.json.workspaces.length === 1, me.json.workspaces?.[0]?.role);
const wid = me.json.workspaces[0].workspace.id;

const anon = await call('GET', '/me');
check('route protégée sans jeton → 401', anon.status === 401);

const refresh = await call('POST', '/auth/refresh', { headers: { cookie } });
check('rotation du jeton de rafraîchissement', refresh.status === 200 && !!refresh.json.accessToken, refresh.status);
const reuse = await call('POST', '/auth/refresh', { headers: { cookie } });
check('réutilisation détectée → 401', reuse.status === 401, reuse.json.detail);

const wsList = await call('GET', '/workspaces', { token });
check('espaces : rôle et offre de l’utilisateur', wsList.json[0]?.role === 'OWNER' && wsList.json[0].planCode === 'FREE', wsList.json[0]);
const credits = await call('GET', `/workspaces/${wid}/credits`, { token });
check('crédits : solde et offre', credits.json.balance === 0 && credits.json.planCode === 'FREE', credits.json);

const plans = await call('GET', '/plans');
check('offres publiques (dont Pack Équipe et Atelier)', plans.status === 200 && plans.json.length === 7, plans.json.length);

const proj = await call('POST', `/workspaces/${wid}/projects`, { token, body: { entityType: 'ASSOCIATION', title: 'Asso test' } });
check('création de projet', proj.status === 201, proj.status);
check('projet : avancement du parcours', proj.json.progress?.brief === false && proj.json.chosenName === null, proj.json.progress);
const pid = proj.json.id;

const extra = await call('POST', `/workspaces/${wid}/projects`, { token, body: { entityType: 'ASSOCIATION', title: 'x', hack: true } });
check('champ inconnu refusé (forbidNonWhitelisted)', extra.status === 400, extra.json.errors);

const noBrief = await call('POST', `/projects/${pid}/names/generate`, { token, body: {}, headers: { 'idempotency-key': 'k-' + Date.now() } });
check('génération sans brief refusée', noBrief.status === 400, noBrief.json.detail);

const brief = await call('PUT', `/projects/${pid}/brief`, {
  token,
  body: {
    sector: 'Éducation', mission: 'Accompagner les jeunes vers l’emploi', values: ['solidarité', 'jeunesse', 'avenir'],
    languages: ['fr'], nameStyles: ['INVENTED', 'COMPOUND', 'ACRONYM'], mustInclude: [], mustAvoid: [],
  },
});
check('brief enregistré, projet renvoyé', brief.status === 200 && brief.json.progress.brief === true && brief.json.brief.audience === '', brief.json.progress);

const noKey = await call('POST', `/projects/${pid}/names/generate`, { token, body: {} });
check('Idempotency-Key obligatoire', noKey.status === 400);

const key = 'e2e-key-' + Date.now();
const gen = await call('POST', `/projects/${pid}/names/generate`, { token, body: {}, headers: { 'idempotency-key': key } });
check('génération acceptée (202 + jobId)', gen.status === 202 && !!gen.json.jobId, gen.json);
const again = await call('POST', `/projects/${pid}/names/generate`, { token, body: {}, headers: { 'idempotency-key': key } });
check('même clé → même tâche', again.json.jobId === gen.json.jobId, again.status);

// Suivi SSE jusqu'à l'état final
const finalStatus = await waitJob(gen.json.jobId, token);
check('SSE : tâche terminée', finalStatus === 'SUCCEEDED', finalStatus);

const names = await call('GET', `/projects/${pid}/names`, { token });
check('noms enregistrés', names.status === 200 && names.json.length > 0, names.json.map?.((n) => `${n.value} (${n.score})`));
const nid = names.json[0]?.id;

const checks = await call('POST', `/names/${nid}/checks`, { token, body: {} });
check('vérifications de disponibilité', checks.status === 200 && checks.json.checks.length >= 10, checks.json.checks?.map((c) => `${c.target}:${c.status}`));
const cached = await call('POST', `/names/${nid}/checks`, { token, body: {} });
check('cache 24 h', cached.json.fromCache === true);

const vote = await call('POST', `/names/${nid}/votes`, { token, body: { value: 1 } });
check('vote : total et vote de l’utilisateur', vote.status === 200 && vote.json.votes === 1 && vote.json.myVote === 1, { votes: vote.json.votes, myVote: vote.json.myVote });

const fav = await call('PATCH', `/names/${nid}`, { token, body: { isFavorite: true } });
check('favori', fav.status === 200 && fav.json.isFavorite === true);

const chosen = await call('POST', `/projects/${pid}/chosen-name`, { token, body: { nameId: nid } });
check('nom final retenu', chosen.status === 200 && chosen.json.chosenNameId === nid && chosen.json.progress.name === true, chosen.json.chosenName?.value);

// Quota gratuit : 3 lots de noms par jour (le 1er est déjà consommé)
for (let i = 0; i < 2; i++) {
  await call('POST', `/projects/${pid}/names/generate`, { token, body: { feedback: 'plus court' }, headers: { 'idempotency-key': `q-${i}-${Date.now()}` } });
}
const over = await call('POST', `/projects/${pid}/names/generate`, { token, body: {}, headers: { 'idempotency-key': 'over-' + Date.now() } });
check('quota gratuit dépassé → 402 INSUFFICIENT_CREDITS', over.status === 402 && over.json.code === 'INSUFFICIENT_CREDITS', over.json.detail);

// Un autre utilisateur ne voit pas le projet
const other = await call('POST', '/auth/register', { body: { email: 'o' + email, password, fullName: 'Autre' } });
const foreign = await call('GET', `/projects/${pid}`, { token: other.json.accessToken });
check('non-membre → 404', foreign.status === 404, foreign.status);

const admin = await call('GET', '/admin/stats', { token });
check('back-office interdit à un USER', admin.status === 403, admin.json.detail);

// ─── Phase 3 : logos ───
const icons = await call('GET', '/library/icons?q=ecole', { token });
check('bibliothèque : recherche d’icônes sans accents', icons.status === 200 && icons.json.some((i) => i.id === 'graduation-cap'), icons.json.map?.((i) => i.id));
const fonts = await call('GET', '/library/fonts', { token });
check('bibliothèque : 47 polices OFL', fonts.status === 200 && fonts.json.length === 47 && fonts.json.every((f) => f.license === 'OFL'), fonts.json.length);

const engineB = await call('POST', `/projects/${pid}/logos/generate`, { token, body: { type: 'ICON_TEXT', style: 'MODERN', engine: 'IMAGE_VECTORIZE' }, headers: { 'idempotency-key': 'b-' + Date.now() } });
check('moteur B pas encore disponible → 501', engineB.status === 501, engineB.json.detail);
const badPalette = await call('POST', `/projects/${pid}/logos/generate`, { token, body: { type: 'ICON_TEXT', style: 'MODERN', palette: ['rouge'] }, headers: { 'idempotency-key': 'p-' + Date.now() } });
check('palette invalide refusée', badPalette.status === 400, badPalette.json.errors);

const logoGen = await call('POST', `/projects/${pid}/logos/generate`, {
  token,
  body: { type: 'ICON_TEXT', style: 'AFRICAN', palette: ['#CE1126', '#FCD116', '#14532D'] },
  headers: { 'idempotency-key': 'logos-' + Date.now() },
});
check('lot de logos accepté (quota gratuit du jour)', logoGen.status === 202 && logoGen.json.costCredits === 0, logoGen.json);
const t0 = Date.now();
const logoStatus = await waitJob(logoGen.json.jobId, token);
check('lot de logos terminé', logoStatus === 'SUCCEEDED', { status: logoStatus, ms: Date.now() - t0 });

const logos = await call('GET', `/projects/${pid}/logos`, { token });
const first = logos.json[0];
check('8 propositions avec le nom retenu', logos.status === 200 && logos.json.length === 8 && logos.json.every((l) => l.current.spec.text === chosen.json.chosenName.value), logos.json.length);
check('palette imposée respectée', logos.json.every((l) => l.current.spec.colors.primary === '#ce1126'));
const lid = first.id;

const detail = await call('GET', `/logos/${lid}`, { token });
check('détail : SVG avec texte en tracés', detail.status === 200 && detail.json.current.svg.startsWith('<svg') && !detail.json.current.svg.includes('<text'), detail.json.current?.svg?.length);

const editedSpec = { ...first.current.spec, text: 'Kalossa', fontId: 'playfair', layout: 'vertical', letterSpacing: 0.02 };
const v2 = await call('POST', `/logos/${lid}/versions`, { token, body: { spec: editedSpec, label: 'Version du bureau' } });
check('édition enregistrée en version 2', v2.status === 201 && v2.json.number === 2 && v2.json.label === 'Version du bureau', v2.json.detail ?? v2.json.number);
const badSpec = await call('POST', `/logos/${lid}/versions`, { token, body: { spec: { ...editedSpec, fontId: 'comic-sans', colors: { ...editedSpec.colors, text: 'noir' } } } });
check('spec invalide refusée (police hors bibliothèque, couleur)', badSpec.status === 400 && badSpec.json.errors?.length === 2, badSpec.json.errors);
const brand = await call('POST', `/logos/${lid}/versions`, { token, body: { spec: { ...editedSpec, text: 'Google Guinée' } } });
check('marque célèbre refusée dans l’éditeur', brand.status === 422, brand.json.terms);
const versions = await call('GET', `/logos/${lid}/versions`, { token });
check('historique des versions', versions.json.length === 2 && versions.json[0].number === 2);

const variants = await call('POST', `/logos/${lid}/variants`, { token, body: {} });
check('6 variantes automatiques', variants.status === 200 && variants.json.variants.map((v) => v.id).join() === 'color,black,white,icon,horizontal,vertical', variants.json.variants?.map((v) => v.id));

const favLogo = await call('PATCH', `/logos/${lid}`, { token, body: { isFavorite: true } });
check('logo favori', favLogo.status === 200 && favLogo.json.isFavorite === true && favLogo.json.current.number === 2);

const exp = await call('POST', `/logos/${lid}/export`, { token, body: { formats: ['svg', 'pdf', 'png'], sizes: [1024, 2048], iconPack: true } });
check('export demandé, réduit en offre gratuite', exp.status === 202 && exp.json.restricted === true, exp.json);
check('export terminé', (await waitJob(exp.json.jobId, token)) === 'SUCCEEDED');
const expJob = await call('GET', `/jobs/${exp.json.jobId}`, { token });
check('lien de téléchargement signé', !!expJob.json.result?.downloadUrl && !('storageKey' in expJob.json.result), expJob.json.result);
const zipRes = await fetch(trusted(expJob.json.result.downloadUrl));
const zipFiles = zipEntries(Buffer.from(await zipRes.arrayBuffer()));
check('offre gratuite : PNG 512 px filigrané uniquement', zipRes.status === 200 && zipFiles.every((f) => /-512\.png$|LICENCES\.txt$/.test(f)) && zipFiles.some((f) => f.endsWith('-couleur-512.png')), zipFiles);
const forged = await fetch(trusted(expJob.json.result.downloadUrl.replace(/sig=[^&]+/, 'sig=faux')));
check('lien falsifié refusé', forged.status === 404, forged.status);

const evilSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" onload="alert(1)"><script>alert(1)</script><a href="javascript:x()"><circle cx="32" cy="32" r="30" fill="#0B3D91"/></a><rect width="10" height="10" fill="#F4B400"/></svg>';
const imported = await call('POST', `/projects/${pid}/logos/import`, { token, body: { svg: evilSvg } });
const importedSvg = (await call('GET', `/logos/${imported.json.id}`, { token })).json.current?.svg ?? '';
check('import SVG nettoyé (ni script ni événement), palette extraite', imported.status === 201 && imported.json.engine === 'UPLOAD' && !/script|onload|javascript/i.test(importedSvg) && importedSvg.includes('circle') && imported.json.palette.length >= 2, { palette: imported.json.palette });
const notSvg = await call('POST', `/projects/${pid}/logos/import`, { token, body: { svg: '<!DOCTYPE svg [<!ENTITY x "y">]><svg/>' } });
check('import avec DTD refusé', notSvg.status === 422, notSvg.json.detail);
const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const importedPng = await call('POST', `/projects/${pid}/logos/import`, { token, body: { pngDataUrl: png1x1, palette: ['#123456', '#abcdef'] } });
check('import PNG encapsulé', importedPng.status === 201 && importedPng.json.palette[0] === '#123456', importedPng.json.detail);
const importedVariants = await call('POST', `/logos/${imported.json.id}/variants`, { token, body: {} });
check('logo importé : variantes couleur, noir, blanc', importedVariants.json.variants?.map((v) => v.id).join() === 'color,black,white');

const quotaLogos = await call('POST', `/projects/${pid}/logos/generate`, { token, body: { type: 'MONOGRAM', style: 'CLASSIC' }, headers: { 'idempotency-key': 'lq-' + Date.now() } });
check('quota gratuit : 1 lot de logos par jour → 402', quotaLogos.status === 402, quotaLogos.json.detail);
const foreignLogo = await call('GET', `/logos/${lid}`, { token: other.json.accessToken });
check('logo d’un autre espace → 404', foreignLogo.status === 404);

const activity = await call('GET', `/projects/${pid}/activity`, { token });
check('historique d’activité du projet (COL-04)', activity.status === 200 && activity.json.some((a) => a.code === 'names.choose') && activity.json.some((a) => a.code === 'logos.version') && activity.json.every((a) => a.actor === 'Testeur E2E'), activity.json.slice?.(0, 3).map((a) => a.action));
const withPreview = await call('GET', `/projects/${pid}`, { token });
check('projet : aperçu du logo favori', withPreview.json.progress.logo === true && !!withPreview.json.previewSpec?.colors, withPreview.json.previewSpec?.text);

// ─── Espace d'organisation, invitations ───
const org = await call('POST', '/workspaces', { token, body: { name: 'Association Kaloum' } });
check('espace d’organisation créé', org.status === 201 && org.json.role === 'OWNER' && org.json.planCode === 'FREE');
const seat = await call('POST', `/workspaces/${org.json.id}/invitations`, { token, body: { role: 'EDITOR', asLink: true } });
check('offre gratuite : 1 membre, invitation refusée', seat.status === 403, seat.json.detail);
// Les paiements arrivent en phase 6 : l'abonnement Association est posé directement en base.
const prisma = new PrismaClient();
await prisma.subscription.create({
  data: {
    workspaceId: org.json.id,
    planId: (await prisma.plan.findUniqueOrThrow({ where: { code: 'ASSOCIATION' } })).id,
    status: 'ACTIVE',
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  },
});
await prisma.$disconnect();
const link = await call('POST', `/workspaces/${org.json.id}/invitations`, { token, body: { role: 'EDITOR', asLink: true } });
check('invitation par lien', link.status === 201 && link.json.isLink === true && link.json.link?.startsWith('/invitation/'), link.json.link);
const pending = await call('GET', `/workspaces/${org.json.id}/invitations`, { token });
check('invitations en attente', pending.status === 200 && pending.json.length === 1 && !pending.json[0].link);
const accepted = await call('POST', `/invitations/${link.json.token}/accept`, { token: other.json.accessToken });
check('invitation acceptée → espace avec rôle', accepted.status === 200 && accepted.json.id === org.json.id && accepted.json.role === 'EDITOR', accepted.json.role);
const members = await call('GET', `/workspaces/${org.json.id}/members`, { token });
check('membres (type Member du front)', members.json.length === 2 && members.json.every((m) => m.userId && m.joinedAt && m.role), members.json.map?.((m) => m.role));

// ─── Double authentification et codes de secours ───
const mfaEmail = `mfa-${Date.now()}@example.org`;
const mfaUser = await call('POST', '/auth/register', { body: { email: mfaEmail, password, fullName: 'Double Facteur' } });
const setup = await call('POST', '/auth/2fa/setup', { token: mfaUser.json.accessToken });
const confirm = await call('POST', '/auth/2fa/verify', { token: mfaUser.json.accessToken, body: { code: otplib.authenticator.generate(setup.json.secret) } });
check('2FA activée : 10 codes de secours', confirm.status === 200 && confirm.json.backupCodes?.length === 10 && confirm.json.user.totpEnabled === true, confirm.json.backupCodes?.[0]);
const noCode = await call('POST', '/auth/login', { body: { email: mfaEmail, password } });
check('connexion sans code → MFA_REQUIRED', noCode.status === 401 && noCode.json.code === 'MFA_REQUIRED', noCode.json.code);
const withTotp = await call('POST', '/auth/login', { body: { email: mfaEmail, password, totpCode: otplib.authenticator.generate(setup.json.secret) } });
check('connexion avec le code TOTP', withTotp.status === 200 && !!withTotp.json.accessToken);
const backup = confirm.json.backupCodes[0];
const withBackup = await call('POST', '/auth/login', { body: { email: mfaEmail, password, totpCode: backup.toUpperCase() } });
check('connexion avec un code de secours', withBackup.status === 200, withBackup.json.detail);
const reused = await call('POST', '/auth/login', { body: { email: mfaEmail, password, totpCode: backup } });
check('code de secours à usage unique', reused.status === 401 && reused.json.code === 'MFA_INVALID', reused.json.detail);

// ─── Module 5 : décoration textile ───
const templates = await call('GET', '/apparel/templates', { token });
const jersey = templates.json.find?.((t) => t.category === 'FOOTBALL_JERSEY');
check('supports textiles avec tailles et zones', !!jersey && jersey.sizes.length === 13 && jersey.zones.length === 10, jersey?.zones?.length);
const presets = await call('GET', '/apparel/rule-presets', { token });
const men = presets.json.presets?.find((p) => p.code === 'FOOTBALL_MEN');
check('préréglages sportifs + rappel du règlement officiel', !!men && !!presets.json.disclaimer);

const design = await call('POST', `/projects/${pid}/apparel-designs`, {
  token,
  body: { templateId: jersey.id, rulePresetId: men.id, name: 'Domicile', technique: 'HEAT_TRANSFER_VINYL', garmentColor: '#0B3D91' },
});
check('création d’une tenue', design.status === 201, design.json.detail);
const did = design.json.id;

const elements = (numberHeight) => ({
  elements: [
    { zoneKey: 'back_name', kind: 'PLAYER_NAME', widthMm: 200, heightMm: 70, offsetXMm: 40, offsetYMm: 0, content: { colors: ['#FFFFFF'] } },
    { zoneKey: 'back_number', kind: 'PLAYER_NUMBER', widthMm: numberHeight * 0.6, heightMm: numberHeight, offsetXMm: 60, offsetYMm: 0, content: { colors: ['#FFFFFF'], strokeMm: 30 } },
  ],
});
await call('PUT', `/apparel-designs/${did}/elements`, { token, body: elements(220) });
const bad = await call('POST', `/apparel-designs/${did}/check`, { token, body: {} });
check('numéro dos de 22 cm signalé non conforme (football hommes)', bad.json.ok === false && bad.json.errors.some((e) => e.code === 'NUMBER_HEIGHT'), bad.json.errors?.map((e) => e.message));
const earlyProof = await call('POST', `/apparel-designs/${did}/proof`, { token, body: {} });
check('BAT refusé tant que la tenue n’est pas conforme', earlyProof.status === 422, earlyProof.status);

const badZone = await call('PUT', `/apparel-designs/${did}/elements`, { token, body: { elements: [{ ...elements(300).elements[1], zoneKey: 'front_full' }] } });
check('zone absente du support refusée', badZone.status === 400, badZone.json.detail);

await call('PUT', `/apparel-designs/${did}/elements`, { token, body: elements(300) });
const good = await call('POST', `/apparel-designs/${did}/check`, { token, body: {} });
check('numéro de 30 cm conforme', good.json.ok === true, good.json.errors);

const dupCsv = 'nom,nom_imprime,numero,taille\nMamadou Diallo,DIALLO,10,M\nIbrahima Bah,BAH,10,L';
const dup = await call('POST', `/apparel-designs/${did}/roster/import`, { token, body: { csv: dupCsv } });
check('effectif : numéro en double refusé', dup.status === 422 && dup.json.issues?.[0]?.code === 'NUMBER_DUPLICATE', dup.json.issues);

const csv = 'nom,nom_imprime,numero,taille,poste,quantite\nMamadou Diallo,DIALLO,10,M,Joueur,1\nIbrahima Bah,I. BAH,1,L,Gardien,1\nAïssatou Camara,CAMARA,7,S,Joueur,2';
const roster = await call('POST', `/apparel-designs/${did}/roster/import`, { token, body: { csv, name: 'Seniors' } });
check('effectif importé avec récapitulatif par taille', roster.status === 200 && roster.json.summary.garments === 4 && roster.json.summary.bySize.S === 2, roster.json.summary);

const proof = await call('POST', `/apparel-designs/${did}/proof`, { token, body: {} });
check('lien BAT créé', proof.status === 200 && !!proof.json.token, proof.json.url);
const pubProof = await call('GET', `/public/proofs/${proof.json.token}`);
check('BAT consultable sans compte', pubProof.status === 200 && pubProof.json.roster.entries.length === 3);
const approve = await call('POST', `/public/proofs/${proof.json.token}/approve`, { body: { approverName: 'Président du club' } });
check('BAT approuvé par le client → APPROVED', approve.status === 200 && approve.json.status === 'APPROVED', approve.json);
const edited = await call('PATCH', `/apparel-designs/${did}`, { token, body: { garmentColor: '#C8102E' } });
check('modifier une tenue approuvée la repasse en brouillon', edited.json.status === 'DRAFT' && edited.json.approvedAt === null, edited.json.status);
const oldProof = await call('GET', `/public/proofs/${proof.json.token}`);
check('l’ancien lien BAT ne fonctionne plus', oldProof.status === 404);

const shop = await call('POST', `/workspaces/${wid}/print-shops`, {
  token,
  body: { name: 'Atelier Madina', techniques: ['HEAT_TRANSFER_VINYL', 'DTF'], maxPrintWMm: 400, maxPrintHMm: 500, minStrokeMm: { HEAT_TRANSFER_VINYL: 35 } },
});
check('profil atelier créé', shop.status === 201, shop.json.detail);
const shopCheck = await call('POST', `/apparel-designs/${did}/check`, { token, body: { printShopId: shop.json.id } });
check('le trait minimal de l’atelier s’applique au contrôle', shopCheck.json.errors?.some((e) => e.code === 'STROKE_TOO_THIN'), shopCheck.json.errors?.map((e) => e.code));

const adminTpl = await call('POST', '/admin/apparel/templates', { token, body: {} });
check('administration des supports réservée aux admins', adminTpl.status === 403);

// ─── Phase 4 : slogans et signatures ───
const noCredit = await call('POST', `/projects/${pid}/slogans/generate`, { token, body: { tone: 'INSPIRING' }, headers: { 'idempotency-key': 's0-' + Date.now() } });
check('slogans sans crédit (offre gratuite) → 402 INSUFFICIENT_CREDITS', noCredit.status === 402 && noCredit.json.code === 'INSUFFICIENT_CREDITS', noCredit.json.detail);
// Les paiements arrivent en phase 6 : crédits et abonnement Pro posés directement en base.
const db = new PrismaClient();
await db.$transaction([
  db.workspace.update({ where: { id: wid }, data: { creditBalance: { increment: 5 } } }),
  db.creditLedgerEntry.create({ data: { workspaceId: wid, delta: 5, reason: 'ADMIN_ADJUSTMENT', note: 'test de fumée' } }),
]);
const sloganGen = await call('POST', `/projects/${pid}/slogans/generate`, { token, body: { tone: 'ENGAGED', maxWords: 6, language: 'fr' }, headers: { 'idempotency-key': 's1-' + Date.now() } });
check('lot de slogans accepté (1 crédit)', sloganGen.status === 202 && sloganGen.json.costCredits === 1, sloganGen.json);
check('lot de slogans terminé', (await waitJob(sloganGen.json.jobId, token)) === 'SUCCEEDED');
const slogans = await call('GET', `/projects/${pid}/slogans`, { token });
check('10 slogans de 6 mots au plus (SIG-01, SIG-02)', slogans.json.length === 10 && slogans.json.every((s) => s.kind === 'SLOGAN' && s.tone === 'ENGAGED' && s.text.split(' ').length <= 6), slogans.json.map?.((s) => s.text).slice(0, 2));
const deviseGen = await call('POST', `/projects/${pid}/slogans/generate`, { token, body: { kind: 'DEVISE', tone: 'INSTITUTIONAL' }, headers: { 'idempotency-key': 's2-' + Date.now() } });
await waitJob(deviseGen.json.jobId, token);
const devises = (await call('GET', `/projects/${pid}/slogans`, { token })).json.filter((s) => s.kind === 'DEVISE');
check('devises en trois termes (SIG-03)', devises.length > 0 && devises.every((d) => d.text.split(' – ').length === 3), devises[0]?.text);
const [s1, s2] = slogans.json;
await call('PATCH', `/slogans/${s1.id}`, { token, body: { isChosen: true } });
const chosen2 = await call('PATCH', `/slogans/${s2.id}`, { token, body: { isChosen: true, isFavorite: true } });
const afterChoice = (await call('GET', `/projects/${pid}/slogans`, { token })).json;
check('un seul slogan retenu', chosen2.json.isChosen && afterChoice.filter((s) => s.kind === 'SLOGAN' && s.isChosen).length === 1 && devises.every((d) => !d.isChosen));
const badSlogan = await call('PATCH', `/slogans/${s2.id}`, { token, body: { text: 'x' } });
check('slogan retouché trop court → 400', badSlogan.status === 400);

const emailSig = await call('POST', `/projects/${pid}/signatures`, {
  token,
  body: { kind: 'EMAIL', templateId: 'sidebar', data: { fullName: 'Aïssatou Diallo', jobTitle: 'Présidente', phones: ['+224 620 00 00 00'], email: 'aissatou@example.org', website: 'kaloum.org', address: 'Conakry', socials: [], photoUrl: '', legal: 'Agrément n° 123' } },
});
check('signature e-mail créée (type Signature du front)', emailSig.status === 201 && emailSig.json.templateId === 'sidebar' && emailSig.json.isPrivate === false && emailSig.json.html?.includes('Aïssatou') && !('fileKey' in emailSig.json), emailSig.json.detail);
const sigHtml = await call('GET', `/signatures/${emailSig.json.id}/html`, { token });
check('HTML : logo en URL absolue et mention de l’offre gratuite (SIG-13, SIG-15)', sigHtml.status === 200 && /src="http[^"]+\/public\/signatures\/[^"]+\/logo\.png/.test(sigHtml.json.html) && sigHtml.json.html.includes('Marka') && sigHtml.json.text.includes('+224 620 00 00 00'));
const bannerSig = await call('PATCH', `/signatures/${emailSig.json.id}`, { token, body: { templateId: 'banner' } });
check('modèle bandeau : slogan retenu repris', bannerSig.status === 200 && bannerSig.json.templateId === 'banner' && bannerSig.json.html.includes(chosen2.json.text), bannerSig.json.detail);
const logoUrl = sigHtml.json.html.match(/src="([^"]+logo\.png[^"]*)"/)?.[1]?.replace(/&amp;/g, '&');
const logoPng = logoUrl ? await fetch(trusted(logoUrl)) : null;
check('logo de la signature servi publiquement en PNG', logoPng?.status === 200 && logoPng.headers.get('content-type') === 'image/png');
const badEmail = await call('POST', `/projects/${pid}/signatures`, { token, body: { kind: 'EMAIL', templateId: 'baroque', data: { fullName: 'X' } } });
check('modèle inconnu → 400', badEmail.status === 400, badEmail.json.detail);

const noAttest = await call('POST', `/projects/${pid}/signatures`, { token, body: { kind: 'HANDWRITTEN', data: { text: 'A. Diallo', fontId: 'great-vibes', ink: 'blue' } } });
check('paraphe sans attestation → 400 ATTESTATION_REQUIRED', noAttest.status === 400 && noAttest.json.code === 'ATTESTATION_REQUIRED');
const balanceBefore = (await call('GET', `/workspaces/${wid}/credits`, { token })).json.balance;
const paraphe = await call('POST', `/projects/${pid}/signatures`, { token, body: { kind: 'HANDWRITTEN', data: { text: 'A. Diallo', fontId: 'great-vibes', ink: 'blue' }, attested: true } });
const balanceAfter = (await call('GET', `/workspaces/${wid}/credits`, { token })).json.balance;
check('paraphe créé, privé, 1 crédit (SIG-20)', paraphe.status === 201 && paraphe.json.isPrivate && !!paraphe.json.attestedAt && balanceBefore - balanceAfter === 1, [paraphe.status, balanceBefore, balanceAfter]);
const parapheFile = await call('GET', `/signatures/${paraphe.json.id}/file`, { token });
const parapheSvg = parapheFile.json.svgUrl ? await (await fetch(trusted(parapheFile.json.svgUrl))).text() : '';
check('paraphe : URL signée courte, SVG en tracés (SIG-24)', parapheFile.status === 200 && new Date(parapheFile.json.expiresAt) - Date.now() <= 300_000 && parapheSvg.includes('<path') && !parapheSvg.includes('<text'));
const parapheFetch = await fetch(trusted(parapheFile.json.url));
check('paraphe : PNG transparent', parapheFetch.status === 200 && (await parapheFetch.arrayBuffer()).byteLength > 1000);

const stampData = { shape: 'round', ringText: 'République de Guinée', bottomText: 'Conakry', centerText: 'RG', centerMode: 'acronym', ink: 'blue', inkEffect: true };
const stamp = await call('POST', `/projects/${pid}/signatures`, { token, body: { kind: 'STAMP', data: stampData, attested: true } });
check('cachet avec terme officiel → PENDING_REVIEW (§6.4)', stamp.status === 201 && stamp.json.status === 'PENDING_REVIEW' && stamp.json.templateId === 'round', stamp.json.status);
const pendingFile = await call('GET', `/signatures/${stamp.json.id}/file`, { token });
check('cachet en attente : fichier refusé', pendingFile.status === 409 && pendingFile.json.code === 'SIGNATURE_PENDING_REVIEW');
const viewerFile = await call('GET', `/signatures/${paraphe.json.id}/file`, { token: other.json.accessToken });
check('paraphe d’un autre espace → 404', viewerFile.status === 404);

const freeBatch = await call('POST', `/projects/${pid}/signatures/batch`, { token, body: { csv: 'nom;fonction\nA;B' } });
check('signatures en lot réservées à Pro → 403', freeBatch.status === 403 && freeBatch.json.code === 'PLAN_REQUIRED');
await db.subscription.create({
  data: { workspaceId: wid, planId: (await db.plan.findUniqueOrThrow({ where: { code: 'PRO' } })).id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) },
});
const batch = await call('POST', `/projects/${pid}/signatures/batch`, { token, body: { csv: 'Nom;Fonction;E-mail;Téléphone\nMamadou Bah;Trésorier;mamadou@example.org;+224 621 11 11 11\n"Fanta Camara";Secrétaire;pas-un-email;\nMamadou Bah;Membre;;', templateId: 'compact' } });
check('lot de signatures accepté (SIG-16)', batch.status === 202 && batch.json.count === 3, batch.json);
check('lot de signatures terminé', (await waitJob(batch.json.jobId, token)) === 'SUCCEEDED');
const batchJob = await call('GET', `/jobs/${batch.json.jobId}`, { token });
const batchZip = Buffer.from(await (await fetch(trusted(batchJob.json.result.downloadUrl))).arrayBuffer());
check('archive : HTML et texte par membre, noms uniques', zipEntries(batchZip).join(',') === 'mamadou-bah.html,mamadou-bah.txt,fanta-camara.html,fanta-camara.txt,mamadou-bah-2.html,mamadou-bah-2.txt', zipEntries(batchZip));
const proHtml = await call('GET', `/signatures/${emailSig.json.id}/html`, { token });
check('offre Pro : plus de mention de la plateforme', !proHtml.json.html.includes('Marka'));

const pubSig = await call('POST', '/public/email-signature', { body: { templateId: 'minimal', data: { fullName: 'Ibrahima Sow', email: 'ibrahima@example.org' }, brand: { name: 'Sow & Fils', primary: '#0f766e', secondary: '#f59e0b' } } });
check('signature e-mail sans compte', pubSig.status === 200 && pubSig.json.html.includes('Ibrahima Sow') && pubSig.json.html.includes('Sow &amp; Fils') && pubSig.json.html.includes('Marka'));

// Modération : un administrateur avec 2FA valide ou refuse le cachet.
const queueForbidden = await call('GET', '/admin/moderation', { token });
check('file de modération interdite à un USER', queueForbidden.status === 403);
await db.user.update({ where: { email: mfaEmail }, data: { role: 'ADMIN' } });
const adminLogin = await call('POST', '/auth/login', { body: { email: mfaEmail, password, totpCode: otplib.authenticator.generate(setup.json.secret) } });
const adminToken = adminLogin.json.accessToken;
const queue = await call('GET', '/admin/moderation', { token: adminToken });
const item = queue.json.find?.((i) => i.id === stamp.json.id);
check('cachet dans la file de modération (type ModerationItem)', queue.status === 200 && item?.kind === 'STAMP' && /r[ée]publique/i.test(item.reason) && !/,/.test(item.reason) && item.previewSvg?.startsWith('<svg') && !!item.workspaceName, item?.reason);
const reject = await call('PATCH', `/admin/signatures/${stamp.json.id}/review`, { token: adminToken, body: { decision: 'REJECT', note: 'Armoiries officielles' } });
const rejectedFile = await call('GET', `/signatures/${stamp.json.id}/file`, { token });
check('cachet refusé : fichier refusé', reject.status === 204 && rejectedFile.status === 403 && rejectedFile.json.code === 'SIGNATURE_REJECTED', [reject.status, rejectedFile.status]);
const notified = await call('GET', '/notifications', { token });
check('propriétaire notifié du refus avec le motif', notified.json.items?.some((n) => n.title === 'Cachet refusé' && n.body.includes('Armoiries')));
const resubmit = await call('PATCH', `/signatures/${stamp.json.id}`, { token, body: { data: { ...stampData, ringText: 'Association Kaloum Jeunesse' }, attested: true } });
check('cachet corrigé : actif, sans nouveau débit', resubmit.status === 200 && resubmit.json.status === 'ACTIVE');
const approveAgain = await call('PATCH', `/admin/signatures/${stamp.json.id}/review`, { token: adminToken, body: { decision: 'APPROVE' } });
check('revue d’un cachet non en attente → 409', approveAgain.status === 409);
const stampFile = await call('GET', `/signatures/${stamp.json.id}/file`, { token });
check('cachet actif : fichier disponible', stampFile.status === 200 && !!stampFile.json.url);
const logoStamp = await call('PATCH', `/signatures/${stamp.json.id}`, { token, body: { data: { ...stampData, ringText: 'Association Kaloum', centerMode: 'logo' }, attested: true } });
check('cachet avec le logo au centre', logoStamp.status === 200 && logoStamp.json.data.centerMode === 'logo');

// ─── Phase 5 : kit de marque, partage, commentaires, notifications ───
const kit1 = await call('POST', `/projects/${pid}/brand-kits`, { token });
check(
  'kit v1 : nom, palette HEX/RGB/CMJN, polices sous licence, slogan (KIT-01)',
  kit1.status === 201 && kit1.json.version === 1 && kit1.json.name === chosen.json.chosenName.value &&
    kit1.json.palette.length === 4 && kit1.json.palette.every((c) => /^#[0-9A-F]{6}$/.test(c.hex) && c.rgb.split(', ').length === 3 && c.cmyk.split(', ').length === 4) &&
    kit1.json.fonts.every((f) => f.license === 'SIL Open Font License 1.1') && !!kit1.json.logoSpec && kit1.json.slogan === chosen2.json.text &&
    kit1.json.guideCost === 3 && kit1.json.guidePdfUrl === null && kit1.json.zipUrl === null,
  kit1.json.detail ?? kit1.json.version,
);
const kid = kit1.json.id;
check('avancement du parcours : kit', (await call('GET', `/projects/${pid}`, { token })).json.progress.kit === true);

// Offre gratuite (abonnement suspendu le temps du test) : charte refusée, archive réduite.
await db.subscription.update({ where: { workspaceId: wid }, data: { status: 'EXPIRED' } });
const freeGuide = await call('POST', `/brand-kits/${kid}/guide`, { token, headers: { 'idempotency-key': 'g0-' + Date.now() } });
check('charte en offre gratuite → 403 PLAN_REQUIRED', freeGuide.status === 403 && freeGuide.json.code === 'PLAN_REQUIRED', freeGuide.json.detail);
const freeZip = await call('POST', `/brand-kits/${kid}/zip`, { token });
check('archive en offre gratuite : demandée, réduite', freeZip.status === 202 && freeZip.json.restricted === true, freeZip.json);
check('archive gratuite terminée', (await waitJob(freeZip.json.jobId, token, 60000)) === 'SUCCEEDED');
const freeZipJob = await call('GET', `/jobs/${freeZip.json.jobId}`, { token });
const freeFiles = zipEntries(Buffer.from(await (await fetch(trusted(freeZipJob.json.result.downloadUrl))).arrayBuffer()));
check(
  'offre gratuite : PNG 512 px seulement, ni vectoriel, ni charte, ni supports (§7.4)',
  freeFiles.some((f) => /\/logo\/png\/.+-couleur-512\.png$/.test(f)) &&
    freeFiles.every((f) => /\/(logo\/png\/.+-512\.png|signatures\/.+|LICENCES\.txt|LISEZMOI\.txt)$/.test(f)),
  freeFiles.filter((f) => !/\/(logo\/png\/.+-512\.png|signatures\/.+|LICENCES\.txt|LISEZMOI\.txt)$/.test(f)),
);
await db.subscription.update({ where: { workspaceId: wid }, data: { status: 'ACTIVE' } });

// Solde à 7 crédits : la charte (3) le fait passer sous le seuil d'alerte (5).
const { creditBalance: balance } = await db.workspace.findUniqueOrThrow({ where: { id: wid } });
await db.$transaction([
  db.workspace.update({ where: { id: wid }, data: { creditBalance: 7 } }),
  db.creditLedgerEntry.create({ data: { workspaceId: wid, delta: 7 - balance, reason: 'ADMIN_ADJUSTMENT', note: 'test de fumée' } }),
]);
const guideNoKey = await call('POST', `/brand-kits/${kid}/guide`, { token });
check('charte : Idempotency-Key obligatoire', guideNoKey.status === 400);
const guide = await call('POST', `/brand-kits/${kid}/guide`, { token, headers: { 'idempotency-key': 'g1-' + Date.now() } });
check('charte demandée : 3 crédits (§8.3)', guide.status === 202 && guide.json.costCredits === 3, guide.json);
check('charte terminée', (await waitJob(guide.json.jobId, token, 60000)) === 'SUCCEEDED');
const guideJob = await call('GET', `/jobs/${guide.json.jobId}`, { token });
const guidePdf = Buffer.from(await (await fetch(trusted(guideJob.json.result.downloadUrl))).arrayBuffer());
const guidePages = guidePdf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0;
check('charte PDF de 9 pages (KIT-02)', guidePdf.subarray(0, 5).toString() === '%PDF-' && guidePages === 9, guidePages);
const afterGuide = await call('GET', '/notifications', { token });
check('export prêt notifié (COL-03)', afterGuide.json.items.some((n) => n.type === 'EXPORT_READY' && n.title === 'Charte graphique prête' && n.href === `/app/projets/${pid}/kit`));
check('alerte de crédits bas (COL-03)', afterGuide.json.items.some((n) => n.type === 'LOW_CREDITS' && n.body.includes('4 crédits')), afterGuide.json.items.map((n) => n.type));
const regen = await call('POST', `/brand-kits/${kid}/guide`, { token, headers: { 'idempotency-key': 'g2-' + Date.now() } });
check('charte régénérée sans coût (§7.4)', regen.status === 202 && regen.json.costCredits === 0, regen.json);
await waitJob(regen.json.jobId, token, 60000);

const zip = await call('POST', `/brand-kits/${kid}/zip`, { token });
check('archive complète demandée', zip.status === 202 && zip.json.restricted === false, zip.json);
check('archive complète terminée', (await waitJob(zip.json.jobId, token, 90000)) === 'SUCCEEDED');
const kitsList = await call('GET', `/projects/${pid}/brand-kits`, { token });
const current = kitsList.json[0];
check('kit : liens signés vers la charte et l’archive', !!current.guidePdfUrl && !!current.zipUrl && current.guideCost === 0, current);
const guideInline = await fetch(trusted(current.guidePdfUrl));
check('charte servie en ligne (PDF)', guideInline.status === 200 && guideInline.headers.get('content-type') === 'application/pdf' && /^inline/.test(guideInline.headers.get('content-disposition') ?? ''));
const kitFiles = zipEntries(Buffer.from(await (await fetch(trusted(current.zipUrl))).arrayBuffer()));
const kitRoot = kitFiles[0]?.split('/')[0] ?? '';
const expectedFiles = [
  'logo/svg/', 'logo/png/', 'logo/pdf/', 'icones-app/favicon.ico', 'reseaux-sociaux/', 'signatures/signature-email.html',
  'signatures/slogan.txt', 'signatures/cachet.svg', 'signatures/paraphe.png', 'supports/carte-de-visite.pdf',
  'supports/papier-a-en-tete.pdf', 'supports/papier-a-en-tete.docx', 'supports/carte-de-membre.pdf', 'charte.pdf', 'LICENCES.txt', 'LISEZMOI.txt',
];
check(
  'archive rangée : logo, icônes, réseaux, signatures, supports, charte, licences (KIT-03, KIT-04)',
  /-kit-v1$/.test(kitRoot) && expectedFiles.every((p) => kitFiles.some((f) => f.startsWith(`${kitRoot}/${p}`))),
  expectedFiles.filter((p) => !kitFiles.some((f) => f.startsWith(`${kitRoot}/${p}`))),
);

// Versions : un nouveau nom final crée v2 (NOM-33) ; v1 se restaure en v3 (KIT-06).
const otherName = (await call('GET', `/projects/${pid}/names`, { token })).json.find((n) => n.id !== nid && !n.isRejected);
await call('POST', `/projects/${pid}/chosen-name`, { token, body: { nameId: otherName.id } });
const versions2 = (await call('GET', `/projects/${pid}/brand-kits`, { token })).json;
check(
  'nouveau nom final → kit v2, v1 conservé (NOM-33)',
  versions2.length === 2 && versions2[0].version === 2 && versions2[0].name === otherName.value && versions2[1].name === chosen.json.chosenName.value,
  versions2.map((k) => `${k.version}:${k.name}`),
);
const restoredKit = await call('POST', `/brand-kits/${kid}/restore`, { token });
check(
  'v1 restaurée en v3, charte déjà payée (KIT-06)',
  restoredKit.status === 201 && restoredKit.json.version === 3 && restoredKit.json.restoredFrom === 1 && restoredKit.json.name === chosen.json.chosenName.value && restoredKit.json.guideCost === 0 && restoredKit.json.guidePdfUrl === null,
  restoredKit.json,
);

// Partage en lecture seule (KIT-05)
const pastShare = await call('POST', `/brand-kits/${kid}/share`, { token, body: { enabled: true, expiresAt: '2020-01-01T00:00:00Z' } });
check('partage : expiration passée refusée', pastShare.status === 400);
const shared = await call('POST', `/brand-kits/${kid}/share`, { token, body: { enabled: true, password: 'kola2026', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
check('lien de partage avec mot de passe et expiration', shared.status === 200 && !!shared.json.shareToken && shared.json.hasPassword === true && !!shared.json.shareExpiresAt && !('sharePasswordHash' in shared.json), shared.json.detail);
const shareToken = shared.json.shareToken;
const locked = await call('GET', `/public/kits/${shareToken}`);
check('kit protégé : mot de passe requis', locked.status === 401 && locked.json.code === 'PASSWORD_REQUIRED');
const wrongPassword = await call('GET', `/public/kits/${shareToken}`, { headers: { 'x-kit-password': 'faux' } });
check('kit protégé : mauvais mot de passe', wrongPassword.status === 401 && wrongPassword.json.code === 'PASSWORD_INVALID');
const publicKit = await call('GET', `/public/kits/${shareToken}`, { headers: { 'x-kit-password': 'kola2026' } });
check(
  'page publique du kit (type PublicKit)',
  publicKit.status === 200 && publicKit.json.projectName === chosen.json.chosenName.value && publicKit.json.entityType === 'ASSOCIATION' &&
    publicKit.json.palette.length === 4 && !!publicKit.json.zipUrl && !('sharePasswordHash' in publicKit.json),
  publicKit.json.detail,
);
const revoked = await call('POST', `/brand-kits/${kid}/share`, { token, body: { enabled: false } });
const revokedPublic = await call('GET', `/public/kits/${shareToken}`, { headers: { 'x-kit-password': 'kola2026' } });
check('lien révoqué → 404', revoked.json.shareToken === null && revokedPublic.status === 404);
check('kit d’un autre espace → 404', (await call('GET', `/brand-kits/${kid}`, { token: other.json.accessToken })).status === 404);
const kitActivity = await call('GET', `/projects/${pid}/activity`, { token });
check('historique : kit assemblé, charte, archive, partage, restauration', ['kits.create', 'kits.guide', 'kits.zip', 'kits.share', 'kits.restore'].every((code) => kitActivity.json.some((a) => a.code === code)));

// Commentaires et mentions dans l'espace d'organisation (COL-02, COL-03)
const shared2 = await call('POST', `/workspaces/${org.json.id}/projects`, { token, body: { entityType: 'ASSOCIATION', title: 'Projet commun' } });
const opid = shared2.json.id;
const comment = await call('POST', `/projects/${opid}/comments`, { token, body: { targetType: 'PROJECT', targetId: opid, body: 'Qu’en penses-tu @Autre ? Le kit est prêt.' } });
check('commentaire avec mention (COL-02)', comment.status === 201 && comment.json.authorName === 'Testeur E2E' && comment.json.mentions?.[0]?.fullName === 'Autre', comment.json);
const mentionedNotifs = await call('GET', '/notifications', { token: other.json.accessToken });
check('membre mentionné notifié', mentionedNotifs.json.items?.some((n) => n.type === 'COMMENT' && n.title === 'Testeur E2E vous a mentionné' && n.href === `/app/projets/${opid}`));
const reply = await call('POST', `/projects/${opid}/comments`, { token: other.json.accessToken, body: { targetType: 'PROJECT', targetId: opid, body: 'Parfait, je valide.' } });
const ownerNotifs = await call('GET', '/notifications', { token });
check('participant prévenu de la réponse', reply.status === 201 && ownerNotifs.json.items.some((n) => n.type === 'COMMENT' && n.title === 'Autre a commenté le projet'));
const thread = await call('GET', `/projects/${opid}/comments?targetType=PROJECT&targetId=${opid}`, { token });
check('commentaires du plus récent au plus ancien', thread.status === 200 && thread.json.length === 2 && thread.json[0].body === 'Parfait, je valide.', thread.json.length);
const foreignTarget = await call('POST', `/projects/${opid}/comments`, { token, body: { targetType: 'LOGO', targetId: lid, body: 'Hors sujet' } });
check('élément d’un autre projet → 400', foreignTarget.status === 400);
const deleteOthers = await call('DELETE', `/comments/${comment.json.id}`, { token: other.json.accessToken });
const deleteOwn = await call('DELETE', `/comments/${comment.json.id}`, { token });
check('suppression : auteur oui, autre éditeur non', deleteOthers.status === 403 && deleteOwn.status === 204, [deleteOthers.status, deleteOwn.status]);
const invite = await call('POST', `/workspaces/${org.json.id}/invitations`, { token, body: { role: 'VIEWER', email: mfaEmail } });
const inviteeNotifs = await call('GET', '/notifications', { token: adminToken });
check('invitation notifiée à un utilisateur inscrit (COL-03)', invite.status === 201 && inviteeNotifs.json.items?.some((n) => n.type === 'INVITATION' && n.href?.startsWith('/invitation/')), invite.json.detail);
await db.$disconnect();
const sigActivity = await call('GET', `/projects/${pid}/activity`, { token });
check('historique : slogans et signatures', ['slogans.generate', 'slogans.choose', 'signatures.create', 'signatures.batch'].every((code) => sigActivity.json.some((a) => a.code === code)));

// ─── Studio de création ───
const studioDoc = {
  version: 1,
  width: 874,
  height: 1240,
  print: { widthMm: 148, heightMm: 210, bleedMm: 3 },
  pages: [
    {
      id: 'p1',
      background: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#0f6b5c' }, { offset: 1, color: '#062f28' }] },
      elements: [
        { id: 'bg', type: 'shape', shape: 'blob', seed: 3, x: 500, y: 900, width: 500, height: 420, rotation: 0, opacity: 1, fill: { type: 'solid', color: '#f2b705' } },
        { id: 'title', type: 'text', x: 60, y: 300, width: 754, height: 220, rotation: 0, opacity: 1, text: 'Journée portes ouvertes', fontId: 'anton', fontWeight: 400, fontSize: 100, letterSpacing: 0, lineHeight: 1.05, align: 'left', uppercase: true, fill: { type: 'solid', color: '#ffffff' }, lines: ['JOURNÉE PORTES', 'OUVERTES'], shadow: { x: 0, y: 6, blur: 18, color: '#000000', opacity: 0.35 } },
        { id: 'arc', type: 'text', x: 200, y: 120, width: 474, height: 120, rotation: 0, opacity: 1, text: 'Kaloum · Conakry', fontId: 'montserrat', fontWeight: 700, fontSize: 40, letterSpacing: 0.1, lineHeight: 1.2, align: 'center', uppercase: true, fill: { type: 'solid', color: '#f2b705' }, curve: 40 },
        { id: 'svg', type: 'svg', source: 'graphic', x: 60, y: 1000, width: 160, height: 160, rotation: 0, opacity: 1, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4" fill="#fff" onclick="x()"/></svg>' },
      ],
    },
  ],
};
const studioDesign = await call('POST', `/projects/${pid}/studio-designs`, { token, body: { name: 'Flyer portes ouvertes', format: 'flyer-a5', doc: studioDoc } });
const sdid = studioDesign.json.id;
check('Studio : création (format imprimé)', studioDesign.status === 201 && studioDesign.json.width === 874 && studioDesign.json.doc.print.bleedMm === 3, studioDesign.json.detail ?? studioDesign.json.errors);
const svgEl = studioDesign.json.doc?.pages[0].elements.find((e) => e.id === 'svg');
check('Studio : SVG intégré nettoyé (script, événements)', !!svgEl && !/script|onclick/i.test(svgEl.svg), svgEl?.svg);
const badDoc = structuredClone(studioDoc);
badDoc.pages[0].elements[1].fontId = 'comic-sans';
const invalid = await call('POST', `/projects/${pid}/studio-designs`, { token, body: { name: 'Invalide', format: 'flyer-a5', doc: badDoc } });
check('Studio : document invalide → 400', invalid.status === 400, invalid.status);
const studioList = await call('GET', `/projects/${pid}/studio-designs`, { token });
check('Studio : liste sans document', studioList.status === 200 && studioList.json.length === 1 && !('doc' in studioList.json[0]));
const renamed = await call('PUT', `/studio-designs/${sdid}`, { token, body: { name: 'Flyer JPO', thumbnail: 'data:image/png;base64,iVBORw0KGgo=' } });
check('Studio : sauvegarde (nom, aperçu)', renamed.status === 200 && renamed.json.name === 'Flyer JPO' && !!renamed.json.thumbnail, renamed.status);
const pdfExport = await call('POST', `/studio-designs/${sdid}/export`, { token, body: { format: 'pdf', cropMarks: true } });
const pdfStatus = pdfExport.status === 202 ? await waitJob(pdfExport.json.jobId, token, 60000) : null;
const pdfJob = pdfExport.status === 202 ? await call('GET', `/jobs/${pdfExport.json.jobId}`, { token }) : null;
const pdfFile = pdfJob?.json.result?.downloadUrl ? await fetch(trusted(pdfJob.json.result.downloadUrl)) : null;
const pdfBytes = pdfFile ? Buffer.from(await pdfFile.arrayBuffer()) : Buffer.alloc(0);
check(
  'Studio : PDF d’impression (fond perdu, traits de coupe, 0 crédit)',
  pdfStatus === 'SUCCEEDED' && pdfBytes.subarray(0, 4).toString() === '%PDF' && /\/TrimBox/.test(pdfBytes.toString('latin1')) && pdfJob.json.costCredits === 0,
  [pdfStatus, pdfBytes.length],
);
const svgExport = await call('POST', `/studio-designs/${sdid}/export`, { token, body: { format: 'svg' } });
const svgStatus = svgExport.status === 202 ? await waitJob(svgExport.json.jobId, token, 60000) : null;
const svgJob = svgExport.status === 202 ? await call('GET', `/jobs/${svgExport.json.jobId}`, { token }) : null;
const svgText = svgJob?.json.result?.downloadUrl ? await (await fetch(trusted(svgJob.json.result.downloadUrl))).text() : '';
check('Studio : SVG au texte vectorisé', svgStatus === 'SUCCEEDED' && svgText.startsWith('<svg') && !svgText.includes('<text'), svgStatus);
const studioCopy = await call('POST', `/studio-designs/${sdid}/duplicate`, { token });
check('Studio : duplication', studioCopy.status === 201 && studioCopy.json.name === 'Flyer JPO (copie)' && studioCopy.json.doc.pages.length === 1);
check('Studio : création d’un autre espace → 404', (await call('GET', `/studio-designs/${sdid}`, { token: other.json.accessToken })).status === 404);
check('Studio : suppression', (await call('DELETE', `/studio-designs/${studioCopy.json.id}`, { token })).status === 204);
const transparentVariants = await call('POST', `/logos/${lid}/variants`, { token, body: { transparent: true } });
const whiteLogo = transparentVariants.json.variants?.find((v) => v.id === 'white')?.svg ?? '';
check('Studio : logo blanc sans fond', transparentVariants.status === 200 && !!whiteLogo && !/<path fill="#1{3,6}" d="M0 0h[\d.]+v[\d.]+H0z"/.test(whiteLogo));
const studioActivity = await call('GET', `/projects/${pid}/activity`, { token });
check('historique : créations et exports du Studio', ['studio.create', 'studio.export'].every((code) => studioActivity.json.some((a) => a.code === code)));

// ─── Studio : avis épinglés, images générées, bibliothèque ───
const pin = await call('POST', `/projects/${pid}/comments`, { token, body: { targetType: 'DESIGN', targetId: sdid, body: 'Le titre touche presque le bord.', anchor: { pageId: 'p1', x: 0.12, y: 0.3 } } });
check('avis épinglé sur une création', pin.status === 201 && pin.json.anchor?.pageId === 'p1' && pin.json.anchor.x === 0.12, pin.json);
const badPin = await call('POST', `/projects/${pid}/comments`, { token, body: { targetType: 'DESIGN', targetId: sdid, body: 'Ailleurs', anchor: { pageId: 'inconnue', x: 0.5, y: 0.5 } } });
const projectPin = await call('POST', `/projects/${pid}/comments`, { token, body: { targetType: 'PROJECT', targetId: pid, body: 'Épinglé ?', anchor: { pageId: 'p1', x: 0.5, y: 0.5 } } });
check('épingle refusée : page inconnue ou cible sans page', badPin.status === 400 && projectPin.status === 400, [badPin.status, projectPin.status]);
const pinReply = await call('POST', `/projects/${pid}/comments`, { token, body: { targetType: 'DESIGN', targetId: sdid, body: 'Corrigé, marge de 60 px.', parentId: pin.json.id } });
const nestedReply = await call('POST', `/projects/${pid}/comments`, { token, body: { targetType: 'DESIGN', targetId: sdid, body: 'Réponse à la réponse', parentId: pinReply.json.id } });
check('réponse dans le fil (un seul niveau)', pinReply.status === 201 && pinReply.json.parentId === pin.json.id && nestedReply.status === 400, [pinReply.status, nestedReply.status]);
const resolved = await call('PATCH', `/comments/${pin.json.id}`, { token, body: { resolved: true } });
const resolveReply = await call('PATCH', `/comments/${pinReply.json.id}`, { token, body: { resolved: true } });
check('fil résolu (seulement par son premier message)', resolved.status === 200 && !!resolved.json.resolvedAt && resolveReply.status === 400, [resolved.status, resolveReply.status]);
const designThread = await call('GET', `/projects/${pid}/comments?targetType=DESIGN&targetId=${sdid}`, { token });
check('avis de la création', designThread.status === 200 && designThread.json.length === 2, designThread.json.length);

const imagesNoKey = await call('POST', `/projects/${pid}/studio-images`, { token, body: { prompt: 'Motif wax pour une affiche', style: 'auto', aspect: 'portrait' } });
const blockedPrompt = await call('POST', `/projects/${pid}/studio-images`, { token, body: { prompt: 'Affiche avec un symbole nazi', style: 'auto', aspect: 'square' }, headers: { 'idempotency-key': crypto.randomUUID() } });
check('images : clé d’idempotence exigée, terme refusé', imagesNoKey.status === 400 && blockedPrompt.status === 422 && blockedPrompt.json.code === 'TERM_BLOCKED', [imagesNoKey.status, blockedPrompt.status]);
const images = await call('POST', `/projects/${pid}/studio-images`, { token, body: { prompt: 'Motif wax pour une affiche', style: 'auto', aspect: 'portrait' }, headers: { 'idempotency-key': crypto.randomUUID() } });
check('images : lot demandé', images.status === 202 && !!images.json.jobId, images.json);
check('images : lot terminé', (await waitJob(images.json.jobId, token, 60000)) === 'SUCCEEDED');
const imagesJob = await call('GET', `/jobs/${images.json.jobId}`, { token });
const generated = imagesJob.json.result?.images ?? [];
const firstImage = generated[0] ? await fetch(trusted(generated[0].url)) : null;
check(
  'images : 4 PNG portrait servis par URL signée',
  generated.length === 4 && generated.every((i) => i.width === 1280 && i.height === 1600) && firstImage?.status === 200 && firstImage.headers.get('content-type') === 'image/png' && !('storageKey' in generated[0]),
  { count: generated.length, status: firstImage?.status },
);

const caps = await call('GET', '/library/capabilities', { token });
check('bibliothèque : capacités', caps.status === 200 && caps.json.aiImages?.demo === true && typeof caps.json.photos === 'boolean', caps.json);
const photos = await call('GET', '/library/photos?q=march%C3%A9', { token });
check('banque de photos : 501 sans clé, résultats avec', caps.json.photos ? photos.status === 200 && Array.isArray(photos.json.photos) : photos.status === 501 && photos.json.code === 'NOT_AVAILABLE', photos.status);
check('banque de photos : identifiant numérique exigé', (await call('GET', '/library/photos/abc/file', { token })).status === 400);
const studioImagesActivity = await call('GET', `/projects/${pid}/activity`, { token });
check('historique : images du Studio', studioImagesActivity.json.some((a) => a.code === 'studio.images'));

const del = await call('DELETE', `/projects/${pid}`, { token });
const gone = await call('GET', `/projects/${pid}`, { token });
const restored = await call('POST', `/projects/${pid}/restore`, { token });
check('corbeille puis restauration', del.status === 204 && gone.status === 404 && restored.status === 201, [del.status, gone.status, restored.status]);

const pub = await call('POST', '/public/names/try', { body: { entityType: 'APPLICATION', sector: 'Fintech', mission: 'Paiement mobile simple' } });
// 3 essais par IP et par jour : au-delà, 429 est le comportement attendu.
check('essai public sans compte (ou limite du jour atteinte)', (pub.status === 200 && pub.json.names.length > 0) || pub.status === 429, pub.status);

const ready = await fetch(apiUrl('/health/ready'));
check('sonde ready', ready.status === 200);

console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert');
process.exit(failures ? 1 : 0);
