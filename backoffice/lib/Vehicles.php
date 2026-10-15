<?php
declare(strict_types=1);

/** Annonces de véhicules. */
final class Vehicles
{
    public const STATUTS = ['brouillon', 'disponible', 'reserve', 'vendu'];
    public const ENERGIES = ['Essence', 'Diesel', 'Hybride', 'Électrique', 'GPL', 'Autre'];
    public const BOITES = ['Manuelle', 'Automatique'];
    public const CARROSSERIES = ['Citadine', 'Compacte', 'Berline', 'SUV', 'Break', '4x4', 'Monospace', 'Coupé', 'Cabriolet', 'Utilitaire'];

    /** Format attendu par le site public (identique à js/vehicules-data.js). */
    public static function toPublic(array $r): array
    {
        $v = [
            'id' => $r['slug'],
            'ref' => $r['ref'],
            'statut' => $r['statut'],
            'marque' => $r['marque'],
            'modele' => $r['modele'],
            'version' => $r['version'],
            'annee' => (int) $r['annee'],
            'miseEnCirculation' => $r['mise_en_circulation'],
            'km' => (int) $r['km'],
            'energie' => $r['energie'],
            'boite' => $r['boite'],
            'carrosserie' => $r['carrosserie'],
            'puissance' => self::int($r['puissance']),
            'cv' => self::int($r['cv']),
            'portes' => self::int($r['portes']),
            'places' => self::int($r['places']),
            'couleur' => $r['couleur'],
            'critair' => self::int($r['critair']),
            'premiereMain' => (bool) $r['premiere_main'],
            'quatreRoues' => (bool) $r['quatre_roues'],
            'garantie' => (int) $r['garantie'],
            'prix' => (int) $r['prix'],
            'prixBarre' => self::int($r['prix_barre']),
            'badge' => $r['badge'] ?: null,
            'ajoutLe' => $r['publie_le'] ?: substr($r['created_at'], 0, 10),
            'photos' => json_decode($r['photos'] ?: '[]', true) ?: [],
            'equipements' => json_decode($r['equipements'] ?: '[]', true) ?: [],
            'description' => (string) $r['description'],
        ];
        if ($r['autonomie'] !== null) {
            $v['autonomie'] = (int) $r['autonomie'];
        }
        return $v;
    }

    /** Annonces visibles sur le site : disponibles et réservées. */
    public static function listPublic(): array
    {
        $rows = Db::all("SELECT * FROM la_vehicules WHERE statut IN ('disponible', 'reserve') ORDER BY COALESCE(publie_le, created_at) DESC, id DESC");
        return array_map([self::class, 'toPublic'], $rows);
    }

    /** Liste du dashboard, avec le nombre de demandes et d'offres. */
    public static function listAdmin(): array
    {
        $rows = Db::all('SELECT * FROM la_vehicules ORDER BY updated_at DESC, id DESC');
        $stats = [];
        foreach (Db::all("SELECT vehicule_id,
                COUNT(*) AS demandes,
                SUM(CASE WHEN statut = 'nouvelle' THEN 1 ELSE 0 END) AS nouvelles,
                SUM(CASE WHEN type = 'offre' THEN 1 ELSE 0 END) AS offres,
                SUM(CASE WHEN type = 'offre' AND statut IN ('nouvelle', 'en_cours') THEN 1 ELSE 0 END) AS offres_ouvertes,
                MAX(CASE WHEN type = 'offre' THEN montant END) AS meilleure_offre
            FROM la_demandes WHERE vehicule_id IS NOT NULL GROUP BY vehicule_id") as $s) {
            $stats[(int) $s['vehicule_id']] = $s;
        }
        return array_map(function ($r) use ($stats) {
            $s = $stats[(int) $r['id']] ?? [];
            return self::toPublic($r) + [
                'dbId' => (int) $r['id'],
                'createdAt' => $r['created_at'],
                'updatedAt' => $r['updated_at'],
                'demandes' => (int) ($s['demandes'] ?? 0),
                'nouvelles' => (int) ($s['nouvelles'] ?? 0),
                'offres' => (int) ($s['offres'] ?? 0),
                'offresOuvertes' => (int) ($s['offres_ouvertes'] ?? 0),
                'meilleureOffre' => isset($s['meilleure_offre']) ? (int) $s['meilleure_offre'] : null,
            ];
        }, $rows);
    }

    public static function get(int $id): array
    {
        $r = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$id]);
        if (!$r) {
            Http::fail(404, 'Annonce introuvable.');
        }
        return self::toPublic($r) + ['dbId' => (int) $r['id']];
    }

    public static function findBySlug(string $slug): ?array
    {
        return Db::one('SELECT * FROM la_vehicules WHERE slug = ?', [$slug]);
    }

    /** Création ou mise à jour depuis le formulaire du dashboard. */
    public static function save(array $in): array
    {
        $id = isset($in['dbId']) ? (int) $in['dbId'] : 0;
        $existing = $id ? Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$id]) : null;
        if ($id && !$existing) {
            Http::fail(404, 'Annonce introuvable.');
        }

        $str = fn($k, $max = 160) => mb_substr(trim((string) ($in[$k] ?? '')), 0, $max);
        $num = function ($k, $min, $max, $required = false) use ($in) {
            $v = $in[$k] ?? null;
            if ($v === null || $v === '') {
                if ($required) {
                    Http::fail(422, "Le champ « $k » est obligatoire.");
                }
                return null;
            }
            if (!is_numeric($v) || $v < $min || $v > $max) {
                Http::fail(422, "Valeur invalide pour « $k ».");
            }
            return (int) $v;
        };
        $oneOf = function ($k, array $list, $default) use ($in) {
            $v = $in[$k] ?? $default;
            return in_array($v, $list, true) ? $v : $default;
        };

        $data = [
            'statut' => $oneOf('statut', self::STATUTS, 'brouillon'),
            'marque' => $str('marque', 80),
            'modele' => $str('modele', 80),
            'version' => $str('version'),
            'annee' => $num('annee', 1950, (int) date('Y') + 1, true),
            'mise_en_circulation' => $str('miseEnCirculation', 7),
            'km' => $num('km', 0, 2_000_000, true),
            'energie' => $oneOf('energie', self::ENERGIES, 'Essence'),
            'boite' => $oneOf('boite', self::BOITES, 'Manuelle'),
            'carrosserie' => $oneOf('carrosserie', self::CARROSSERIES, 'Citadine'),
            'puissance' => $num('puissance', 1, 2000),
            'cv' => $num('cv', 1, 200),
            'portes' => $num('portes', 1, 9),
            'places' => $num('places', 1, 9),
            'couleur' => $str('couleur', 80),
            'critair' => $num('critair', 0, 5),
            'premiere_main' => !empty($in['premiereMain']) ? 1 : 0,
            'quatre_roues' => !empty($in['quatreRoues']) ? 1 : 0,
            'autonomie' => $num('autonomie', 1, 2000),
            'garantie' => $num('garantie', 0, 120) ?? 12,
            'prix' => $num('prix', 1, 10_000_000, true),
            'prix_barre' => $num('prixBarre', 1, 10_000_000),
            'badge' => $str('badge', 60) ?: null,
            'description' => mb_substr(trim((string) ($in['description'] ?? '')), 0, 5000),
            'equipements' => json_encode(self::cleanList($in['equipements'] ?? []), JSON_UNESCAPED_UNICODE),
            'photos' => json_encode(self::cleanPhotos($in['photos'] ?? []), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'updated_at' => Db::now(),
        ];
        if ($data['marque'] === '' || $data['modele'] === '') {
            Http::fail(422, 'La marque et le modèle sont obligatoires.');
        }
        if ($data['prix_barre'] !== null && $data['prix_barre'] <= $data['prix']) {
            $data['prix_barre'] = null;
        }
        // Date de mise en ligne : fixée au premier passage en « disponible »
        $online = in_array($data['statut'], ['disponible', 'reserve'], true);
        $data['publie_le'] = $existing['publie_le'] ?? null;
        if ($online && !$data['publie_le']) {
            $data['publie_le'] = date('Y-m-d');
        }

        if ($existing) {
            Db::update('la_vehicules', $data, $id);
        } else {
            $data['created_at'] = Db::now();
            $data['slug'] = 'tmp-' . bin2hex(random_bytes(6));
            $id = Db::insert('la_vehicules', $data);
            Db::update('la_vehicules', [
                'slug' => self::slugify($data['marque'] . ' ' . $data['modele'] . ' ' . $data['annee']) . '-' . $id,
                'ref' => 'LA-' . (2400 + $id),
            ], $id);
        }
        return self::get($id);
    }

    public static function setStatut(int $id, string $statut): array
    {
        if (!in_array($statut, self::STATUTS, true)) {
            Http::fail(422, 'Statut invalide.');
        }
        $r = Db::one('SELECT publie_le FROM la_vehicules WHERE id = ?', [$id]);
        if (!$r) {
            Http::fail(404, 'Annonce introuvable.');
        }
        $data = ['statut' => $statut, 'updated_at' => Db::now()];
        if (in_array($statut, ['disponible', 'reserve'], true) && !$r['publie_le']) {
            $data['publie_le'] = date('Y-m-d');
        }
        Db::update('la_vehicules', $data, $id);
        return self::get($id);
    }

    public static function delete(int $id): void
    {
        $r = Db::one('SELECT photos FROM la_vehicules WHERE id = ?', [$id]);
        if (!$r) {
            Http::fail(404, 'Annonce introuvable.');
        }
        foreach (json_decode($r['photos'] ?: '[]', true) ?: [] as $p) {
            Uploads::deleteLocal($p);
        }
        Db::exec('DELETE FROM la_vehicules WHERE id = ?', [$id]);
    }

    public static function slugify(string $s): string
    {
        // Translittération explicite (le résultat d'iconv varie selon le serveur)
        $s = strtr($s, [
            'à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ã' => 'a', 'å' => 'a', 'ç' => 'c', 'č' => 'c',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'ě' => 'e', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ì' => 'i',
            'ñ' => 'n', 'ó' => 'o', 'ô' => 'o', 'ö' => 'o', 'ò' => 'o', 'õ' => 'o', 'ø' => 'o', 'ř' => 'r', 'š' => 's',
            'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'ù' => 'u', 'ý' => 'y', 'ÿ' => 'y', 'ž' => 'z', 'œ' => 'oe', 'æ' => 'ae', 'ß' => 'ss',
        ]);
        $s = strtr($s, ['À' => 'a', 'Â' => 'a', 'Ç' => 'c', 'É' => 'e', 'È' => 'e', 'Ê' => 'e', 'Î' => 'i', 'Ô' => 'o', 'Ö' => 'o', 'Û' => 'u', 'Ü' => 'u', 'Š' => 's', 'Č' => 'c', 'Ž' => 'z', 'Œ' => 'oe']);
        $s = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) ?: $s;
        $s = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', $s));
        return trim($s, '-') ?: 'vehicule';
    }

    private static function int($v): ?int
    {
        return $v === null || $v === '' ? null : (int) $v;
    }

    private static function cleanList($list): array
    {
        if (is_string($list)) {
            $list = preg_split('/\R/', $list);
        }
        $out = [];
        foreach ((array) $list as $item) {
            $item = mb_substr(trim((string) $item), 0, 120);
            if ($item !== '') {
                $out[] = $item;
            }
        }
        return array_slice($out, 0, 60);
    }

    private static function cleanPhotos($list): array
    {
        $out = [];
        foreach ((array) $list as $p) {
            if (!is_array($p)) {
                continue;
            }
            $photo = [];
            foreach (['url', 'urlSmall', 'fichier', 'credit', 'licence', 'source'] as $k) {
                if (!empty($p[$k]) && is_string($p[$k])) {
                    $photo[$k] = mb_substr($p[$k], 0, 500);
                }
            }
            foreach (['url', 'urlSmall', 'source'] as $k) {
                if (isset($photo[$k]) && !preg_match('#^(https?://|/)#', $photo[$k])) {
                    unset($photo[$k]);
                }
            }
            if (isset($photo['url']) || isset($photo['fichier'])) {
                $out[] = $photo;
            }
        }
        return array_slice($out, 0, 30);
    }
}
