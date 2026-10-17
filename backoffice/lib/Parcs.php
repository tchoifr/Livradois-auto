<?php
declare(strict_types=1);

/** Parcs automobiles : création, désactivation, affectations, transferts de véhicules. */
final class Parcs
{
    private static function out(array $p, array $counts = []): array
    {
        return [
            'id' => (int) $p['id'], 'code' => $p['code'], 'nom' => $p['nom'], 'adresse' => $p['adresse'],
            'telephone' => $p['telephone'], 'notes' => (string) $p['notes'], 'actif' => (int) $p['actif'] === 1,
            'vehicules' => (int) ($counts[(int) $p['id']] ?? 0),
        ];
    }

    public static function list(array $user, bool $withInactive = false): array
    {
        [$sql, $params] = Access::scope($user, 'p.id');
        $rows = Db::all('SELECT p.* FROM la_parcs p WHERE 1 = 1' . $sql . ($withInactive ? '' : ' AND p.actif = 1') . ' ORDER BY p.actif DESC, p.nom', $params);
        $counts = [];
        foreach (Db::all("SELECT parc_id, COUNT(*) AS n FROM la_vehicules WHERE statut NOT IN ('vendu', 'livre', 'retire') GROUP BY parc_id") as $c) {
            $counts[(int) $c['parc_id']] = (int) $c['n'];
        }
        $affect = [];
        foreach (Db::all('SELECT ap.parc_id, a.id, a.name, a.email, a.role FROM la_admin_parcs ap JOIN la_admins a ON a.id = ap.admin_id WHERE ap.removed_at IS NULL AND a.actif = 1') as $r) {
            $affect[(int) $r['parc_id']][] = ['id' => (int) $r['id'], 'nom' => $r['name'] ?: $r['email'], 'role' => $r['role']];
        }
        return array_map(fn($p) => self::out($p, $counts) + ['equipe' => $affect[(int) $p['id']] ?? []], $rows);
    }

    public static function get(int $id): array
    {
        $p = Db::one('SELECT * FROM la_parcs WHERE id = ?', [$id]);
        if (!$p) {
            Http::fail(404, 'Parc introuvable.');
        }
        return $p;
    }

    public static function save(array $user, array $in): array
    {
        $id = (int) ($in['id'] ?? 0);
        $code = strtoupper(preg_replace('/[^A-Za-z0-9-]/', '', In::str($in, 'code', 20)));
        $data = [
            'code' => $code,
            'nom' => In::str($in, 'nom', 120),
            'adresse' => In::str($in, 'adresse', 255),
            'telephone' => In::str($in, 'telephone', 40),
            'notes' => In::str($in, 'notes', 2000),
            'actif' => array_key_exists('actif', $in) ? In::bool($in, 'actif') : 1,
            'updated_at' => Db::now(),
        ];
        if ($data['code'] === '' || $data['nom'] === '') {
            Http::fail(422, 'Le code et le nom du parc sont obligatoires.');
        }
        $dup = Db::value('SELECT id FROM la_parcs WHERE code = ? AND id <> ?', [$code, $id]);
        if ($dup) {
            Http::fail(422, 'Ce code de parc est déjà utilisé.');
        }
        if ($id) {
            $before = self::get($id);
            if (!$data['actif'] && (int) $before['actif'] === 1) {
                $n = (int) Db::value("SELECT COUNT(*) FROM la_vehicules WHERE parc_id = ? AND statut NOT IN ('vendu', 'livre', 'retire')", [$id]);
                if ($n > 0) {
                    Http::fail(409, "Ce parc contient encore $n véhicule(s) en stock : transférez-les avant de le désactiver.");
                }
            }
            Db::update('la_parcs', $data, $id);
            Audit::log($user, 'parc.modifier', 'parc', $id, $before, $data);
        } else {
            $data['created_at'] = Db::now();
            $id = Db::insert('la_parcs', $data);
            Audit::log($user, 'parc.creer', 'parc', $id, null, $data);
        }
        return self::out(self::get($id));
    }

    /** Transfert d'un véhicule entre parcs, avec historique et avertissement sur les rendez-vous à venir. */
    public static function transfer(array $user, int $vehiculeId, int $destination, string $commentaire): array
    {
        Access::require($user, 'vehicules.transferer');
        return Db::transaction(function () use ($user, $vehiculeId, $destination, $commentaire) {
            $v = Access::vehicule($user, $vehiculeId);
            Db::lockRow('la_vehicules', $vehiculeId);
            $dest = self::get($destination);
            if ((int) $dest['actif'] !== 1) {
                Http::fail(422, 'Le parc de destination est désactivé.');
            }
            Access::requireParc($user, $destination);
            $source = $v['parc_id'] !== null ? (int) $v['parc_id'] : null;
            if ($source === $destination) {
                Http::fail(422, 'Le véhicule est déjà dans ce parc.');
            }
            Db::update('la_vehicules', ['parc_id' => $destination, 'updated_at' => Db::now()], $vehiculeId);
            Db::insert('la_parc_mouvements', [
                'vehicule_id' => $vehiculeId, 'parc_source_id' => $source, 'parc_destination_id' => $destination,
                'effectue_par' => $user['id'], 'effectue_le' => Db::now(), 'commentaire' => mb_substr(trim($commentaire), 0, 500),
            ]);
            Audit::log($user, 'vehicule.transferer', 'vehicule', $vehiculeId, ['parc_id' => $source], ['parc_id' => $destination]);
            // Les rendez-vous existants sont conservés ; on signale ceux à venir
            $futurs = Db::all("SELECT r.id, r.start_at, r.motif, p.nom AS parc FROM la_rendez_vous r LEFT JOIN la_parcs p ON p.id = r.parc_id
                WHERE r.vehicule_id = ? AND r.start_at >= ? AND r.statut IN ('en_attente', 'confirme') ORDER BY r.start_at", [$vehiculeId, Db::now()]);
            return [
                'ok' => true,
                'avertissements' => array_map(fn($r) => 'Rendez-vous du ' . date('d/m/Y à H:i', strtotime($r['start_at'])) . ' prévu au parc « ' . ($r['parc'] ?? '?') . ' » : vérifiez qu\'il reste réalisable depuis le nouveau parc.', $futurs),
            ];
        });
    }

    public static function mouvements(int $vehiculeId): array
    {
        return array_map(fn($m) => [
            'date' => $m['effectue_le'], 'de' => $m['source'] ?? '—', 'vers' => $m['destination'], 'par' => $m['par'] ?: 'Système',
            'commentaire' => $m['commentaire'],
        ], Db::all('SELECT m.*, ps.nom AS source, pd.nom AS destination, a.name AS par FROM la_parc_mouvements m
            LEFT JOIN la_parcs ps ON ps.id = m.parc_source_id LEFT JOIN la_parcs pd ON pd.id = m.parc_destination_id
            LEFT JOIN la_admins a ON a.id = m.effectue_par WHERE m.vehicule_id = ? ORDER BY m.id DESC', [$vehiculeId]));
    }
}
