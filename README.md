# logo-backend

API et workers NestJS de la plateforme de création d'identité de marque : **noms**, **logos** et **signatures** prêts à l'emploi pour associations, applications, entreprises et projets.

Le cahier des charges complet se trouve dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).

## Stack

NestJS 11 · Prisma 6 · PostgreSQL · Redis + BullMQ · Swagger · pino · argon2id · JWT + cookie de rafraîchissement · TOTP

Rendu : opentype.js (texte en tracés) · SVGO · resvg (PNG) · pdfkit + svg-to-pdfkit (PDF vectoriel) · jpeg-js · stockage S3 (RustFS en développement) ou disque local

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

E-mails de développement : http://localhost:8025 (Mailpit).

Sous Windows, Hyper-V réserve souvent des plages de ports (`netsh interface ipv4 show excludedportrange protocol=tcp`). Si 6379 ou 5432 est refusé, définissez `REDIS_PORT` / `POSTGRES_PORT` dans `.env` (par ex. `REDIS_PORT=16379` et `REDIS_URL=redis://localhost:16379`).

Test de bout en bout, API et worker lancés : `npm run test:smoke` (inscription, rotation de session, brief, génération + SSE, disponibilité, vote, choix du nom, quota gratuit, droits, logos : génération, édition, variantes, export, import nettoyé ; historique, espaces et invitations, 2FA et codes de secours, textile, Studio : créations, exports, avis épinglés, images générées, banque de photos ; corbeille, essai public). Il lit la base (`DATABASE_URL`) pour poser un abonnement, les paiements n'existant pas encore. Il ne contacte que les hôtes de test listés dans `TRUSTED_HOSTS` (localhost par défaut) : pour viser une autre API (`API=http://hote/api/v1`), ajoutez son hôte à cette liste.

Banque de photos du Studio : facultative, activée par une clé gratuite [Pexels](https://www.pexels.com/api/) dans `PEXELS_API_KEY`.

Fichiers générés : par défaut sur disque (`STORAGE_DIR`, servis par URL signée `/api/v1/files`) ; `STORAGE_DRIVER=s3` utilise le stockage S3 de docker-compose (RustFS, console sur http://localhost:9001) ou tout stockage S3 (URL présignées).

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
                        composition des logos, variantes, SVGO, PNG, JPG, PDF, ICO, ZIP, pHash,
                        charte graphique PDF, supports imprimables, papier à en-tête Word
  modules/
    auth/               inscription, connexion, Google, refresh avec rotation, mot de passe oublié, 2FA
    users/              /me, suppression, export des données
    workspaces/         espaces, membres, invitations
    projects/           projets, brief, corbeille, duplication
    names/              génération de noms, favoris, votes, choix final, essai public
    logos/              moteur A, import nettoyé, versions, variantes, exports (worker)
    slogans/            slogans, devises, phrases de mission
    signatures/         signature e-mail, paraphe, cachet, lots CSV
    brand-kits/         kit de marque : versions, charte PDF et archive (worker), partage public
    comments/           commentaires et mentions @
    studio/             Studio de création : documents (pages et éléments), sauvegarde, exports (worker)
    library/            bibliothèque : icônes, polices, modèles, banque de photos (Pexels), capacités
    availability/       domaines (RDAP), réseaux, marques, comparaison phonétique
    jobs/               file de génération, idempotence, SSE
    credits/            grand livre de crédits
    ai/                 interface AiProvider + fournisseur factice
    moderation/         liste noire, marques célèbres
    billing/            offres, solde, historique
    notifications/      notifications dans l'application et par e-mail
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
- **Erreurs** : `code` explicite quand le front doit réagir (`MFA_REQUIRED`, `MFA_INVALID`, `INSUFFICIENT_CREDITS`, `PLAN_REQUIRED`, `LOGO_REQUIRED`).
- **Espaces** : rôle de l'utilisateur et offre en vigueur (`planCode`) ; membres et invitations en attente ; invitation par lien (`asLink`).
- **Projets** : brief, nom retenu, avancement du parcours (`progress`), aperçu du logo favori (`previewSpec`), historique d'activité (`GET /projects/:pid/activity`, COL-04, tiré du journal d'audit) ; parcours « J'ai déjà un nom » (`existingName`).
- **Noms** : total des votes et vote de l'utilisateur (`votes`, `myVote`), vérifications avec lien de contrôle manuel.
- **Kits** : contenu figé de la version (`name`, `acronym`, `meaning`, `slogan`, `devise`, `mission`), `logoSpec` et, pour un logo importé, `logoSvg` ; liens signés `guidePdfUrl` et `zipUrl` (Éditeur et Propriétaire), `guideCost` (3 ou 0), `restoredFrom`. Page publique : `PublicKit`, mot de passe dans l'en-tête `X-Kit-Password` (`PASSWORD_REQUIRED`, `PASSWORD_INVALID`).
- **Commentaires** : `authorName` et membres mentionnés (`mentions`).
- **Listes paginées** (`items`, `nextCursor`) : projets, grand livre, notifications, utilisateurs et journal du back-office.

Les liens des e-mails pointent vers les pages du front (`/verifier-email`, `/reinitialiser-mot-de-passe`, `/invitation/:token`). Si le front et l'API sont servis sur deux domaines distincts, `REFRESH_COOKIE_SAMESITE=none` rend le cookie de rafraîchissement utilisable (il est alors sécurisé).

## Permissions

Deux niveaux (§3), vérifiés côté API :

- **Rôle plateforme** (`USER < SUPPORT < ADMIN < SUPER_ADMIN`) : `@Roles('ADMIN')` + `RolesGuard`. Les rôles internes exigent une session ouverte avec un code TOTP.
- **Rôle dans l'espace** (`VIEWER < EDITOR < OWNER`) : `@WorkspaceAccess('EDITOR')` + `WorkspaceGuard`. L'espace est déduit de `:wid`, `:pid`, `:nid`, `:lid`, `:did`, `:kid`, `:cid`, `:sdid`, `:sid` ou `:jid`. Le support a un accès en lecture par défaut, inscrit au journal d'audit ; un non-membre reçoit 404 ; un espace supprimé n'existe plus. `{ download: true }` laisse passer un lecteur quand l'espace autorise ses téléchargements.

Matrice complète, route par route : [docs/permissions.md](docs/permissions.md). Vérification de bout en bout (propriétaire, éditeur, lecteur, non-membre, support, admin) : `npm run test:permissions`.

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
| 4. Signatures (slogans, e-mail, paraphe, cachet) | Fait (fournisseur IA factice) ; contrôle IA des slogans connus à faire |
| 5. Kit de marque, partage, commentaires | Fait : versions, charte PDF, archive, supports imprimables, partage, commentaires et mentions, notifications par e-mail |
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

Moteur B (image IA + vectorisation, « Devrait ») : la route répond 501 tant que le fournisseur d'images n'est pas choisi (§15.4). L'exclusivité d'un logo (`isExclusive`) est posée quand il entre dans un kit sur une offre payante.

## Module 3 — signatures (§6)

- **Slogans** (`POST /projects/:pid/slogans/generate`, tâche `SLOGANS`, 1 crédit) : 10 slogans selon le ton, la langue et le nombre de mots (8 par défaut) ; pour une association, devise en trois termes et phrase de mission. Le worker écarte les termes interdits (périmètre `SLOGAN`), les propositions déjà faites et celles trop proches d'un slogan connu (liste de référence interne, [known-slogans.ts](src/modules/slogans/known-slogans.ts)). `PATCH /slogans/:sid` : favori, retouche du texte, choix (un seul retenu par type).
- **Signature e-mail** (`POST /projects/:pid/signatures`, `kind: EMAIL`, 0 crédit) : 6 modèles (`classic`, `sidebar`, `compact`, `centered`, `banner`, `minimal`), HTML en tableaux et styles en ligne, version texte brut (`GET /signatures/:sid/html`). Nom retenu, slogan choisi, couleurs du logo favori ; le logo est servi en PNG par une URL publique stable (`/public/signatures/:sid/logo.png`). Mention de la plateforme sur l'offre gratuite. `POST /public/email-signature` : rendu sans compte.
- **Signatures en lot** (`POST /projects/:pid/signatures/batch`, offres Pro et Agence, tâche `SIGNATURE`) : CSV (nom, fonction, e-mail, téléphone) appliqué à la signature e-mail du projet ; archive ZIP d'un HTML et d'un texte par membre (`result.downloadUrl`).
- **Paraphe et cachet** (`kind: HANDWRITTEN | STAMP`, 1 crédit, attestation obligatoire) : rendu serveur en tracés ([src/render/stamp.ts](src/render/stamp.ts)), texte circulaire compris, encre et effet d'encre, logo du projet au centre. SVG et PNG transparent 2048 px stockés en privé, servis par URL signée de 5 minutes (`GET /signatures/:sid/file`).
- **Modération** (§6.4) : un cachet portant un terme officiel (« République », « Ministère »…) ou un terme de la liste noire `STAMP` passe en `PENDING_REVIEW` ; son fichier n'est pas servi. `GET /admin/moderation` liste les cachets en attente avec leur aperçu ; `PATCH /admin/signatures/:sid/review` (`APPROVE` ou `REJECT` avec motif, administrateur) trace la décision et notifie les propriétaires de l'espace. Un cachet refusé puis corrigé repasse par le contrôle.

## Module 4 — kit de marque et collaboration (§7)

- **Versions** (KIT-01, KIT-06) : `POST /projects/:pid/brand-kits` fige l'état du projet (nom retenu, sigle et origine, logo favori, palette HEX/RGB/CMJN, polices avec licence, slogan, devise et mission choisis). `POST /brand-kits/:kid/restore` recopie une ancienne version sous un nouveau numéro. Changer de nom final crée une nouvelle version (NOM-33).
- **Charte graphique PDF** (KIT-02, `POST /brand-kits/:kid/guide`, tâche `BRAND_GUIDE`, `Idempotency-Key` obligatoire) : 3 crédits la première fois pour une version, puis régénérable sans coût (une version restaurée hérite de la charte payée). Réservée aux offres qui l'incluent (`PLAN_REQUIRED` sinon). Neuf pages vectorielles ([src/render/brand-guide.ts](src/render/brand-guide.ts)) : couverture, origine du nom, logo et variantes, zone de protection et taille minimale, usages interdits, couleurs et contraste, typographies (spécimens en tracés), signatures (slogan, devise, cachet, paraphe, texte de la signature e-mail), exemples d'application.
- **Archive ZIP** (KIT-03, `POST /brand-kits/:kid/zip`, tâche `EXPORT_ZIP`, 0 crédit) : `logo/svg`, `logo/png`, `logo/pdf`, `logo/jpg`, `icones-app`, `reseaux-sociaux`, `signatures` (HTML et texte de la signature e-mail, slogans, cachet et paraphe validés), `supports`, `charte.pdf` (si payée), `LICENCES.txt`, `LISEZMOI.txt`. Offre gratuite : PNG 512 px filigranés, sans vectoriel, charte ni supports (§7.4).
- **Supports imprimables** (KIT-04, dans l'archive) : carte de visite recto verso et carte de membre d'association avec fond perdu de 3 mm (TrimBox renseignée), papier à en-tête A4 en PDF et en Word (OOXML écrit sans dépendance, logo en en-tête). Les coordonnées viennent de la signature e-mail du projet.
- **Fichiers** : stockés en privé, servis par URL signée de 15 minutes (`guidePdfUrl`, `zipUrl`, `result.downloadUrl`), purgés après 7 jours puis régénérables.
- **Partage** (KIT-05, `POST /brand-kits/:kid/share`) : lien en lecture seule, mot de passe (argon2id) et date d'expiration facultatifs, révocable. `GET /public/kits/:token` (20 requêtes par minute) renvoie le kit et ses liens de téléchargement.
- **Commentaires** (COL-02, `GET|POST /projects/:pid/comments`, `DELETE /comments/:cid`) : sur le projet, un nom, un logo, une signature, un slogan, le kit ou une création du Studio ; tout membre, lecteur compris. Mentions `@Prénom`, `@PrénomNom` ou `@partie-locale-de-l-e-mail`, sans casse ni accents. Fils à un niveau (`parentId`) ; `PATCH /comments/:cid` `{ resolved }` résout ou rouvre un fil (son auteur, un Éditeur ou le Propriétaire), une réponse le rouvre.
- **Notifications** (COL-03) : dans l'application et par e-mail pour une mention, une charte ou une archive prête, des crédits bas (seuil de 5, une fois au franchissement) ; dans l'application pour une réponse dans une discussion, une invitation reçue par un utilisateur inscrit, un export de logo ou un lot de signatures prêt.

## Studio de création

Éditeur de supports à la marque (publications, stories, flyers, affiches, cartes de visite,
présentations). Le front compose et édite le document ; l'API le valide, le conserve et en
produit les fichiers définitifs.

- **Document** ([src/render/design-doc.ts](src/render/design-doc.ts)) : pages d'éléments en px
  (texte, forme, icône, photo, SVG), même contrat que le front (`src/lib/studio/types.ts`).
  Schéma zod (clés inconnues ignorées) : 30 pages, 300 éléments par page, photos PNG ou JPEG en data URL de 4 Mo
  au plus, document de 14 Mo au plus (413), SVG intégrés nettoyés comme un logo importé (422).
  Format imprimé : dimensions en mm et fond perdu.
- **Routes** : `GET|POST /projects/:pid/studio-designs` (liste sans document, création),
  `GET|PUT|DELETE /studio-designs/:sdid` (sauvegarde automatique : 120 par minute),
  `POST /studio-designs/:sdid/duplicate`, `POST /studio-designs/:sdid/export` (202, tâche
  `DESIGN_EXPORT`, 0 crédit, `Idempotency-Key` facultative). Le lien du fichier est dans le
  résultat de la tâche (`GET /jobs/:jid`, URL signée).
- **Rendu** ([src/render/design.ts](src/render/design.ts)) : texte converti en tracés avec les
  lignes calculées par l'éditeur (rendu identique), texte en arc, dégradés, contours, surlignage,
  ombres, modes de fusion, masques et filtres photo.
- **PDF** ([src/render/design-pdf.ts](src/render/design-pdf.ts)) : taille réelle, BleedBox et
  TrimBox, traits de coupe facultatifs ; une page portant des effets que le PDF ne rend pas
  (ombres, fusion, filtres) est tramée à 300 dpi. SVG d'une page, ou ZIP pour plusieurs.
- **Logos** : `POST /logos/:lid/variants` avec `transparent: true` livre la version blanche sans
  fond, pour la poser sur une création.
- **Avis épinglés** : un commentaire `targetType: "DESIGN"` peut porter une épingle
  `anchor: { pageId, x, y }` (proportions de la page, 0 à 1), refusée sur une autre cible ou une
  page absente de la création. Le lien de la notification ouvre le fil (`/studio/:sdid?commentaire=`).
- **Images générées** : `POST /projects/:pid/studio-images` (`prompt` de 3 à 300 caractères,
  `style` `auto` ou l'un de `abstract`, `gradient`, `geometric`, `waves`, `wax`, `bogolan`,
  `confetti`, `aspect` `square`, `portrait` ou `landscape`, `palette` facultative, sinon celle du
  logo favori) : 202, `Idempotency-Key` obligatoire, tâche `STUDIO_IMAGES` (1 crédit, 2 lots
  gratuits par jour), description passée par la liste noire (422 `TERM_BLOCKED`). Le résultat
  donne 4 PNG (`images[].url` signées, `width`, `height`) et `demo`. Le fournisseur de
  démonstration compose des visuels génératifs déterministes à partir de la palette
  ([src/render/artwork.ts](src/render/artwork.ts), même moteur que le front) ; un vrai modèle
  d'images se branche en implémentant `AiProvider.generateImages`.
- **Banque de photos** : `GET /library/photos?q=&page=&orientation=&locale=` (recherche Pexels,
  ou sélection du moment sans `q` ; résultats validés, mis en cache une heure dans Redis) et
  `GET /library/photos/:id/file` (fichier relayé par l'API : hôte `images.pexels.com` seul,
  JPEG, PNG ou WebP de 15 Mo au plus, ramené à 2 400 px). Sans `PEXELS_API_KEY` : 501
  `NOT_AVAILABLE`, sans appel sortant. `GET /library/capabilities` indique au front le
  fournisseur d'images (`aiImages.demo`) et la disponibilité des photos.

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
| `npm run test:permissions` | Matrice des droits, rôle par rôle, contre une API locale |
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
