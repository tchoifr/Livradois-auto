<?php
declare(strict_types=1);

/**
 * Rendez-vous et prévention des doubles réservations.
 * Intervalle [début, fin[ : deux rendez-vous peuvent se suivre (fin du premier = début du second).
 * Les rendez-vous annulés ne bloquent plus. La vérification est faite côté serveur, dans une
 * transaction, véhicule verrouillé : deux créations simultanées ne peuvent pas se chevaucher.
 */
final class Appointments
{
    public const STATUTS = [
        'en_attente' => 'En attente de confirmation', 'confirme' => 'Confirmé', 'termine' => 'Terminé',
        'absent' => 'Client absent', 'annule' => 'Annulé',
    ];
    private const ACTIFS = "('en_attente', 'confirme')";

    public static function rows(string $where, array $params, string $order = 'r.start_at'): array
    {
        $rows = Db::all("SELECT r.*, v.marque, v.modele, v.version, v.numero_stock, v.immatriculation, v.pret_visite, v.statut AS vehicule_statut, v.parc_id AS vehicule_parc_id, v.photos AS vehicule_photos,
                c.nom AS client_nom, c.prenom AS client_prenom, c.telephone AS client_tel, c.email AS client_email,
                p.nom AS parc_nom, a.name AS assigne_nom, cr.name AS createur_nom
            FROM la_rendez_vous r
            JOIN la_vehicules v ON v.id = r.vehicule_id
            LEFT JOIN la_clients c ON c.id = r.client_id
            LEFT JOIN la_parcs p ON p.id = r.parc_id
            LEFT JOIN la_admins a ON a.id = r.assigned_to
            LEFT JOIN la_admins cr ON cr.id = r.created_by
            WHERE $where ORDER BY $order LIMIT 1000", $params);
        return array_map([self::class, 'out'], $rows);
    }

    private static function out(array $r): array
    {
        $motif = Settings::motif($r['motif']);
        return [
            'id' => (int) $r['id'],
            'vehiculeId' => (int) $r['vehicule_id'],
            'vehicule' => trim($r['marque'] . ' ' . $r['modele']), 'vehiculeVersion' => $r['version'],
            'numeroStock' => $r['numero_stock'], 'immatriculation' => $r['immatriculation'],
            'vehiculePret' => (int) $r['pret_visite'] === 1, 'vehiculeStatut' => $r['vehicule_statut'],
            'vehiculePhoto' => (json_decode((string) ($r['vehicule_photos'] ?? ''), true) ?: [])[0] ?? null,
            'clientId' => $r['client_id'] !== null ? (int) $r['client_id'] : null,
            'client' => $r['client_id'] !== null ? trim(($r['client_prenom'] ?? '') . ' ' . ($r['client_nom'] ?? '')) : null,
            'clientTelephone' => $r['client_tel'] ?? '', 'clientEmail' => $r['client_email'] ?? '',
            'parcId' => $r['parc_id'] !== null ? (int) $r['parc_id'] : null, 'parc' => $r['parc_nom'],
            'motif' => $r['motif'], 'motifLabel' => $motif['libelle'] ?? $r['motif'],
            'debut' => $r['start_at'], 'fin' => $r['end_at'],
            'statut' => $r['statut'], 'statutLabel' => self::STATUTS[$r['statut']] ?? $r['statut'],
            'notes' => (string) $r['notes'], 'motifAnnulation' => $r['motif_annulation'],
            'assigneId' => $r['assigned_to'] !== null ? (int) $r['assigned_to'] : null, 'assigne' => $r['assigne_nom'],
            'creePar' => $r['createur_nom'], 'createdAt' => $r['created_at'],
            'enRetard' => in_array($r['statut'], ['en_attente', 'confirme'], true) && $r['end_at'] < Db::now(),
        ];
    }

    /** Périmètre : rendez-vous pris dans un parc autorisé, ou véhicule actuellement dans un parc autorisé. */
    private static function scope(array $user): array
    {
        $ids = Access::parcIds($user);
        if ($ids === null) {
            return ['', []];
        }
        if (!$ids) {
            return [' AND 1 = 0', []];
        }
        $in = Db::in($ids);
        return [" AND (r.parc_id IN ($in) OR v.parc_id IN ($in))", array_merge($ids, $ids)];
    }

    public static function list(array $user, array $q): array
    {
        [$where, $p] = self::scope($user);
        $where = '1 = 1' . $where;
        $du = In::date($q, 'du');
        $au = In::date($q, 'au');
        if ($du) {
            $where .= ' AND r.end_at > ?';
            $p[] = "$du 00:00:00";
        }
        if ($au) {
            $where .= ' AND r.start_at < ?';
            $p[] = date('Y-m-d', strtotime("$au +1 day")) . ' 00:00:00';
        }
        foreach (['parc' => 'r.parc_id', 'vehicule' => 'r.vehicule_id', 'client' => 'r.client_id', 'assigne' => 'r.assigned_to'] as $k => $col) {
            if (!empty($q[$k])) {
                $where .= " AND $col = ?";
                $p[] = (int) $q[$k];
            }
        }
        if (!empty($q['motif'])) {
            $where .= ' AND r.motif = ?';
            $p[] = (string) $q['motif'];
        }
        if (!empty($q['statut']) && isset(self::STATUTS[$q['statut']])) {
            $where .= ' AND r.statut = ?';
            $p[] = $q['statut'];
        } elseif (($q['actifs'] ?? '') === '1') {
            $where .= ' AND r.statut IN ' . self::ACTIFS;
        }
        if (($q['retard'] ?? '') === '1') {
            $where .= ' AND r.statut IN ' . self::ACTIFS . ' AND r.end_at < ?';
            $p[] = Db::now();
        }
        return self::rows($where, $p, ($q['ordre'] ?? '') === 'desc' ? 'r.start_at DESC' : 'r.start_at');
    }

    public static function get(array $user, int $id): array
    {
        [$where, $p] = self::scope($user);
        $r = self::rows("r.id = ?$where", array_merge([$id], $p));
        if (!$r) {
            Http::fail(404, 'Rendez-vous introuvable.');
        }
        $rdv = $r[0];
        $rdv['messages'] = Notifications::forAppointment($id);
        return $rdv;
    }

    /** Vérifie l'absence de chevauchement (à appeler dans la transaction, véhicule verrouillé). */
    private static function assertFree(int $vehiculeId, string $start, string $end, int $exceptId = 0): void
    {
        $conflicts = Db::all('SELECT r.id, r.start_at, r.end_at, r.motif, r.statut, c.nom AS client FROM la_rendez_vous r LEFT JOIN la_clients c ON c.id = r.client_id
            WHERE r.vehicule_id = ? AND r.statut IN ' . self::ACTIFS . ' AND r.start_at < ? AND r.end_at > ? AND r.id <> ?'
            // Lecture verrouillante sous MySQL : toujours la dernière version validée
            . (Db::isMysql() ? ' FOR UPDATE' : ''), [$vehiculeId, $end, $start, $exceptId]);
        if ($conflicts) {
            $c = $conflicts[0];
            Http::fail(409, 'Ce véhicule est déjà réservé de ' . date('H:i', strtotime($c['start_at'])) . ' à ' . date('H:i', strtotime($c['end_at']))
                . ' le ' . date('d/m/Y', strtotime($c['start_at'])) . ' (' . (Settings::motif($c['motif'])['libelle'] ?? $c['motif']) . '). Choisissez un autre créneau.', [
                'conflits' => array_map(fn($x) => ['id' => (int) $x['id'], 'debut' => $x['start_at'], 'fin' => $x['end_at'], 'motif' => $x['motif'], 'statut' => $x['statut']], $conflicts),
            ]);
        }
    }

    /** Lit et valide les champs communs (véhicule, motif, début, durée/fin, assignation). */
    private static function readSlot(array $user, array $in, ?array $current = null): array
    {
        $vid = (int) ($in['vehiculeId'] ?? ($current['vehicule_id'] ?? 0));
        $v = Access::vehicule($user, $vid);
        $motifCode = (string) ($in['motif'] ?? ($current['motif'] ?? ''));
        $motif = Settings::motif($motifCode);
        if (!$motif) {
            Http::fail(422, 'Motif de rendez-vous inconnu.');
        }
        $start = In::datetime($in, 'debut', $current === null, 'date et heure') ?? $current['start_at'];
        $end = In::datetime($in, 'fin');
        if (!$end) {
            $duree = In::int($in, 'duree', 5, 600) ?? ($current ? (int) ((strtotime($current['end_at']) - strtotime($current['start_at'])) / 60) : (int) $motif['duree']);
            $end = date('Y-m-d H:i:s', strtotime($start) + $duree * 60);
        }
        if ($end <= $start) {
            Http::fail(422, 'L\'heure de fin doit être après l\'heure de début.');
        }
        if ((strtotime($end) - strtotime($start)) > 10 * 3600) {
            Http::fail(422, 'Un rendez-vous ne peut pas dépasser 10 heures.');
        }
        if (in_array($v['statut'], ['vendu', 'livre', 'retire'], true) && in_array($motifCode, ['visite', 'essai'], true)) {
            Http::fail(409, 'Ce véhicule est ' . strtolower(Vehicles::STATUT_LABELS[$v['statut']]) . ' : plus de visite ni d\'essai possible.');
        }
        $assigne = array_key_exists('assigneId', $in) ? ($in['assigneId'] === '' || $in['assigneId'] === null ? null : (int) $in['assigneId']) : ($current['assigned_to'] ?? null);
        if ($assigne !== null && !Db::value('SELECT COUNT(*) FROM la_admins WHERE id = ? AND actif = 1', [$assigne])) {
            Http::fail(422, 'Personne assignée inconnue.');
        }
        return [$v, $motifCode, $start, $end, $assigne !== null ? (int) $assigne : null];
    }

    private static function warnings(array $v, string $motif, string $start, string $end): array
    {
        $w = [];
        if ($v['statut'] === 'reserve' && in_array($motif, ['visite', 'essai'], true)) {
            $w[] = 'Ce véhicule est réservé par un autre client : vérifiez avant de confirmer.';
        }
        $day = (string) date('w', strtotime($start));
        $inside = false;
        foreach ((array) (Settings::get('horaires')[$day] ?? []) as [$a, $b]) {
            if (substr($start, 11, 5) >= $a && substr($end, 11, 5) <= $b && substr($start, 0, 10) === substr($end, 0, 10)) {
                $inside = true;
            }
        }
        if (!$inside) {
            $w[] = 'Ce créneau est en dehors des horaires d\'ouverture.';
        }
        if ($start < Db::now()) {
            $w[] = 'Ce rendez-vous est dans le passé.';
        }
        return $w;
    }

    /** Client existant (clientId) ou fiche minimale créée à la volée (nouveauClient). */
    private static function resolveClient(array $user, array $in): ?int
    {
        if (!empty($in['clientId'])) {
            $cid = (int) $in['clientId'];
            if (!Db::value('SELECT COUNT(*) FROM la_clients WHERE id = ? AND actif = 1', [$cid])) {
                Http::fail(422, 'Client introuvable.');
            }
            return $cid;
        }
        if (!empty($in['nouveauClient']) && is_array($in['nouveauClient'])) {
            return Clients::save($user, $in['nouveauClient'])['id'];
        }
        return null;
    }

    public static function create(array $user, array $in): array
    {
        Access::require($user, 'rdv.gerer');
        $statut = In::oneOf($in, 'statut', ['confirme', 'en_attente'], 'confirme', 'statut');
        $result = Db::transaction(function () use ($user, $in, $statut) {
            $clientId = self::resolveClient($user, $in);
            if ($clientId === null) {
                Http::fail(422, 'Choisissez ou créez le client du rendez-vous.');
            }
            [$v, $motif, $start, $end, $assigne] = self::readSlot($user, $in);
            Db::lockRow('la_vehicules', (int) $v['id']);
            self::assertFree((int) $v['id'], $start, $end);
            $id = Db::insert('la_rendez_vous', [
                'vehicule_id' => (int) $v['id'], 'client_id' => $clientId, 'parc_id' => $v['parc_id'] !== null ? (int) $v['parc_id'] : null,
                'created_by' => $user['id'], 'assigned_to' => $assigne, 'motif' => $motif, 'start_at' => $start, 'end_at' => $end,
                'statut' => $statut, 'notes' => In::str($in, 'notes', 2000), 'motif_annulation' => '',
                'created_at' => Db::now(), 'updated_at' => Db::now(),
            ]);
            Clients::history($user, $clientId, 'rdv_cree', (Settings::motif($motif)['libelle'] ?? $motif) . ' le ' . date('d/m/Y à H:i', strtotime($start)) . ' — ' . $v['marque'] . ' ' . $v['modele'], ['vehicule_id' => (int) $v['id'], 'rendez_vous_id' => $id]);
            Audit::log($user, 'rdv.creer', 'rendez_vous', $id, null, ['vehicule_id' => (int) $v['id'], 'client_id' => $clientId, 'debut' => $start, 'fin' => $end, 'motif' => $motif]);
            return [$id, self::warnings($v, $motif, $start, $end)];
        });
        [$id, $warnings] = $result;
        if ($statut === 'confirme') {
            Notifications::planifierRappels($id);
        }
        return ['rendezVous' => self::get($user, $id), 'avertissements' => $warnings, 'proposition' => Notifications::proposition($id, 'confirmation')];
    }

    public static function update(array $user, array $in): array
    {
        Access::require($user, 'rdv.gerer');
        $id = (int) ($in['id'] ?? 0);
        $current = self::get($user, $id);
        if (in_array($current['statut'], ['annule', 'termine', 'absent'], true)) {
            Http::fail(409, 'Ce rendez-vous est clôturé (' . strtolower($current['statutLabel']) . ') : créez-en un nouveau.');
        }
        $before = Db::one('SELECT * FROM la_rendez_vous WHERE id = ?', [$id]);
        [$id, $warnings, $moved] = Db::transaction(function () use ($user, $in, $id, $before) {
            [$v, $motif, $start, $end, $assigne] = self::readSlot($user, $in, $before);
            Db::lockRow('la_vehicules', (int) $v['id']);
            self::assertFree((int) $v['id'], $start, $end, $id);
            $clientId = array_key_exists('clientId', $in) || !empty($in['nouveauClient']) ? self::resolveClient($user, $in) : ($before['client_id'] !== null ? (int) $before['client_id'] : null);
            $data = [
                'vehicule_id' => (int) $v['id'], 'client_id' => $clientId, 'motif' => $motif, 'start_at' => $start, 'end_at' => $end,
                'assigned_to' => $assigne, 'notes' => array_key_exists('notes', $in) ? In::str($in, 'notes', 2000) : (string) $before['notes'],
                'statut' => isset($in['statut']) && in_array($in['statut'], ['confirme', 'en_attente'], true) ? $in['statut'] : $before['statut'],
                'updated_at' => Db::now(),
            ];
            if ((int) $v['id'] !== (int) $before['vehicule_id']) {
                $data['parc_id'] = $v['parc_id'] !== null ? (int) $v['parc_id'] : null;
            }
            Db::update('la_rendez_vous', $data, $id);
            $moved = $start !== $before['start_at'] || $end !== $before['end_at'] || (int) $v['id'] !== (int) $before['vehicule_id'];
            if ($clientId) {
                Clients::history($user, $clientId, $moved ? 'rdv_modifie' : 'rdv_statut', $moved
                    ? 'Rendez-vous déplacé du ' . date('d/m/Y H:i', strtotime($before['start_at'])) . ' au ' . date('d/m/Y H:i', strtotime($start))
                    : 'Rendez-vous mis à jour', ['vehicule_id' => (int) $v['id'], 'rendez_vous_id' => $id]);
            }
            Audit::log($user, 'rdv.modifier', 'rendez_vous', $id, $before, $data);
            return [$id, self::warnings($v, $motif, $start, $end), $moved];
        });
        $after = self::get($user, $id);
        if ($moved || $after['statut'] !== $before['statut']) {
            Notifications::annulerRappels($id);
            if ($after['statut'] === 'confirme') {
                Notifications::planifierRappels($id);
            }
        }
        return [
            'rendezVous' => $after, 'avertissements' => $warnings,
            'proposition' => $moved ? Notifications::proposition($id, 'modification', ['ancienne_date' => date('d/m/Y à H:i', strtotime($before['start_at']))]) : null,
        ];
    }

    public static function cancel(array $user, int $id, string $raison): array
    {
        Access::require($user, 'rdv.gerer');
        $rdv = self::get($user, $id);
        if ($rdv['statut'] === 'annule') {
            Http::fail(409, 'Ce rendez-vous est déjà annulé.');
        }
        Db::update('la_rendez_vous', ['statut' => 'annule', 'annule_le' => Db::now(), 'annule_par' => $user['id'], 'motif_annulation' => mb_substr(trim($raison), 0, 255), 'updated_at' => Db::now()], $id);
        $annules = Notifications::annulerRappels($id);
        if ($rdv['clientId']) {
            Clients::history($user, $rdv['clientId'], 'rdv_annule', 'Rendez-vous du ' . date('d/m/Y à H:i', strtotime($rdv['debut'])) . ' annulé' . ($raison ? ' : ' . $raison : ''), ['vehicule_id' => $rdv['vehiculeId'], 'rendez_vous_id' => $id]);
        }
        Audit::log($user, 'rdv.annuler', 'rendez_vous', $id, ['statut' => $rdv['statut']], ['statut' => 'annule', 'raison' => $raison]);
        return ['rendezVous' => self::get($user, $id), 'rappelsAnnules' => $annules, 'proposition' => $rdv['debut'] > Db::now() ? Notifications::proposition($id, 'annulation') : null];
    }

    /** Clôture : terminé, client absent, ou retour en attente/confirmé. */
    public static function setStatut(array $user, int $id, string $statut): array
    {
        Access::require($user, 'rdv.gerer');
        $rdv = self::get($user, $id);
        if (!in_array($statut, ['termine', 'absent', 'confirme', 'en_attente'], true)) {
            Http::fail(422, 'Statut invalide.');
        }
        if ($rdv['statut'] === 'annule') {
            Http::fail(409, 'Un rendez-vous annulé ne peut pas être modifié.');
        }
        Db::update('la_rendez_vous', ['statut' => $statut, 'updated_at' => Db::now()], $id);
        if (in_array($statut, ['termine', 'absent'], true)) {
            Notifications::annulerRappels($id);
        } elseif ($statut === 'confirme') {
            Notifications::planifierRappels($id);
        }
        if ($rdv['clientId']) {
            Clients::history($user, $rdv['clientId'], 'rdv_statut', 'Rendez-vous du ' . date('d/m/Y à H:i', strtotime($rdv['debut'])) . ' : ' . strtolower(self::STATUTS[$statut]), ['vehicule_id' => $rdv['vehiculeId'], 'rendez_vous_id' => $id]);
        }
        Audit::log($user, 'rdv.statut', 'rendez_vous', $id, ['statut' => $rdv['statut']], ['statut' => $statut]);
        return self::get($user, $id);
    }

    /** Créneaux d'une journée pour un véhicule : libres, occupés, en attente, annulés. */
    public static function creneaux(array $user, array $q): array
    {
        $vid = (int) ($q['vehicule'] ?? 0);
        Access::vehicule($user, $vid);
        $date = In::date($q, 'date', true, 'date');
        $motif = Settings::motif((string) ($q['motif'] ?? '')) ?? ['duree' => 30];
        $duree = In::int($q, 'duree', 5, 600) ?? (int) $motif['duree'];
        $exclude = (int) ($q['exclure'] ?? 0);
        $rdvs = Db::all('SELECT r.id, r.start_at, r.end_at, r.statut, r.motif, c.nom AS client FROM la_rendez_vous r LEFT JOIN la_clients c ON c.id = r.client_id
            WHERE r.vehicule_id = ? AND r.start_at < ? AND r.end_at > ? ORDER BY r.start_at', [$vid, "$date 23:59:59", "$date 00:00:00"]);
        $busy = array_filter($rdvs, fn($r) => in_array($r['statut'], ['en_attente', 'confirme'], true) && (int) $r['id'] !== $exclude);
        $slots = [];
        $now = Db::now();
        // Créneaux de la durée du rendez-vous, alignés sur l'ouverture (visite de 30 min : 8h00, 8h30, 9h00…)
        foreach ((array) (Settings::get('horaires')[(string) date('w', strtotime($date))] ?? []) as [$a, $b]) {
            for ($t = strtotime("$date $a:00"); $t + $duree * 60 <= strtotime("$date $b:00"); $t += $duree * 60) {
                $s = date('Y-m-d H:i:s', $t);
                $e = date('Y-m-d H:i:s', $t + $duree * 60);
                $libre = $s >= $now;
                foreach ($busy as $r) {
                    if ($r['start_at'] < $e && $r['end_at'] > $s) {
                        $libre = false;
                    }
                }
                $slots[] = ['debut' => $s, 'fin' => $e, 'libre' => $libre, 'passe' => $s < $now];
            }
        }
        return [
            'duree' => $duree, 'pas' => $duree, 'creneaux' => $slots,
            'reservations' => array_map(fn($r) => ['id' => (int) $r['id'], 'debut' => $r['start_at'], 'fin' => $r['end_at'], 'statut' => $r['statut'],
                'statutLabel' => self::STATUTS[$r['statut']] ?? $r['statut'], 'motif' => Settings::motif($r['motif'])['libelle'] ?? $r['motif']], $rdvs),
        ];
    }
}
