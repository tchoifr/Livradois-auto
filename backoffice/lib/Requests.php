<?php
declare(strict_types=1);

/** Demandes clients et offres envoyées depuis le site. */
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
            'created_at' => Db::now(),
            'updated_at' => Db::now(),
        ]);
        Http::record('demande', (string) $id);
        self::notify($type, $nom, $tel, $email, $message, $montant, $titre);
        return ['ok' => true, 'id' => $id];
    }

    /** Prévient le garage par e-mail (fonction mail() de l'hébergement OVH). */
    private static function notify(string $type, string $nom, string $tel, string $email, string $message, ?int $montant, string $titre): void
    {
        $to = cfg('notify_email');
        if (!$to || !function_exists('mail')) {
            return;
        }
        $clean = fn($s) => str_replace(["\r", "\n"], ' ', $s);
        $subject = '=?UTF-8?B?' . base64_encode('Nouvelle demande : ' . self::TYPES[$type] . ($titre ? ' – ' . $titre : '')) . '?=';
        $body = "Nouvelle demande reçue sur le site Livradois Automobiles\n\n"
            . 'Type : ' . self::TYPES[$type] . "\n"
            . ($titre ? "Véhicule : $titre\n" : '')
            . ($montant ? 'Offre : ' . number_format($montant, 0, ',', ' ') . " €\n" : '')
            . "Nom : $nom\nTéléphone : $tel\n" . ($email ? "E-mail : $email\n" : '')
            . "\nMessage :\n$message\n\n— Gérer les demandes : " . cfg('site_url', '') . "admin/#/demandes\n";
        $headers = "Content-Type: text/plain; charset=UTF-8\r\n";
        $from = cfg('mail_from');
        if ($from) {
            $headers .= 'From: ' . $clean($from) . "\r\n";
        }
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $headers .= 'Reply-To: ' . $clean($email) . "\r\n";
        }
        @mail($to, $subject, $body, $headers);
    }

    public static function list(array $q): array
    {
        $where = [];
        $params = [];
        if (!empty($q['vehicule'])) {
            $where[] = 'd.vehicule_id = ?';
            $params[] = (int) $q['vehicule'];
        }
        if (!empty($q['type']) && array_key_exists($q['type'], self::TYPES)) {
            $where[] = 'd.type = ?';
            $params[] = $q['type'];
        }
        if (!empty($q['statut']) && in_array($q['statut'], self::STATUTS, true)) {
            $where[] = 'd.statut = ?';
            $params[] = $q['statut'];
        }
        $sql = 'SELECT d.*, v.slug, v.marque, v.modele, v.prix, v.photos, v.statut AS vehicule_statut
            FROM la_demandes d LEFT JOIN la_vehicules v ON v.id = d.vehicule_id'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
            . ' ORDER BY d.created_at DESC, d.id DESC LIMIT 500';
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
                    'prix' => $r['prix'] !== null ? (int) $r['prix'] : null,
                    'photo' => $photos[0] ?? null,
                    'statut' => $r['vehicule_statut'],
                    'supprime' => $r['marque'] === null,
                ] : null,
                'vehiculeTitre' => $r['vehicule_titre'],
            ];
        }, Db::all($sql, $params));
    }

    public static function setStatut(int $id, string $statut): void
    {
        if (!in_array($statut, self::STATUTS, true)) {
            Http::fail(422, 'Statut invalide.');
        }
        if (!Db::exec('UPDATE la_demandes SET statut = ?, updated_at = ? WHERE id = ?', [$statut, Db::now(), $id])) {
            Http::fail(404, 'Demande introuvable.');
        }
    }

    public static function delete(int $id): void
    {
        Db::exec('DELETE FROM la_demandes WHERE id = ?', [$id]);
    }

    public static function stats(): array
    {
        $count = fn($sql, $p = []) => (int) Db::value($sql, $p);
        return [
            'enLigne' => $count("SELECT COUNT(*) FROM la_vehicules WHERE statut = 'disponible'"),
            'reserves' => $count("SELECT COUNT(*) FROM la_vehicules WHERE statut = 'reserve'"),
            'brouillons' => $count("SELECT COUNT(*) FROM la_vehicules WHERE statut = 'brouillon'"),
            'vendus' => $count("SELECT COUNT(*) FROM la_vehicules WHERE statut = 'vendu'"),
            'valeurStock' => $count("SELECT COALESCE(SUM(prix), 0) FROM la_vehicules WHERE statut IN ('disponible', 'reserve')"),
            'demandesNouvelles' => $count("SELECT COUNT(*) FROM la_demandes WHERE statut = 'nouvelle'"),
            'offresOuvertes' => $count("SELECT COUNT(*) FROM la_demandes WHERE type = 'offre' AND statut IN ('nouvelle', 'en_cours')"),
            'annoncesAvecOffres' => $count("SELECT COUNT(DISTINCT vehicule_id) FROM la_demandes WHERE type = 'offre' AND statut IN ('nouvelle', 'en_cours') AND vehicule_id IS NOT NULL"),
            'demandes30j' => $count('SELECT COUNT(*) FROM la_demandes WHERE created_at >= ?', [date('Y-m-d H:i:s', time() - 86400 * 30)]),
        ];
    }
}
