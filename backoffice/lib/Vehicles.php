<?php
declare(strict_types=1);

/** Véhicules : annonce publique + fiche interne (identification, parc, statut, préparation, contrôle technique). */
final class Vehicles
{
    public const STATUTS = ['brouillon', 'disponible', 'reserve', 'vendu', 'livre', 'retire'];
    public const STATUT_LABELS = [
        'brouillon' => 'Brouillon', 'disponible' => 'En ligne', 'reserve' => 'Réservé',
        'vendu' => 'Vendu', 'livre' => 'Livré', 'retire' => 'Retiré',
    ];
    /** Transitions autorisées (vendu et livré passent par l'enregistrement de la vente). */
    public const TRANSITIONS = [
        'brouillon' => ['disponible', 'retire'],
        'disponible' => ['brouillon', 'reserve', 'vendu', 'retire'],
        'reserve' => ['disponible', 'vendu', 'retire'],
        'vendu' => ['livre', 'reserve', 'disponible'],
        'livre' => ['vendu'],
        'retire' => ['brouillon', 'disponible'],
    ];
    public const ENERGIES = ['Essence', 'Diesel', 'Hybride', 'Électrique', 'GPL', 'Autre'];
    public const BOITES = ['Manuelle', 'Automatique'];
    public const CARROSSERIES = ['Citadine', 'Compacte', 'Berline', 'SUV', 'Break', '4x4', 'Monospace', 'Coupé', 'Cabriolet', 'Utilitaire'];
    public const CT_RESULTATS = ['favorable' => 'Favorable', 'contre_visite' => 'Contre-visite', 'defavorable' => 'Défavorable', 'a_verifier' => 'À vérifier'];
    private const STOCK = "'brouillon', 'disponible', 'reserve'";

    /** Format attendu par le site public (identique à js/vehicules-data.js) — inchangé. */
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

    /** État du contrôle technique : ok / bientot / echu / inconnu (une date d'échéance non vérifiée reste « à vérifier »). */
    public static function ctEtat(array $r): array
    {
        if (empty($r['ct_echeance'])) {
            return ['etat' => 'inconnu', 'label' => empty($r['ct_date']) ? 'CT non renseigné' : 'Échéance CT à saisir', 'jours' => null];
        }
        $jours = (int) floor((strtotime($r['ct_echeance']) - strtotime(date('Y-m-d'))) / 86400);
        $seuil = max((array) (Settings::get('alertes')['ct_jours'] ?? [30]));
        if ($jours < 0) {
            return ['etat' => 'echu', 'label' => 'CT échu depuis ' . abs($jours) . ' j', 'jours' => $jours];
        }
        if ($jours <= $seuil) {
            return ['etat' => 'bientot', 'label' => "CT dans $jours j", 'jours' => $jours];
        }
        $label = 'CT valable jusqu\'au ' . date('d/m/Y', strtotime($r['ct_echeance']));
        return ['etat' => (int) $r['ct_echeance_verifiee'] === 1 ? 'ok' : 'a_verifier', 'label' => $label . ((int) $r['ct_echeance_verifiee'] === 1 ? '' : ' (à vérifier)'), 'jours' => $jours];
    }

    /** Champs internes ajoutés au format public pour le dashboard. */
    private static function toAdmin(array $r, array $extra = []): array
    {
        return self::toPublic($r) + [
            'dbId' => (int) $r['id'],
            'numeroStock' => (string) $r['numero_stock'],
            'immatriculation' => (string) $r['immatriculation'],
            'vin' => (string) $r['vin'],
            'parcId' => $r['parc_id'] !== null ? (int) $r['parc_id'] : null,
            'parc' => $r['parc_nom'] ?? null,
            'emplacement' => (string) $r['emplacement'],
            'statutLabel' => self::STATUT_LABELS[$r['statut']] ?? $r['statut'],
            'transitions' => self::TRANSITIONS[$r['statut']] ?? [],
            'pretVisite' => (int) $r['pret_visite'] === 1,
            'pretVerifieLe' => $r['pret_verifie_le'],
            'ct' => [
                'date' => $r['ct_date'], 'resultat' => $r['ct_resultat'], 'echeance' => $r['ct_echeance'],
                'echeanceVerifiee' => (int) $r['ct_echeance_verifiee'] === 1, 'centre' => $r['ct_centre'],
                'coutCentimes' => self::int($r['ct_cout_centimes']), 'documentId' => self::int($r['ct_document_id']),
            ] + self::ctEtat($r),
            'demo' => (int) $r['demo'] === 1,
            'createdAt' => $r['created_at'],
            'updatedAt' => $r['updated_at'],
        ] + $extra;
    }

    /** Annonces visibles sur le site : disponibles et réservées (inchangé). */
    public static function listPublic(): array
    {
        $rows = Db::all("SELECT * FROM la_vehicules WHERE statut IN ('disponible', 'reserve') ORDER BY COALESCE(publie_le, created_at) DESC, id DESC");
        return array_map([self::class, 'toPublic'], $rows);
    }

    /** Liste du dashboard (périmètre de parcs, préparation, CT, demandes/offres, prochain rendez-vous). */
    public static function listAdmin(array $user, array $q = []): array
    {
        [$scope, $params] = Access::scope($user, 'v.parc_id');
        $where = '1 = 1' . $scope;
        if (!empty($q['parc'])) {
            $where .= ' AND v.parc_id = ?';
            $params[] = (int) $q['parc'];
        }
        if (!empty($q['statut']) && in_array($q['statut'], self::STATUTS, true)) {
            $where .= ' AND v.statut = ?';
            $params[] = $q['statut'];
        } elseif (($q['stock'] ?? '') === '1') {
            $where .= ' AND v.statut IN (' . self::STOCK . ')';
        }
        $rows = Db::all("SELECT v.*, p.nom AS parc_nom FROM la_vehicules v LEFT JOIN la_parcs p ON p.id = v.parc_id WHERE $where ORDER BY v.updated_at DESC, v.id DESC", $params);
        if (!$rows) {
            return [];
        }
        $ids = array_map(fn($r) => (int) $r['id'], $rows);
        $in = Db::in($ids);

        $stats = [];
        foreach (Db::all("SELECT vehicule_id,
                COUNT(*) AS demandes,
                SUM(CASE WHEN statut = 'nouvelle' THEN 1 ELSE 0 END) AS nouvelles,
                SUM(CASE WHEN type = 'offre' THEN 1 ELSE 0 END) AS offres,
                SUM(CASE WHEN type = 'offre' AND statut IN ('nouvelle', 'en_cours') THEN 1 ELSE 0 END) AS offres_ouvertes,
                MAX(CASE WHEN type = 'offre' THEN montant END) AS meilleure_offre
            FROM la_demandes WHERE vehicule_id IN ($in) GROUP BY vehicule_id", $ids) as $s) {
            $stats[(int) $s['vehicule_id']] = $s;
        }
        $prep = Checklist::summaries($ids);
        $next = [];
        foreach (Db::all("SELECT vehicule_id, MIN(start_at) AS prochain FROM la_rendez_vous WHERE vehicule_id IN ($in) AND statut IN ('en_attente', 'confirme') AND start_at >= ? GROUP BY vehicule_id", array_merge($ids, [Db::now()])) as $n) {
            $next[(int) $n['vehicule_id']] = $n['prochain'];
        }

        $out = [];
        foreach ($rows as $r) {
            $id = (int) $r['id'];
            $s = $stats[$id] ?? [];
            $item = self::toAdmin($r, [
                'demandes' => (int) ($s['demandes'] ?? 0),
                'nouvelles' => (int) ($s['nouvelles'] ?? 0),
                'offres' => (int) ($s['offres'] ?? 0),
                'offresOuvertes' => (int) ($s['offres_ouvertes'] ?? 0),
                'meilleureOffre' => isset($s['meilleure_offre']) ? (int) $s['meilleure_offre'] : null,
                'preparation' => $prep[$id] ?? ['faits' => 0, 'total' => 0, 'manquants' => []],
                'prochainRdv' => $next[$id] ?? null,
            ]);
            if (!empty($q['preparation']) && $q['preparation'] === 'incomplete' && $item['preparation']['faits'] >= $item['preparation']['total']) {
                continue;
            }
            if (!empty($q['ct']) && $q['ct'] === 'alerte' && !in_array($item['ct']['etat'], ['echu', 'bientot'], true)) {
                continue;
            }
            $out[] = $item;
        }
        return $out;
    }

    public static function get(array $user, int $id): array
    {
        Access::vehicule($user, $id);
        $r = Db::one('SELECT v.*, p.nom AS parc_nom FROM la_vehicules v LEFT JOIN la_parcs p ON p.id = v.parc_id WHERE v.id = ?', [$id]);
        $prep = Checklist::summaries([$id]);
        return self::toAdmin($r, ['preparation' => $prep[$id] ?? ['faits' => 0, 'total' => 0, 'manquants' => []]]);
    }

    public static function findBySlug(string $slug): ?array
    {
        return Db::one('SELECT * FROM la_vehicules WHERE slug = ?', [$slug]);
    }

    /** Création ou mise à jour de l'annonce et de l'identification (propriétaire ou secrétaire référente). */
    public static function save(array $user, array $in): array
    {
        Access::require($user, 'vehicules.modifier');
        $id = isset($in['dbId']) ? (int) $in['dbId'] : 0;
        $existing = $id ? Access::vehicule($user, $id) : null;

        $str = fn($k, $max = 160) => In::str($in, $k, $max);
        $num = fn($k, $min, $max, $req = false, $label = '') => In::int($in, $k, $min, $max, $req, $label);
        $oneOf = function ($k, array $list, $default) use ($in) {
            $v = $in[$k] ?? $default;
            return in_array($v, $list, true) ? $v : $default;
        };

        $data = [
            'marque' => $str('marque', 80),
            'modele' => $str('modele', 80),
            'version' => $str('version'),
            'annee' => $num('annee', 1950, (int) date('Y') + 1, true, 'année'),
            'mise_en_circulation' => $str('miseEnCirculation', 7),
            'km' => $num('km', 0, 2_000_000, true, 'kilométrage'),
            'energie' => $oneOf('energie', self::ENERGIES, 'Essence'),
            'boite' => $oneOf('boite', self::BOITES, 'Manuelle'),
            'carrosserie' => $oneOf('carrosserie', self::CARROSSERIES, 'Citadine'),
            'puissance' => $num('puissance', 1, 2000),
            'cv' => $num('cv', 1, 200),
            'portes' => $num('portes', 1, 9),
            'places' => $num('places', 1, 9),
            'couleur' => $str('couleur', 80),
            'critair' => $num('critair', 0, 5),
            'premiere_main' => In::bool($in, 'premiereMain'),
            'quatre_roues' => In::bool($in, 'quatreRoues'),
            'autonomie' => $num('autonomie', 1, 2000),
            'garantie' => $num('garantie', 0, 120) ?? 12,
            'prix' => $num('prix', 1, 10_000_000, true, 'prix'),
            'prix_barre' => $num('prixBarre', 1, 10_000_000),
            'badge' => $str('badge', 60) ?: null,
            'description' => mb_substr(trim((string) ($in['description'] ?? '')), 0, 5000),
            'equipements' => json_encode(self::cleanList($in['equipements'] ?? []), JSON_UNESCAPED_UNICODE),
            'photos' => json_encode(self::cleanPhotos($in['photos'] ?? []), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'immatriculation' => In::immat((string) ($in['immatriculation'] ?? '')),
            'vin' => strtoupper(preg_replace('/[^A-Za-z0-9]/', '', In::str($in, 'vin', 17))),
            'emplacement' => $str('emplacement', 80),
            'updated_at' => Db::now(),
        ];
        if ($data['marque'] === '' || $data['modele'] === '') {
            Http::fail(422, 'La marque et le modèle sont obligatoires.');
        }
        if ($data['prix_barre'] !== null && $data['prix_barre'] <= $data['prix']) {
            $data['prix_barre'] = null;
        }
        if ($data['vin'] !== '' && strlen($data['vin']) !== 17) {
            Http::fail(422, 'Le numéro VIN doit contenir 17 caractères.');
        }
        $stock = strtoupper(preg_replace('/[^A-Za-z0-9-]/', '', $str('numeroStock', 40)));
        if ($stock !== '') {
            if (Db::value('SELECT id FROM la_vehicules WHERE numero_stock = ? AND id <> ?', [$stock, $id])) {
                Http::fail(422, 'Ce numéro de stock est déjà utilisé par un autre véhicule.');
            }
            $data['numero_stock'] = $stock;
        }
        if ($data['immatriculation'] !== '' && ($other = Db::one('SELECT numero_stock FROM la_vehicules WHERE immatriculation = ? AND id <> ? AND statut NOT IN (\'livre\', \'retire\')', [$data['immatriculation'], $id]))) {
            Http::fail(422, 'Cette immatriculation est déjà enregistrée (véhicule ' . $other['numero_stock'] . ').');
        }

        // Statut : uniquement à la création ici (ensuite via setStatut, transitions contrôlées)
        if ($existing) {
            if (isset($in['statut']) && $in['statut'] !== $existing['statut']) {
                self::checkTransition($user, $existing, (string) $in['statut']);
                $data['statut'] = $in['statut'];
            }
            if (isset($in['parcId']) && (int) $in['parcId'] !== (int) $existing['parc_id']) {
                Http::fail(422, 'Pour changer de parc, utilisez « Transférer » (historique conservé).');
            }
        } else {
            $data['statut'] = in_array($in['statut'] ?? '', ['brouillon', 'disponible'], true) ? $in['statut'] : 'brouillon';
            $parc = (int) ($in['parcId'] ?? 0);
            if (!$parc) {
                $mine = Access::parcIds($user);
                $parc = $mine === null ? (int) Db::value('SELECT MIN(id) FROM la_parcs WHERE actif = 1') : (count($mine) === 1 ? $mine[0] : 0);
            }
            if (!$parc) {
                Http::fail(422, 'Choisissez le parc du véhicule.');
            }
            Access::requireParc($user, $parc);
            $data['parc_id'] = $parc;
        }
        $online = in_array($data['statut'] ?? ($existing['statut'] ?? ''), ['disponible', 'reserve'], true);
        $data['publie_le'] = $existing['publie_le'] ?? null;
        if ($online && !$data['publie_le']) {
            $data['publie_le'] = date('Y-m-d');
        }

        if ($existing) {
            Db::update('la_vehicules', $data, $id);
            Audit::log($user, 'vehicule.modifier', 'vehicule', $id, self::auditable($existing), self::auditable($data));
        } else {
            $data['created_at'] = Db::now();
            $data['slug'] = 'tmp-' . bin2hex(random_bytes(6));
            $id = Db::insert('la_vehicules', $data);
            $upd = [
                'slug' => self::slugify($data['marque'] . ' ' . $data['modele'] . ' ' . $data['annee']) . '-' . $id,
                'ref' => 'LA-' . (2400 + $id),
            ];
            if (empty($data['numero_stock'])) {
                $upd['numero_stock'] = 'LA-' . (2400 + $id);
            }
            Db::update('la_vehicules', $upd, $id);
            Checklist::ensure($id);
            Audit::log($user, 'vehicule.creer', 'vehicule', $id, null, self::auditable($data + $upd));
        }
        return self::get($user, $id);
    }

    private static function auditable(array $d): array
    {
        unset($d['description'], $d['equipements'], $d['photos'], $d['updated_at']);
        return $d;
    }

    public static function checkTransition(array $user, array $v, string $to): void
    {
        if (!in_array($to, self::STATUTS, true)) {
            Http::fail(422, 'Statut invalide.');
        }
        $from = $v['statut'];
        if ($from === $to) {
            return;
        }
        if (!in_array($to, self::TRANSITIONS[$from] ?? [], true)) {
            Http::fail(409, 'Passage de « ' . self::STATUT_LABELS[$from] . ' » à « ' . self::STATUT_LABELS[$to] . ' » non autorisé.');
        }
        if (in_array($to, ['vendu', 'livre'], true) || in_array($from, ['vendu', 'livre'], true)) {
            Access::require($user, 'ventes.gerer');
            if ($to === 'vendu' && !Db::value("SELECT COUNT(*) FROM la_ventes WHERE vehicule_id = ? AND statut <> 'annulee'", [(int) $v['id']])) {
                Http::fail(409, 'Enregistrez d\'abord la vente (onglet Vente & finance) : prix final, acheteur et date.');
            }
        } else {
            Access::require($user, 'vehicules.statut');
        }
    }

    public static function setStatut(array $user, int $id, string $statut): array
    {
        return Db::transaction(function () use ($user, $id, $statut) {
            $v = Access::vehicule($user, $id);
            Db::lockRow('la_vehicules', $id);
            self::checkTransition($user, $v, $statut);
            $data = ['statut' => $statut, 'updated_at' => Db::now()];
            if (in_array($statut, ['disponible', 'reserve'], true) && !$v['publie_le']) {
                $data['publie_le'] = date('Y-m-d');
            }
            Db::update('la_vehicules', $data, $id);
            Audit::log($user, 'vehicule.statut', 'vehicule', $id, ['statut' => $v['statut']], ['statut' => $statut]);
            return self::get($user, $id);
        });
    }

    /** Marque le véhicule « prêt pour le rendez-vous » (ou non), avec auteur et date de vérification. */
    public static function setPret(array $user, int $id, bool $pret): array
    {
        Access::require($user, 'vehicules.preparer');
        Access::vehicule($user, $id);
        Db::update('la_vehicules', ['pret_visite' => $pret ? 1 : 0, 'pret_verifie_le' => Db::now(), 'pret_verifie_par' => $user['id'], 'updated_at' => Db::now()], $id);
        Audit::log($user, 'vehicule.pret', 'vehicule', $id, null, ['pret_visite' => $pret]);
        return self::get($user, $id);
    }

    /** Données du contrôle technique (une échéance saisie doit être vérifiée explicitement). */
    public static function saveCt(array $user, array $in): array
    {
        Access::require($user, 'vehicules.preparer');
        $id = (int) ($in['id'] ?? 0);
        $v = Access::vehicule($user, $id);
        $data = [
            'ct_date' => In::date($in, 'date', false, 'date du contrôle'),
            'ct_resultat' => ($in['resultat'] ?? '') === '' ? '' : In::oneOf($in, 'resultat', array_keys(self::CT_RESULTATS), null, 'résultat'),
            'ct_echeance' => In::date($in, 'echeance', false, 'échéance'),
            'ct_echeance_verifiee' => In::bool($in, 'echeanceVerifiee'),
            'ct_centre' => In::str($in, 'centre', 120),
            'ct_cout_centimes' => In::cents($in, 'cout', false, 'coût'),
            'ct_document_id' => isset($in['documentId']) && $in['documentId'] !== '' && $in['documentId'] !== null ? (int) $in['documentId'] : ($v['ct_document_id'] !== null ? (int) $v['ct_document_id'] : null),
            'updated_at' => Db::now(),
        ];
        if ($data['ct_echeance'] && $data['ct_date'] && $data['ct_echeance'] <= $data['ct_date']) {
            Http::fail(422, 'L\'échéance doit être postérieure à la date du contrôle.');
        }
        if (!$data['ct_echeance']) {
            $data['ct_echeance_verifiee'] = 0;
        }
        if ($data['ct_document_id'] && !Db::value('SELECT COUNT(*) FROM la_documents WHERE id = ? AND vehicule_id = ? AND supprime_le IS NULL', [$data['ct_document_id'], $id])) {
            Http::fail(422, 'Document de contrôle technique introuvable pour ce véhicule.');
        }
        Db::update('la_vehicules', $data, $id);
        Audit::log($user, 'vehicule.controle_technique', 'vehicule', $id, array_intersect_key($v, $data), $data);
        Checklist::syncCt($user, $id, $data);
        return self::get($user, $id);
    }

    /** Suppression définitive : seulement un brouillon/retiré sans historique (sinon : retirer). */
    public static function delete(array $user, int $id): void
    {
        Access::require($user, 'vehicules.supprimer');
        $v = Access::vehicule($user, $id);
        $linked = (int) Db::value('SELECT COUNT(*) FROM la_rendez_vous WHERE vehicule_id = ?', [$id])
            + (int) Db::value('SELECT COUNT(*) FROM la_ventes WHERE vehicule_id = ?', [$id])
            + (int) Db::value('SELECT COUNT(*) FROM la_finance_entries WHERE vehicule_id = ?', [$id]);
        if (in_array($v['statut'], ['vendu', 'livre', 'reserve'], true) || $linked > 0) {
            Http::fail(409, 'Ce véhicule a un historique (rendez-vous, vente ou écritures) : utilisez « Retirer » plutôt que la suppression.');
        }
        foreach (json_decode($v['photos'] ?: '[]', true) ?: [] as $p) {
            Uploads::deleteLocal($p);
        }
        Db::exec('DELETE FROM la_vehicule_checklist WHERE vehicule_id = ?', [$id]);
        Db::exec('DELETE FROM la_vehicules WHERE id = ?', [$id]);
        Audit::log($user, 'vehicule.supprimer', 'vehicule', $id, self::auditable($v), null);
    }

    /** Retire du site toutes les annonces de démonstration importées (réversible). */
    public static function retirerDemo(array $user): int
    {
        Access::require($user, 'vehicules.supprimer');
        $ids = array_map('intval', array_column(Db::all("SELECT id FROM la_vehicules WHERE demo = 1 AND statut IN ('brouillon', 'disponible', 'reserve')"), 'id'));
        foreach ($ids as $id) {
            Db::update('la_vehicules', ['statut' => 'retire', 'updated_at' => Db::now()], $id);
        }
        Audit::log($user, 'vehicule.retirer_demo', 'vehicule', null, null, ['nombre' => count($ids)]);
        return count($ids);
    }

    public static function slugify(string $s): string
    {
        // Translittération explicite (le résultat d'iconv varie selon le serveur)
        $s = strtr($s, [
            'à' => 'a', 'â' => 'a', 'ä' => 'a', 'á' => 'a', 'ã' => 'a', 'å' => 'a', 'ç' => 'c', 'č' => 'c',
            'é' => 'e', 'è' => 'e', 'ê' => 'e', 'ë' => 'e', 'ě' => 'e', 'í' => 'i', 'î' => 'i', 'ï' => 'i', 'ì' => 'i',
            'ñ' => 'n', 'ó' => 'o', 'ô' => 'o', 'ö' => 'o', 'ò' => 'o', 'õ' => 'o', 'ø' => 'o', 'ř' => 'r', 'š' => 's',
            'ú' => 'u', 'û' => 'u', 'ü' => 'u', 'ù' => 'u', 'ý' => 'y', 'ÿ' => 'y', 'ž' => 'z', 'œ' => 'oe', 'æ' => 'ae', 'ß' => 'ss',
            'À' => 'a', 'Â' => 'a', 'Ç' => 'c', 'É' => 'e', 'È' => 'e', 'Ê' => 'e', 'Î' => 'i', 'Ô' => 'o', 'Ö' => 'o', 'Û' => 'u', 'Ü' => 'u', 'Š' => 's', 'Č' => 'c', 'Ž' => 'z', 'Œ' => 'oe',
        ]);
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
