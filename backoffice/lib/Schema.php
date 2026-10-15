<?php
declare(strict_types=1);

/** Création des tables (idempotente). */
final class Schema
{
    private const TABLES = [
        'la_admins' => '
            id {ID},
            email VARCHAR(190) NOT NULL UNIQUE,
            name VARCHAR(120) NOT NULL DEFAULT \'\',
            password_hash VARCHAR(255) NOT NULL,
            created_at DATETIME NOT NULL,
            last_login_at DATETIME NULL',
        'la_sessions' => '
            id {ID},
            admin_id INT NOT NULL,
            token_hash CHAR(64) NOT NULL UNIQUE,
            ip VARCHAR(64) NOT NULL DEFAULT \'\',
            user_agent VARCHAR(200) NOT NULL DEFAULT \'\',
            created_at DATETIME NOT NULL,
            last_seen_at DATETIME NOT NULL{IDX:idx_sessions_admin:admin_id}',
        'la_vehicules' => '
            id {ID},
            slug VARCHAR(160) NOT NULL UNIQUE,
            ref VARCHAR(40) NOT NULL DEFAULT \'\',
            statut VARCHAR(20) NOT NULL DEFAULT \'brouillon\',
            marque VARCHAR(80) NOT NULL,
            modele VARCHAR(80) NOT NULL,
            version VARCHAR(160) NOT NULL DEFAULT \'\',
            annee SMALLINT NOT NULL,
            mise_en_circulation VARCHAR(7) NOT NULL DEFAULT \'\',
            km INT NOT NULL DEFAULT 0,
            energie VARCHAR(30) NOT NULL DEFAULT \'\',
            boite VARCHAR(30) NOT NULL DEFAULT \'\',
            carrosserie VARCHAR(30) NOT NULL DEFAULT \'\',
            puissance SMALLINT NULL,
            cv SMALLINT NULL,
            portes SMALLINT NULL,
            places SMALLINT NULL,
            couleur VARCHAR(80) NOT NULL DEFAULT \'\',
            critair SMALLINT NULL,
            premiere_main SMALLINT NOT NULL DEFAULT 0,
            quatre_roues SMALLINT NOT NULL DEFAULT 0,
            autonomie SMALLINT NULL,
            garantie SMALLINT NOT NULL DEFAULT 12,
            prix INT NOT NULL,
            prix_barre INT NULL,
            badge VARCHAR(60) NULL,
            description TEXT NULL,
            equipements TEXT NULL,
            photos TEXT NULL,
            publie_le DATE NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL{IDX:idx_vehicules_statut:statut}',
        'la_demandes' => '
            id {ID},
            vehicule_id INT NULL,
            vehicule_titre VARCHAR(200) NOT NULL DEFAULT \'\',
            type VARCHAR(20) NOT NULL,
            nom VARCHAR(120) NOT NULL,
            tel VARCHAR(40) NOT NULL,
            email VARCHAR(190) NOT NULL DEFAULT \'\',
            message TEXT NULL,
            montant INT NULL,
            statut VARCHAR(20) NOT NULL DEFAULT \'nouvelle\',
            ip VARCHAR(64) NOT NULL DEFAULT \'\',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL{IDX:idx_demandes_vehicule:vehicule_id}{IDX:idx_demandes_statut:statut}',
        'la_events' => '
            id {ID},
            kind VARCHAR(20) NOT NULL,
            ip VARCHAR(64) NOT NULL,
            subject VARCHAR(190) NOT NULL DEFAULT \'\',
            created_at DATETIME NOT NULL{IDX:idx_events_lookup:kind, created_at}',
    ];

    public static function migrate(): void
    {
        $mysql = Db::driver() === 'mysql';
        foreach (self::TABLES as $table => $body) {
            $indexes = [];
            $body = preg_replace_callback('/\{IDX:([a-z_]+):([^}]+)\}/', function ($m) use ($mysql, &$indexes) {
                if ($mysql) {
                    return ",\n            INDEX {$m[1]} ({$m[2]})";
                }
                $indexes[] = [$m[1], $m[2]];
                return '';
            }, $body);
            $body = str_replace('{ID}', $mysql ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT', $body);
            $tail = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
            Db::pdo()->exec("CREATE TABLE IF NOT EXISTS $table ($body\n)$tail");
            foreach ($indexes as [$name, $cols]) {
                Db::pdo()->exec("CREATE INDEX IF NOT EXISTS $name ON $table ($cols)");
            }
        }
    }

    public static function hasAdmin(): bool
    {
        try {
            return (int) Db::value('SELECT COUNT(*) FROM la_admins') > 0;
        } catch (PDOException $e) {
            return false;
        }
    }
}
