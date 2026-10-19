# logo-backend

API et workers NestJS de la plateforme de création d'identité de marque : **noms**, **logos** et **signatures** prêts à l'emploi pour associations, applications, entreprises et projets.

Le cahier des charges complet se trouve dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).

## Stack

NestJS 11 · Prisma 6 · PostgreSQL · Redis + BullMQ · Swagger · pino · argon2id · JWT + cookie de rafraîchissement · TOTP
Rendu : opentype.js (texte en tracés) · resvg · sharp · SVGO · pdfkit · archiver · stockage S3 (RustFS en développement)

Un seul code source, deux points d'entrée :

| Processus | Entrée | Rôle |
| --- | --- | --- |
| API | `src/main.ts` | REST sous `/api/v1`, Swagger à `/api/docs` |
| Worker | `src/worker.ts` | Consommateurs BullMQ : générations, e-mails, maintenance nocturne |

> Le cahier des charges (§11.2) prévoit un monorepo pnpm/Turborepo (`apps/api`, `apps/worker`, `packages/*`). Ce dépôt contient la partie backend ; il pourra être déplacé dans `apps/api` sans modification de code.

## Démarrage

```bash
cp .env.example .env               # puis ajuster les secrets
docker compose up -d               # PostgreSQL, Redis, stockage S3 (RustFS), Mailpit
npm install
npx prisma migrate dev             # crée le schéma
npm run prisma:seed                # offres, liste noire, modèles
npm run dev                        # API : http://localhost:3001/api/docs
npm run dev:worker                 # worker (autre terminal)
```

E-mails de développement : http://localhost:8025 (Mailpit). Console du stockage : http://localhost:9001 (identifiants `S3_ACCESS_KEY` / `S3_SECRET_KEY`). MinIO ne publiant plus d'images Docker communautaires, le développement utilise RustFS (Apache 2.0, compatible S3) ; en production, tout service compatible S3 convient.

Sous Windows, Hyper-V réserve souvent des plages de ports (`netsh interface ipv4 show excludedportrange protocol=tcp`). Si 6379 ou 5432 est refusé, définissez `REDIS_PORT` / `POSTGRES_PORT` dans `.env` (par ex. `REDIS_PORT=16379` et `REDIS_URL=redis://localhost:16379`).

Test de bout en bout, API et worker lancés : `npm run test:smoke` (inscription, rotation de session, brief, génération + SSE, disponibilité, vote, choix du nom, quota gratuit, droits, corbeille, essai public).

## Structure

```text
prisma/
  schema.prisma         modèle de données (§12)
  seed.ts               offres, liste noire, modèles
src/
  main.ts               API
  worker.ts             worker
  core.module.ts        socle partagé : config, logs, Prisma, Redis, BullMQ, services transverses
  app.module.ts         API : guards globaux, modules HTTP
  config/env.ts         validation de l'environnement (zod)
  common/               guards (JWT, rôles, espace), décorateurs, filtre problem+json, utilitaires
  shared/               coûts en crédits, files, couleurs, schémas zod (sorties IA, LogoSpec)
  render/               moteur A : bibliothèque (polices, icônes), composition SVG, variantes, exports, pHash, nettoyage
  modules/
    auth/               inscription, connexion, Google, refresh avec rotation, mot de passe oublié, 2FA
    users/              /me, suppression, export des données
    workspaces/         espaces, membres, invitations
    projects/           projets, brief, corbeille, duplication
    names/              génération de noms, favoris, votes, choix final (ou nom saisi), essai public
    logos/              génération, import, versions, variantes, exports ZIP, bibliothèque
    storage/            stockage objet S3, URL signées
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

## Permissions

Deux niveaux (§3), vérifiés côté API :

- **Rôle plateforme** (`USER < SUPPORT < ADMIN < SUPER_ADMIN`) : `@Roles('ADMIN')` + `RolesGuard`. Les rôles internes exigent une session ouverte avec un code TOTP.
- **Rôle dans l'espace** (`VIEWER < EDITOR < OWNER`) : `@WorkspaceAccess('EDITOR')` + `WorkspaceGuard`. L'espace est déduit de `:wid`, `:pid`, `:nid` ou `:jid`. Le support a un accès en lecture par défaut ; un non-membre reçoit 404.

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
| 3. Logos (moteur SVG, éditeur, exports) | Fait pour le moteur A (fournisseur IA factice). Moteur B, formats réseaux sociaux (LOGO-23) et commentaires (LOGO-15) à faire |
| 4. Signatures (slogans, e-mail, paraphe, cachet) | À faire |
| 5. Kit de marque, partage, commentaires | À faire |
| 6. Paiements (Orange Money, abonnements, factures) | À faire |
| 8a. Textile : gabarits, éditeur, maquettes, BAT | Partiel : supports, zones, tailles, préréglages, éléments, contrôle, BAT, ateliers, admin. Propositions IA et maquettes 2D à faire |
| 8b. Textile : numéros, effectifs, pack atelier | Partiel : import et contrôle d'effectif, ajustement des noms. Polices de numéros et exports par technique à faire |

## Module 5 — décoration textile (§16)

Le moteur de règles est dans [src/modules/apparel/apparel-rules.ts](src/modules/apparel/apparel-rules.ts) (fonctions pures, testées) : éléments dans leur zone, zones « plein » exclusives, règlements FIFA/UEFA/FIBA (hauteurs, traits, écart nom-numéro, publicités), technique (trait minimal, flex sans image ni dégradé, style compatible, broderie, sublimation sur tissu clair), contraste avec le tissu, 300 dpi, attestation de droits, effectif (doublons, numéros interdits, tailles), ajustement des noms longs (condensation à 80 % puis réduction jusqu'au minimum).

Repère : bas du col au milieu, X positif = gauche du porteur. Les zones par défaut (adulte M) et les mesures des tailles du seed sont **indicatives** et doivent être validées sur un vêtement réel ([apparel-defaults.ts](src/modules/apparel/apparel-defaults.ts)).

Non exposées pour l'instant, car elles dépendent du moteur de rendu SVG de la phase 3 : `POST /apparel-designs/:did/generate`, `/mockups`, `/production-export` et `/number-fonts`. Les types de tâche et les coûts en crédits sont déjà en place.

## Logos — moteur A (§5)

Une **LogoSpec** (JSON validé par zod, [src/shared/logo-spec.ts](src/shared/logo-spec.ts)) décrit chaque logo : type, disposition, texte, police, couleurs, icône, pastille ou emblème. L'IA la propose, l'éditeur la modifie (`POST /logos/:lid/versions`), le serveur la rend ([src/render/compose.ts](src/render/compose.ts)) :

- texte converti en tracés (opentype.js) : les fichiers s'affichent sans police installée ;
- uniquement des éléments de la bibliothèque interne : 16 polices Google Fonts (OFL) et 5 184 icônes Tabler (MIT), listées dans LICENCES.txt à chaque export ;
- contraste texte/fond corrigé à 4,5:1 ; pastilles et emblèmes évidés par masque, d'où des variantes noir et blanc strictement monochromes ;
- empreinte perceptuelle (pHash) : une proposition trop proche d'un logo exclusif d'un autre client est écartée.

Exports asynchrones (`POST /logos/:lid/export` → 202, puis `GET /jobs/:jid` donne un lien signé de 15 min). L'archive reste 7 jours. Offre gratuite : PNG 512 px filigrané uniquement ; offre payante : SVG, PDF vectoriel, PNG 512/1024/2048, JPG, variantes et pack d'icônes d'app (favicon.ico, Apple 180, Android 192/512, iOS 1024).

Points en attente d'une décision (§15.4) : fournisseur IA réel, prestataire SMS (CPT-03, routes renvoyant 501), agrégateur de paiement, prix en GNF (à 0 dans le seed), stockage S3.

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

## Docker

```bash
docker build -t logo-backend .
docker run --env-file .env -p 3001:3001 logo-backend              # API (applique les migrations)
docker run --env-file .env logo-backend node dist/worker.js       # worker
```
