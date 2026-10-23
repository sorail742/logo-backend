// Matrice des droits de bout en bout (§3) : chaque route sensible est appelée par chaque rôle
// d'espace (propriétaire, éditeur, lecteur, non-membre) et par les rôles plateforme (support,
// admin), et le code HTTP attendu est vérifié. API et worker lancés localement.
// Usage : npm run test:permissions
import { PrismaClient } from '@prisma/client';
import otplib from 'otplib';

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

function apiUrl(path) {
  const [pathname, search] = path.split('?');
  const segments = pathname.split('/').map((segment) => encodeURIComponent(decodeURIComponent(segment)));
  return trusted(`${API}${segments.join('/')}${search === undefined ? '' : `?${search}`}`);
}

let failures = 0;
let checks = 0;
function check(label, cond, extra) {
  checks++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${!cond && extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
  if (!cond) failures++;
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(apiUrl(path), {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const db = new PrismaClient();
const stamp = Date.now();
const password = `Kx9!vQ2#mLp7-perm-${stamp}`;

async function register(label) {
  const email = `perm-${label}-${stamp}@example.org`;
  const res = await call('POST', '/auth/register', { body: { email, password, fullName: `Test ${label}` } });
  if (res.status !== 201) throw new Error(`Inscription ${label} : ${res.status} ${JSON.stringify(res.json)}`);
  return { email, token: res.json.accessToken, id: res.json.user.id };
}

/** Compte plateforme : rôle posé en base, double authentification activée, session avec TOTP. */
async function staff(user, role) {
  const setup = await call('POST', '/auth/2fa/setup', { token: user.token });
  await call('POST', '/auth/2fa/verify', { token: user.token, body: { code: otplib.authenticator.generate(setup.json.secret) } });
  await db.user.update({ where: { id: user.id }, data: { role } });
  const login = await call('POST', '/auth/login', {
    body: { email: user.email, password, totpCode: otplib.authenticator.generate(setup.json.secret) },
  });
  return { ...user, token: login.json.accessToken };
}

const owner = await register('owner');
const editor = await register('editor');
const viewer = await register('viewer');
const outsider = await register('outsider');
const support = await staff(await register('support'), 'SUPPORT');
const admin = await staff(await register('admin'), 'ADMIN');
const people = { owner, editor, viewer, outsider, support, admin };

/** Appelle la route avec chaque rôle et compare au code attendu ({ owner: 200, viewer: 403… }). */
async function matrix(label, method, path, expected, body) {
  for (const [role, status] of Object.entries(expected)) {
    const res = await call(method, typeof path === 'function' ? path(role) : path, {
      token: people[role].token,
      body: typeof body === 'function' ? body(role) : body,
    });
    check(`${label} — ${role} → ${status}`, res.status === status, { got: res.status, detail: res.json?.detail });
  }
}

// ─── Espace d'organisation : propriétaire, éditeur, lecteur ───
const org = await call('POST', '/workspaces', { token: owner.token, body: { name: `Espace droits ${stamp}` } });
const wid = org.json.id;
await db.subscription.create({
  data: {
    workspaceId: wid,
    planId: (await db.plan.findUniqueOrThrow({ where: { code: 'PRO' } })).id,
    status: 'ACTIVE',
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  },
});
for (const [user, role] of [[editor, 'EDITOR'], [viewer, 'VIEWER']]) {
  const link = await call('POST', `/workspaces/${wid}/invitations`, { token: owner.token, body: { role, asLink: true } });
  await call('POST', `/invitations/${link.json.token}/accept`, { token: user.token });
}

await matrix('voir l’espace', 'GET', `/workspaces/${wid}`, { owner: 200, editor: 200, viewer: 200, outsider: 404, support: 200 });
await matrix('renommer l’espace', 'PATCH', `/workspaces/${wid}`, { owner: 200, editor: 403, viewer: 403, outsider: 404, support: 404 }, { name: `Espace droits ${stamp}` });
await matrix('solde de crédits', 'GET', `/workspaces/${wid}/credits`, { owner: 200, editor: 200, viewer: 200, outsider: 404, support: 200 });
await matrix('grand livre', 'GET', `/workspaces/${wid}/ledger`, { owner: 200, editor: 403, viewer: 403, outsider: 404, support: 200 });
await matrix('membres', 'GET', `/workspaces/${wid}/members`, { owner: 200, editor: 200, viewer: 200, outsider: 404 });
await matrix('invitations', 'GET', `/workspaces/${wid}/invitations`, { owner: 200, editor: 403, viewer: 403, outsider: 404 });
await matrix('inviter', 'POST', `/workspaces/${wid}/invitations`, { editor: 403, viewer: 403, outsider: 404 }, { role: 'VIEWER', asLink: true });

// ─── Projets ───
await matrix('créer un projet', 'POST', `/workspaces/${wid}/projects`, { owner: 201, editor: 201, viewer: 403, outsider: 404, support: 404 }, (role) => ({ title: `Projet ${role}`, entityType: 'ASSOCIATION', existingName: `Projet ${role}` }));
const pid = (await call('POST', `/workspaces/${wid}/projects`, { token: owner.token, body: { title: 'Projet témoin', entityType: 'ASSOCIATION', existingName: 'Témoin' } })).json.id;
await matrix('voir un projet', 'GET', `/projects/${pid}`, { owner: 200, editor: 200, viewer: 200, outsider: 404, support: 200, admin: 200 });
await matrix('modifier un projet', 'PATCH', `/projects/${pid}`, { owner: 200, editor: 200, viewer: 403, outsider: 404, support: 404 }, { status: 'IN_PROGRESS' });
await matrix('historique', 'GET', `/projects/${pid}/activity`, { owner: 200, editor: 200, viewer: 200, outsider: 404 });
await matrix('corbeille', 'GET', `/workspaces/${wid}/projects?trash=true`, { owner: 200, editor: 403, viewer: 403, outsider: 404, support: 403, admin: 200 });
await matrix('commenter', 'POST', `/projects/${pid}/comments`, { owner: 201, editor: 201, viewer: 201, outsider: 404, support: 404 }, { targetType: 'PROJECT', targetId: pid, body: 'Avis de test' });

const staffAudit = await db.auditLog.count({ where: { actorId: support.id, action: 'staff.access' } });
check('accès du support inscrit au journal d’audit', staffAudit > 0, staffAudit);

// ─── Studio : édition, export, téléchargement des lecteurs (§3 « si autorisé ») ───
const doc = { version: 1, width: 1080, height: 1080, pages: [{ id: 'p1', background: { type: 'solid', color: '#ffffff' }, elements: [] }] };
await matrix('créer une création', 'POST', `/projects/${pid}/studio-designs`, { owner: 201, editor: 201, viewer: 403, outsider: 404 }, { name: 'Publication', format: 'post-square', doc });
const sdid = (await call('POST', `/projects/${pid}/studio-designs`, { token: owner.token, body: { name: 'Affiche', format: 'post-square', doc } })).json.id;
await matrix('détourage IA (non configuré : 501)', 'POST', `/projects/${pid}/studio-cutout`, { viewer: 403, outsider: 404, editor: 501 }, { image: 'data:image/png;base64,iVBORw0KGgo=' });
await matrix('enregistrer une création', 'PUT', `/studio-designs/${sdid}`, { owner: 200, editor: 200, viewer: 403, outsider: 404 }, { name: 'Affiche' });
await matrix('exporter (téléchargements non autorisés)', 'POST', `/studio-designs/${sdid}/export`, { editor: 202, viewer: 403, outsider: 404 }, { format: 'svg' });
const exportJob = (await call('POST', `/studio-designs/${sdid}/export`, { token: editor.token, body: { format: 'svg' } })).json.jobId;
for (let i = 0; i < 40; i++) {
  const job = await call('GET', `/jobs/${exportJob}`, { token: editor.token });
  if (['SUCCEEDED', 'FAILED'].includes(job.json.status)) break;
  await new Promise((resolve) => {
    setTimeout(resolve, 500);
  });
}
const asViewer = await call('GET', `/jobs/${exportJob}`, { token: viewer.token });
check('tâche vue par un lecteur : sans lien de téléchargement', asViewer.status === 200 && !asViewer.json.result?.downloadUrl && asViewer.json.result?.restricted === true, asViewer.json.result);
const asEditor = await call('GET', `/jobs/${exportJob}`, { token: editor.token });
check('tâche vue par l’éditeur : lien signé', asEditor.status === 200 && !!asEditor.json.result?.downloadUrl, asEditor.json.status);

await matrix('autoriser les téléchargements des lecteurs', 'PATCH', `/workspaces/${wid}`, { editor: 403, viewer: 403, owner: 200 }, { viewerDownloads: true });
await matrix('exporter (téléchargements autorisés)', 'POST', `/studio-designs/${sdid}/export`, { viewer: 202 }, { format: 'svg' });
const allowed = await call('GET', `/jobs/${exportJob}`, { token: viewer.token });
check('tâche vue par un lecteur autorisé : lien signé', !!allowed.json.result?.downloadUrl, allowed.json.result);
await matrix('lecteur autorisé : toujours pas d’édition', 'PUT', `/studio-designs/${sdid}`, { viewer: 403 }, { name: 'Affiche' });
await call('PATCH', `/workspaces/${wid}`, { token: owner.token, body: { viewerDownloads: false } });

// ─── Site web : lecture pour tous les membres, édition par l'éditeur, suppression par le propriétaire ───
await matrix('site : avant le logo', 'POST', `/projects/${pid}/website`, { editor: 400, viewer: 403, outsider: 404 });
await db.logo.create({
  data: {
    projectId: pid,
    type: 'ICON_TEXT',
    engine: 'SVG_COMPOSER',
    style: 'MODERN',
    versions: {
      create: {
        number: 1,
        svg: '<svg xmlns="http://www.w3.org/2000/svg"/>',
        spec: {
          type: 'ICON_TEXT', text: 'Témoin', tagline: '', fontId: 'montserrat', fontWeight: 700, letterSpacing: 0, uppercase: false,
          iconId: 'leaf', iconScale: 1, iconFrame: 'circle', layout: 'horizontal',
          colors: { primary: '#0f766e', secondary: '#f59e0b', text: '#0f172a', background: '#ffffff' },
        },
      },
    },
  },
});
await matrix('site : créer', 'POST', `/projects/${pid}/website`, { viewer: 403, outsider: 404, support: 404, editor: 201 });
await matrix('site : voir', 'GET', `/projects/${pid}/website`, { owner: 200, editor: 200, viewer: 200, outsider: 404, support: 200 });
const webid = (await call('GET', `/projects/${pid}/website`, { token: owner.token })).json.website.id;
await matrix('site : logo de l’aperçu', 'GET', `/websites/${webid}/brand`, { owner: 200, editor: 200, viewer: 200, outsider: 404 });
await matrix('site : modifier', 'PATCH', `/websites/${webid}`, { owner: 200, editor: 200, viewer: 403, outsider: 404, support: 404 }, { logoId: null });
await matrix('site : publier', 'POST', `/websites/${webid}/publish`, { viewer: 403, outsider: 404, support: 404, editor: 200 });
await matrix('site : messages reçus', 'GET', `/websites/${webid}/messages`, { owner: 200, editor: 200, viewer: 403, outsider: 404 });
await matrix('site : exporter (téléchargements non autorisés)', 'POST', `/websites/${webid}/export`, { viewer: 403, outsider: 404, editor: 200 });
await matrix('site : dépublier', 'POST', `/websites/${webid}/unpublish`, { viewer: 403, outsider: 404, editor: 200 });
await matrix('site : supprimer', 'DELETE', `/websites/${webid}`, { editor: 403, viewer: 403, outsider: 404, support: 404, owner: 204 });

// ─── Suppression et restauration d'un projet ───
const doomed = (await call('POST', `/workspaces/${wid}/projects`, { token: owner.token, body: { title: 'À supprimer', entityType: 'ASSOCIATION', existingName: 'Éphémère' } })).json.id;
await matrix('supprimer un projet', 'DELETE', `/projects/${doomed}`, { editor: 403, viewer: 403, outsider: 404, owner: 204 });
await matrix('restaurer un projet', 'POST', `/projects/${doomed}/restore`, { editor: 403, viewer: 403, owner: 201 });

// ─── Back-office : hiérarchie, modération, crédits avec validation ───
await matrix('back-office', 'GET', '/admin/stats', { owner: 403, support: 200, admin: 200 });
await matrix('suspendre un compte', 'PATCH', `/admin/users/${outsider.id}`, { owner: 403, support: 403 }, { suspended: true });
await db.user.update({ where: { id: outsider.id }, data: { role: 'SUPER_ADMIN' } });
await matrix('suspendre un super admin', 'PATCH', `/admin/users/${outsider.id}`, { admin: 403 }, { suspended: true });
await db.user.update({ where: { id: outsider.id }, data: { role: 'USER' } });
await matrix('journal d’audit complet', 'GET', '/admin/audit-logs', { support: 403, admin: 403 });
await matrix('modérer (signature inexistante)', 'PATCH', `/admin/signatures/${crypto.randomUUID()}/review`, { owner: 403, support: 404 }, { decision: 'APPROVE' });
await matrix('ajuster des crédits directement', 'POST', '/admin/credits/adjust', { support: 403 }, { workspaceId: wid, delta: 5, reason: 'Geste commercial' });
const request = await call('POST', '/admin/credits/requests', { token: support.token, body: { workspaceId: wid, delta: 5, reason: 'Geste commercial après incident' } });
check('le support propose un ajustement', request.status === 201 && request.json.status === 'PENDING', request.json);
await matrix('le support ne valide pas', 'PATCH', `/admin/credits/requests/${request.json.id}`, { support: 403 }, { approve: true });
const before = (await call('GET', `/workspaces/${wid}/credits`, { token: owner.token })).json.balance;
await matrix('un admin valide', 'PATCH', `/admin/credits/requests/${request.json.id}`, { admin: 200 }, { approve: true });
const after = (await call('GET', `/workspaces/${wid}/credits`, { token: owner.token })).json.balance;
check('ajustement appliqué après validation', after === before + 5, { before, after });
await matrix('une demande ne se valide qu’une fois', 'PATCH', `/admin/credits/requests/${request.json.id}`, { admin: 409 }, { approve: true });

// ─── Membres : départ volontaire, retrait, propriétaire unique ───
await matrix('retirer un autre membre', 'DELETE', `/workspaces/${wid}/members/${owner.id}`, { editor: 403, viewer: 403 });
await matrix('quitter l’espace', 'DELETE', `/workspaces/${wid}/members/${viewer.id}`, { viewer: 204 });
await matrix('ex-lecteur : plus d’accès', 'GET', `/projects/${pid}`, { viewer: 404 });
await matrix('dernier propriétaire', 'DELETE', `/workspaces/${wid}/members/${owner.id}`, { owner: 409 });

// ─── Suppression de l'espace ───
const personal = (await call('GET', '/workspaces', { token: owner.token })).json.find((w) => w.kind === 'PERSONAL');
await matrix('supprimer l’espace personnel', 'DELETE', `/workspaces/${personal.id}`, { owner: 400 }, { confirm: personal.name });
await matrix('supprimer l’espace (non-propriétaire)', 'DELETE', `/workspaces/${wid}`, { editor: 403, outsider: 404, support: 404 }, { confirm: org.json.name });
await matrix('supprimer l’espace (mauvais nom)', 'DELETE', `/workspaces/${wid}`, { owner: 400 }, { confirm: 'autre nom' });
await matrix('supprimer l’espace', 'DELETE', `/workspaces/${wid}`, { owner: 204 }, { confirm: org.json.name });
await matrix('espace supprimé : introuvable', 'GET', `/workspaces/${wid}`, { owner: 404, editor: 404, admin: 404 });
await matrix('projet d’un espace supprimé : introuvable', 'GET', `/projects/${pid}`, { owner: 404 });
const lists = (await call('GET', '/workspaces', { token: owner.token })).json;
check('espace supprimé absent de la liste', !lists.some((w) => w.id === wid), lists.map((w) => w.name));
const ledgerKept = await db.creditLedgerEntry.count({ where: { workspaceId: wid } });
check('grand livre conservé', ledgerKept > 0, ledgerKept);

await db.$disconnect();
console.log(failures ? `\n${failures} échec(s) sur ${checks} vérifications` : `\nMatrice des droits conforme (${checks} vérifications)`);
process.exit(failures ? 1 : 0);
