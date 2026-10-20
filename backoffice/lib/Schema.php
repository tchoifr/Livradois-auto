<?php
declare(strict_types=1);

/**
 * Migrations versionnées et relançables (table la_migrations).
 * Règle : ne jamais modifier une migration déjà déployée ; en ajouter une nouvelle.
 * Aucune migration ne supprime de données.
 */
final class Schema
{
    /** v1 : schéma initial (annonces, demandes, comptes, sessions). */
    private const V1 = [
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

    /** v2 : parcs, rôles, clients, rendez-vous, préparation, documents, finance, messages, audit. */
    private const V2 = [
        'la_parcs' => '
            id {ID},
            code VARCHAR(20) NOT NULL UNIQUE,
            nom VARCHAR(120) NOT NULL,
            adresse VARCHAR(255) NOT NULL DEFAULT \'\',
            telephone VARCHAR(40) NOT NULL DEFAULT \'\',
            notes TEXT NULL,
            actif SMALLINT NOT NULL DEFAULT 1,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL',
        'la_admin_parcs' => '
            id {ID},
            admin_id INT NOT NULL,
            parc_id INT NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT \'\',
            assigned_at DATETIME NOT NULL,
            removed_at DATETIME NULL{UNQ:uq_admin_parc:admin_id, parc_id}',
        'la_parc_mouvements' => '
            id {ID},
            vehicule_id INT NOT NULL,
            parc_source_id INT NULL,
            parc_destination_id INT NOT NULL,
            effectue_par INT NULL,
            effectue_le DATETIME NOT NULL,
            commentaire VARCHAR(500) NOT NULL DEFAULT \'\'{IDX:idx_mouvements_vehicule:vehicule_id}',
        'la_clients' => '
            id {ID},
            nom VARCHAR(120) NOT NULL,
            prenom VARCHAR(80) NOT NULL DEFAULT \'\',
            telephone VARCHAR(40) NOT NULL DEFAULT \'\',
            telephone_norm VARCHAR(20) NOT NULL DEFAULT \'\',
            email VARCHAR(190) NOT NULL DEFAULT \'\',
            email_norm VARCHAR(190) NOT NULL DEFAULT \'\',
            preference_contact VARCHAR(12) NOT NULL DEFAULT \'telephone\',
            service_email SMALLINT NOT NULL DEFAULT 1,
            service_sms SMALLINT NOT NULL DEFAULT 0,
            marketing SMALLINT NOT NULL DEFAULT 0,
            prefs_source VARCHAR(40) NOT NULL DEFAULT \'\',
            prefs_maj_le DATETIME NULL,
            notes TEXT NULL,
            actif SMALLINT NOT NULL DEFAULT 1,
            created_by INT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL{IDX:idx_clients_tel:telephone_norm}{IDX:idx_clients_email:email_norm}',
        'la_rendez_vous' => '
            id {ID},
            vehicule_id INT NOT NULL,
            client_id INT NULL,
            parc_id INT NULL,
            created_by INT NULL,
            assigned_to INT NULL,
            motif VARCHAR(30) NOT NULL,
            start_at DATETIME NOT NULL,
            end_at DATETIME NOT NULL,
            statut VARCHAR(20) NOT NULL DEFAULT \'confirme\',
            notes TEXT NULL,
            annule_le DATETIME NULL,
            annule_par INT NULL,
            motif_annulation VARCHAR(255) NOT NULL DEFAULT \'\',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL{IDX:idx_rdv_vehicule:vehicule_id, start_at}{IDX:idx_rdv_start:start_at}{IDX:idx_rdv_client:client_id}',
        'la_checklist_items' => '
            id {ID},
            code VARCHAR(40) NOT NULL UNIQUE,
            libelle VARCHAR(120) NOT NULL,
            categorie VARCHAR(20) NOT NULL DEFAULT \'preparation\',
            obligatoire SMALLINT NOT NULL DEFAULT 1,
            actif SMALLINT NOT NULL DEFAULT 1,
            ordre SMALLINT NOT NULL DEFAULT 0',
        'la_vehicule_checklist' => '
            id {ID},
            vehicule_id INT NOT NULL,
            item_id INT NOT NULL,
            statut VARCHAR(20) NOT NULL DEFAULT \'a_faire\',
            responsable_id INT NULL,
            echeance DATE NULL,
            completed_at DATETIME NULL,
            commentaire VARCHAR(500) NOT NULL DEFAULT \'\',
            updated_by INT NULL,
            updated_at DATETIME NOT NULL{UNQ:uq_vehicule_item:vehicule_id, item_id}',
        'la_documents' => '
            id {ID},
            vehicule_id INT NULL,
            client_id INT NULL,
            vente_id INT NULL,
            type VARCHAR(40) NOT NULL,
            nom_fichier VARCHAR(200) NOT NULL,
            chemin VARCHAR(255) NOT NULL,
            mime VARCHAR(80) NOT NULL,
            taille INT NOT NULL,
            uploaded_by INT NULL,
            created_at DATETIME NOT NULL,
            supprime_le DATETIME NULL{IDX:idx_documents_vehicule:vehicule_id}',
        'la_finance_entries' => '
            id {ID},
            vehicule_id INT NOT NULL,
            type VARCHAR(20) NOT NULL,
            categorie VARCHAR(30) NOT NULL DEFAULT \'\',
            libelle VARCHAR(200) NOT NULL DEFAULT \'\',
            montant_centimes BIGINT NOT NULL,
            montant_ht_centimes BIGINT NULL,
            date_operation DATE NOT NULL,
            reference VARCHAR(80) NOT NULL DEFAULT \'\',
            tiers VARCHAR(120) NOT NULL DEFAULT \'\',
            statut_paiement VARCHAR(20) NOT NULL DEFAULT \'\',
            document_id INT NULL,
            statut VARCHAR(20) NOT NULL DEFAULT \'valide\',
            contre_ecriture_de_id INT NULL,
            cree_par INT NULL,
            created_at DATETIME NOT NULL{IDX:idx_finance_vehicule:vehicule_id}{IDX:idx_finance_date:date_operation}',
        'la_ventes' => '
            id {ID},
            vehicule_id INT NOT NULL,
            client_id INT NULL,
            acheteur VARCHAR(160) NOT NULL DEFAULT \'\',
            statut VARCHAR(20) NOT NULL DEFAULT \'reservee\',
            prix_final_centimes BIGINT NOT NULL DEFAULT 0,
            date_reservation DATE NULL,
            date_limite_reservation DATE NULL,
            date_vente DATE NULL,
            date_livraison DATE NULL,
            reference_document VARCHAR(80) NOT NULL DEFAULT \'\',
            documents_remis VARCHAR(500) NOT NULL DEFAULT \'\',
            responsable_id INT NULL,
            notes TEXT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL{IDX:idx_ventes_vehicule:vehicule_id}',
        'la_paiements' => '
            id {ID},
            vente_id INT NOT NULL,
            type VARCHAR(20) NOT NULL,
            montant_centimes BIGINT NOT NULL,
            date_paiement DATE NOT NULL,
            moyen VARCHAR(20) NOT NULL DEFAULT \'\',
            reference VARCHAR(80) NOT NULL DEFAULT \'\',
            statut VARCHAR(20) NOT NULL DEFAULT \'valide\',
            commentaire VARCHAR(255) NOT NULL DEFAULT \'\',
            document_id INT NULL,
            cree_par INT NULL,
            created_at DATETIME NOT NULL{IDX:idx_paiements_vente:vente_id}',
        'la_notifications' => '
            id {ID},
            rendez_vous_id INT NULL,
            client_id INT NULL,
            vehicule_id INT NULL,
            demande_id INT NULL,
            canal VARCHAR(10) NOT NULL,
            destinataire VARCHAR(190) NOT NULL DEFAULT \'\',
            template VARCHAR(40) NOT NULL,
            sujet VARCHAR(200) NOT NULL DEFAULT \'\',
            contenu TEXT NULL,
            scheduled_at DATETIME NOT NULL,
            statut VARCHAR(20) NOT NULL DEFAULT \'en_attente\',
            claim VARCHAR(40) NOT NULL DEFAULT \'\',
            provider_id VARCHAR(120) NOT NULL DEFAULT \'\',
            attempts SMALLINT NOT NULL DEFAULT 0,
            next_attempt_at DATETIME NULL,
            sent_at DATETIME NULL,
            delivered_at DATETIME NULL,
            last_error VARCHAR(500) NOT NULL DEFAULT \'\',
            dedupe_key VARCHAR(160) NULL UNIQUE,
            created_by INT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL{IDX:idx_notif_due:statut, scheduled_at}{IDX:idx_notif_rdv:rendez_vous_id}',
        'la_contact_history' => '
            id {ID},
            client_id INT NOT NULL,
            vehicule_id INT NULL,
            rendez_vous_id INT NULL,
            demande_id INT NULL,
            actor_id INT NULL,
            type VARCHAR(30) NOT NULL,
            resume VARCHAR(500) NOT NULL DEFAULT \'\',
            occurred_at DATETIME NOT NULL,
            metadata TEXT NULL{IDX:idx_history_client:client_id, occurred_at}',
        'la_audit_log' => '
            id {ID},
            actor_id INT NULL,
            action VARCHAR(60) NOT NULL,
            entity_type VARCHAR(30) NOT NULL,
            entity_id INT NULL,
            avant TEXT NULL,
            apres TEXT NULL,
            ip VARCHAR(64) NOT NULL DEFAULT \'\',
            created_at DATETIME NOT NULL{IDX:idx_audit_entity:entity_type, entity_id}{IDX:idx_audit_date:created_at}',
        'la_settings' => '
            cle VARCHAR(60) NOT NULL PRIMARY KEY,
            valeur TEXT NULL,
            updated_by INT NULL,
            updated_at DATETIME NOT NULL',
    ];

    /**
     * v4 : diffusion multicanale. Une publication par véhicule et par canal (statut propre à chaque plateforme),
     * comptes de diffusion (accès chiffrés), file de tâches pour les connecteurs API, historique des opérations.
     */
    private const V4 = [
        'la_canaux' => '
            id {ID},
            code VARCHAR(40) NOT NULL UNIQUE,
            nom VARCHAR(80) NOT NULL,
            type VARCHAR(20) NOT NULL,
            url_depot VARCHAR(255) NOT NULL DEFAULT \'\',
            actif SMALLINT NOT NULL DEFAULT 1,
            ordre SMALLINT NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL',
        'la_comptes_diffusion' => '
            id {ID},
            canal_id INT NOT NULL UNIQUE,
            abonnement_actif SMALLINT NOT NULL DEFAULT 0,
            abonnement_offre VARCHAR(120) NOT NULL DEFAULT \'\',
            abonnement_fin DATE NULL,
            methode VARCHAR(20) NOT NULL DEFAULT \'\',
            url_jeton VARCHAR(255) NOT NULL DEFAULT \'\',
            url_test VARCHAR(255) NOT NULL DEFAULT \'\',
            entete_cle VARCHAR(40) NOT NULL DEFAULT \'\',
            identifiant VARCHAR(190) NOT NULL DEFAULT \'\',
            secret_chiffre TEXT NULL,
            jeton_chiffre TEXT NULL,
            jeton_expire_le DATETIME NULL,
            statut VARCHAR(20) NOT NULL DEFAULT \'non_connecte\',
            dernier_test_le DATETIME NULL,
            dernier_message VARCHAR(500) NOT NULL DEFAULT \'\',
            connecte_par INT NULL,
            connecte_le DATETIME NULL,
            updated_at DATETIME NOT NULL',
        'la_publications' => '
            id {ID},
            vehicule_id INT NOT NULL,
            canal_id INT NOT NULL,
            mode VARCHAR(10) NOT NULL DEFAULT \'manuel\',
            statut VARCHAR(20) NOT NULL DEFAULT \'non_publie\',
            reference_externe VARCHAR(120) NOT NULL DEFAULT \'\',
            url VARCHAR(500) NOT NULL DEFAULT \'\',
            titre_perso VARCHAR(160) NULL,
            description_perso TEXT NULL,
            photos_perso TEXT NULL,
            empreinte CHAR(40) NOT NULL DEFAULT \'\',
            prix_publie INT NULL,
            publie_le DATETIME NULL,
            expire_le DATE NULL,
            derniere_synchro DATETIME NULL,
            derniere_erreur VARCHAR(500) NOT NULL DEFAULT \'\',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL{UNQ:uq_publication:vehicule_id, canal_id}{IDX:idx_publication_statut:statut}',
        'la_diffusion_taches' => '
            id {ID},
            publication_id INT NOT NULL,
            action VARCHAR(20) NOT NULL,
            statut VARCHAR(20) NOT NULL DEFAULT \'en_attente\',
            claim VARCHAR(40) NOT NULL DEFAULT \'\',
            tentatives SMALLINT NOT NULL DEFAULT 0,
            prochaine_tentative DATETIME NULL,
            derniere_erreur VARCHAR(500) NOT NULL DEFAULT \'\',
            dedupe_key VARCHAR(160) NULL UNIQUE,
            acteur_id INT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL{IDX:idx_diffusion_taches:statut, prochaine_tentative}',
        'la_diffusion_historique' => '
            id {ID},
            vehicule_id INT NULL,
            canal_id INT NULL,
            publication_id INT NULL,
            action VARCHAR(40) NOT NULL,
            resultat VARCHAR(10) NOT NULL,
            message VARCHAR(500) NOT NULL DEFAULT \'\',
            acteur_id INT NULL,
            created_at DATETIME NOT NULL{IDX:idx_diffusion_hist_vehicule:vehicule_id}{IDX:idx_diffusion_hist_date:created_at}',
    ];

    public static function migrate(): array
    {
        self::createTables(['la_migrations' => "version INT NOT NULL PRIMARY KEY,\n applied_at DATETIME NOT NULL"]);
        $done = array_map('intval', array_column(Db::all('SELECT version FROM la_migrations'), 'version'));
        $applied = [];
        foreach ([1, 2, 3, 4, 5] as $v) {
            if (in_array($v, $done, true)) {
                continue;
            }
            self::{'v' . $v}();
            Db::insert('la_migrations', ['version' => $v, 'applied_at' => Db::now()]);
            $applied[] = $v;
        }
        return $applied;
    }

    private static function v1(): void
    {
        self::createTables(self::V1);
    }

    private static function v2(): void
    {
        self::createTables(self::V2);
        // Comptes : rôle, statut actif, téléphone
        self::addColumn('la_admins', 'role', "VARCHAR(20) NOT NULL DEFAULT 'admin'");
        self::addColumn('la_admins', 'actif', 'SMALLINT NOT NULL DEFAULT 1');
        self::addColumn('la_admins', 'telephone', "VARCHAR(40) NOT NULL DEFAULT ''");
        // Véhicules : identification, localisation, préparation, contrôle technique, démo
        self::addColumn('la_vehicules', 'parc_id', 'INT NULL');
        self::addColumn('la_vehicules', 'numero_stock', 'VARCHAR(40) NULL');
        self::addColumn('la_vehicules', 'immatriculation', "VARCHAR(20) NOT NULL DEFAULT ''");
        self::addColumn('la_vehicules', 'vin', "VARCHAR(17) NOT NULL DEFAULT ''");
        self::addColumn('la_vehicules', 'emplacement', "VARCHAR(80) NOT NULL DEFAULT ''");
        self::addColumn('la_vehicules', 'pret_visite', 'SMALLINT NOT NULL DEFAULT 0');
        self::addColumn('la_vehicules', 'pret_verifie_le', 'DATETIME NULL');
        self::addColumn('la_vehicules', 'pret_verifie_par', 'INT NULL');
        self::addColumn('la_vehicules', 'ct_date', 'DATE NULL');
        self::addColumn('la_vehicules', 'ct_resultat', "VARCHAR(20) NOT NULL DEFAULT ''");
        self::addColumn('la_vehicules', 'ct_echeance', 'DATE NULL');
        self::addColumn('la_vehicules', 'ct_echeance_verifiee', 'SMALLINT NOT NULL DEFAULT 0');
        self::addColumn('la_vehicules', 'ct_centre', "VARCHAR(120) NOT NULL DEFAULT ''");
        self::addColumn('la_vehicules', 'ct_cout_centimes', 'BIGINT NULL');
        self::addColumn('la_vehicules', 'ct_document_id', 'INT NULL');
        self::addColumn('la_vehicules', 'demo', 'SMALLINT NOT NULL DEFAULT 0');
        self::addIndex('la_vehicules', 'uq_vehicules_stock', 'numero_stock', true);
        self::addIndex('la_vehicules', 'idx_vehicules_immat', 'immatriculation');
        self::addIndex('la_vehicules', 'idx_vehicules_parc', 'parc_id');
        // Demandes du site : rattachement à un client (avec validation humaine)
        self::addColumn('la_demandes', 'client_id', 'INT NULL');
        self::addColumn('la_demandes', 'client_suggere_id', 'INT NULL');
    }

    /** v3 : données de départ (parc principal, rôles, checklist, numéros de stock, annonces de démonstration). */
    private static function v3(): void
    {
        $now = Db::now();
        if (!Db::value('SELECT COUNT(*) FROM la_parcs')) {
            Db::insert('la_parcs', [
                'code' => 'ARL', 'nom' => 'Parc d\'Arlanc', 'adresse' => '60 route Nationale, 63220 Arlanc',
                'telephone' => '04 73 95 85 46', 'notes' => '', 'actif' => 1, 'created_at' => $now, 'updated_at' => $now,
            ]);
        }
        $parc = (int) Db::value('SELECT MIN(id) FROM la_parcs');
        Db::exec('UPDATE la_vehicules SET parc_id = ? WHERE parc_id IS NULL', [$parc]);
        Db::exec("UPDATE la_vehicules SET numero_stock = ref WHERE (numero_stock IS NULL OR numero_stock = '') AND ref <> ''");
        foreach (Db::all("SELECT id FROM la_vehicules WHERE numero_stock IS NULL OR numero_stock = ''") as $r) {
            Db::exec('UPDATE la_vehicules SET numero_stock = ? WHERE id = ?', ['LA-' . (2400 + (int) $r['id']), (int) $r['id']]);
        }
        Db::exec("UPDATE la_admins SET role = 'admin' WHERE role = '' OR role IS NULL");
        Checklist::seedItems();
        // Annonces importées depuis les exemples du site : marquées « démo » pour pouvoir les retirer d'un clic
        $seed = BO_ROOT . '/seed/vehicules-demo.json';
        if (is_file($seed)) {
            $slugs = array_column(json_decode((string) file_get_contents($seed), true) ?: [], 'id');
            if ($slugs) {
                Db::exec('UPDATE la_vehicules SET demo = 1 WHERE slug IN (' . Db::in($slugs) . ')', $slugs);
            }
        }
    }

    private static function v4(): void
    {
        self::createTables(self::V4);
        $now = Db::now();
        foreach ([
            ['site', 'Site du garage', 'site', '', 0],
            ['leboncoin', 'Leboncoin', 'plateforme', 'https://www.leboncoin.fr/deposer-une-annonce', 1],
            ['lacentrale', 'La Centrale', 'plateforme', 'https://www.lacentrale.fr', 2],
        ] as [$code, $nom, $type, $url, $ordre]) {
            if (!Db::value('SELECT COUNT(*) FROM la_canaux WHERE code = ?', [$code])) {
                Db::insert('la_canaux', ['code' => $code, 'nom' => $nom, 'type' => $type, 'url_depot' => $url, 'actif' => 1, 'ordre' => $ordre, 'created_at' => $now]);
            }
        }
    }

    /** Publication en 1 clic : API de publication de chaque plateforme (configurée d'après sa documentation) et type d'erreur. */
    private static function v5(): void
    {
        foreach ([
            'api_actif' => 'SMALLINT NOT NULL DEFAULT 0',
            'api_methode_creation' => "VARCHAR(10) NOT NULL DEFAULT 'POST'",
            'api_url_creation' => "VARCHAR(255) NOT NULL DEFAULT ''",
            'api_methode_modification' => "VARCHAR(10) NOT NULL DEFAULT 'PUT'",
            'api_url_modification' => "VARCHAR(255) NOT NULL DEFAULT ''",
            'api_methode_retrait' => "VARCHAR(10) NOT NULL DEFAULT 'DELETE'",
            'api_url_retrait' => "VARCHAR(255) NOT NULL DEFAULT ''",
            'api_chemin_reference' => "VARCHAR(80) NOT NULL DEFAULT 'id'",
            'api_chemin_url' => "VARCHAR(80) NOT NULL DEFAULT ''",
            'api_modele' => 'TEXT NULL',
        ] as $col => $def) {
            self::addColumn('la_comptes_diffusion', $col, $def);
        }
        self::addColumn('la_publications', 'erreur_type', "VARCHAR(20) NOT NULL DEFAULT ''");
    }

    public static function hasAdmin(): bool
    {
        try {
            return (int) Db::value('SELECT COUNT(*) FROM la_admins') > 0;
        } catch (PDOException $e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- outils

    private static function createTables(array $tables): void
    {
        $mysql = Db::isMysql();
        foreach ($tables as $table => $body) {
            $indexes = [];
            $body = preg_replace_callback('/\{(IDX|UNQ):([a-z_]+):([^}]+)\}/', function ($m) use ($mysql, &$indexes) {
                if ($mysql) {
                    return ",\n            " . ($m[1] === 'UNQ' ? 'UNIQUE ' : '') . "INDEX {$m[2]} ({$m[3]})";
                }
                $indexes[] = [$m[1] === 'UNQ', $m[2], $m[3]];
                return '';
            }, $body);
            $body = str_replace('{ID}', $mysql ? 'INT UNSIGNED AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT', $body);
            $tail = $mysql ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci' : '';
            Db::pdo()->exec("CREATE TABLE IF NOT EXISTS $table ($body\n)$tail");
            foreach ($indexes as [$unique, $name, $cols]) {
                Db::pdo()->exec('CREATE ' . ($unique ? 'UNIQUE ' : '') . "INDEX IF NOT EXISTS $name ON $table ($cols)");
            }
        }
    }

    private static function columns(string $table): array
    {
        if (Db::isMysql()) {
            return array_column(Db::all('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$table]), 'COLUMN_NAME');
        }
        return array_column(Db::all("PRAGMA table_info($table)"), 'name');
    }

    private static function addColumn(string $table, string $column, string $definition): void
    {
        if (!in_array($column, self::columns($table), true)) {
            Db::pdo()->exec("ALTER TABLE $table ADD COLUMN $column $definition");
        }
    }

    private static function addIndex(string $table, string $name, string $cols, bool $unique = false): void
    {
        if (Db::isMysql()) {
            $exists = Db::value('SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?', [$table, $name]);
            if (!$exists) {
                Db::pdo()->exec('CREATE ' . ($unique ? 'UNIQUE ' : '') . "INDEX $name ON $table ($cols)");
            }
            return;
        }
        Db::pdo()->exec('CREATE ' . ($unique ? 'UNIQUE ' : '') . "INDEX IF NOT EXISTS $name ON $table ($cols)");
    }
}
