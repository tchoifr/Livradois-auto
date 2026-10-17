<?php
declare(strict_types=1);

/** Fiches clients, détection des doublons (validation humaine) et historique de contact. */
final class Clients
{
    public const PREFERENCES = ['telephone' => 'Téléphone', 'email' => 'E-mail', 'sms' => 'SMS', 'aucune' => 'Aucune'];
    public const HISTORY_TYPES = [
        'appel_entrant' => 'Appel entrant', 'appel_sortant' => 'Appel sortant', 'note' => 'Note',
        'rdv_cree' => 'Rendez-vous créé', 'rdv_modifie' => 'Rendez-vous déplacé', 'rdv_annule' => 'Rendez-vous annulé', 'rdv_statut' => 'Rendez-vous mis à jour',
        'email' => 'E-mail envoyé', 'sms' => 'SMS envoyé', 'demande_site' => 'Demande depuis le site',
        'vente' => 'Vente', 'livraison' => 'Livraison', 'retour' => 'Réponse / retour du client',
    ];

    public static function out(array $c): array
    {
        return [
            'id' => (int) $c['id'], 'nom' => $c['nom'], 'prenom' => $c['prenom'], 'nomComplet' => trim($c['prenom'] . ' ' . $c['nom']),
            'telephone' => $c['telephone'], 'email' => $c['email'], 'preference' => $c['preference_contact'],
            'serviceEmail' => (int) $c['service_email'] === 1, 'serviceSms' => (int) $c['service_sms'] === 1, 'marketing' => (int) $c['marketing'] === 1,
            'notes' => (string) $c['notes'], 'actif' => (int) $c['actif'] === 1, 'createdAt' => $c['created_at'],
        ];
    }

    public static function search(array $user, string $q, int $limit = 30): array
    {
        $q = trim($q);
        $params = [];
        $where = 'actif = 1';
        if ($q !== '') {
            $like = '%' . mb_strtolower($q) . '%';
            $digits = preg_replace('/\D/', '', $q);
            $where .= ' AND (LOWER(nom) LIKE ? OR LOWER(prenom) LIKE ? OR email_norm LIKE ?' . (strlen($digits) >= 3 ? ' OR telephone_norm LIKE ?' : '') . ')';
            array_push($params, $like, $like, $like);
            if (strlen($digits) >= 3) {
                $params[] = '%' . In::phoneNorm($digits) . '%';
            }
        }
        $limit = max(1, min(200, $limit));
        return array_map([self::class, 'out'], Db::all("SELECT * FROM la_clients WHERE $where ORDER BY updated_at DESC LIMIT $limit", $params));
    }

    public static function get(array $user, int $id): array
    {
        $c = Db::one('SELECT * FROM la_clients WHERE id = ?', [$id]);
        if (!$c) {
            Http::fail(404, 'Client introuvable.');
        }
        [$scope, $p] = Access::scope($user, 'v.parc_id', true);
        $hist = Db::all("SELECT h.*, a.name AS acteur, v.marque, v.modele, v.numero_stock FROM la_contact_history h
            LEFT JOIN la_admins a ON a.id = h.actor_id LEFT JOIN la_vehicules v ON v.id = h.vehicule_id
            WHERE h.client_id = ?$scope ORDER BY h.occurred_at DESC, h.id DESC LIMIT 300", array_merge([$id], $p));
        [$scopeR, $pr] = Access::scope($user, 'r.parc_id');
        $rdv = Appointments::rows("r.client_id = ?$scopeR", array_merge([$id], $pr), 'r.start_at DESC');
        [$scopeD, $pd] = Access::scope($user, 'v.parc_id', true);
        $dem = Db::all("SELECT d.*, v.marque, v.modele FROM la_demandes d LEFT JOIN la_vehicules v ON v.id = d.vehicule_id WHERE d.client_id = ?$scopeD ORDER BY d.created_at DESC", array_merge([$id], $pd));
        return self::out($c) + [
            'historique' => array_map(fn($h) => [
                'id' => (int) $h['id'], 'type' => $h['type'], 'typeLabel' => self::HISTORY_TYPES[$h['type']] ?? $h['type'],
                'resume' => $h['resume'], 'date' => $h['occurred_at'], 'acteur' => $h['acteur'],
                'vehicule' => $h['vehicule_id'] ? trim(($h['marque'] ?? '') . ' ' . ($h['modele'] ?? '') . ' (' . ($h['numero_stock'] ?? '') . ')') : null,
                'vehiculeId' => $h['vehicule_id'] !== null ? (int) $h['vehicule_id'] : null,
                'rendezVousId' => $h['rendez_vous_id'] !== null ? (int) $h['rendez_vous_id'] : null,
            ], $hist),
            'rendezVous' => $rdv,
            'demandes' => array_map(fn($d) => ['id' => (int) $d['id'], 'type' => $d['type'], 'statut' => $d['statut'], 'date' => $d['created_at'],
                'vehicule' => $d['marque'] ? $d['marque'] . ' ' . $d['modele'] : $d['vehicule_titre'], 'montant' => $d['montant'] !== null ? (int) $d['montant'] : null], $dem),
        ];
    }

    /** Clients existants ayant le même téléphone ou e-mail. */
    public static function duplicates(string $tel, string $email, int $exceptId = 0): array
    {
        $t = In::phoneNorm($tel);
        $e = In::emailNorm($email);
        if (strlen($t) < 9 && $e === '') {
            return [];
        }
        $conds = [];
        $p = [];
        if (strlen($t) >= 9) {
            $conds[] = 'telephone_norm = ?';
            $p[] = $t;
        }
        if ($e !== '') {
            $conds[] = 'email_norm = ?';
            $p[] = $e;
        }
        $p[] = $exceptId;
        return array_map([self::class, 'out'], Db::all('SELECT * FROM la_clients WHERE actif = 1 AND (' . implode(' OR ', $conds) . ') AND id <> ? LIMIT 5', $p));
    }

    public static function save(array $user, array $in): array
    {
        Access::require($user, 'clients.gerer');
        $id = (int) ($in['id'] ?? 0);
        $data = [
            'nom' => In::str($in, 'nom', 120),
            'prenom' => In::str($in, 'prenom', 80),
            'telephone' => In::str($in, 'telephone', 40),
            'email' => In::str($in, 'email', 190),
            'preference_contact' => In::oneOf($in, 'preference', array_keys(self::PREFERENCES), 'telephone', 'préférence de contact'),
            'notes' => In::str($in, 'notes', 2000),
            'updated_at' => Db::now(),
        ];
        if ($data['nom'] === '') {
            Http::fail(422, 'Le nom du client est obligatoire.');
        }
        if ($data['telephone'] === '' && $data['email'] === '') {
            Http::fail(422, 'Indiquez au moins un téléphone ou un e-mail.');
        }
        if ($data['email'] !== '' && !filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            Http::fail(422, 'Adresse e-mail invalide.');
        }
        if ($data['telephone'] !== '' && strlen(In::phoneNorm($data['telephone'])) < 9) {
            Http::fail(422, 'Numéro de téléphone invalide.');
        }
        $data['telephone_norm'] = In::phoneNorm($data['telephone']);
        $data['email_norm'] = In::emailNorm($data['email']);
        // Préférences de messages : service (rendez-vous) distinct du marketing
        $before = $id ? Db::one('SELECT * FROM la_clients WHERE id = ?', [$id]) : null;
        if ($id && !$before) {
            Http::fail(404, 'Client introuvable.');
        }
        foreach (['serviceEmail' => 'service_email', 'serviceSms' => 'service_sms', 'marketing' => 'marketing'] as $k => $col) {
            if (array_key_exists($k, $in)) {
                $data[$col] = In::bool($in, $k);
            }
        }
        if ($before === null || array_intersect_key($data, ['service_email' => 1, 'service_sms' => 1, 'marketing' => 1]) != array_intersect_key($before, ['service_email' => 1, 'service_sms' => 1, 'marketing' => 1])) {
            $data['prefs_source'] = 'dashboard';
            $data['prefs_maj_le'] = Db::now();
        }
        $dups = self::duplicates($data['telephone'], $data['email'], $id);
        if ($dups && empty($in['confirmerDoublon'])) {
            Http::fail(409, 'Un client existe déjà avec ce téléphone ou cet e-mail. Vérifiez avant de créer un doublon.', ['doublons' => $dups]);
        }
        if ($before) {
            Db::update('la_clients', $data, $id);
            Audit::log($user, 'client.modifier', 'client', $id, $before, $data);
        } else {
            $data['created_at'] = Db::now();
            $data['created_by'] = $user['id'];
            $id = Db::insert('la_clients', $data);
            Audit::log($user, 'client.creer', 'client', $id, null, ['nom' => $data['nom'], 'prenom' => $data['prenom']]);
        }
        return self::out(Db::one('SELECT * FROM la_clients WHERE id = ?', [$id]));
    }

    /** Ajoute une entrée à l'historique de contact (appelé par tous les modules). */
    public static function history(?array $user, int $clientId, string $type, string $resume, array $refs = [], ?string $when = null): void
    {
        Db::insert('la_contact_history', [
            'client_id' => $clientId,
            'vehicule_id' => $refs['vehicule_id'] ?? null,
            'rendez_vous_id' => $refs['rendez_vous_id'] ?? null,
            'demande_id' => $refs['demande_id'] ?? null,
            'actor_id' => $user['id'] ?? null,
            'type' => $type,
            'resume' => mb_substr($resume, 0, 500),
            'occurred_at' => $when ?? Db::now(),
            'metadata' => isset($refs['meta']) ? json_encode($refs['meta'], JSON_UNESCAPED_UNICODE) : null,
        ]);
    }

    /** Saisie manuelle d'un appel ou d'une note (même sans message numérique). */
    public static function logContact(array $user, array $in): array
    {
        Access::require($user, 'clients.gerer');
        $cid = (int) ($in['clientId'] ?? 0);
        if (!Db::value('SELECT COUNT(*) FROM la_clients WHERE id = ?', [$cid])) {
            Http::fail(404, 'Client introuvable.');
        }
        $type = In::oneOf($in, 'type', ['appel_entrant', 'appel_sortant', 'note', 'retour'], null, 'type');
        $resume = In::str($in, 'resume', 500);
        if ($resume === '') {
            Http::fail(422, 'Résumez l\'échange en quelques mots.');
        }
        $vid = isset($in['vehiculeId']) && $in['vehiculeId'] !== '' ? (int) $in['vehiculeId'] : null;
        if ($vid) {
            Access::vehicule($user, $vid);
        }
        $when = In::datetime($in, 'date') ?? Db::now();
        self::history($user, $cid, $type, $resume, ['vehicule_id' => $vid], $when);
        return self::get($user, $cid);
    }

    /** Export des données d'un client (droit d'accès RGPD). */
    public static function export(array $user, int $id): array
    {
        $c = Db::one('SELECT * FROM la_clients WHERE id = ?', [$id]);
        if (!$c) {
            Http::fail(404, 'Client introuvable.');
        }
        Audit::log($user, 'client.exporter', 'client', $id);
        unset($c['telephone_norm'], $c['email_norm']);
        return [
            'client' => $c,
            'historique' => Db::all('SELECT type, resume, occurred_at FROM la_contact_history WHERE client_id = ? ORDER BY occurred_at', [$id]),
            'rendez_vous' => Db::all('SELECT motif, start_at, end_at, statut FROM la_rendez_vous WHERE client_id = ? ORDER BY start_at', [$id]),
            'demandes' => Db::all('SELECT type, message, montant, statut, created_at FROM la_demandes WHERE client_id = ? ORDER BY created_at', [$id]),
            'messages' => Db::all('SELECT canal, template, statut, sent_at FROM la_notifications WHERE client_id = ? ORDER BY created_at', [$id]),
        ];
    }

    /** Anonymisation (droit à l'effacement) : les ventes et écritures restent, sans données personnelles. */
    public static function anonymize(array $user, int $id): void
    {
        if (!Db::value('SELECT COUNT(*) FROM la_clients WHERE id = ?', [$id])) {
            Http::fail(404, 'Client introuvable.');
        }
        Db::update('la_clients', [
            'nom' => 'Client anonymisé #' . $id, 'prenom' => '', 'telephone' => '', 'telephone_norm' => '', 'email' => '', 'email_norm' => '',
            'notes' => '', 'service_email' => 0, 'service_sms' => 0, 'marketing' => 0, 'actif' => 0, 'updated_at' => Db::now(),
        ], $id);
        Db::exec("UPDATE la_contact_history SET resume = '(anonymisé)', metadata = NULL WHERE client_id = ?", [$id]);
        Db::exec("UPDATE la_demandes SET nom = '(anonymisé)', tel = '', email = '', message = NULL WHERE client_id = ?", [$id]);
        Db::exec("UPDATE la_notifications SET destinataire = '', contenu = NULL WHERE client_id = ?", [$id]);
        Db::exec("UPDATE la_ventes SET acheteur = '(anonymisé)' WHERE client_id = ?", [$id]);
        Audit::log($user, 'client.anonymiser', 'client', $id);
    }
}
