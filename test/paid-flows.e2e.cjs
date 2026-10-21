// Parcours payants et modération (développement uniquement) : simule un achat par écriture
// directe en base via docker compose, crée un admin avec double authentification.
// Usage : npm run test:smoke:paid   (API, worker et docker compose lancés)
const { execFileSync } = require('node:child_process');
const { authenticator } = require(process.cwd() + '/node_modules/otplib');
const API = 'http://localhost:3001/api/v1';
let failures = 0;
const check = (label, ok, extra) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${extra !== undefined ? ' — ' + JSON.stringify(extra).slice(0, 220) : ''}`);
  if (!ok) failures++;
};
const call = async (method, path, { token, body, headers = {} } = {}) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};
const sql = (q) =>
  execFileSync('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'logo', '-d', 'logo', '-At', '-c', q]).toString().trim();
const wait = async (token, id) => {
  for (let i = 0; i < 100; i++) {
    const j = await call('GET', `/jobs/${id}`, { token });
    if (['SUCCEEDED', 'FAILED'].includes(j.json.status)) return j.json;
    await new Promise((r) => {
      setTimeout(r, 300);
    });
  }
  return {};
};
const idem = (p) => ({ 'idempotency-key': `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}` });

(async () => {
  const password = 'Kx9!vQ2#mLp7-sig-' + Date.now();
  const reg = await call('POST', '/auth/register', { body: { email: `sig-${Date.now()}@example.org`, password, fullName: 'Présidente AJV' } });
  const token = reg.json.accessToken;
  const wid = (await call('GET', '/me', { token })).json.workspaces[0].workspace.id;
  const pid = (await call('POST', `/workspaces/${wid}/projects`, { token, body: { entityType: 'ASSOCIATION', title: 'AJV' } })).json.id;
  await call('PUT', `/projects/${pid}/brief`, {
    token,
    body: { sector: 'Environnement', mission: 'Planter des arbres avec les jeunes', values: ['écologie', 'solidarité'], audience: 'les jeunes', languages: ['fr'], nameStyles: ['ACRONYM'], mustInclude: [], mustAvoid: [] },
  });
  await call('POST', `/projects/${pid}/chosen-name`, { token, body: { value: 'Jeunesse Verte', acronym: 'AJV' } });

  // Achat simulé : écriture PURCHASE + solde (la phase 6 le fera via le prestataire de paiement).
  sql(`begin; insert into "CreditLedgerEntry" (id, "workspaceId", delta, reason, note) values (gen_random_uuid(), '${wid}', 100, 'PURCHASE', 'achat simulé'); update "Workspace" set "creditBalance" = "creditBalance" + 100 where id = '${wid}'; commit;`);

  // ─── Slogans ───
  const sg = await call('POST', `/projects/${pid}/slogans/generate`, { token, body: { tone: 'COMMITTED' }, headers: idem('slo') });
  const sj = await wait(token, sg.json.jobId);
  const slogans = (await call('GET', `/projects/${pid}/slogans`, { token })).json;
  const byKind = (k) => slogans.filter((s) => s.kind === k);
  check(
    'lot de slogans (1 crédit) : 10 slogans + devises + mission (association)',
    sj.status === 'SUCCEEDED' && byKind('SLOGAN').length === 10 && byKind('DEVISE').length >= 1 && byKind('MISSION').length === 1,
    { status: sj.status, n: slogans.length, devise: byKind('DEVISE')[0]?.text, slogan: byKind('SLOGAN')[0]?.text },
  );
  const chosen = await call('PATCH', `/slogans/${byKind('SLOGAN')[0].id}`, { token, body: { isChosen: true } });
  await call('PATCH', `/slogans/${byKind('SLOGAN')[1].id}`, { token, body: { isChosen: true } });
  const after = (await call('GET', `/projects/${pid}/slogans?kind=SLOGAN`, { token })).json;
  check('un seul slogan retenu à la fois', chosen.status === 200 && after.filter((s) => s.isChosen).length === 1);

  // ─── Logo + slogan (SIG-05) ───
  const lg = await call('POST', `/projects/${pid}/logos/generate`, { token, body: { types: ['ICON_TEXT'], style: 'AFRICAN' }, headers: idem('logo') });
  await wait(token, lg.json.jobId);
  const logo = (await call('GET', `/projects/${pid}/logos`, { token })).json[0];
  const tagline = byKind('SLOGAN')[1].text;
  const withTag = await call('POST', `/slogans/${byKind('SLOGAN')[1].id}/logo-version`, { token, body: { logoId: logo.id } });
  check('logo avec signature : nouvelle version exportable (SIG-05)', withTag.status === 201 && withTag.json.spec?.tagline === tagline && withTag.json.label === 'Logo avec signature', withTag.json.detail ?? withTag.json.spec?.tagline);

  // ─── Cachets et paraphes ───
  const stampData = { shape: 'round', topText: 'Association Jeunesse Verte', bottomText: 'Conakry · Guinée', center: { kind: 'acronym', text: 'AJV' }, title: 'La Présidente', ink: 'blue', inkEffect: true };
  const stamp = await call('POST', `/projects/${pid}/signatures`, { token, body: { kind: 'STAMP', attest: true, data: stampData } });
  check('cachet créé, actif, attestation horodatée', stamp.status === 201 && stamp.json.status === 'ACTIVE' && !!stamp.json.attestedAt && !!stamp.json.notice, stamp.json.detail ?? stamp.json.status);
  const file = await call('GET', `/signatures/${stamp.json.id}/file?format=png`, { token });
  const png = file.json?.url ? await fetch(file.json.url) : null;
  check(
    'cachet : URL signée 15 min, PNG HD, rappel légal',
    file.status === 200 && png?.status === 200 && png.headers.get('content-type') === 'image/png' && file.json.notice.includes('signature électronique qualifiée'),
    file.json?.expiresInSeconds,
  );
  const official = await call('POST', `/projects/${pid}/signatures`, { token, body: { kind: 'STAMP', attest: true, data: { ...stampData, bottomText: 'République de Guinée' } } });
  check('cachet avec « République » → validation manuelle (critère §15.2)', official.status === 201 && official.json.status === 'PENDING_REVIEW' && official.json.review?.terms?.includes('République'), official.json.review);
  const blocked = await call('GET', `/signatures/${official.json.id}/file`, { token });
  check('fichier indisponible tant que non validé', blocked.status === 403, blocked.json.detail);

  const generated = (await call('POST', `/projects/${pid}/signatures/handwritten/proposals`, { token, body: { fullName: 'Aïssatou Camara' } })).json[1].spec;
  const hw = await call('POST', `/projects/${pid}/signatures`, { token, body: { kind: 'HANDWRITTEN', attest: true, data: { ink: 'violet', spec: generated } } });
  const drawn = await call('POST', `/projects/${pid}/signatures`, {
    token,
    body: { kind: 'HANDWRITTEN', attest: true, data: { ink: 'black', spec: { mode: 'drawn', strokes: [[[0, 0], [12, 30], [25, 5], [40, 28], [60, 2]]] } } },
  });
  const hwFile = await call('GET', `/signatures/${hw.json.id}/file?format=svg`, { token });
  const svg = hwFile.json?.url ? await (await fetch(hwFile.json.url)).text() : '';
  check('paraphes généré et dessiné, SVG privé via URL signée', hw.status === 201 && drawn.status === 201 && svg.startsWith('<svg') && svg.toUpperCase().includes('5B2C83'), [hw.status, drawn.status, svg.slice(0, 40)]);
  const direct = await fetch(`http://localhost:9000/logo-platform/private/signatures/${hw.json.id}/paraphe.svg`);
  check('stockage privé : accès direct refusé', direct.status === 403, direct.status);

  // ─── Signature e-mail payante et lot (SIG-16) ───
  const email = await call('POST', `/projects/${pid}/signatures`, { token, body: { kind: 'EMAIL', data: { fullName: 'Aïssatou Camara', phones: ['+224620000000'] } } });
  check('offre payante : pas de mention de la plateforme', email.status === 201 && !email.json.html.includes('Signature créée avec'));
  const batch = await call('POST', `/projects/${pid}/signatures/batch`, {
    token,
    body: {
      csv: 'nom,fonction,email,telephone\nAïssatou Camara,Présidente,a@exemple.org,+224620000000\nIbrahima Bah,Trésorier,b@exemple.org,+224620000001\nSans Tel,Membre,c@exemple.org,620',
      common: { organization: 'Jeunesse Verte' },
    },
  });
  check('signatures en lot : 2 créées, 1 ligne en erreur signalée', batch.status === 201 && batch.json.created?.length === 2 && batch.json.errors?.length === 1 && batch.json.errors[0].line === 4, batch.json.errors ?? batch.json);

  // Solde : 100 − 1 (slogans) − 2 (logos) − 2 cachets − 2 paraphes = 93
  const credits = await call('GET', `/workspaces/${wid}/credits`, { token });
  check('grand livre : 93 crédits restants', credits.json.balance === 93, credits.json.balance);

  // ─── Modération par un admin avec double authentification ───
  const adminEmail = `admin-${Date.now()}@example.org`;
  const adm = await call('POST', '/auth/register', { body: { email: adminEmail, password, fullName: 'Admin Test' } });
  sql(`update "User" set role = 'ADMIN' where email = '${adminEmail}'`);
  const noMfa = await call('GET', '/admin/moderation', { token: adm.json.accessToken });
  check('back-office refusé sans 2FA', noMfa.status === 403, noMfa.json.detail);
  const setup = await call('POST', '/auth/2fa/setup', { token: adm.json.accessToken });
  const verify = await call('POST', '/auth/2fa/verify', { token: adm.json.accessToken, body: { code: authenticator.generate(setup.json.secret) } });
  const adminToken = verify.json.accessToken;
  const queue = await call('GET', '/admin/moderation', { token: adminToken });
  const item = queue.json?.find?.((q) => q.id === official.json.id);
  check('file de modération : cachet signalé avec aperçu', queue.status === 200 && !!item?.previewUrl && item.flagged.includes('République'), item?.flagged ?? queue.json);
  const approve = await call('PATCH', `/admin/signatures/${official.json.id}/review`, { token: adminToken, body: { decision: 'APPROVE', note: 'Justificatif vérifié' } });
  const nowOk = await call('GET', `/signatures/${official.json.id}/file`, { token });
  const audited = sql(`select count(*) from "AuditLog" where action = 'signature.review.approve' and "entityId" = '${official.json.id}'`);
  check('cachet validé par l’admin → téléchargeable, décision tracée', approve.json?.status === 'ACTIVE' && nowOk.status === 200 && audited === '1', { approve: approve.status, file: nowOk.status, audited });

  console.log(failures ? `\n${failures} échec(s)` : '\nTout est vert');
  process.exit(failures ? 1 : 0);
})();
