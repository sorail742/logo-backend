# logo-backend

API et workers NestJS de la plateforme de création d'identité de marque : **noms**, **logos** et **signatures** prêts à l'emploi pour associations, applications, entreprises et projets.

Le cahier des charges complet se trouve dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).

## Stack

NestJS 11 · Prisma 6 · PostgreSQL · Redis + BullMQ · Swagger · pino · argon2id · JWT + cookie de rafraîchissement · TOTP

Rendu : opentype.js (texte en tracés) · SVGO · resvg (PNG) · pdfkit + svg-to-pdfkit (PDF vectoriel) · jpeg-js · stockage S3 (MinIO) ou disque local

Un seul code source, deux points d'entrée :

| Processus | Entrée | Rôle |
| --- | --- | --- |
| API | `src/main.ts` | REST sous `/api/v1`, Swagger à `/api/docs` |
| Worker | `src/worker.ts` | Consommateurs BullMQ : générations, e-mails, maintenance nocturne |

> Le cahier des charges (§11.2) prévoit un monorepo pnpm/Turborepo (`apps/api`, `apps/worker`, `packages/*`). Ce dépôt contient la partie backend ; il pourra être déplacé dans `apps/api` sans modification de code.

## Démarrage

```bash
cp .env.example .env               # puis ajuster les secrets
docker compose up -d               # PostgreSQL, Redis, MinIO, Mailpit
npm install
npx prisma migrate dev             # crée le schéma
npm run prisma:seed                # offres, liste noire, modèles
npm run dev                        # API : http://localhost:3001/api/docs
npm run dev:worker                 # worker (autre terminal)
```

E-mails de développement : http://localhost:8025 (Mailpit).

Sous Windows, Hyper-V réserve souvent des plages de ports (`netsh interface ipv4 show excludedportrange protocol=tcp`). Si 6379 ou 5432 est refusé, définissez `REDIS_PORT` / `POSTGRES_PORT` dans `.env` (par ex. `REDIS_PORT=16379` et `REDIS_URL=redis://localhost:16379`).

Test de bout en bout, API et worker lancés : `npm run test:smoke` (inscription, rotation de session, brief, génération + SSE, disponibilité, vote, choix du nom, quota gratuit, droits, logos : génération, édition, variantes, export, import nettoyé ; historique, espaces et invitations, 2FA et codes de secours, textile, corbeille, essai public). Il lit la base (`DATABASE_URL`) pour poser un abonnement, les paiements n'existant pas encore.

Fichiers générés : par défaut sur disque (`STORAGE_DIR`, servis par URL signée `/api/v1/files`) ; `STORAGE_DRIVER=s3` utilise le MinIO de docker-compose ou tout stockage S3 (URL présignées).

## Structure

```text
assets/fonts/           polices OFL de la bibliothèque (WOFF latin + latin étendu) et manifeste
scripts/fetch-fonts.mjs récupère ces polices depuis les paquets @fontsource
prisma/
  schema.prisma         modèle de données (§12)
  seed.ts               offres, liste noire, modèles
src/
  main.ts               API
  worker.ts             worker
  core.module.ts        socle partagé : config, logs, Prisma, Redis, BullMQ, services transverses
  app.module.ts         API : guards globaux, modules HTTP
  config/env.ts         validation de l'environnement (zod)
  common/               guards (JWT, rôles, espace), décorateurs, filtre problem+json, stockage, utilitaires
  shared/               coûts en crédits, files, schémas zod des sorties IA
  render/               moteur SVG (futur packages/render) : polices et texte en tracés, icônes,
                        composition des logos, variantes, SVGO, PNG, JPG, PDF, ICO, ZIP, pHash
  modules/
    auth/               inscription, connexion, Google, refresh avec rotation, mot de passe oublié, 2FA
    users/              /me, suppression, export des données
    workspaces/         espaces, membres, invitations
    projects/           projets, brief, corbeille, duplication
    names/              génération de noms, favoris, votes, choix final, essai public
    logos/              moteur A, import nettoyé, versions, variantes, exports (worker)
    library/            bibliothèque : icônes, polices, modèles
    availability/       domaines (RDAP), réseaux, marques, comparaison phonétique
    jobs/               file de génération, idempotence, SSE
    credits/            grand livre de crédits
    ai/                 interface AiProvider + fournisseur factice
    moderation/         liste noire, marques célèbres
    billing/            offres, solde, historique
    notifications/      notifications in-app
    apparel/            module textile : supports, tenues, contrôle de conformité, effectifs, BAT, ateliers
    admin/              back-office : stats, utilisateurs, crédits, liste noire, audit
    audit/              journal d'audit
    mail/               e-mails transactionnels (via file)
    health/             sondes live/ready
  worker/               processeurs BullMQ
```

## Contrat avec le front

Les réponses suivent les types du front ([logo-frontend](https://github.com/sorail742/logo-frontend), `src/lib/types.ts`), appelés à devenir `packages/shared` (§11.2). Les présentateurs (`*.presenter.ts`) les produisent à partir des modèles Prisma :

- **Session** : `register`, `login`, `refresh`, `google` et `2fa/verify` renvoient `{ accessToken, user }` ; l'activation de la 2FA renvoie aussi 10 codes de secours à usage unique (§14.1), acceptés à la place du code TOTP.
- **Erreurs** : `code` explicite quand le front doit réagir (`MFA_REQUIRED`, `MFA_INVALID`, `INSUFFICIENT_CREDITS`).
- **Espaces** : rôle de l'utilisateur et offre en vigueur (`planCode`) ; membres et invitations en attente ; invitation par lien (`asLink`).
- **Projets** : brief, nom retenu, avancement du parcours (`progress`), aperçu du logo favori (`previewSpec`), historique d'activité (`GET /projects/:pid/activity`, COL-04, tiré du journal d'audit) ; parcours « J'ai déjà un nom » (`existingName`).
- **Noms** : total des votes et vote de l'utilisateur (`votes`, `myVote`), vérifications avec lien de contrôle manuel.
- **Listes paginées** (`items`, `nextCursor`) : projets, grand livre, notifications, utilisateurs et journal du back-office.

Les liens des e-mails pointent vers les pages du front (`/verifier-email`, `/reinitialiser-mot-de-passe`, `/invitation/:token`). Si le front et l'API sont servis sur deux domaines distincts, `REFRESH_COOKIE_SAMESITE=none` rend le cookie de rafraîchissement utilisable (il est alors sécurisé).

## Permissions

Deux niveaux (§3), vérifiés côté API :

- **Rôle plateforme** (`USER < SUPPORT < ADMIN < SUPER_ADMIN`) : `@Roles('ADMIN')` + `RolesGuard`. Les rôles internes exigent une session ouverte avec un code TOTP.
- **Rôle dans l'espace** (`VIEWER < EDITOR < OWNER`) : `@WorkspaceAccess('EDITOR')` + `WorkspaceGuard`. L'espace est déduit de `:wid`, `:pid`, `:nid`, `:lid`, `:did` ou `:jid`. Le support a un accès en lecture par défaut ; un non-membre reçoit 404.

## Cycle d'une génération (§11.4)

1. `POST /api/v1/projects/:pid/names/generate` avec l'en-tête `Idempotency-Key`.
2. Une transaction crée la tâche `QUEUED` et débite les crédits (ou consomme le quota gratuit du jour).
3. Réponse `202 { jobId }` ; suivi par `GET /api/v1/jobs/:jid/events` (SSE).
4. Le worker appelle l'IA, valide la sortie (zod), filtre les termes interdits, enregistre.
5. Après 3 échecs, la tâche passe en `FAILED` et les crédits sont remboursés automatiquement.

## Avancement par rapport au planning (§15, §16.13)

| Phase | Statut |
| --- | --- |
| 1. Socle technique : auth, espaces, projets, back-office minimal | Fait |
| 2. Générateur de noms : brief, génération, vérifications, favoris, choix | Fait (fournisseur IA factice) |
| 3. Logos (moteur SVG, éditeur, exports) | Fait pour le moteur A (fournisseur IA factice) ; moteur B (image + vectorisation) à faire |
| 4. Signatures (slogans, e-mail, paraphe, cachet) | À faire |
| 5. Kit de marque, partage, commentaires | À faire |
| 6. Paiements (Orange Money, abonnements, factures) | À faire |
| 8a. Textile : gabarits, éditeur, maquettes, BAT | Partiel : supports, zones, tailles, préréglages, éléments, contrôle, BAT, ateliers, admin. Propositions IA et maquettes 2D à faire |
| 8b. Textile : numéros, effectifs, pack atelier | Partiel : import et contrôle d'effectif, ajustement des noms. Polices de numéros et exports par technique à faire |

## Module 2 — logos (§5)

Le front et le serveur partagent la même spécification déclarative (`LogoSpec` : texte, police, graisse, espacement, icône, cadre, disposition, couleurs). Le front l'édite et l'affiche en aperçu ; le serveur la valide (zod, polices et icônes de la bibliothèque uniquement) et produit les fichiers définitifs avec le moteur de [src/render](src/render) :

- **Génération** (`POST /projects/:pid/logos/generate`, tâche `LOGOS`, 2 crédits ou quota gratuit) : l'IA choisit icône, police, palette et disposition (`AiProvider.composeLogos`) ; le serveur compose 8 propositions avec le nom retenu et le slogan choisi, écarte les doublons et les logos proches (pHash) d'un logo exclusif d'un autre client. Relances avec retour (« plus simple », « autre icône », « mêmes couleurs ») et logo de référence.
- **Texte en tracés** : les polices OFL sont lues avec opentype.js (crénage, repli par caractère sur le latin étendu : Ɓ, Ŋ, Ɛ…). Aucun SVG, PNG ou PDF exporté n'a besoin de la police installée.
- **Éditeur** : `POST /logos/:lid/versions` enregistre une spec ; le SVG est recomposé côté serveur, contraste texte/fond corrigé à 4,5:1, marques célèbres refusées.
- **Variantes** (`POST /logos/:lid/variants`) : couleur, noir, blanc, icône seule, horizontale, verticale.
- **Export** (`POST /logos/:lid/export`, tâche `LOGO_EXPORT`, 0 crédit) : archive ZIP avec SVG optimisés, PDF vectoriels, PNG transparents 512/1024/2048, JPG, pack d'icônes d'app (favicon.ico 16/32/48, 180, 192, 512, 1024), formats réseaux sociaux et LICENCES.txt. Offre gratuite : PNG 512 px filigrané uniquement (`restricted: true`). Le lien signé est donné par `GET /jobs/:jid` (`result.downloadUrl`) ; les exports sont purgés après 7 jours.
- **Import** (`POST /projects/:pid/logos/import`) : SVG nettoyé par liste blanche (ni script, ni événement, ni lien ou ressource externe, ni DTD) ou PNG encapsulé ; palette extraite. Le SVG d'origine reste la version 1 ; les versions suivantes sont recomposées depuis la spec.

Moteur B (image IA + vectorisation, « Devrait ») : la route répond 501 tant que le fournisseur d'images n'est pas choisi (§15.4). L'exclusivité d'un logo (`isExclusive`) sera posée à l'achat (phase 6).

## Module 5 — décoration textile (§16)

Le moteur de règles est dans [src/modules/apparel/apparel-rules.ts](src/modules/apparel/apparel-rules.ts) (fonctions pures, testées) : éléments dans leur zone, zones « plein » exclusives, règlements FIFA/UEFA/FIBA (hauteurs, traits, écart nom-numéro, publicités), technique (trait minimal, flex sans image ni dégradé, style compatible, broderie, sublimation sur tissu clair), contraste avec le tissu, 300 dpi, attestation de droits, effectif (doublons, numéros interdits, tailles), ajustement des noms longs (condensation à 80 % puis réduction jusqu'au minimum).

Repère : bas du col au milieu, X positif = gauche du porteur. Les zones par défaut (adulte M) et les mesures des tailles du seed sont **indicatives** et doivent être validées sur un vêtement réel ([apparel-defaults.ts](src/modules/apparel/apparel-defaults.ts)).

Non exposées pour l'instant : `POST /apparel-designs/:did/generate`, `/mockups`, `/production-export` et `/number-fonts`. Le moteur de rendu de la phase 3 (`src/render`) est désormais disponible pour les construire ; les types de tâche et les coûts en crédits sont déjà en place.

Points en attente d'une décision (§15.4) : fournisseur IA réel (texte et images), prestataire SMS (CPT-03, routes renvoyant 501), agrégateur de paiement, prix en GNF (à 0 dans le seed), hébergeur du stockage S3.

## Scripts

| Commande | Effet |
| --- | --- |
| `npm run dev` / `npm run dev:worker` | API / worker en mode watch |
| `npm run build` | Compilation dans `dist/` |
| `npm test` / `npm run test:cov` | Tests unitaires / couverture |
| `npm run test:smoke` | Parcours complet contre une API locale |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run prisma:migrate` | Nouvelle migration |
| `npm run prisma:deploy` | Migrations en production |
| `npm run fonts:fetch` | Régénère `assets/fonts` (polices de la bibliothèque) |

## Docker

```bash
docker build -t logo-backend .
docker run --env-file .env -p 3001:3001 logo-backend              # API (applique les migrations)
docker run --env-file .env logo-backend node dist/worker.js       # worker
```
