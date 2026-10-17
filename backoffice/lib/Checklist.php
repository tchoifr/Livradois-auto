<?php
declare(strict_types=1);

/**
 * Préparation administrative (non mécanique) : checklist configurable par véhicule.
 * Aucune notion de réparation, d'ordre de réparation, de pièces ou de mécanicien.
 */
final class Checklist
{
    public const STATUTS = ['a_faire' => 'À faire', 'en_cours' => 'En cours', 'termine' => 'Terminé', 'non_necessaire' => 'Non nécessaire'];
    public const CATEGORIES = [
        'preparation' => 'Préparation', 'documents' => 'Documents', 'administratif' => 'Administratif',
        'visite' => 'Avant visite', 'livraison' => 'Avant livraison',
    ];
    /** Catégories prises en compte selon le statut du véhicule. */
    private const STOCK_CATS = ['preparation', 'documents', 'administratif', 'visite'];

    private const DEFAULT_ITEMS = [
        ['nettoyage_interieur', 'Nettoyage intérieur', 'preparation', 1],
        ['nettoyage_exterieur', 'Nettoyage extérieur', 'preparation', 1],
        ['photos', 'Photos de l\'annonce', 'preparation', 1],
        ['doc_carte_grise', 'Carte grise (certificat d\'immatriculation)', 'documents', 1],
        ['doc_non_gage', 'Certificat de situation administrative (non-gage)', 'documents', 1],
        ['doc_entretien', 'Carnet / factures d\'entretien', 'documents', 0],
        ['controle_technique', 'Contrôle technique à jour et vérifié', 'documents', 1],
        ['verification_admin', 'Vérification administrative', 'administratif', 1],
        ['pret_visite', 'Véhicule prêt pour les rendez-vous', 'visite', 1],
        ['livraison_documents', 'Documents de vente prêts', 'livraison', 1],
        ['livraison_paiement', 'Paiement vérifié', 'livraison', 1],
        ['livraison_rdv', 'Rendez-vous de livraison planifié', 'livraison', 1],
        ['livraison_admin', 'État administratif final (cession, carte grise)', 'livraison', 1],
    ];

    public static function seedItems(): void
    {
        foreach (self::DEFAULT_ITEMS as $i => [$code, $libelle, $cat, $obl]) {
            if (!Db::value('SELECT COUNT(*) FROM la_checklist_items WHERE code = ?', [$code])) {
                Db::insert('la_checklist_items', ['code' => $code, 'libelle' => $libelle, 'categorie' => $cat, 'obligatoire' => $obl, 'actif' => 1, 'ordre' => $i]);
            }
        }
    }

    public static function items(bool $all = false): array
    {
        return Db::all('SELECT * FROM la_checklist_items' . ($all ? '' : ' WHERE actif = 1') . ' ORDER BY ordre, id');
    }

    /** Crée les lignes manquantes pour un véhicule (les lignes absentes valent « à faire »). */
    public static function ensure(int $vehiculeId): void
    {
        foreach (self::items() as $it) {
            if (!Db::value('SELECT COUNT(*) FROM la_vehicule_checklist WHERE vehicule_id = ? AND item_id = ?', [$vehiculeId, (int) $it['id']])) {
                Db::insert('la_vehicule_checklist', ['vehicule_id' => $vehiculeId, 'item_id' => (int) $it['id'], 'statut' => 'a_faire', 'updated_at' => Db::now(), 'commentaire' => '']);
            }
        }
    }

    private static function categoriesFor(string $statut): array
    {
        return in_array($statut, ['vendu', 'livre'], true) ? array_keys(self::CATEGORIES) : self::STOCK_CATS;
    }

    /** Avancement par véhicule : tâches obligatoires faites / total, libellés manquants. */
    public static function summaries(array $vehiculeIds): array
    {
        if (!$vehiculeIds) {
            return [];
        }
        $items = array_filter(self::items(), fn($i) => (int) $i['obligatoire'] === 1);
        $in = Db::in($vehiculeIds);
        $statuts = [];
        foreach (Db::all("SELECT id, statut FROM la_vehicules WHERE id IN ($in)", $vehiculeIds) as $v) {
            $statuts[(int) $v['id']] = $v['statut'];
        }
        $done = [];
        foreach (Db::all("SELECT vehicule_id, item_id, statut FROM la_vehicule_checklist WHERE vehicule_id IN ($in)", $vehiculeIds) as $r) {
            $done[(int) $r['vehicule_id']][(int) $r['item_id']] = $r['statut'];
        }
        $out = [];
        foreach ($vehiculeIds as $vid) {
            $cats = self::categoriesFor($statuts[$vid] ?? 'brouillon');
            $faits = 0;
            $total = 0;
            $manquants = [];
            foreach ($items as $it) {
                if (!in_array($it['categorie'], $cats, true)) {
                    continue;
                }
                $total++;
                $st = $done[$vid][(int) $it['id']] ?? 'a_faire';
                if ($st === 'termine' || $st === 'non_necessaire') {
                    $faits++;
                } else {
                    $manquants[] = $it['libelle'];
                }
            }
            $out[$vid] = ['faits' => $faits, 'total' => $total, 'manquants' => $manquants];
        }
        return $out;
    }

    public static function forVehicule(array $user, int $vehiculeId): array
    {
        $v = Access::vehicule($user, $vehiculeId);
        $rows = [];
        foreach (Db::all('SELECT c.*, r.name AS responsable, u.name AS maj_par FROM la_vehicule_checklist c
            LEFT JOIN la_admins r ON r.id = c.responsable_id LEFT JOIN la_admins u ON u.id = c.updated_by WHERE c.vehicule_id = ?', [$vehiculeId]) as $r) {
            $rows[(int) $r['item_id']] = $r;
        }
        $docs = [];
        foreach (Db::all('SELECT type, COUNT(*) AS n FROM la_documents WHERE vehicule_id = ? AND supprime_le IS NULL GROUP BY type', [$vehiculeId]) as $d) {
            $docs[$d['type']] = (int) $d['n'];
        }
        $cats = self::categoriesFor($v['statut']);
        $out = [];
        foreach (self::items() as $it) {
            $r = $rows[(int) $it['id']] ?? null;
            $out[] = [
                'itemId' => (int) $it['id'], 'code' => $it['code'], 'libelle' => $it['libelle'], 'categorie' => $it['categorie'],
                'categorieLabel' => self::CATEGORIES[$it['categorie']] ?? $it['categorie'], 'obligatoire' => (int) $it['obligatoire'] === 1,
                'concerne' => in_array($it['categorie'], $cats, true),
                'statut' => $r['statut'] ?? 'a_faire', 'responsableId' => isset($r['responsable_id']) ? (int) $r['responsable_id'] : null,
                'responsable' => $r['responsable'] ?? null, 'echeance' => $r['echeance'] ?? null, 'termineLe' => $r['completed_at'] ?? null,
                'commentaire' => $r['commentaire'] ?? '', 'majPar' => $r['maj_par'] ?? null, 'majLe' => $r['updated_at'] ?? null,
                'documents' => $docs[Documents::typeForItem($it['code'])] ?? 0,
            ];
        }
        return ['items' => $out, 'statuts' => self::STATUTS, 'categories' => self::CATEGORIES];
    }

    public static function update(array $user, array $in): array
    {
        Access::require($user, 'vehicules.preparer');
        $vid = (int) ($in['vehiculeId'] ?? 0);
        Access::vehicule($user, $vid);
        $item = Db::one('SELECT * FROM la_checklist_items WHERE id = ?', [(int) ($in['itemId'] ?? 0)]);
        if (!$item) {
            Http::fail(404, 'Tâche inconnue.');
        }
        $statut = In::oneOf($in, 'statut', array_keys(self::STATUTS), null, 'statut');
        $resp = isset($in['responsableId']) && $in['responsableId'] !== '' && $in['responsableId'] !== null ? (int) $in['responsableId'] : null;
        if ($resp !== null && !Db::value('SELECT COUNT(*) FROM la_admins WHERE id = ? AND actif = 1', [$resp])) {
            Http::fail(422, 'Responsable inconnu.');
        }
        $before = Db::one('SELECT * FROM la_vehicule_checklist WHERE vehicule_id = ? AND item_id = ?', [$vid, (int) $item['id']]);
        // Mise à jour partielle (ex. simple changement de statut) : un champ non transmis garde sa valeur
        $keep = fn(string $k, string $col, $value) => array_key_exists($k, $in) ? $value : ($before[$col] ?? $value);
        $data = [
            'statut' => $statut, 'responsable_id' => $keep('responsableId', 'responsable_id', $resp),
            'echeance' => $keep('echeance', 'echeance', In::date($in, 'echeance', false, 'échéance')),
            'commentaire' => $keep('commentaire', 'commentaire', In::str($in, 'commentaire', 500)), 'updated_by' => $user['id'], 'updated_at' => Db::now(),
            'completed_at' => $statut === 'termine' ? (($before['statut'] ?? '') === 'termine' ? $before['completed_at'] : Db::now()) : null,
        ];
        if ($before) {
            Db::update('la_vehicule_checklist', $data, (int) $before['id']);
        } else {
            Db::insert('la_vehicule_checklist', $data + ['vehicule_id' => $vid, 'item_id' => (int) $item['id']]);
        }
        Audit::log($user, 'preparation.' . $item['code'], 'vehicule', $vid, $before ? ['statut' => $before['statut']] : null, ['statut' => $statut, 'tache' => $item['libelle']]);
        if ($item['code'] === 'pret_visite') {
            Db::update('la_vehicules', ['pret_visite' => $statut === 'termine' ? 1 : 0, 'pret_verifie_le' => Db::now(), 'pret_verifie_par' => $user['id']], $vid);
        }
        return self::forVehicule($user, $vid);
    }

    /** Coche automatiquement la tâche CT quand le contrôle est favorable et l'échéance vérifiée et future. */
    public static function syncCt(array $user, int $vid, array $ct): void
    {
        $item = Db::one("SELECT id FROM la_checklist_items WHERE code = 'controle_technique'");
        if (!$item) {
            return;
        }
        $row = Db::one('SELECT * FROM la_vehicule_checklist WHERE vehicule_id = ? AND item_id = ?', [$vid, (int) $item['id']]);
        if ($row && $row['statut'] === 'non_necessaire') {
            return;
        }
        $ok = $ct['ct_resultat'] === 'favorable' && $ct['ct_echeance'] && (int) $ct['ct_echeance_verifiee'] === 1 && $ct['ct_echeance'] >= date('Y-m-d');
        $statut = $ok ? 'termine' : 'a_faire';
        $data = ['statut' => $statut, 'updated_by' => $user['id'], 'updated_at' => Db::now(), 'completed_at' => $ok ? Db::now() : null];
        if ($row) {
            Db::update('la_vehicule_checklist', $data, (int) $row['id']);
        } else {
            Db::insert('la_vehicule_checklist', $data + ['vehicule_id' => $vid, 'item_id' => (int) $item['id'], 'commentaire' => '']);
        }
    }

    /** Vue d'ensemble : véhicules en stock × tâches de préparation, rendez-vous des 7 prochains jours. */
    public static function board(array $user, array $q): array
    {
        $parc = !empty($q['parc']) ? ['parc' => (int) $q['parc']] : [];
        $vehicules = Vehicles::listAdmin($user, ['stock' => '1'] + $parc);
        $items = array_values(array_filter(self::items(), fn($i) => in_array($i['categorie'], self::STOCK_CATS, true)));
        $ids = array_map(fn($v) => $v['dbId'], $vehicules);
        $etat = [];
        if ($ids) {
            foreach (Db::all('SELECT vehicule_id, item_id, statut FROM la_vehicule_checklist WHERE vehicule_id IN (' . Db::in($ids) . ')', $ids) as $r) {
                $etat[(int) $r['vehicule_id']][(int) $r['item_id']] = $r['statut'];
            }
        }
        $rdv = Appointments::list($user, ['du' => date('Y-m-d'), 'au' => date('Y-m-d', strtotime('+7 days')), 'actifs' => '1'] + $parc);
        return [
            'taches' => array_map(fn($i) => ['id' => (int) $i['id'], 'code' => $i['code'], 'libelle' => $i['libelle'], 'categorie' => $i['categorie'], 'obligatoire' => (int) $i['obligatoire'] === 1], $items),
            'statuts' => self::STATUTS,
            'vehicules' => array_map(fn($v) => [
                'dbId' => $v['dbId'], 'titre' => $v['marque'] . ' ' . $v['modele'], 'numeroStock' => $v['numeroStock'], 'immatriculation' => $v['immatriculation'],
                'parc' => $v['parc'], 'statut' => $v['statut'], 'photo' => $v['photos'][0] ?? null, 'pretVisite' => $v['pretVisite'], 'ct' => $v['ct'],
                'preparation' => $v['preparation'], 'prochainRdv' => $v['prochainRdv'],
                'etats' => array_map(fn($i) => $etat[$v['dbId']][(int) $i['id']] ?? 'a_faire', $items),
            ], $vehicules),
            'rendezVous' => array_values(array_filter($rdv, fn($r) => in_array($r['motif'], ['visite', 'essai', 'livraison'], true))),
        ];
    }

    /** Gestion des tâches par l'administrateur (ajout, libellé, catégorie, obligatoire, activation). */
    public static function saveItem(array $user, array $in): array
    {
        $id = (int) ($in['id'] ?? 0);
        $data = [
            'libelle' => In::str($in, 'libelle', 120),
            'categorie' => In::oneOf($in, 'categorie', array_keys(self::CATEGORIES), 'preparation', 'catégorie'),
            'obligatoire' => In::bool($in, 'obligatoire'),
            'actif' => array_key_exists('actif', $in) ? In::bool($in, 'actif') : 1,
        ];
        if ($data['libelle'] === '') {
            Http::fail(422, 'Le libellé de la tâche est obligatoire.');
        }
        if ($id) {
            $before = Db::one('SELECT * FROM la_checklist_items WHERE id = ?', [$id]);
            if (!$before) {
                Http::fail(404, 'Tâche inconnue.');
            }
            Db::update('la_checklist_items', $data, $id);
            Audit::log($user, 'preparation.tache_modifier', 'checklist', $id, $before, $data);
        } else {
            $data['code'] = 'perso_' . substr(Vehicles::slugify($data['libelle']), 0, 25) . '_' . bin2hex(random_bytes(2));
            $data['code'] = str_replace('-', '_', $data['code']);
            $data['ordre'] = (int) Db::value('SELECT COALESCE(MAX(ordre), 0) + 1 FROM la_checklist_items');
            $id = Db::insert('la_checklist_items', $data);
            Audit::log($user, 'preparation.tache_creer', 'checklist', $id, null, $data);
        }
        return array_map(fn($i) => ['id' => (int) $i['id'], 'code' => $i['code'], 'libelle' => $i['libelle'], 'categorie' => $i['categorie'], 'obligatoire' => (int) $i['obligatoire'] === 1, 'actif' => (int) $i['actif'] === 1], self::items(true));
    }
}
