# Matrice des droits

Deux niveaux de rôles (cahier des charges §3) :

- **rôle dans un espace** : Propriétaire (OWNER) > Éditeur (EDITOR) > Lecteur (VIEWER) ;
- **rôle plateforme** : Utilisateur (USER) < Support (SUPPORT) < Admin (ADMIN) < Super admin (SUPER_ADMIN).

L'API fait foi : `WorkspaceGuard` (rôle d'espace, déduit des paramètres de route) et `RolesGuard`
(rôle plateforme). Le front (`src/lib/permissions.ts`) masque les actions interdites avec la
même matrice. La conformité est vérifiée de bout en bout par `npm run test:permissions`.

## Règles générales

- Un non-membre reçoit **404** (il ne doit pas savoir que la ressource existe) ; un membre au
  rôle insuffisant reçoit **403**.
- Un espace supprimé n'existe plus pour personne (404), y compris ses projets.
- Le support et les admins accèdent aux espaces **en lecture**, avec une session ouverte en double
  authentification ; chacun de ces accès est inscrit au journal d'audit (`staff.access`).
- Les rôles plateforme internes (support et au-delà) exigent la double authentification pour tout
  le back-office.
- Un compte plateforme n'agit que sur un rang **inférieur** au sien ; le super admin agit sur tous.

## Espaces de travail

| Action | Route | Lecteur | Éditeur | Propriétaire | Support | Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Voir l'espace, ses membres | `GET /workspaces/:wid`, `…/members` | Oui | Oui | Oui | Lecture | Lecture |
| Voir le solde de crédits | `GET /workspaces/:wid/credits` | Oui | Oui | Oui | Lecture | Lecture |
| Voir le grand livre | `GET /workspaces/:wid/ledger` | — | — | Oui | Lecture | Lecture |
| Renommer, autoriser les téléchargements des lecteurs | `PATCH /workspaces/:wid` | — | — | Oui | — | — |
| Inviter, voir les invitations | `…/invitations` | — | — | Oui | — | — |
| Changer le rôle d'un membre | `PATCH …/members/:uid` | — | — | Oui | — | — |
| Retirer un membre | `DELETE …/members/:uid` | Soi-même | Soi-même | Oui | — | — |
| Supprimer l'espace (organisation, nom confirmé) | `DELETE /workspaces/:wid` | — | — | Oui | — | Oui |

L'espace garde toujours au moins un propriétaire. L'espace personnel disparaît avec le compte.
Supprimer un espace envoie ses projets à la corbeille (purge à 30 jours) ; le grand livre, les
paiements et l'abonnement sont conservés.

## Projets et contenus

| Action | Lecteur | Éditeur | Propriétaire | Support | Admin |
| --- | --- | --- | --- | --- | --- |
| Voir projets, noms, logos, slogans, signatures, kits, créations, site web, historique | Oui | Oui | Oui | Lecture | Lecture |
| Commenter, répondre, voter pour un nom | Oui | Oui | Oui | — | — |
| Résoudre le fil d'un autre | — | Oui | Oui | — | — |
| Créer un projet, lancer une génération (noms, logos, slogans, images, détourage IA) | — | Oui | Oui | — | — |
| Éditer brief, logos, slogans, signatures, kit, créations du Studio, site web | — | Oui | Oui | — | — |
| Partager le kit (lien public), publier ou dépublier le site web | — | Oui | Oui | — | — |
| Lire les messages reçus par le formulaire du site | — | Oui | Oui | — | — |
| Exporter un logo, une création ou le site web (ZIP), préparer l'archive du kit, télécharger | Si autorisé | Oui | Oui | — | — |
| Télécharger le fichier d'un cachet ou d'un paraphe | — | Oui | Oui | — | — |
| Demander la charte PDF (crédits) | — | Oui | Oui | — | — |
| Voir la corbeille | — | — | Oui | — | Oui |
| Supprimer le site web | — | — | Oui | — | — |
| Supprimer ou restaurer un projet | — | — | Oui | — | Oui |

« Si autorisé » : le propriétaire active « Les lecteurs peuvent télécharger » dans les réglages de
l'espace. Sans ce réglage, les liens de téléchargement des tâches (`GET /jobs/:jid`) ne sont pas
signés pour un lecteur (`result.restricted`). Le cachet et le paraphe restent réservés aux
éditeurs : ce sont des marques d'authentification.

## Back-office

| Action | Route | Support | Admin | Super admin |
| --- | --- | --- | --- | --- |
| Tableau de bord, comptes, paiements | `GET /admin/stats`, `/admin/users…` | Oui | Oui | Oui |
| Modérer un contenu signalé | `GET /admin/moderation`, `PATCH /admin/signatures/:sid/review` | Oui | Oui | Oui |
| Proposer un ajustement de crédits | `POST /admin/credits/requests` | Oui | Oui | Oui |
| Valider ou refuser une proposition (autre que la sienne) | `PATCH /admin/credits/requests/:id` | — | Oui | Oui |
| Ajuster des crédits directement | `POST /admin/credits/adjust` | — | Oui | Oui |
| Suspendre, réinitialiser la double authentification | `PATCH /admin/users/:uid` | — | Rang inférieur | Oui |
| Changer un rôle plateforme | `PATCH /admin/users/:uid` (`role`) | — | — | Oui |
| Liste noire de termes, modèles textiles | `/admin/blocked-terms`, `/admin/apparel/…` | — | Oui | Oui |
| Journal d'audit complet | `GET /admin/audit-logs` | — | — | Oui |

## Routes publiques

Sans compte, avec limitation de débit : essai de noms et de signature e-mail, page d'un kit
partagé (mot de passe et expiration facultatifs), validation d'un BAT par lien, logo d'une
signature e-mail, fichiers servis par URL signée, offres, sondes de santé. Site web publié :
page, image de partage et icônes, images téléversées (identifiant aléatoire), polices de la
bibliothèque et formulaire de contact (5 messages par minute et par adresse IP, champ piège
contre les robots, ouvert à toute origine pour un site exporté et hébergé ailleurs).
