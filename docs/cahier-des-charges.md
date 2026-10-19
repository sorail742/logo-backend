# Cahier des charges — Plateforme de création d'identité de marque

Oct 15, 2026 · @bonjour

## 1. Présentation du projet

La plateforme permet à toute structure (association, application, plateforme, entreprise, projet) d'obtenir en un seul parcours un **nom**, un **logo** et des **signatures** prêts à l'emploi. Elle est développée en NestJS (API), Next.js (front), PostgreSQL et Prisma.

### 1.1 Contexte et problème

- Créer une identité coûte cher : un designer, plusieurs allers-retours, des délais de plusieurs semaines.
- Les associations, startups et projets étudiants manquent souvent de budget et de compétences graphiques.
- Les outils existants sont majoritairement en anglais, facturés en devises et sans paiement mobile.
- Un nom choisi sans vérification se révèle souvent déjà pris (domaine, réseaux sociaux, marque déposée).

### 1.2 Objectifs

| # | Objectif | Indicateur de réussite (cible V1) |
| --- | --- | --- |
| O1 | Générer des noms pertinents et disponibles | Lot de 10 noms en moins de 10 s, disponibilité domaine et réseaux affichée |
| O2 | Produire un logo vectoriel exploitable | Au moins 4 propositions par génération, export SVG, PNG et PDF |
| O3 | Fournir les signatures de la structure | Slogan, signature e-mail HTML, signature visuelle et cachet |
| O4 | Livrer un kit de marque complet | Archive ZIP + charte graphique PDF générée automatiquement |
| O5 | Rendre le service rentable | Crédits et abonnements payables en GNF par mobile money et carte |

### 1.3 Périmètre

| Inclus en V1 | Exclu de la V1 (évolutions) |
| --- | --- |
| Générateur de noms avec vérifications | Application mobile native (la V1 est une PWA responsive) |
| Générateur et éditeur de logos | Dépôt légal de marque auprès de l'OAPI (seulement une pré-vérification) |
| Slogans, signatures e-mail, signatures visuelles, cachets | Marketplace de designers humains |
| Kit de marque, projets, collaboration | Impression physique (cartes, tampons encreurs) |
| Comptes, offres, crédits, paiements | Signature électronique à valeur juridique |
| Back-office d'administration | Maquettes produits (t-shirts, enseignes) en 3D |

### 1.4 Hypothèses retenues

- « Signatures » couvre trois livrables : la signature de marque (slogan), la signature e-mail et la signature visuelle (paraphe stylisé et cachet d'association).
- L'interface est en français par défaut, l'anglais vient en second.
- Le nom de la plateforme reste à définir ; il peut être le premier cas test du générateur de noms.

## 2. Cibles et parcours utilisateurs

Cinq profils sont visés ; les associations et les porteurs de projets numériques sont prioritaires en V1.

| Persona | Situation | Ce qu'il attend de la plateforme |
| --- | --- | --- |
| Responsable d'association | Bénévole, budget très faible, besoin de documents officiels | Nom, logo, cachet, signature e-mail, tarif associatif |
| Porteur d'application ou de plateforme | Développeur ou fondateur, lance un produit | Nom avec domaine libre, icône d'app (1024 px, favicon), slogan |
| Startup ou PME | Petite équipe, veut paraître professionnelle | Kit de marque complet, charte PDF, travail en équipe |
| Freelance ou agence | Crée des identités pour ses clients | Pistes rapides, retouches fines, exports en lot, espace par client |
| Étudiant ou club | Projet scolaire ou associatif étudiant | Offre gratuite, résultat rapide |

### 2.1 Parcours complet (cas nominal)

1. Créer un projet et choisir son type : association, application, plateforme, entreprise, événement ou autre.
2. Remplir le brief : secteur, mission, valeurs, public cible, langue, mots-clés, ton souhaité.
3. Générer des noms, vérifier leur disponibilité, en retenir un.
4. Générer des logos à partir du nom, puis ajuster couleurs, police, icône et disposition.
5. Générer le slogan, la signature e-mail, la signature visuelle et le cachet.
6. Assembler le kit de marque, payer si l'offre l'exige, télécharger ou partager.

### 2.2 Parcours partiels

- **J'ai déjà un nom** : l'utilisateur saisit le nom et commence directement au logo.
- **J'ai déjà un logo** : il importe son logo (SVG ou PNG) ; la plateforme en extrait les couleurs et produit signatures et kit.
- **Juste une signature e-mail** : parcours court sans brief, accessible sans compte jusqu'à l'export.

## 3. Rôles et permissions

Les droits reposent sur deux niveaux : un rôle **plateforme** (USER, SUPPORT, ADMIN, SUPER\_ADMIN) et un rôle dans chaque **espace de travail** (OWNER, EDITOR, VIEWER). Un utilisateur peut être propriétaire d'un espace et simple lecteur dans un autre.

| Action | Visiteur | Lecteur | Éditeur | Propriétaire | Support | Admin | Super admin |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Essayer la génération de noms ou de signature e-mail | Limité (3 essais) | Oui | Oui | Oui | Oui | Oui | Oui |
| Voir les projets de l'espace | — | Oui | Oui | Oui | Lecture | Oui | Oui |
| Commenter un élément | — | Oui | Oui | Oui | — | — | — |
| Créer un projet, lancer une génération | — | — | Oui | Oui | — | — | — |
| Éditer logos, slogans, signatures | — | — | Oui | Oui | — | — | — |
| Exporter et télécharger | — | Si autorisé | Oui | Oui | — | — | — |
| Inviter ou retirer des membres | — | — | — | Oui | — | — | — |
| Acheter des crédits, gérer l'abonnement | — | — | — | Oui | — | — | — |
| Supprimer un projet ou l'espace | — | — | — | Oui | — | Oui | Oui |
| Consulter comptes, paiements, tickets | — | — | — | — | Oui | Oui | Oui |
| Ajuster des crédits, rembourser | — | — | — | — | Avec validation | Oui | Oui |
| Gérer modèles, polices, icônes, styles | — | — | — | — | — | Oui | Oui |
| Modérer un contenu signalé | — | — | — | — | Oui | Oui | Oui |
| Gérer les offres, prix et clés d'API IA | — | — | — | — | — | — | Oui |
| Nommer des admins, voir le journal d'audit complet | — | — | — | — | — | — | Oui |

**Règles techniques** : les permissions sont vérifiées côté API par des guards NestJS (`RolesGuard` pour le rôle plateforme, `WorkspaceGuard` pour le rôle d'espace). Le front masque les actions interdites mais ne fait jamais foi. Toute action Support, Admin ou Super admin est tracée dans le journal d'audit.

## 4. Module 1 — Générateur de noms

Le module propose des lots de 10 noms expliqués, vérifie leur disponibilité et mène au choix d'un nom unique qui alimente les autres modules. Priorités : **Doit** (V1 obligatoire), **Devrait** (V1 si le délai le permet), **Pourrait** (V2).

### 4.1 Brief de nommage

| ID | Exigence | Priorité |
| --- | --- | --- |
| NOM-01 | Saisir le type de structure : association, application, plateforme, entreprise, événement, autre | Doit |
| NOM-02 | Saisir secteur, mission (texte libre, 500 caractères max), valeurs (étiquettes), public cible | Doit |
| NOM-03 | Choisir le style : descriptif, inventé, composé, métaphorique, acronyme ou sigle, nom propre | Doit |
| NOM-04 | Fixer la langue (français, anglais), la longueur maximale, les mots à inclure ou à éviter | Doit |
| NOM-05 | Pour une association : générer le sigle et sa forme développée ensemble | Doit |
| NOM-06 | Proposer des noms inspirés de langues locales (ex. pular, malinké, soussou) avec leur sens | Pourrait |

### 4.2 Génération

| ID | Exigence | Priorité |
| --- | --- | --- |
| NOM-10 | Générer un lot de 10 noms via un fournisseur IA (LLM) derrière une interface interchangeable | Doit |
| NOM-11 | Afficher pour chaque nom : signification, style, sigle éventuel, prononciation | Doit |
| NOM-12 | Calculer un score sur 100 : longueur, facilité de prononciation, originalité, disponibilité | Devrait |
| NOM-13 | Relancer avec un retour : « plus court », « plus sérieux », « plus proche de celui-ci » | Doit |
| NOM-14 | Filtrer les noms injurieux ou à connotation négative (liste noire multilingue + contrôle IA) | Doit |
| NOM-15 | Ne jamais reproposer un nom déjà refusé dans le même projet | Devrait |

### 4.3 Vérifications de disponibilité

| ID | Exigence | Priorité |
| --- | --- | --- |
| NOM-20 | Vérifier les domaines .com, .org, .net, .app, .africa et .gn via RDAP ou l'API d'un registrar | Doit |
| NOM-21 | Indiquer la disponibilité probable des identifiants Facebook, Instagram, TikTok, X, LinkedIn, GitHub | Devrait |
| NOM-22 | Rechercher les applications homônymes sur Play Store et App Store | Pourrait |
| NOM-23 | Comparer phonétiquement le nom aux noms déjà retenus sur la plateforme (Soundex/Metaphone adapté au français) | Devrait |
| NOM-24 | Fournir un lien de recherche pré-rempli vers les bases de marques (OAPI, OMPI Global Brand Database) | Doit |
| NOM-25 | Mettre les résultats en cache 24 h et afficher la date de la dernière vérification | Doit |

Les résultats réseaux sociaux et marques sont **indicatifs** : l'interface le dit clairement et recommande une vérification officielle avant tout dépôt.

### 4.4 Sélection

| ID | Exigence | Priorité |
| --- | --- | --- |
| NOM-30 | Ajouter un nom aux favoris, comparer jusqu'à 4 favoris côte à côte | Doit |
| NOM-31 | Faire voter les membres de l'espace sur les favoris | Devrait |
| NOM-32 | Retenir un nom final : il devient le nom du projet et alimente logos, slogans et signatures | Doit |
| NOM-33 | Changer de nom final crée une nouvelle version du kit, l'ancienne reste consultable | Doit |

## 5. Module 2 — Générateur de logos

Le moteur principal compose des logos **vectoriels** (SVG) à partir d'éléments sous licence libre choisis par l'IA ; un moteur secondaire par génération d'image puis vectorisation sert aux emblèmes plus illustratifs. Ce choix garantit des fichiers éditables, légers et nets à toutes les tailles.

### 5.1 Moteurs de génération

| Moteur | Fonctionnement | Avantages | Limites | Priorité |
| --- | --- | --- | --- | --- |
| A — Composition SVG | Le LLM choisit icône, police, palette et disposition ; le serveur assemble le SVG | Vectoriel natif, éditable, coût faible, rapide | Créativité limitée par la bibliothèque | Doit |
| B — Image IA + vectorisation | Un modèle d'image produit un symbole, vectorisé ensuite (vtracer ou potrace) | Symboles uniques, plus artistiques | Coût par image, retouche parfois nécessaire | Devrait |

### 5.2 Paramètres et propositions

| ID | Exigence | Priorité |
| --- | --- | --- |
| LOGO-01 | Choisir le type : logotype (texte seul), monogramme, icône + texte, emblème ou badge | Doit |
| LOGO-02 | Choisir le style : minimaliste, moderne, classique, institutionnel, ludique, motifs africains | Doit |
| LOGO-03 | Choisir une palette (2 à 4 couleurs) ou la laisser proposer par l'IA selon le brief | Doit |
| LOGO-04 | Générer 8 propositions par lot, en reprenant le nom et le sigle retenus | Doit |
| LOGO-05 | Présenter chaque proposition en situation : carte de visite, fond sombre, avatar réseau social, icône d'app | Doit |
| LOGO-06 | Relancer avec un retour : « plus simple », « autre icône », « mêmes couleurs » | Doit |
| LOGO-07 | Importer un logo existant (SVG, PNG) et en extraire la palette | Devrait |

### 5.3 Éditeur en ligne

| ID | Exigence | Priorité |
| --- | --- | --- |
| LOGO-10 | Modifier texte, police, graisse, taille, espacement des lettres, couleurs | Doit |
| LOGO-11 | Remplacer l'icône par recherche dans la bibliothèque, la redimensionner, la placer | Doit |
| LOGO-12 | Basculer la disposition : horizontale, verticale, icône seule, texte seul | Doit |
| LOGO-13 | Annuler, rétablir, enregistrer des versions nommées, revenir à une version | Doit |
| LOGO-14 | Prévisualisation en direct à 32 px pour tester la lisibilité | Devrait |
| LOGO-15 | Commentaires des membres épinglés sur une version | Pourrait |

### 5.4 Variantes et exports

| ID | Exigence | Priorité |
| --- | --- | --- |
| LOGO-20 | Produire automatiquement les variantes : couleur, noir, blanc, icône seule, horizontale, verticale | Doit |
| LOGO-21 | Exporter en SVG, PDF vectoriel, PNG transparent (512, 1024, 2048 px) et JPG | Doit |
| LOGO-22 | Générer le pack icônes d'app : favicon.ico (16/32/48), Apple 180 px, Android 192 et 512 px, iOS 1024 px | Doit |
| LOGO-23 | Générer les formats réseaux sociaux : photo de profil, bannières Facebook et LinkedIn | Devrait |
| LOGO-24 | Offre gratuite : PNG 512 px avec filigrane uniquement | Doit |

### 5.5 Règles de qualité et d'originalité

- Le texte est converti en tracés à l'export SVG et PDF : le fichier s'affiche sans la police installée.
- Les SVG sont optimisés (SVGO) ; le contraste texte/fond respecte un ratio d'au moins 4,5:1.
- Les icônes et polices proviennent uniquement de la bibliothèque interne ; chaque élément y porte sa licence (OFL, MIT, CC0).
- Une empreinte perceptuelle (pHash) compare chaque logo acheté aux logos déjà vendus : un logo acheté devient **exclusif** et n'est plus proposé à un autre client.

## 6. Module 3 — Signatures

Le module produit trois signatures qui reprennent automatiquement le nom, le logo, les couleurs et les polices du projet : la signature de marque, la signature e-mail et la signature visuelle avec le cachet.

### 6.1 Signature de marque (slogan, devise)

| ID | Exigence | Priorité |
| --- | --- | --- |
| SIG-01 | Générer 10 slogans selon le brief, le ton (inspirant, institutionnel, accrocheur, engagé) et la langue | Doit |
| SIG-02 | Limiter la longueur (nombre de mots réglable, 8 par défaut) | Doit |
| SIG-03 | Pour une association : proposer une devise en trois termes et une phrase de mission | Doit |
| SIG-04 | Signaler un slogan trop proche d'un slogan connu (liste de référence interne + contrôle IA) | Devrait |
| SIG-05 | Assembler logo + slogan en une version « logo avec signature » exportable | Doit |

### 6.2 Signature e-mail

| ID | Exigence | Priorité |
| --- | --- | --- |
| SIG-10 | Formulaire : nom, fonction, téléphones au format international (+224…), e-mail, site, adresse, réseaux, photo | Doit |
| SIG-11 | Ajouter une mention légale libre (numéro d'agrément d'association, RCCM, avis de confidentialité) | Doit |
| SIG-12 | Proposer au moins 6 modèles, aux couleurs et polices du kit appliquées automatiquement | Doit |
| SIG-13 | Produire un HTML compatible Gmail, Outlook (bureau et web), Apple Mail, Thunderbird : tableaux, styles en ligne, images PNG en HTTPS absolu | Doit |
| SIG-14 | Bouton « copier la signature » + guide d'installation par messagerie | Doit |
| SIG-15 | Fournir aussi une version texte brut | Devrait |
| SIG-16 | Générer les signatures de tous les membres d'une organisation par import CSV | Devrait |
| SIG-17 | Ajouter une bannière promotionnelle cliquable (événement, campagne d'adhésion) | Pourrait |

### 6.3 Signature visuelle et cachet

| ID | Exigence | Priorité |
| --- | --- | --- |
| SIG-20 | Paraphe stylisé : généré à partir du nom avec des polices manuscrites sous licence, plusieurs propositions | Doit |
| SIG-21 | Paraphe dessiné au doigt ou à la souris, lissé puis vectorisé, fond transparent | Devrait |
| SIG-22 | Cachet : formes ronde, ovale, rectangulaire ; texte circulaire (nom, ville, pays) ; centre avec logo, sigle ou qualité (« Le Président ») | Doit |
| SIG-23 | Couleur d'encre (bleu, violet, rouge, noir) et effet d'encre optionnel | Doit |
| SIG-24 | Exporter cachet et paraphe en SVG et PNG transparent haute définition (fabrication d'un tampon physique) | Doit |

### 6.4 Règles de sécurité propres aux signatures

- Paraphes et cachets sont des **images** : ils n'ont pas la valeur d'une signature électronique qualifiée. L'interface l'indique avant chaque export.
- L'utilisateur certifie, par case à cocher horodatée, être le titulaire du nom ou habilité à représenter la structure.
- Les cachets contenant des termes officiels (« République », « Ministère », « Préfecture », « Police », « Gendarmerie », « Tribunal »…) ou des armoiries sont bloqués ou soumis à validation manuelle.
- Les paraphes sont privés par défaut, stockés dans un espace non public et servis par URL signée de courte durée.

## 7. Module 4 — Kit de marque, projets et collaboration

Le kit de marque rassemble tout ce que le projet a produit en un seul livrable : une page web partageable, une charte graphique PDF et une archive ZIP. Les projets sont rangés dans des espaces de travail où plusieurs personnes collaborent.

### 7.1 Kit de marque

| ID | Exigence | Priorité |
| --- | --- | --- |
| KIT-01 | Page kit : nom, sigle, logo et variantes, palette (HEX, RGB, CMJN), polices avec licence, slogan, signatures | Doit |
| KIT-02 | Charte graphique PDF générée : origine du nom, logo, zone de protection, taille minimale, usages interdits, couleurs, typographies, signatures, exemples | Doit |
| KIT-03 | Archive ZIP rangée : logo/svg, logo/png, logo/pdf, icones-app, reseaux-sociaux, signatures, charte.pdf, LICENCES.txt | Doit |
| KIT-04 | Supports : papier à en-tête (DOCX + PDF), carte de visite prête à imprimer (fond perdu 3 mm), carte de membre d'association | Devrait |
| KIT-05 | Lien de partage en lecture seule, avec mot de passe et date d'expiration optionnels | Doit |
| KIT-06 | Versions du kit (v1, v2…) consultables et restaurables | Doit |

### 7.2 Espaces de travail et projets

| ID | Exigence | Priorité |
| --- | --- | --- |
| PRJ-01 | Un espace personnel créé à l'inscription ; création d'espaces d'organisation | Doit |
| PRJ-02 | Un projet = une identité ; statuts Brouillon, En cours, Finalisé, Archivé | Doit |
| PRJ-03 | Tableau de bord : recherche, filtres par type et statut, duplication de projet | Doit |
| PRJ-04 | Corbeille : un projet supprimé reste récupérable 30 jours | Devrait |
| PRJ-05 | Espace par client pour les agences (un espace d'organisation par client) | Devrait |

### 7.3 Collaboration

| ID | Exigence | Priorité |
| --- | --- | --- |
| COL-01 | Inviter par e-mail ou par lien, en choisissant le rôle (Lecteur, Éditeur) | Doit |
| COL-02 | Commentaires sur un nom, un logo ou une signature, avec mentions @ | Devrait |
| COL-03 | Notifications dans l'application et par e-mail (invitation, commentaire, export prêt, crédits bas) | Doit |
| COL-04 | Historique d'activité par projet (qui a fait quoi, quand) | Devrait |

### 7.4 Règles d'export

- Les exports lourds (ZIP, charte PDF) sont produits de façon asynchrone par une file de tâches ; l'utilisateur est prévenu quand c'est prêt.
- Un lien de téléchargement reste valable 7 jours ; l'export peut être régénéré sans coût.
- Le filigrane et la résolution dépendent de l'offre au moment de l'export, pas au moment de la génération.

## 8. Comptes, offres, crédits et paiements

Le modèle combine une offre gratuite limitée, des achats uniques et des abonnements ; chaque génération consomme des crédits. Les prix en GNF restent à fixer après mesure du coût réel des appels IA par génération.

### 8.1 Comptes

| ID | Exigence | Priorité |
| --- | --- | --- |
| CPT-01 | Inscription par e-mail et mot de passe, avec vérification de l'e-mail | Doit |
| CPT-02 | Connexion avec Google (OAuth 2.0) | Doit |
| CPT-03 | Connexion par numéro de téléphone et code SMS (OTP) | Devrait |
| CPT-04 | Mot de passe oublié par lien à usage unique valable 30 min | Doit |
| CPT-05 | Double authentification TOTP, obligatoire pour Support, Admin et Super admin | Doit |
| CPT-06 | Profil : nom, photo, langue, pays ; suppression du compte et export des données | Doit |

### 8.2 Offres proposées

| Offre | Pour qui | Contenu | Facturation |
| --- | --- | --- | --- |
| Gratuit | Découverte, étudiants | 3 lots de noms et 1 lot de logos par jour, PNG 512 px avec filigrane, signature e-mail avec mention de la plateforme | Gratuit |
| Pack Identité | Association, porteur de projet | 1 projet complet, exports sans filigrane, charte PDF, cachet, 100 crédits | Paiement unique |
| Association | Association avec agrément | Pack Identité à tarif réduit après validation d'un justificatif | Paiement unique |
| Pro | Startups, freelances | Projets illimités, 500 crédits par mois, 5 membres, signatures en lot | Mensuel ou annuel |
| Agence | Agences de communication | 2 000 crédits par mois, espaces clients illimités, 15 membres | Mensuel ou annuel |

### 8.3 Coût des actions en crédits (à calibrer)

| Action | Crédits |
| --- | --- |
| Lot de 10 noms | 1 |
| Vérification de disponibilité | 0 (incluse) |
| Lot de 8 logos, moteur A (composition SVG) | 2 |
| Lot de logos, moteur B (image IA + vectorisation) | 5 |
| Lot de 10 slogans | 1 |
| Signature e-mail | 0 |
| Paraphe ou cachet | 1 |
| Charte graphique PDF | 3 |

### 8.4 Paiements

| ID | Exigence | Priorité |
| --- | --- | --- |
| PAY-01 | Paiement Orange Money en priorité, autres portefeuilles mobiles via un agrégateur (à choisir) | Doit |
| PAY-02 | Paiement par carte via un prestataire acceptant les marchands établis en Guinée (à choisir) | Devrait |
| PAY-03 | Webhooks idempotents ; statuts PENDING, SUCCEEDED, FAILED, REFUNDED ; réconciliation quotidienne | Doit |
| PAY-04 | Factures PDF numérotées en GNF, taxe paramétrable (taux à confirmer) | Doit |
| PAY-05 | Grand livre de crédits immuable : débit au lancement, remboursement automatique si la génération échoue | Doit |
| PAY-06 | Codes promo ; validation manuelle du tarif association par un admin | Devrait |
| PAY-07 | Affichage en GNF par défaut, USD et EUR en option | Devrait |
| PAY-08 | Renouvellement d'abonnement avec rappel 3 jours avant, et 3 jours de grâce en cas d'échec | Devrait |

## 9. Back-office administrateur

Le back-office est une section protégée de l'application Next.js (`/admin`), réservée aux rôles Support, Admin et Super admin avec double authentification. Il pilote l'activité, l'argent, la bibliothèque graphique et l'IA.

| ID | Domaine | Exigence | Priorité |
| --- | --- | --- | --- |
| ADM-01 | Tableau de bord | Inscriptions, utilisateurs actifs, générations par module, taux de passage gratuit → payant, revenus en GNF, coût IA et marge par jour | Doit |
| ADM-02 | Utilisateurs | Liste, recherche, fiche détaillée, suspension, réinitialisation de la double authentification | Doit |
| ADM-03 | Utilisateurs | Vue « en tant que » en lecture seule pour le support, tracée dans l'audit | Devrait |
| ADM-04 | Espaces et projets | Consultation, transfert de propriété, restauration depuis la corbeille | Doit |
| ADM-05 | Paiements | Transactions, remboursements, réconciliation, factures, export CSV comptable | Doit |
| ADM-06 | Crédits | Ajustement manuel avec motif obligatoire | Doit |
| ADM-07 | Tarif association | File des justificatifs à valider ou refuser, avec motif | Devrait |
| ADM-08 | Bibliothèque | Icônes, polices, palettes : import, licence, étiquettes, activation | Doit |
| ADM-09 | Modèles | Modèles de signature e-mail, de cachet et de charte PDF : création, aperçu, activation | Doit |
| ADM-10 | IA | Fournisseur actif, prompts versionnés, quotas, suivi des coûts par appel | Doit |
| ADM-11 | IA | Comparaison A/B de deux versions de prompt | Pourrait |
| ADM-12 | Modération | Contenus signalés, cachets en validation manuelle, liste noire de mots | Doit |
| ADM-13 | Support | Messages des utilisateurs et réponses, FAQ éditable | Devrait |
| ADM-14 | Paramètres | Offres, prix, codes promo, taxe, e-mails transactionnels, mode maintenance | Doit |
| ADM-15 | Audit | Journal de toutes les actions sensibles : auteur, date, avant/après, adresse IP | Doit |

## 10. Exigences non fonctionnelles

La plateforme doit rester rapide sur une connexion mobile 3G/4G moyenne, car une grande partie des utilisateurs visés y accède depuis un téléphone.

| Catégorie | Exigence | Cible V1 |
| --- | --- | --- |
| Performance web | Affichage du contenu principal (LCP) des pages publiques | < 2,5 s en 4G |
| Performance API | Temps de réponse hors IA, 95e percentile | < 300 ms |
| Performance IA | Lot de 10 noms / lot de 8 logos moteur A / export ZIP complet | < 10 s / < 15 s / < 60 s |
| Faible débit | Poids de la page d'accueil, images en WebP ou AVIF, aperçus en SVG | < 1 Mo |
| Hors ligne | PWA : projets déjà ouverts consultables sans réseau | Doit |
| Disponibilité | Disponibilité mensuelle | 99,5 % |
| Sauvegardes | PostgreSQL : sauvegarde quotidienne + restauration à un instant donné | 7 jours d'historique |
| Reprise | Perte de données maximale (RPO) / durée de remise en service (RTO) | 15 min / 4 h |
| Montée en charge | API sans état, workers de génération ajoutables à chaud | 1 000 utilisateurs simultanés |
| Compatibilité | Chrome, Firefox, Safari, Edge (2 dernières versions), Chrome Android 9+ | Largeur min. 360 px |
| Accessibilité | Contrastes, navigation clavier, libellés pour lecteurs d'écran | WCAG 2.1 AA |
| Langues | Français par défaut, anglais ; formats de date et de monnaie locaux | 2 langues |
| Référencement | Pages publiques rendues côté serveur, sitemap, balises Open Graph, pages outils indexables | Doit |
| Observabilité | Logs structurés, traces OpenTelemetry, suivi d'erreurs, métriques et alertes | Doit |
| Qualité du code | TypeScript strict, ESLint, Prettier, tests unitaires des services, tests E2E des parcours critiques | Couverture back ≥ 70 % |
| Documentation | API documentée en OpenAPI (Swagger), décisions d'architecture en ADR | Doit |

## 11. Architecture technique

Le projet est un monorepo TypeScript avec un front Next.js, une API NestJS et des workers NestJS qui exécutent les générations en arrière-plan ; PostgreSQL est accédé uniquement via Prisma.

&#91;embedded content: architecture · 2 applications, 3 stockages, 4 services externes\]

Le front n'appelle jamais directement l'IA ni le paiement : tout passe par l'API, et les générations tournent dans les workers pour que l'API reste rapide.

### 11.1 Choix techniques

| Couche | Technologie | Rôle |
| --- | --- | --- |
| Front | Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui | Site public rendu côté serveur, application, back-office |
| Données côté front | TanStack Query, Zustand | Cache des requêtes, état de l'éditeur |
| Éditeur de logo | Fabric.js (canvas avec import et export SVG) | Édition interactive des logos et cachets |
| Langues | next-intl | Français, anglais |
| API | NestJS, class-validator, @nestjs/swagger, Passport (JWT, Google) | REST, validation, documentation, authentification |
| ORM | Prisma | Schéma, migrations, accès PostgreSQL |
| Tâches de fond | BullMQ (@nestjs/bullmq) + Redis | Files de génération, d'export et d'e-mails |
| Rendu | opentype.js, SVGO, resvg-js, sharp, Playwright (HTML vers PDF), archiver | Texte en tracés, optimisation SVG, PNG, redimensionnement, charte PDF, ZIP |
| Vectorisation | vtracer | Moteur B : image vers SVG |
| IA | Module `AiProvider` interchangeable (LLM texte, modèle d'image) | Noms, slogans, choix de composition, symboles |
| Base de données | PostgreSQL | Données métier |
| Stockage | Compatible S3 (MinIO en développement) | Fichiers générés et importés |
| Observabilité | pino, OpenTelemetry, Sentry | Logs, traces, erreurs |
| CI/CD | GitHub Actions, Docker | Tests, build, déploiement |

### 11.2 Structure du monorepo

```text
apps/
  web/        Next.js : site public, application, /admin
  api/        NestJS : REST, authentification, webhooks
  worker/     NestJS autonome : consommateurs BullMQ
packages/
  database/   schema.prisma, migrations, seed, client Prisma
  shared/     types, schémas zod, coûts en crédits
  render/     moteur SVG : composition, tracés, variantes, exports
  ui/         composants React partagés
  config/     ESLint, tsconfig, Prettier
```

Le monorepo est géré avec pnpm et Turborepo ; `packages/render` est partagé entre les workers (rendu final) et le front (aperçu instantané dans l'éditeur).

### 11.3 Modules NestJS

| Module | Responsabilité |
| --- | --- |
| AuthModule | Inscription, connexion, JWT, Google, OTP, 2FA |
| UsersModule, WorkspacesModule | Profils, espaces, membres, invitations |
| ProjectsModule | Projets, briefs, corbeille |
| NamesModule, AvailabilityModule | Génération de noms, vérifications domaine, réseaux, marques |
| LogosModule | Génération, versions, variantes, exports de logos |
| SignaturesModule | Slogans, signatures e-mail, paraphes, cachets |
| BrandKitModule | Kit, charte PDF, ZIP, partage |
| JobsModule | Création et suivi des tâches, flux SSE |
| AiModule | Abstraction des fournisseurs IA, prompts versionnés, coûts |
| BillingModule, PaymentsModule | Offres, crédits, abonnements, adaptateurs de paiement, factures |
| LibraryModule | Icônes, polices, modèles |
| StorageModule | Envoi et URL signées S3 |
| NotificationsModule | In-app, e-mail, SMS |
| AdminModule, AuditModule | Back-office, journal d'audit |
| HealthModule | Sondes de santé pour l'hébergeur |

### 11.4 Cycle d'une génération

1. Le front envoie `POST /projects/:pid/logos/generate` avec un en-tête `Idempotency-Key`.
2. L'API vérifie les droits, puis, dans une même transaction, débite les crédits et crée la tâche `QUEUED`.
3. L'API place la tâche dans la file BullMQ et répond `202` avec le `jobId`.
4. Un worker appelle le fournisseur IA, valide la réponse (zod), filtre les termes interdits, compose les SVG et enregistre les résultats.
5. La tâche passe à `SUCCEEDED` et un événement SSE prévient le front, qui affiche les propositions.
6. En cas d'échec après 3 tentatives, la tâche passe à `FAILED` et les crédits sont remboursés automatiquement.

### 11.5 Hébergement

- **Développement** : docker-compose avec PostgreSQL, Redis, MinIO et un serveur e-mail de test.
- **Production, option managée** : Vercel pour Next.js, Render pour l'API et les workers, Neon pour PostgreSQL, un Redis managé et un stockage compatible S3.
- **Production, option VPS** : Docker sur un serveur, reverse proxy Caddy ou Nginx, sauvegardes envoyées hors du serveur.
- Trois environnements (développement, recette, production) ; `prisma migrate deploy` s'exécute à chaque déploiement.

## 12. Modèle de données (schéma Prisma)

Le modèle compte 29 entités réparties en six domaines ; tout projet appartient à un espace de travail, et l'espace porte les crédits, l'abonnement et les paiements.

| Domaine | Entités |
| --- | --- |
| Identité et accès | User, OAuthAccount, RefreshToken, Workspace, Membership, Invitation |
| Projets | Project, Brief |
| Contenus générés | NameSuggestion, AvailabilityCheck, NameVote, Logo, LogoVersion, Slogan, Signature, BrandKit |
| Génération | GenerationJob, Asset, Template, BlockedTerm |
| Facturation | Plan, Subscription, Payment, Invoice, CreditLedgerEntry, AssociationProof |
| Suivi | Comment, Notification, AuditLog |

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Énumérations ───
enum PlatformRole {
  USER
  SUPPORT
  ADMIN
  SUPER_ADMIN
}

enum WorkspaceRole {
  OWNER
  EDITOR
  VIEWER
}

enum WorkspaceKind {
  PERSONAL
  ORGANIZATION
}

enum EntityType {
  ASSOCIATION
  APPLICATION
  PLATFORM
  COMPANY
  EVENT
  OTHER
}

enum ProjectStatus {
  DRAFT
  IN_PROGRESS
  FINALIZED
  ARCHIVED
}

enum NameStyle {
  DESCRIPTIVE
  INVENTED
  COMPOUND
  METAPHORICAL
  ACRONYM
  PROPER
}

enum CheckKind {
  DOMAIN
  SOCIAL
  APP_STORE
  TRADEMARK
  PHONETIC
}

enum CheckStatus {
  AVAILABLE
  TAKEN
  UNKNOWN
}

enum LogoType {
  WORDMARK
  MONOGRAM
  ICON_TEXT
  EMBLEM
}

enum LogoEngine {
  SVG_COMPOSER
  IMAGE_VECTORIZE
  UPLOAD
}

enum SignatureKind {
  EMAIL
  HANDWRITTEN
  STAMP
}

enum SignatureStatus {
  ACTIVE
  PENDING_REVIEW
  REJECTED
}

enum JobKind {
  NAMES
  LOGOS
  SLOGANS
  SIGNATURE
  BRAND_GUIDE
  EXPORT_ZIP
}

enum JobStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
  CANCELED
}

enum LedgerReason {
  PURCHASE
  SUBSCRIPTION_GRANT
  GENERATION
  REFUND
  ADMIN_ADJUSTMENT
  PROMO
}

enum PaymentProvider {
  ORANGE_MONEY
  MOBILE_MONEY_AGGREGATOR
  CARD
}

enum PaymentStatus {
  PENDING
  SUCCEEDED
  FAILED
  REFUNDED
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELED
  EXPIRED
}

enum AssetKind {
  ICON
  FONT
  LOGO_FILE
  SIGNATURE_FILE
  EXPORT
  UPLOAD
  AVATAR
}

enum LicenseKind {
  OFL
  MIT
  CC0
  APACHE2
  PROPRIETARY
}

// ─── Identité et accès ───
model User {
  id              String        @id @default(uuid())
  email           String?       @unique
  phone           String?       @unique
  passwordHash    String?
  fullName        String
  avatarUrl       String?
  locale          String        @default("fr")
  country         String        @default("GN")
  role            PlatformRole  @default(USER)
  emailVerifiedAt DateTime?
  totpSecret      String?       // chiffré (AES-256-GCM)
  suspendedAt     DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  deletedAt       DateTime?

  oauthAccounts   OAuthAccount[]
  refreshTokens   RefreshToken[]
  memberships     Membership[]
  comments        Comment[]
  notifications   Notification[]
  auditLogs       AuditLog[]
}

model OAuthAccount {
  id                String @id @default(uuid())
  userId            String
  provider          String // "google"
  providerAccountId String
  user              User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model RefreshToken {
  id        String    @id @default(uuid())
  userId    String
  tokenHash String    @unique
  userAgent String?
  ip        String?
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Workspace {
  id            String        @id @default(uuid())
  name          String
  slug          String        @unique
  kind          WorkspaceKind @default(PERSONAL)
  creditBalance Int           @default(0) // cache du grand livre
  createdAt     DateTime      @default(now())
  updatedAt     DateTime      @updatedAt

  members       Membership[]
  invitations   Invitation[]
  projects      Project[]
  subscription  Subscription?
  payments      Payment[]
  ledger            CreditLedgerEntry[]
  associationProofs AssociationProof[]
}

model Membership {
  id          String        @id @default(uuid())
  userId      String
  workspaceId String
  role        WorkspaceRole
  createdAt   DateTime      @default(now())
  user        User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId])
}

model Invitation {
  id          String        @id @default(uuid())
  workspaceId String
  email       String
  role        WorkspaceRole
  tokenHash   String        @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  workspace   Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}

// ─── Projets ───
model Project {
  id           String           @id @default(uuid())
  workspaceId  String
  entityType   EntityType
  status       ProjectStatus    @default(DRAFT)
  title        String           // titre de travail
  chosenNameId String?          @unique
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  deletedAt    DateTime?        // corbeille 30 jours

  workspace    Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  brief        Brief?
  names        NameSuggestion[] @relation("ProjectNames")
  chosenName   NameSuggestion?  @relation("ChosenName", fields: [chosenNameId], references: [id])
  logos        Logo[]
  slogans      Slogan[]
  signatures   Signature[]
  brandKits    BrandKit[]
  jobs         GenerationJob[]
  comments     Comment[]

  @@index([workspaceId, status])
}

model Brief {
  id          String      @id @default(uuid())
  projectId   String      @unique
  sector      String
  mission     String      @db.VarChar(500)
  values      String[]
  audience    String?
  languages   String[]    @default(["fr"])
  nameStyles  NameStyle[]
  maxLength   Int?
  mustInclude String[]
  mustAvoid   String[]
  tone        String?
  updatedAt   DateTime    @updatedAt
  project     Project     @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

// ─── Contenus générés ───
model NameSuggestion {
  id            String              @id @default(uuid())
  projectId     String
  jobId         String?
  value         String
  acronym       String?
  meaning       String
  style         NameStyle
  pronunciation String?
  score         Int?
  isFavorite    Boolean             @default(false)
  isRejected    Boolean             @default(false)
  createdAt     DateTime            @default(now())
  project       Project             @relation("ProjectNames", fields: [projectId], references: [id], onDelete: Cascade)
  chosenFor     Project?            @relation("ChosenName")
  job           GenerationJob?      @relation(fields: [jobId], references: [id])
  checks        AvailabilityCheck[]
  votes         NameVote[]

  @@unique([projectId, value])
}

model AvailabilityCheck {
  id        String         @id @default(uuid())
  nameId    String
  kind      CheckKind
  target    String         // ex. "monasso.org", "instagram"
  status    CheckStatus
  details   Json?
  checkedAt DateTime       @default(now())
  name      NameSuggestion @relation(fields: [nameId], references: [id], onDelete: Cascade)

  @@index([nameId, kind])
}

model NameVote {
  nameId String
  userId String
  value  Int            // +1 ou -1
  name   NameSuggestion @relation(fields: [nameId], references: [id], onDelete: Cascade)

  @@id([nameId, userId])
}

model Logo {
  id          String         @id @default(uuid())
  projectId   String
  jobId       String?
  type        LogoType
  engine      LogoEngine
  style       String
  isFavorite  Boolean        @default(false)
  isExclusive Boolean        @default(false) // vrai après achat
  phash       String?        // empreinte perceptuelle
  createdAt   DateTime       @default(now())
  project     Project        @relation(fields: [projectId], references: [id], onDelete: Cascade)
  job         GenerationJob? @relation(fields: [jobId], references: [id])
  versions    LogoVersion[]

  @@index([phash])
}

model LogoVersion {
  id        String   @id @default(uuid())
  logoId    String
  number    Int
  label     String?
  spec      Json     // texte, police, couleurs, icône, disposition
  svg       String   // source SVG
  createdAt DateTime @default(now())
  logo      Logo     @relation(fields: [logoId], references: [id], onDelete: Cascade)

  @@unique([logoId, number])
}

model Slogan {
  id         String   @id @default(uuid())
  projectId  String
  text       String
  kind       String   @default("SLOGAN") // SLOGAN | DEVISE | MISSION
  tone       String?
  isFavorite Boolean  @default(false)
  isChosen   Boolean  @default(false)
  createdAt  DateTime @default(now())
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
}

model Signature {
  id         String          @id @default(uuid())
  projectId  String
  kind       SignatureKind
  status     SignatureStatus @default(ACTIVE)
  templateId String?
  data       Json            // champs saisis
  html       String?         // signature e-mail
  fileKey    String?         // paraphe ou cachet (stockage objet privé)
  isPrivate  Boolean         @default(true)
  attestedAt DateTime?       // « je suis habilité »
  createdAt  DateTime        @default(now())
  project    Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  template   Template?       @relation(fields: [templateId], references: [id])
}

model BrandKit {
  id                String    @id @default(uuid())
  projectId         String
  version           Int
  palette           Json      // [{ hex, rgb, cmyk, role }]
  fonts             Json
  logoVersionId     String?
  sloganId          String?
  guidePdfKey       String?
  zipKey            String?
  shareToken        String?   @unique
  sharePasswordHash String?
  shareExpiresAt    DateTime?
  createdAt         DateTime  @default(now())
  project           Project   @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, version])
}

// ─── Génération et bibliothèque ───
model GenerationJob {
  id            String           @id @default(uuid())
  projectId     String
  kind          JobKind
  status        JobStatus        @default(QUEUED)
  input         Json
  provider      String?
  promptVersion String?
  costCredits   Int
  costUsdMicros Int?             // coût IA réel
  error         String?
  startedAt     DateTime?
  finishedAt    DateTime?
  createdAt     DateTime         @default(now())
  project       Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  names         NameSuggestion[]
  logos         Logo[]

  @@index([status, createdAt])
}

model Asset {
  id         String       @id @default(uuid())
  kind       AssetKind
  name       String
  storageKey String       @unique
  mimeType   String
  sizeBytes  Int
  license    LicenseKind?
  tags       String[]
  isActive   Boolean      @default(true)
  createdAt  DateTime     @default(now())

  @@index([kind, isActive])
}

model Template {
  id         String      @id @default(uuid())
  kind       String      // EMAIL_SIGNATURE | STAMP | BRAND_GUIDE
  name       String
  content    Json
  isActive   Boolean     @default(true)
  signatures Signature[]
}

model BlockedTerm {
  id       String @id @default(uuid())
  term     String
  language String
  scope    String // NAME | SLOGAN | STAMP

  @@unique([term, language, scope])
}

// ─── Facturation ───
model Plan {
  id             String         @id @default(uuid())
  code           String         @unique // FREE, PACK, ASSOCIATION, PRO, AGENCY
  name           String
  priceGnf       BigInt
  interval       String?        // null = paiement unique, "month", "year"
  monthlyCredits Int            @default(0)
  maxMembers     Int            @default(1)
  features       Json
  isActive       Boolean        @default(true)
  subscriptions  Subscription[]
}

model Subscription {
  id                String             @id @default(uuid())
  workspaceId       String             @unique
  planId            String
  status            SubscriptionStatus
  currentPeriodEnd  DateTime
  cancelAtPeriodEnd Boolean            @default(false)
  workspace         Workspace          @relation(fields: [workspaceId], references: [id])
  plan              Plan               @relation(fields: [planId], references: [id])
}

model Payment {
  id             String          @id @default(uuid())
  workspaceId    String
  provider       PaymentProvider
  providerRef    String?         @unique
  idempotencyKey String          @unique
  amountGnf      BigInt
  status         PaymentStatus   @default(PENDING)
  planCode       String?
  creditsGranted Int?
  raw            Json?           // réponse brute du prestataire
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt
  workspace      Workspace       @relation(fields: [workspaceId], references: [id])
  invoice        Invoice?
}

model Invoice {
  id        String   @id @default(uuid())
  paymentId String   @unique
  number    String   @unique // ex. FAC-2026-000123
  amountGnf BigInt
  taxGnf    BigInt   @default(0)
  pdfKey    String
  issuedAt  DateTime @default(now())
  payment   Payment  @relation(fields: [paymentId], references: [id])
}

model CreditLedgerEntry {
  id          String       @id @default(uuid())
  workspaceId String
  delta       Int          // positif = crédit, négatif = débit
  reason      LedgerReason
  jobId       String?
  paymentId   String?
  actorId     String?
  note        String?
  createdAt   DateTime     @default(now())
  workspace   Workspace    @relation(fields: [workspaceId], references: [id])

  @@index([workspaceId, createdAt])
}

model AssociationProof {
  id           String    @id @default(uuid())
  workspaceId  String
  fileKey      String    // justificatif (stockage privé)
  status       String    @default("PENDING") // PENDING | APPROVED | REJECTED
  reviewNote   String?
  reviewedById String?
  createdAt    DateTime  @default(now())
  reviewedAt   DateTime?
  workspace    Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
}

// ─── Suivi ───
model Comment {
  id         String   @id @default(uuid())
  projectId  String
  authorId   String
  targetType String   // NAME | LOGO | SIGNATURE | SLOGAN
  targetId   String
  body       String
  createdAt  DateTime @default(now())
  project    Project  @relation(fields: [projectId], references: [id], onDelete: Cascade)
  author     User     @relation(fields: [authorId], references: [id])
}

model Notification {
  id        String    @id @default(uuid())
  userId    String
  type      String
  payload   Json
  readAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt])
}

model AuditLog {
  id         String   @id @default(uuid())
  actorId    String?
  action     String   // ex. "credits.adjust"
  entityType String
  entityId   String
  before     Json?
  after      Json?
  ip         String?
  createdAt  DateTime @default(now())
  actor      User?    @relation(fields: [actorId], references: [id])

  @@index([entityType, entityId])
}
```

### 12.1 Règles de données

- Identifiants UUID partout ; suppression logique (`deletedAt`) pour les utilisateurs et les projets.
- Le solde `creditBalance` est mis à jour dans la même transaction que l'écriture du grand livre ; un contrôle nocturne recalcule le solde depuis le grand livre.
- Les montants en GNF sont stockés en `BigInt`, sans décimales.
- Les migrations passent par `prisma migrate` ; un script de seed charge offres, modèles, polices et icônes de départ.
- Selon la version de Prisma retenue, l'URL de connexion peut devoir être déclarée dans `prisma.config.ts` plutôt que dans le schéma.

## 13. API REST

L'API NestJS est servie sous `/api/v1`, documentée en OpenAPI à `/api/docs`. Les générations IA sont asynchrones : l'appel répond `202 Accepted` avec un `jobId`, suivi en temps réel par Server-Sent Events.

### 13.1 Conventions

- JSON en entrée et sortie ; validation par DTO (`class-validator`) ; erreurs au format `application/problem+json` (RFC 7807).
- Pagination par curseur : `?cursor=<id>&limit=20` (100 maximum).
- En-tête `Idempotency-Key` obligatoire sur les générations et les paiements.
- Limitation de débit : 60 requêtes par minute par utilisateur, 10 par minute sur les routes d'authentification.
- Accès : **Public**, **Connecté**, **Lecteur / Éditeur / Propriétaire** (rôle dans l'espace), **Admin** (rôle plateforme).

### 13.2 Authentification et compte

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `POST /auth/register` | Public | Créer un compte e-mail |
| `POST /auth/login` | Public | Connexion, renvoie un jeton d'accès + cookie de rafraîchissement |
| `POST /auth/refresh` | Public (cookie) | Renouveler le jeton d'accès, rotation du jeton de rafraîchissement |
| `POST /auth/logout` | Connecté | Révoquer la session |
| `POST /auth/google` | Public | Connexion Google |
| `POST /auth/otp/request` · `POST /auth/otp/verify` | Public | Connexion par code SMS |
| `POST /auth/password/forgot` · `POST /auth/password/reset` | Public | Mot de passe oublié |
| `POST /auth/2fa/setup` · `POST /auth/2fa/verify` | Connecté | Double authentification TOTP |
| `GET /me` · `PATCH /me` · `DELETE /me` | Connecté | Profil, suppression du compte |
| `GET /me/export` | Connecté | Export des données personnelles (ZIP) |

### 13.3 Espaces, membres et projets

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `GET /workspaces` · `POST /workspaces` | Connecté | Lister, créer un espace |
| `GET /workspaces/:wid` · `PATCH /workspaces/:wid` | Lecteur · Propriétaire | Détail, modification |
| `GET /workspaces/:wid/members` | Lecteur | Membres |
| `PATCH /workspaces/:wid/members/:uid` · `DELETE …` | Propriétaire | Changer un rôle, retirer un membre |
| `POST /workspaces/:wid/invitations` | Propriétaire | Inviter par e-mail ou créer un lien |
| `POST /invitations/:token/accept` | Connecté | Accepter une invitation |
| `GET /workspaces/:wid/projects` · `POST …` | Lecteur · Éditeur | Lister (filtres type, statut), créer |
| `GET /projects/:pid` · `PATCH /projects/:pid` | Lecteur · Éditeur | Détail, modification |
| `DELETE /projects/:pid` · `POST /projects/:pid/restore` | Propriétaire | Corbeille, restauration |
| `POST /projects/:pid/duplicate` | Éditeur | Dupliquer |
| `PUT /projects/:pid/brief` | Éditeur | Enregistrer le brief |

### 13.4 Noms

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `POST /projects/:pid/names/generate` | Éditeur | Lancer un lot (202 + jobId), avec retour optionnel |
| `GET /projects/:pid/names` | Lecteur | Lister (filtres favoris, rejetés) |
| `PATCH /names/:nid` | Éditeur | Favori, rejet |
| `POST /names/:nid/checks` | Éditeur | Lancer les vérifications de disponibilité |
| `POST /names/:nid/votes` | Lecteur | Voter |
| `POST /projects/:pid/chosen-name` | Éditeur | Retenir le nom final |
| `POST /public/names/try` | Public | Essai sans compte (3 par jour et par IP) |

### 13.5 Logos

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `POST /projects/:pid/logos/generate` | Éditeur | Lancer un lot, moteur A ou B |
| `POST /projects/:pid/logos/import` | Éditeur | Importer un logo existant |
| `GET /projects/:pid/logos` · `GET /logos/:lid` | Lecteur | Lister, détail |
| `GET /logos/:lid/versions` · `POST /logos/:lid/versions` | Lecteur · Éditeur | Historique, enregistrer une édition |
| `POST /logos/:lid/variants` | Éditeur | Produire les variantes automatiques |
| `POST /logos/:lid/export` | Éditeur | Exporter (formats, tailles, pack icônes) |

### 13.6 Slogans et signatures

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `POST /projects/:pid/slogans/generate` | Éditeur | Lancer un lot de slogans ou de devises |
| `GET /projects/:pid/slogans` · `PATCH /slogans/:sid` | Lecteur · Éditeur | Lister, favori, choix |
| `POST /projects/:pid/signatures` | Éditeur | Créer une signature EMAIL, HANDWRITTEN ou STAMP |
| `GET /signatures/:sid` · `PATCH /signatures/:sid` | Lecteur · Éditeur | Détail, modification |
| `GET /signatures/:sid/html` | Lecteur | HTML et texte brut de la signature e-mail |
| `GET /signatures/:sid/file` | Éditeur | URL signée du paraphe ou du cachet |
| `POST /projects/:pid/signatures/batch` | Éditeur | Signatures e-mail en lot depuis un CSV |
| `POST /public/email-signature` | Public | Signature e-mail sans compte |

### 13.7 Kit de marque, tâches et bibliothèque

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `POST /projects/:pid/brand-kits` · `GET …` | Éditeur · Lecteur | Créer une version du kit, lister |
| `POST /brand-kits/:kid/guide` · `POST /brand-kits/:kid/zip` | Éditeur | Générer charte PDF, archive ZIP |
| `POST /brand-kits/:kid/share` | Éditeur | Créer ou révoquer le lien de partage |
| `GET /public/kits/:token` | Public | Page publique du kit |
| `GET /jobs/:jid` · `GET /jobs/:jid/events` (SSE) | Lecteur | État et progression d'une tâche |
| `GET /library/icons?q=` · `GET /library/fonts` · `GET /library/templates?kind=` | Connecté | Bibliothèque graphique |
| `GET /projects/:pid/comments` · `POST …` | Lecteur | Commentaires |
| `GET /notifications` · `PATCH /notifications/:id/read` | Connecté | Notifications |

### 13.8 Facturation

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `GET /plans` | Public | Offres actives |
| `GET /workspaces/:wid/credits` · `GET /workspaces/:wid/ledger` | Propriétaire | Solde, historique des crédits |
| `POST /workspaces/:wid/checkout` | Propriétaire | Lancer un paiement (offre ou pack, moyen, numéro mobile money) |
| `POST /workspaces/:wid/promo` | Propriétaire | Appliquer un code promo |
| `POST /workspaces/:wid/association-proof` | Propriétaire | Envoyer le justificatif d'association |
| `POST /workspaces/:wid/subscription/cancel` | Propriétaire | Résilier à la fin de la période |
| `GET /workspaces/:wid/invoices` · `GET /invoices/:id/pdf` | Propriétaire | Factures |
| `POST /webhooks/payments/:provider` | Public (signature vérifiée) | Notification du prestataire de paiement |

### 13.9 Administration

| Méthode et route | Accès | Rôle |
| --- | --- | --- |
| `GET /admin/stats` | Support | Indicateurs du tableau de bord |
| `GET /admin/users` · `PATCH /admin/users/:uid` | Support · Admin | Recherche, suspension, reset 2FA |
| `POST /admin/credits/adjust` | Admin | Ajustement de crédits motivé |
| `POST /admin/payments/:id/refund` | Admin | Remboursement |
| `GET /admin/association-proofs` · `PATCH …/:id` | Admin | Valider ou refuser un tarif association |
| `GET /admin/moderation` · `PATCH /admin/signatures/:sid/review` | Support | Contenus signalés, cachets à valider |
| `/admin/assets` · `/admin/templates` · `/admin/blocked-terms` (CRUD) | Admin | Bibliothèque, modèles, liste noire |
| `/admin/plans` · `/admin/prompts` · `/admin/settings` (CRUD) | Super admin | Offres, prompts IA, paramètres |
| `GET /admin/audit-logs` | Super admin | Journal d'audit |

## 14. Sécurité, propriété intellectuelle et conformité

Trois risques dominent : le vol de compte ou de crédits, l'usage frauduleux de cachets et paraphes, et les litiges sur la propriété des logos. Les mesures ci-dessous sont toutes obligatoires en V1.

### 14.1 Sécurité applicative

| Domaine | Mesure |
| --- | --- |
| Mots de passe | Hachage argon2id ; 8 caractères minimum ; vérification contre les mots de passe compromis connus |
| Sessions | Jeton d'accès JWT de 15 min ; jeton de rafraîchissement de 30 jours en cookie httpOnly, Secure, SameSite=Strict ; rotation et détection de réutilisation |
| Double authentification | TOTP, obligatoire pour les rôles internes ; codes de secours à usage unique |
| Transport et en-têtes | HTTPS (TLS 1.2+), HSTS, Helmet côté NestJS, Content-Security-Policy stricte côté Next.js, CORS limité au domaine du front |
| Entrées | DTO avec `whitelist` et `forbidNonWhitelisted` ; requêtes Prisma paramétrées (pas de SQL brut non paramétré) |
| SVG importés ou générés | Nettoyage systématique : suppression des scripts, gestionnaires d'événements, liens externes et `foreignObject` (risque XSS) |
| Fichiers envoyés | Type vérifié par signature binaire, 5 Mo maximum, analyse antivirus (ClamAV) |
| Abus | Limitation de débit Redis ; CAPTCHA sur inscription et routes publiques ; quotas par IP pour les essais gratuits |
| Stockage | Compartiments privés, URL signées de 15 min, sauvegardes chiffrées |
| Secrets | Variables d'environnement ou gestionnaire de secrets ; clés IA et paiement uniquement côté serveur |
| Paiements | Signature des webhooks vérifiée, idempotence, aucun crédit accordé sans confirmation du prestataire |
| IA | Le brief est traité comme une donnée, jamais comme une instruction ; sortie validée par schéma (zod) ; modération avant affichage |
| Contrôle | Revue OWASP Top 10, analyse des dépendances (npm audit, Dependabot), test d'intrusion avant le lancement |

### 14.2 Propriété intellectuelle

- À l'achat, les CGU cèdent à l'utilisateur les droits d'usage commercial du logo, dans la limite des licences des polices et icônes utilisées.
- Chaque export contient un fichier LICENCES.txt listant chaque police et icône avec sa licence.
- La protection par le droit d'auteur d'une création générée par IA reste incertaine ; la plateforme recommande un dépôt de marque auprès de l'OAPI pour sécuriser nom et logo.
- Les noms de marques célèbres sont filtrés dans les briefs et les résultats ; un formulaire permet de signaler une contrefaçon.
- Les CGU, la politique de remboursement et la cession de droits doivent être relues par un juriste avant le lancement.

### 14.3 Données personnelles

- Conformité à la [loi guinéenne L/2016/037/AN relative à la cybersécurité et à la protection des données à caractère personnel](https://www.dlapiperdataprotection.com/?c=GN&t=law) ; respect du RGPD pour les utilisateurs situés dans l'Union européenne.
- Politique de confidentialité, consentement aux cookies non essentiels, registre des traitements.
- Droits d'accès, de rectification, de suppression et d'export depuis le profil (`GET /me/export`, `DELETE /me`).
- Durées de conservation : comptes supprimés purgés après 30 jours ; factures conservées selon l'obligation comptable ; journaux techniques 90 jours.
- Les briefs ne sont pas utilisés pour entraîner des modèles ; les fournisseurs IA sont choisis avec une option de non-rétention des données.

## 15. Planning, recette et risques

La V1 se livre en 19 semaines et 8 phases : une bêta fermée gratuite démarre à la fin de la semaine 13, le lancement public avec paiement à la fin de la semaine 19.

&#91;embedded content: planning · 8 phases, 19 semaines, 2 jalons\]

Les phases jusqu'aux signatures forment le MVP testé en bêta ; le kit complet, les paiements et la sécurisation finale viennent ensuite.

### 15.1 Livrables par phase

| Phase | Livrables | Fin de phase validée quand… |
| --- | --- | --- |
| 0. Cadrage et maquettes | Maquettes des écrans, prompts testés, coût IA mesuré par lot, choix des prestataires IA et paiement | Maquettes et coûts approuvés |
| 1. Socle technique | Monorepo, CI/CD, authentification, espaces, projets, back-office minimal, environnement de recette | Un utilisateur crée un compte et un projet en recette |
| 2. Générateur de noms | Brief, génération, vérifications, favoris, choix du nom | Exigences NOM « Doit » couvertes |
| 3. Générateur de logos | Moteur A, éditeur, variantes, exports, pack icônes | Exigences LOGO « Doit » couvertes |
| 4. Signatures | Slogans, signature e-mail, paraphe, cachet, règles de sécurité | Exigences SIG « Doit » couvertes ; bêta ouverte à 20 testeurs |
| 5. Kit et collaboration | Page kit, charte PDF, ZIP, partage, invitations, notifications | Kit complet téléchargeable |
| 6. Paiements et offres | Orange Money, crédits, abonnements, factures, codes promo | Paiement réel validé de bout en bout |
| 7. Recette et lancement | Corrections bêta, test d'intrusion, optimisation, CGU, mise en production | Critères de recette 15.2 tous cochés |

### 15.2 Critères de recette

- [ ] Les 6 étapes du parcours complet (section 2.1) passent en test E2E sur mobile Android et sur ordinateur.
- [ ] Lot de 10 noms en moins de 10 s et lot de 8 logos en moins de 15 s, au 95e percentile sur 100 essais.
- [ ] Les SVG exportés s'ouvrent sans erreur dans Inkscape, Illustrator et un navigateur, texte converti en tracés.
- [ ] La signature e-mail s'affiche correctement dans Gmail, Outlook et Apple Mail.
- [ ] Un paiement Orange Money réussi crédite l'espace une seule fois, même si le webhook arrive deux fois.
- [ ] Une génération échouée rembourse automatiquement les crédits.
- [ ] Un cachet contenant « République » passe en validation manuelle.
- [ ] Un Lecteur ne peut ni générer ni modifier (tests des guards).
- [ ] Test d'intrusion : aucune faille critique ou haute non corrigée.
- [ ] Score Lighthouse mobile d'au moins 90 en performance et en accessibilité sur la page d'accueil.

### 15.3 Risques principaux

| Risque | Impact | Parade |
| --- | --- | --- |
| Coût des API IA supérieur au prix de vente | Marge négative | Mesurer le coût par lot en phase 0, calibrer les crédits, moteur A par défaut, cache |
| Intégration mobile money lente | Lancement payant retardé | Contacter opérateur ou agrégateur dès la phase 0 ; bêta gratuite en attendant |
| Logos jugés trop génériques | Faible conversion | Bibliothèque riche, styles locaux, moteur B, éditeur complet |
| Usage frauduleux de cachets | Risque juridique et d'image | Filtre des termes officiels, validation manuelle, attestation, journal d'audit |
| Vérifications réseaux sociaux bloquées | Information incomplète | Résultats marqués indicatifs, cache, lien de vérification manuelle |
| Connexions lentes des utilisateurs | Abandons | PWA, pages légères, aperçus SVG, génération asynchrone |

### 15.4 Questions ouvertes

- Nom définitif de la plateforme.
- Prix en GNF de chaque offre et du pack de crédits.
- Agrégateur mobile money et prestataire carte retenus.
- Fournisseurs IA principaux (texte et image) et budget mensuel alloué.
- Hébergement : option managée ou VPS.
- Structure juridique éditrice (facturation, taxe applicable).
