<?php
/*
 * Modèle de configuration de l'API du back-office.
 * Sur le serveur, ce fichier est copié en « config.local.php » et rempli.
 * config.local.php n'est jamais versionné (voir .gitignore), jamais écrasé par le déploiement,
 * et inaccessible depuis le web (.htaccess).
 */
return [
    // Base MySQL OVH (Hébergement > Bases de données)
    'db' => [
        'dsn' => 'mysql:host=NOM_BASE.mysql.db;dbname=NOM_BASE;charset=utf8mb4',
        'user' => 'NOM_UTILISATEUR',
        'pass' => 'MOT_DE_PASSE',
    ],

    // Adresse publique de ce dossier sur OVH (sans « / » final) — sert aux URL des photos
    'backoffice_url' => 'https://livradois-api.byhnex.com',

    // Adresse du site public ; le dashboard est à site_url + « admin/ »
    'site_url' => 'https://tchoifr.github.io/Livradois-auto/',

    // Origines autorisées à appeler l'API (site + dashboard)
    'allowed_origins' => [
        'https://tchoifr.github.io',
        'https://livradois-automobiles.netlify.app',
    ],

    // Notification e-mail à chaque nouvelle demande (laisser vide pour désactiver)
    'notify_email' => 'livradois.automobiles@gmail.com',
    'mail_from' => 'Site Livradois Automobiles <no-reply@byhnex.com>',

    // Clé demandée par setup.php pour créer le premier compte (32 caractères aléatoires minimum).
    // À vider une fois le compte créé.
    'setup_key' => 'CHANGER_MOI_AVEC_UNE_LONGUE_CLE_ALEATOIRE',
];
