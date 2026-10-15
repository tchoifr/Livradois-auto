# Back-office Livradois Automobiles

Tableau de bord privé pour gérer les annonces du site (mise en ligne, réservation, vente)
et suivre les demandes et offres envoyées par les clients.

- **Hébergement :** hébergement web OVH (PHP 8.1 ou plus + MySQL).
- **Site public :** reste sur GitHub Pages ; il lit les annonces via `api.php` et y envoie les demandes.

## Contenu

| Élément | Rôle |
| --- | --- |
| `index.html`, `assets/` | Interface du dashboard |
| `api.php` | API (annonces publiques, demandes, routes d'administration) |
| `lib/` | Code PHP (inaccessible depuis le web) |
| `setup.php` | Installation : crée les tables et le premier compte |
| `uploads/vehicules/` | Photos envoyées depuis le dashboard |
| `config.example.php` | Modèle de configuration |

## Installation sur OVH

1. **Copier** le dossier `backoffice/` sur l'hébergement (FTP/SFTP), par exemple dans `www/backoffice/`.
2. **Configurer** : copier `config.example.php` en `config.local.php` sur le serveur et renseigner :
   - les identifiants de la base MySQL (espace client OVH → Hébergement → Bases de données) ;
   - `backoffice_url` : l'adresse publique du dossier, ex. `https://www.mondomaine.fr/backoffice` ;
   - `setup_key` : une longue clé aléatoire (32 caractères ou plus).
   `config.local.php` n'est jamais versionné et le `.htaccess` en bloque l'accès depuis le web.
3. **Installer** : ouvrir `https://…/backoffice/setup.php`, saisir la clé, créer le compte
   administrateur (mot de passe de 12 caractères minimum). Cocher « Importer les annonces de
   démonstration » pour partir du stock actuel du site.
4. **Supprimer `setup.php`** du serveur (il est de toute façon bloqué dès qu'un compte existe).
5. **Brancher le site** : dans `js/config.js` du dépôt, indiquer
   `api: "https://…/backoffice/api.php"`, puis publier. Le site lit alors les annonces depuis la base,
   et les formulaires « Réserver / Essai / Faire une offre… » enregistrent les demandes dans le dashboard.
6. Si le site est servi depuis une autre adresse que celles listées dans `allowed_origins`
   (`config.local.php`), l'y ajouter.

## Sécurité

- Mots de passe hachés (Argon2id, sinon bcrypt), jamais stockés en clair.
- Cookie de session `HttpOnly`, `Secure`, `SameSite=Strict`, régénéré à la connexion ;
  déconnexion après 2 h d'inactivité (12 h maximum).
- Jeton CSRF exigé pour toute modification.
- 5 tentatives de connexion par compte et 20 par adresse IP toutes les 15 minutes.
- HTTPS forcé, en-têtes de sécurité (CSP, anti-iframe…), dossiers `lib/` et `seed/` interdits,
  aucun script exécutable dans `uploads/`.
- Photos vérifiées (JPG/PNG/WebP réels), recadrées et réencodées en WebP.
- Formulaire public : champ anti-robots et limite de 6 demandes par heure et par adresse IP.

## Test en local (sans OVH)

```sh
# config.local.php avec une base SQLite : 'db' => ['dsn' => 'sqlite:/chemin/test.sqlite']
php setup.php admin@exemple.fr "MotDePasseSolide-2026" --demo
php -S localhost:8766
```
