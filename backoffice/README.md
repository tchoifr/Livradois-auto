# Back-office Livradois Automobiles

| Élément | Où | Adresse |
| --- | --- | --- |
| Site public | GitHub Pages | https://tchoifr.github.io/Livradois-auto/ |
| **Dashboard** (`admin/`) | GitHub Pages | https://tchoifr.github.io/Livradois-auto/admin/ |
| Démonstration (données fictives) | GitHub Pages | https://tchoifr.github.io/Livradois-auto/admin/?demo=1 |
| **API** (`backoffice/`, PHP 8 + MySQL) | Hébergement OVH `byhnex.com`, dossier `livradois-api` | https://livradois-api.byhnex.com |

Le dashboard et le site sont des pages statiques ; ils appellent l'API, seule à accéder à la base MySQL
(une base OVH `*.mysql.db` n'est joignable que depuis l'hébergement). L'adresse de l'API se règle dans
`js/config.js` (champ `api`).

## Fonctions

Planning (jour, semaine, mois, liste) et prise de rendez-vous par téléphone ; véhicules multi-parcs (n° de stock,
immatriculation, VIN, emplacement, transferts tracés) ; préparation **non mécanique** (nettoyage, photos,
documents, vérification administrative, « prêt pour les rendez-vous ») ; contrôle technique (date, résultat,
échéance vérifiée sur le procès-verbal, alertes) ; documents privés ; clients et historique de contact ;
demandes du site rattachées aux fiches clients avec validation humaine ; messages (confirmation, rappels
24 h / 2 h, modification, annulation) avec file d'envoi, nouvelles tentatives et relance manuelle ; ventes,
paiements, coûts et marge de gestion estimée, rapports et export CSV ; diffusion des annonces (site, Leboncoin,
La Centrale) ; journal d'audit.

**Aucune double réservation** : chaque création ou déplacement de rendez-vous est vérifié par le serveur dans une
transaction, le véhicule verrouillé (intervalle `[début, fin[`). En cas de conflit, l'API répond `409` avec les
rendez-vous en cause.

### Rôles (vérifiés par le serveur à chaque action)

| | Propriétaire | Secrétaire référente | Secrétaire |
| --- | :-: | :-: | :-: |
| Planning, clients, messages, demandes, préparation, CT, documents | ✓ | ✓ | ✓ |
| Annonces, photos, statut, transfert entre parcs | ✓ | ✓ | |
| Diffusion : consulter l'état des annonces | ✓ | ✓ | ✓ |
| Diffusion : publier, mettre à jour, retirer, adapter | ✓ | ✓ | |
| Ventes, paiements, finances, rapports | ✓ | | |
| Comptes de diffusion (abonnements, accès API) | ✓ | | |
| Parcs, comptes, paramètres, journal, suppression, export / anonymisation client | ✓ | | |

Les secrétaires ne voient que les parcs qui leur sont affectés (**Équipe & accès**). Un compte nominatif par
personne : chaque action est tracée au nom de son auteur.

## Contenu de `backoffice/`

| Élément | Rôle |
| --- | --- |
| `api.php` | API : annonces publiques, demandes/offres, routes du dashboard |
| `lib/` | Code PHP (inaccessible depuis le web) |
| `setup.php` | Migrations versionnées ; création du premier compte ; `--demo-db` reconstruit la démonstration |
| `bin/worker.php` | Envoi des messages dus et opérations de diffusion en attente — à lancer par une tâche planifiée |
| `bin/backup.php` | Sauvegarde SQL compressée (30 conservées) |
| `settings.php` | Réglages non secrets versionnés (vide) ; `settings.local.php` est écrit par le déploiement |
| `uploads/vehicules/` | Photos des annonces (publiques) |
| `config.example.php` | Modèle de `config.local.php` (mots de passe, uniquement sur le serveur) |

Les documents (cartes grises, procès-verbaux, factures), les sauvegardes et la base de démonstration sont rangés
**hors du dossier web**, dans `livradois-prive/` à côté de `livradois-api/` (réglage `private_dir`).

Tables préfixées `la_`, montants en centimes, dates au fuseau Europe/Paris. Les migrations (`la_migrations`)
s'appliquent une seule fois et ne modifient jamais les annonces existantes.

## Messages et mode test

Tous les e-mails (clients et alertes « nouvelle demande » au garage) passent par une seule fonction d'envoi.
Tant que le réglage `mail_redirect` contient une adresse, **aucun client ne reçoit rien** : tout part vers cette
adresse, avec le destinataire prévu dans l'objet (`[TEST → client@…]`).

- Valeur fixée au déploiement par le secret GitHub `MAIL_REDIRECT` (environnement `production`).
  Pour passer en envoi réel : secret `MAIL_REDIRECT` = `aucune`, puis relancer le workflow
  — ou vider le champ dans **Paramètres → E-mails et contact** (le réglage du dashboard l'emporte).
- SMS : aucun prestataire configuré ; les clients qui préfèrent le SMS reçoivent un e-mail s'ils l'acceptent.
- Rappels automatiques : ils partent dès qu'une page du dashboard est ouverte. Pour qu'ils partent aussi la nuit
  et le week-end, créer une tâche planifiée OVH (toutes les 15 min) lançant `bin/worker.php` du dossier de l'API.

## Diffusion des annonces

La fiche du véhicule reste la référence ; chaque canal (site, Leboncoin, La Centrale, autres sites ajoutés) a sa
propre publication : statut, lien, référence, expiration, prix publié, adaptation du titre / texte / photos (sans
modifier la fiche), historique horodaté avec son auteur.

- **Site du garage** : publication directe (statut « en ligne » du véhicule).
- **Leboncoin, La Centrale** : **publication assistée**. Aucune de ces plateformes ne propose d'API publique de
  publication ; la diffusion automatique est réservée aux professionnels abonnés, avec des accès et une
  documentation remis par la plateforme. Le dashboard prépare l'annonce (texte et photos à copier, lien de dépôt),
  l'utilisateur publie sur la plateforme puis enregistre le lien : rien n'est affiché « publié » sans cette
  confirmation.
- **Synchronisation** : prix, texte ou photos modifiés → annonces « à mettre à jour » ; véhicule vendu, livré ou
  retiré → « à retirer » (vente annulée → conservées) ; parution dépassée → « à renouveler ». Ces actions
  apparaissent dans **À faire** du tableau de bord et dans **Diffusion**.
- **Comptes de diffusion** (propriétaire) : abonnement déclaré (offre, date de fin) et accès API remis par la
  plateforme (OAuth 2.0 identifiant / secret client, ou clé d'API). Jamais le mot de passe du compte. Les accès
  sont chiffrés sur le serveur (AES-256-GCM, ou XChaCha20-Poly1305 si openssl est absent ; clé `diffusion_key`
  facultative, sinon dérivée des accès à la base) et ne sont jamais renvoyés au navigateur. « Tester la connexion »
  fait un vrai appel, uniquement si l'abonnement est actif, uniquement en https vers un domaine officiel de la
  plateforme (adresses internes refusées, pas de redirection).
- **Publication en 1 clic** : bouton « Publier » dans chaque case du tableau **Diffusion** et sur la fiche. Pour
  Leboncoin / La Centrale, il ne fonctionne que si les trois étapes sont remplies, dans cet ordre : abonnement pro
  actif → compte connecté (test réussi) → API de publication renseignée d'après la documentation remise avec
  l'abonnement (adresse et méthode de création / modification / retrait, modèle JSON de l'annonce avec des
  variables `{{titre}}`, `{{prix}}`, `{{photos}}`…, chemin de la référence dans la réponse ; « Aperçu de l'envoi »
  montre le JSON sans rien envoyer). Sinon une fenêtre indique l'étape manquante et propose la publication assistée.
- **Réponses des plateformes** : création confirmée seulement avec une référence d'annonce ; refus (400 / 422,
  motif affiché, annonce « Refusée ») ; offre payante requise (402, ou 403 mentionnant l'abonnement) ; limite de
  l'offre atteinte (quota) ; accès expirés (401 : jeton renouvelé une fois, puis compte à reconnecter) ; trop de
  demandes ou panne (429, 5xx : nouvel essai automatique). Chaque cas a son message et son action (voir les offres,
  reconnecter, adapter l'annonce, réessayer) et apparaît dans **À faire**.
- **Publication automatique** : chaque plateforme a un connecteur (`ConnecteurDiffusion` dans
  `lib/Diffusion.php`) qui déclare ses opérations (publier, modifier, retirer). Les envois passent par une file
  (`la_diffusion_taches`) : une seule opération par version de l'annonce, nouveaux essais après 5, 15 puis 60 min
  en cas de panne passagère, statut « erreur » avec le message de la plateforme sinon. Aucun connecteur Leboncoin
  ou La Centrale n'est livré : il sera écrit à partir de leur documentation officielle quand l'abonnement pro
  donnera accès à leur API. La plateforme fictive `bac_a_sable` n'existe que pour les tests automatiques
  (réglage `diffusion_bac_a_sable`, jamais en production).

## Mise en route (une seule fois)

1. **OVH → Hébergement → Multisite → Ajouter un domaine** : sous-domaine `livradois-api.byhnex.com`,
   dossier racine `livradois-api`, SSL activé.
2. **Déposer `config.local.php`** dans `livradois-api/` (FileZilla). Ce fichier contient les accès MySQL
   et la clé d'installation ; il n'est jamais versionné ni écrasé par le déploiement.
3. **GitHub → environnement `production`** : secrets `OVH_SSH_HOST`, `OVH_SSH_USER`, `OVH_SSH_KEY`,
   `MAIL_REDIRECT` ; variables `OVH_API_DIR`, `API_URL`, `OVH_KNOWN_HOSTS`, et `OVH_DEPLOY_ENABLED=true`
   au niveau du dépôt.
4. **Créer le compte** : `php setup.php email@exemple.fr` en SSH (mot de passe demandé), ou
   `https://livradois-api.byhnex.com/setup.php` avec la clé `setup_key`.

## Déploiement

Chaque push sur `main` touchant `backoffice/`, `tests/` ou le workflow lance **Actions → « Déployer l'API du
back-office »** :

1. **Tests** sur MySQL 8.4 + PHP 8.2 : migration depuis une base existante, sauvegarde, démonstration, puis
   la suite `tests/api.test.mjs` (droits, parcs, double réservation, messages, finances, démonstration…).
2. **Déploiement** seulement si tout passe : copie dans un dossier intermédiaire, **sauvegarde de la base**,
   migrations, reconstruction de la démonstration, puis bascule des fichiers et contrôles de santé.

## Sécurité

- Connexion par e-mail + mot de passe haché (Argon2id, sinon bcrypt), 12 caractères minimum.
- Jeton de session aléatoire de 256 bits, envoyé dans l'en-tête `X-LA-Token` et gardé seulement le temps
  de l'onglet (`sessionStorage`) ; la base ne stocke que son empreinte SHA-256. Pas de cookie, donc pas de CSRF.
- Expiration après 2 h d'inactivité (12 h maximum) ; déconnexion, désactivation du compte et changement de mot de
  passe révoquent les jetons.
- 5 tentatives de connexion par compte et 20 par adresse IP toutes les 15 minutes.
- API accessible uniquement depuis les origines listées (`allowed_origins`), HTTPS forcé, en-têtes de sécurité,
  CSP sur le dashboard, dossiers `lib/`, `bin/` et `seed/` interdits, aucun script exécutable dans `uploads/`.
- Photos et documents vérifiés par leur contenu réel ; documents servis uniquement aux personnes autorisées.
- Démonstration : base SQLite séparée, remise à zéro chaque jour ; un jeton de démo n'ouvre jamais la base réelle.
- Formulaire public : champ anti-robots et 6 demandes maximum par heure et par adresse IP.

## Test en local

```sh
# config.local.php avec SQLite : 'db' => ['dsn' => 'sqlite:/chemin/test.sqlite'],
# 'allowed_origins' => ['http://localhost:8765'], 'private_dir' => '/chemin/prive'
php setup.php admin@exemple.fr "MotDePasseSolide-2026" --demo
php -S localhost:8766
API=http://localhost:8766/api.php ADMIN_EMAIL=admin@exemple.fr ADMIN_PASSWORD="MotDePasseSolide-2026" \
  BO_DIR=backoffice PHP_BIN=php node tests/api.test.mjs
```
