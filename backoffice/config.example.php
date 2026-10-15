<?php
/*
 * Modèle de configuration du back-office.
 * Copiez ce fichier en « config.local.php » sur le serveur et remplissez-le.
 * config.local.php n'est jamais versionné (voir .gitignore) et n'est pas accessible depuis le web (.htaccess).
 */
return [
    // Base MySQL OVH (Hébergement > Bases de données)
    'db' => [
        'dsn' => 'mysql:host=NOM_BASE.mysql.db;dbname=NOM_BASE;charset=utf8mb4',
        'user' => 'NOM_UTILISATEUR',
        'pass' => 'MOT_DE_PASSE',
    ],

    // Adresse publique de ce dossier (sans « / » final) — sert aux URL des photos
    'backoffice_url' => 'https://www.exemple.fr/backoffice',

    // Adresse du site public (aperçu des annonces depuis le dashboard)
    'site_url' => 'https://tchoifr.github.io/Livradois-auto/',

    // Sites autorisés à lire les annonces et envoyer des demandes
    'allowed_origins' => [
        'https://tchoifr.github.io',
        'https://livradois-automobiles.netlify.app',
    ],

    // Notification e-mail à chaque nouvelle demande (laisser vide pour désactiver)
    'notify_email' => 'livradois.automobiles@gmail.com',
    'mail_from' => 'Site Livradois Automobiles <no-reply@exemple.fr>',

    // Clé demandée par setup.php pour créer le premier compte (32 caractères aléatoires minimum)
    'setup_key' => 'CHANGER_MOI_AVEC_UNE_LONGUE_CLE_ALEATOIRE',
];
