# Back-office Livradois Automobiles

| Élément | Où | Adresse |
| --- | --- | --- |
| Site public | GitHub Pages | https://tchoifr.github.io/Livradois-auto/ |
| **Dashboard** (`admin/`) | GitHub Pages | https://tchoifr.github.io/Livradois-auto/admin/ |
| **API** (`backoffice/`, PHP 8 + MySQL) | Hébergement OVH `byhnex.com`, dossier `livradois-api` | https://livradois-api.byhnex.com |

Le dashboard et le site sont des pages statiques ; ils appellent l'API, seule à accéder à la base MySQL
(une base OVH `*.mysql.db` n'est joignable que depuis l'hébergement). L'adresse de l'API se règle dans
`js/config.js` (champ `api`).

## Contenu de `backoffice/`

| Élément | Rôle |
| --- | --- |
| `api.php` | API : annonces publiques, demandes/offres, routes du dashboard |
| `lib/` | Code PHP (inaccessible depuis le web) |
| `setup.php` | Crée les tables ; en navigateur, crée le premier compte (clé `setup_key`) |
| `uploads/vehicules/` | Photos envoyées depuis le dashboard |
| `config.example.php` | Modèle de `config.local.php` (mots de passe, uniquement sur le serveur) |

Les tables sont préfixées `la_` (`la_admins`, `la_sessions`, `la_vehicules`, `la_demandes`, `la_events`).

## Mise en route (une seule fois)

1. **OVH → Hébergement → Multisite → Ajouter un domaine** : sous-domaine `livradois-api.byhnex.com`,
   dossier racine `livradois-api`, SSL activé.
2. **Déposer `config.local.php`** dans `livradois-api/` (FileZilla). Ce fichier contient les accès MySQL
   et la clé d'installation ; il n'est jamais versionné ni écrasé par le déploiement.
3. **GitHub → environnement `production`** : secrets `OVH_SSH_HOST`, `OVH_SSH_USER`, `OVH_SSH_KEY`
   (clé privée SSH autorisée sur l'hébergement) ; variables `OVH_API_DIR`, `API_URL`, `OVH_KNOWN_HOSTS`.
4. **Actions → « Déployer l'API du back-office » → Run workflow** : envoi de l'API, création des tables,
   contrôle que l'API répond.
5. **Créer le compte** : ouvrir `https://livradois-api.byhnex.com/setup.php`, saisir la clé `setup_key`
   de `config.local.php`, l'e-mail et le mot de passe (12 caractères minimum). Cocher « Importer les annonces
   de démonstration » pour partir du stock actuel. Vider ensuite `setup_key` dans `config.local.php`.
6. **Relier le site** : `js/config.js` → `api: "https://livradois-api.byhnex.com/api.php"`, puis publier.

Mises à jour suivantes : relancer simplement le workflow (étape 4).

## Sécurité

- Connexion par e-mail + mot de passe haché (Argon2id, sinon bcrypt).
- Jeton de session aléatoire de 256 bits, envoyé dans l'en-tête `X-LA-Token` et gardé seulement le temps
  de l'onglet (`sessionStorage`) ; la base ne stocke que son empreinte SHA-256. Pas de cookie, donc pas de CSRF.
- Expiration après 2 h d'inactivité (12 h maximum) ; déconnexion et changement de mot de passe révoquent les jetons.
- 5 tentatives de connexion par compte et 20 par adresse IP toutes les 15 minutes.
- API accessible uniquement depuis les origines listées (`allowed_origins`), HTTPS forcé, en-têtes de sécurité,
  CSP sur le dashboard, dossiers `lib/` et `seed/` interdits, aucun script exécutable dans `uploads/`.
- Photos vérifiées (JPG/PNG/WebP réels), recadrées et réencodées en WebP.
- Formulaire public : champ anti-robots et 6 demandes maximum par heure et par adresse IP.

## Test en local

```sh
# config.local.php avec SQLite : 'db' => ['dsn' => 'sqlite:/chemin/test.sqlite'],
# 'allowed_origins' => ['http://localhost:8765']
php setup.php admin@exemple.fr "MotDePasseSolide-2026" --demo
php -S localhost:8766
```
