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
check('offres publiques', plans.status === 200 && plans.json.length === 5, plans.json.length);

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

const del = await call('DELETE', `/projects/${pid}`, { token });
const gone = await call('GET', `/projects/${pid}`, { token });
const restored = await call('POST', `/projects/${pid}/restore`, { token });
check('corbeille puis restauration', del.status === 204 && gone.status === 404 && restored.status === 201, [del.status, gone.status, restored.status]);

const pub = await call('POST', '/public/names/try', { body: { entityType: 'APPLICATION', sector: 'Fintech', mission: 'Paiement mobile simple' } });
check('essai public sans compte', pub.status === 200 && pub.json.names.length > 0, pub.json.triesLeft);

const ready = await fetch(API + '/health/ready');
check('sonde ready', ready.status === 200);

console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert');
process.exit(failures ? 1 : 0);
