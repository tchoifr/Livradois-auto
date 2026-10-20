<?php
declare(strict_types=1);

/** Demandes clients et offres envoyées depuis le site, rattachées aux fiches clients avec validation humaine. */
final class Requests
{
    public const TYPES = [
        'reservation' => 'Réservation',
        'essai' => 'Demande d\'essai',
        'offre' => 'Offre de prix',
        'reprise' => 'Reprise de véhicule',
        'financement' => 'Financement',
        'alerte' => 'Alerte disponibilité',
        'question' => 'Question',
    ];
    public const STATUTS = ['nouvelle', 'en_cours', 'acceptee', 'refusee', 'traitee'];

    /** Enregistre une demande publique (formulaire de la fiche véhicule). */
    public static function create(array $in): array
    {
        // Champ piège anti-robots : rempli uniquement par les robots
        if (!empty($in['website'])) {
            return ['ok' => true];
        }
        if (Http::tooMany('demande', 6, 3600)) {
            Http::fail(429, 'Trop de demandes envoyées. Merci de nous appeler au 04 73 95 85 46.');
        }

        $type = array_key_exists($in['type'] ?? '', self::TYPES) ? $in['type'] : 'question';
        $nom = mb_substr(trim((string) ($in['nom'] ?? '')), 0, 120);
        $tel = mb_substr(trim((string) ($in['tel'] ?? '')), 0, 40);
        $email = mb_substr(trim((string) ($in['email'] ?? '')), 0, 190);
        $message = mb_substr(trim((string) ($in['message'] ?? '')), 0, 3000);
        $montant = isset($in['montant']) && $in['montant'] !== '' ? (int) $in['montant'] : null;

        if ($nom === '' || strlen(preg_replace('/\D/', '', $tel)) < 10) {
            Http::fail(422, 'Merci d\'indiquer votre nom et un numéro de téléphone valide.');
        }
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Http::fail(422, 'Adresse e-mail invalide.');
        }
        if ($type === 'offre' && ($montant === null || $montant < 100 || $montant > 10_000_000)) {
            Http::fail(422, 'Merci d\'indiquer le montant de votre offre.');
        }
        if ($type !== 'offre') {
            $montant = null;
        }

        $vehicule = null;
        if (!empty($in['vehiculeId']) && is_string($in['vehiculeId'])) {
            $vehicule = Vehicles::findBySlug($in['vehiculeId']);
        }
        $titre = $vehicule ? trim("{$vehicule['marque']} {$vehicule['modele']} {$vehicule['version']}") . " (réf. {$vehicule['ref']})" : '';

        // Client existant probable (même téléphone ou e-mail) : proposé, jamais associé automatiquement
        $dups = Clients::duplicates($tel, $email);
        $id = Db::insert('la_demandes', [
            'vehicule_id' => $vehicule ? (int) $vehicule['id'] : null,
            'vehicule_titre' => mb_substr($titre, 0, 200),
            'type' => $type,
            'nom' => $nom,
            'tel' => $tel,
            'email' => $email,
            'message' => $message,
            'montant' => $montant,
            'statut' => 'nouvelle',
            'ip' => Http::ip(),
            'client_suggere_id' => count($dups) === 1 ? $dups[0]['id'] : null,
            'created_at' => Db::now(),
            'updated_at' => Db::now(),
        ]);
        Http::record('demande', (string) $id);
        Notifications::demandeSite($id);
        return ['ok' => true, 'id' => $id];
    }

    public static function list(array $user, array $q): array
    {
        [$scope, $params] = Access::scope($user, 'v.parc_id', true);
        $where = ['1 = 1' . $scope];
        if (!empty($q['vehicule'])) {
            $where[] = 'd.vehicule_id = ?';
            $params[] = (int) $q['vehicule'];
        }
        if (!empty($q['client'])) {
            $where[] = 'd.client_id = ?';
            $params[] = (int) $q['client'];
        }
        if (!empty($q['type']) && array_key_exists($q['type'], self::TYPES)) {
            $where[] = 'd.type = ?';
            $params[] = $q['type'];
        }
        if (!empty($q['statut']) && in_array($q['statut'], self::STATUTS, true)) {
            $where[] = 'd.statut = ?';
            $params[] = $q['statut'];
        }
        $sql = 'SELECT d.*, v.slug, v.marque, v.modele, v.prix, v.photos, v.statut AS vehicule_statut, v.numero_stock,
                c.nom AS client_nom, c.prenom AS client_prenom, s.nom AS sugg_nom, s.prenom AS sugg_prenom, s.telephone AS sugg_tel
            FROM la_demandes d LEFT JOIN la_vehicules v ON v.id = d.vehicule_id
            LEFT JOIN la_clients c ON c.id = d.client_id LEFT JOIN la_clients s ON s.id = d.client_suggere_id
            WHERE ' . implode(' AND ', $where) . ' ORDER BY d.created_at DESC, d.id DESC LIMIT 500';
        return array_map(function ($r) {
            $photos = json_decode($r['photos'] ?: '[]', true) ?: [];
            return [
                'id' => (int) $r['id'],
                'type' => $r['type'],
                'statut' => $r['statut'],
                'nom' => $r['nom'],
                'tel' => $r['tel'],
                'email' => $r['email'],
                'message' => $r['message'],
                'montant' => $r['montant'] !== null ? (int) $r['montant'] : null,
                'createdAt' => $r['created_at'],
                'vehicule' => $r['vehicule_id'] ? [
                    'dbId' => (int) $r['vehicule_id'],
                    'slug' => $r['slug'],
                    'titre' => $r['marque'] ? "{$r['marque']} {$r['modele']}" : $r['vehicule_titre'],
                    'numeroStock' => $r['numero_stock'],
                    'prix' => $r['prix'] !== null ? (int) $r['prix'] : null,
                    'photo' => $photos[0] ?? null,
                    'statut' => $r['vehicule_statut'],
                    'supprime' => $r['marque'] === null,
                ] : null,
                'vehiculeTitre' => $r['vehicule_titre'],
                'client' => $r['client_id'] ? ['id' => (int) $r['client_id'], 'nom' => trim(($r['client_prenom'] ?? '') . ' ' . $r['client_nom'])] : null,
                'clientSuggere' => !$r['client_id'] && $r['client_suggere_id'] ? ['id' => (int) $r['client_suggere_id'], 'nom' => trim(($r['sugg_prenom'] ?? '') . ' ' . $r['sugg_nom']), 'telephone' => $r['sugg_tel']] : null,
            ];
        }, Db::all($sql, $params));
    }

    private static function load(array $user, int $id): array
    {
        $d = Db::one('SELECT d.*, v.parc_id FROM la_demandes d LEFT JOIN la_vehicules v ON v.id = d.vehicule_id WHERE d.id = ?', [$id]);
        if (!$d) {
            Http::fail(404, 'Demande introuvable.');
        }
        if ($d['vehicule_id'] !== null) {
            Access::requireParc($user, $d['parc_id'] !== null ? (int) $d['parc_id'] : null);
        }
        return $d;
    }

    /** Rattache la demande à un client existant (validation humaine) ou crée la fiche à partir de la demande. */
    public static function associer(array $user, array $in): array
    {
        Access::require($user, 'clients.gerer');
        $d = self::load($user, (int) ($in['id'] ?? 0));
        if (!empty($in['clientId'])) {
            $cid = (int) $in['clientId'];
            if (!Db::value('SELECT COUNT(*) FROM la_clients WHERE id = ? AND actif = 1', [$cid])) {
                Http::fail(422, 'Client introuvable.');
            }
        } else {
            $parts = preg_split('/\s+/', trim($d['nom']), 2);
            $cid = Clients::save($user, [
                'nom' => count($parts) === 2 ? $parts[1] : $parts[0], 'prenom' => count($parts) === 2 ? $parts[0] : '',
                'telephone' => $d['tel'], 'email' => $d['email'], 'preference' => $d['email'] !== '' ? 'email' : 'telephone',
                'serviceEmail' => $d['email'] !== '', 'confirmerDoublon' => !empty($in['confirmerDoublon']),
            ])['id'];
        }
        Db::exec('UPDATE la_demandes SET client_id = ?, client_suggere_id = NULL, updated_at = ? WHERE id = ?', [$cid, Db::now(), (int) $d['id']]);
        Clients::history($user, $cid, 'demande_site', (self::TYPES[$d['type']] ?? $d['type']) . ($d['vehicule_titre'] ? ' — ' . $d['vehicule_titre'] : '')
            . ($d['montant'] ? ' — offre ' . number_format((int) $d['montant'], 0, ',', ' ') . ' €' : '') . ($d['message'] ? ' : ' . mb_substr((string) $d['message'], 0, 200) : ''),
            ['vehicule_id' => $d['vehicule_id'] !== null ? (int) $d['vehicule_id'] : null, 'demande_id' => (int) $d['id']], $d['created_at']);
        Audit::log($user, 'demande.associer', 'demande', (int) $d['id'], null, ['client_id' => $cid]);
        return ['ok' => true, 'clientId' => $cid];
    }

    public static function setStatut(array $user, int $id, string $statut): void
    {
        Access::require($user, 'demandes.gerer');
        if (!in_array($statut, self::STATUTS, true)) {
            Http::fail(422, 'Statut invalide.');
        }
        $d = self::load($user, $id);
        Db::exec('UPDATE la_demandes SET statut = ?, updated_at = ? WHERE id = ?', [$statut, Db::now(), $id]);
        Audit::log($user, 'demande.statut', 'demande', $id, ['statut' => $d['statut']], ['statut' => $statut]);
    }

    public static function delete(array $user, int $id): void
    {
        Access::require($user, 'demandes.supprimer');
        self::load($user, $id);
        Db::exec('DELETE FROM la_demandes WHERE id = ?', [$id]);
        Audit::log($user, 'demande.supprimer', 'demande', $id);
    }

    /** Compteurs courts (menu et notifications du dashboard). */
    public static function stats(array $user): array
    {
        [$scope, $p] = Access::scope($user, 'v.parc_id', true);
        [$vs, $vp] = Access::scope($user, 'parc_id');
        $count = fn($sql, $params = []) => (int) Db::value($sql, $params);
        return [
            'enLigne' => $count("SELECT COUNT(*) FROM la_vehicules WHERE statut = 'disponible'$vs", $vp),
            'reserves' => $count("SELECT COUNT(*) FROM la_vehicules WHERE statut = 'reserve'$vs", $vp),
            'brouillons' => $count("SELECT COUNT(*) FROM la_vehicules WHERE statut = 'brouillon'$vs", $vp),
            'vendus' => $count("SELECT COUNT(*) FROM la_vehicules WHERE statut IN ('vendu', 'livre')$vs", $vp),
            'demandesNouvelles' => $count("SELECT COUNT(*) FROM la_demandes d LEFT JOIN la_vehicules v ON v.id = d.vehicule_id WHERE d.statut = 'nouvelle'$scope", $p),
            'offresOuvertes' => $count("SELECT COUNT(*) FROM la_demandes d LEFT JOIN la_vehicules v ON v.id = d.vehicule_id WHERE d.type = 'offre' AND d.statut IN ('nouvelle', 'en_cours')$scope", $p),
            'rdvAujourdhui' => $count("SELECT COUNT(*) FROM la_rendez_vous r WHERE r.statut IN ('en_attente', 'confirme') AND r.start_at >= ? AND r.start_at < ?" . Access::scope($user, 'r.parc_id')[0],
                array_merge([date('Y-m-d 00:00:00'), date('Y-m-d 00:00:00', strtotime('+1 day'))], Access::scope($user, 'r.parc_id')[1])),
            'messagesEchec' => Notifications::stats($user)['echecs'],
            'diffusionActions' => Diffusion::actions($user, null, 0)['total'],
        ];
    }
}
