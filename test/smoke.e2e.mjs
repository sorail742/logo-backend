// Test de fumée de bout en bout (phases 1 et 2) contre une API et un worker lancés localement.
// Usage : npm run test:smoke   (API=http://hote/api/v1 pour une autre cible)
const API = process.env.API ?? 'http://localhost:3001/api/v1';
let failures = 0;

function check(label, cond, extra) {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${extra !== undefined ? ' — ' + JSON.stringify(extra) : ''}`);
  if (!cond) failures++;
}

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(API + path, {
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

const email = `e2e-${Date.now()}@example.org`;
const password = 'Kx9!vQ2#mLp7-unique-' + Date.now();

const reg = await call('POST', '/auth/register', { body: { email, password, fullName: 'Testeur E2E' } });
check('inscription', reg.status === 201, reg.status);
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

const plans = await call('GET', '/plans');
check('offres publiques (dont Pack Équipe et Atelier)', plans.status === 200 && plans.json.length === 7, plans.json.length);

const proj = await call('POST', `/workspaces/${wid}/projects`, { token, body: { entityType: 'ASSOCIATION', title: 'Asso test' } });
check('création de projet', proj.status === 201, proj.status);
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
check('brief enregistré', brief.status === 200, brief.status);

const noKey = await call('POST', `/projects/${pid}/names/generate`, { token, body: {} });
check('Idempotency-Key obligatoire', noKey.status === 400);

const key = 'e2e-key-' + Date.now();
const gen = await call('POST', `/projects/${pid}/names/generate`, { token, body: {}, headers: { 'idempotency-key': key } });
check('génération acceptée (202 + jobId)', gen.status === 202 && !!gen.json.jobId, gen.json);
const again = await call('POST', `/projects/${pid}/names/generate`, { token, body: {}, headers: { 'idempotency-key': key } });
check('même clé → même tâche', again.json.jobId === gen.json.jobId, again.status);

// Suivi SSE jusqu'à l'état final
const sse = await fetch(`${API}/jobs/${gen.json.jobId}/events`, { headers: { authorization: `Bearer ${token}` } });
const reader = sse.body.getReader();
const dec = new TextDecoder();
let buf = '';
let finalStatus;
const deadline = Date.now() + 20000;
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
check('SSE : tâche terminée', finalStatus === 'SUCCEEDED', finalStatus);

const names = await call('GET', `/projects/${pid}/names`, { token });
check('noms enregistrés', names.status === 200 && names.json.length > 0, names.json.map?.((n) => `${n.value} (${n.score})`));
const nid = names.json[0]?.id;

const checks = await call('POST', `/names/${nid}/checks`, { token, body: {} });
check('vérifications de disponibilité', checks.status === 200 && checks.json.checks.length >= 10, checks.json.checks?.map((c) => `${c.target}:${c.status}`));
const cached = await call('POST', `/names/${nid}/checks`, { token, body: {} });
check('cache 24 h', cached.json.fromCache === true);

const vote = await call('POST', `/names/${nid}/votes`, { token, body: { value: 1 } });
check('vote', vote.status === 200 && vote.json.total === 1, vote.json);

const fav = await call('PATCH', `/names/${nid}`, { token, body: { isFavorite: true } });
check('favori', fav.status === 200 && fav.json.isFavorite === true);

const chosen = await call('POST', `/projects/${pid}/chosen-name`, { token, body: { nameId: nid } });
check('nom final retenu', chosen.status === 200 && chosen.json.chosenNameId === nid, chosen.json.chosenName?.value);

// Quota gratuit : 3 lots de noms par jour (le 1er est déjà consommé)
for (let i = 0; i < 2; i++) {
  await call('POST', `/projects/${pid}/names/generate`, { token, body: { feedback: 'plus court' }, headers: { 'idempotency-key': `q-${i}-${Date.now()}` } });
}
const over = await call('POST', `/projects/${pid}/names/generate`, { token, body: {}, headers: { 'idempotency-key': 'over-' + Date.now() } });
check('quota gratuit dépassé → 402', over.status === 402, over.json.detail);

// Un autre utilisateur ne voit pas le projet
const other = await call('POST', '/auth/register', { body: { email: 'o' + email, password, fullName: 'Autre' } });
const foreign = await call('GET', `/projects/${pid}`, { token: other.json.accessToken });
check('non-membre → 404', foreign.status === 404, foreign.status);

const admin = await call('GET', '/admin/stats', { token });
check('back-office interdit à un USER', admin.status === 403, admin.json.detail);

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

const del = await call('DELETE', `/projects/${pid}`, { token });
const gone = await call('GET', `/projects/${pid}`, { token });
const restored = await call('POST', `/projects/${pid}/restore`, { token });
check('corbeille puis restauration', del.status === 204 && gone.status === 404 && restored.status === 201, [del.status, gone.status, restored.status]);

const pub = await call('POST', '/public/names/try', { body: { entityType: 'APPLICATION', sector: 'Fintech', mission: 'Paiement mobile simple' } });
// 3 essais par IP et par jour : au-delà, 429 est le comportement attendu.
check('essai public sans compte (ou limite du jour atteinte)', (pub.status === 200 && pub.json.names.length > 0) || pub.status === 429, pub.status);

const ready = await fetch(API + '/health/ready');
check('sonde ready', ready.status === 200);

console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert');
process.exit(failures ? 1 : 0);
