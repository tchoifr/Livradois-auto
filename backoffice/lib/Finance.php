<?php
declare(strict_types=1);

/**
 * Suivi de gestion par véhicule (pas une comptabilité) : coûts, vente, encaissements, marge estimée.
 * Montants en centimes entiers. Aucune écriture validée n'est effacée : correction par contre-écriture
 * (dépenses) ou annulation tracée (paiements). Réservé au propriétaire.
 */
final class Finance
{
    public const TYPES = ['achat' => 'Achat du véhicule', 'frais' => 'Frais / dépense'];
    public const CATEGORIES = [
        'achat' => 'Achat', 'transport' => 'Transport', 'administratif' => 'Frais administratifs', 'controle_technique' => 'Contrôle technique',
        'nettoyage' => 'Nettoyage', 'annonce' => 'Annonces / publicité', 'autre' => 'Autre (hors réparation)',
    ];
    public const VENTE_STATUTS = ['reservee' => 'Réservation', 'en_cours' => 'Vente en cours', 'finalisee' => 'Vente finalisée', 'livree' => 'Livrée', 'annulee' => 'Annulée'];
    public const PAIEMENT_TYPES = ['acompte' => 'Acompte', 'partiel' => 'Paiement partiel', 'solde' => 'Solde', 'remboursement' => 'Remboursement'];
    public const MOYENS = ['virement' => 'Virement', 'cheque' => 'Chèque', 'carte' => 'Carte bancaire', 'especes' => 'Espèces', 'financement' => 'Organisme de financement', 'autre' => 'Autre'];

    private static function vente(int $vid): ?array
    {
        return Db::one("SELECT * FROM la_ventes WHERE vehicule_id = ? AND statut <> 'annulee' ORDER BY id DESC LIMIT 1", [$vid]);
    }

    /** Totaux d'un véhicule (coût suivi, prix final, encaissé, reste, marge de gestion estimée). */
    public static function totals(int $vid): array
    {
        $cout = (int) Db::value("SELECT COALESCE(SUM(montant_centimes), 0) FROM la_finance_entries WHERE vehicule_id = ? AND statut = 'valide'", [$vid]);
        $achat = (int) Db::value("SELECT COALESCE(SUM(montant_centimes), 0) FROM la_finance_entries WHERE vehicule_id = ? AND statut = 'valide' AND type = 'achat'", [$vid]);
        $v = self::vente($vid);
        $prix = $v ? (int) $v['prix_final_centimes'] : null;
        $encaisse = $v ? self::encaisse((int) $v['id']) : 0;
        $prixAffiche = (int) Db::value('SELECT prix FROM la_vehicules WHERE id = ?', [$vid]) * 100;
        return [
            'achatCentimes' => $achat, 'fraisCentimes' => $cout - $achat, 'coutSuiviCentimes' => $cout,
            'prixFinalCentimes' => $prix, 'encaisseCentimes' => $encaisse,
            'resteCentimes' => $prix !== null ? $prix - $encaisse : null,
            'margeEstimeeCentimes' => $prix !== null ? $prix - $cout : null,
            'margePotentielleCentimes' => $prixAffiche - $cout,
        ];
    }

    private static function encaisse(int $venteId): int
    {
        return (int) Db::value("SELECT COALESCE(SUM(CASE WHEN type = 'remboursement' THEN -montant_centimes ELSE montant_centimes END), 0) FROM la_paiements WHERE vente_id = ? AND statut = 'valide'", [$venteId]);
    }

    public static function forVehicule(array $user, int $vid): array
    {
        Access::require($user, 'finance.voir');
        Access::vehicule($user, $vid);
        $entries = Db::all('SELECT f.*, a.name AS auteur, d.nom_fichier FROM la_finance_entries f LEFT JOIN la_admins a ON a.id = f.cree_par LEFT JOIN la_documents d ON d.id = f.document_id WHERE f.vehicule_id = ? ORDER BY f.date_operation, f.id', [$vid]);
        $reversed = [];
        foreach ($entries as $e) {
            if ($e['contre_ecriture_de_id'] !== null) {
                $reversed[(int) $e['contre_ecriture_de_id']] = (int) $e['id'];
            }
        }
        $ventes = Db::all('SELECT v.*, c.nom AS client_nom, c.prenom AS client_prenom FROM la_ventes v LEFT JOIN la_clients c ON c.id = v.client_id WHERE v.vehicule_id = ? ORDER BY v.id DESC', [$vid]);
        return [
            'ecritures' => array_map(fn($e) => [
                'id' => (int) $e['id'], 'type' => $e['type'], 'typeLabel' => self::TYPES[$e['type']] ?? $e['type'], 'categorie' => $e['categorie'],
                'categorieLabel' => self::CATEGORIES[$e['categorie']] ?? $e['categorie'], 'libelle' => $e['libelle'], 'montantCentimes' => (int) $e['montant_centimes'],
                'montantHtCentimes' => $e['montant_ht_centimes'] !== null ? (int) $e['montant_ht_centimes'] : null, 'date' => $e['date_operation'],
                'reference' => $e['reference'], 'tiers' => $e['tiers'], 'statutPaiement' => $e['statut_paiement'], 'document' => $e['nom_fichier'],
                'documentId' => $e['document_id'] !== null ? (int) $e['document_id'] : null,
                'contreEcritureDe' => $e['contre_ecriture_de_id'] !== null ? (int) $e['contre_ecriture_de_id'] : null,
                'annuleePar' => $reversed[(int) $e['id']] ?? null, 'auteur' => $e['auteur'], 'creeLe' => $e['created_at'],
            ], $entries),
            'ventes' => array_map(fn($v) => self::venteOut($v), $ventes),
            'totaux' => self::totals($vid),
            'listes' => ['types' => self::TYPES, 'categories' => self::CATEGORIES, 'venteStatuts' => self::VENTE_STATUTS, 'paiementTypes' => self::PAIEMENT_TYPES, 'moyens' => self::MOYENS],
        ];
    }

    private static function venteOut(array $v): array
    {
        $paiements = Db::all('SELECT p.*, a.name AS auteur FROM la_paiements p LEFT JOIN la_admins a ON a.id = p.cree_par WHERE p.vente_id = ? ORDER BY p.date_paiement, p.id', [(int) $v['id']]);
        $enc = self::encaisse((int) $v['id']);
        return [
            'id' => (int) $v['id'], 'statut' => $v['statut'], 'statutLabel' => self::VENTE_STATUTS[$v['statut']] ?? $v['statut'],
            'clientId' => $v['client_id'] !== null ? (int) $v['client_id'] : null,
            'acheteur' => $v['client_id'] !== null && isset($v['client_nom']) ? trim(($v['client_prenom'] ?? '') . ' ' . $v['client_nom']) : $v['acheteur'],
            'prixFinalCentimes' => (int) $v['prix_final_centimes'], 'dateReservation' => $v['date_reservation'], 'dateLimiteReservation' => $v['date_limite_reservation'],
            'dateVente' => $v['date_vente'], 'dateLivraison' => $v['date_livraison'], 'reference' => $v['reference_document'],
            'documentsRemis' => $v['documents_remis'], 'notes' => (string) $v['notes'], 'responsableId' => $v['responsable_id'] !== null ? (int) $v['responsable_id'] : null,
            'encaisseCentimes' => $enc, 'resteCentimes' => (int) $v['prix_final_centimes'] - $enc,
            'paiements' => array_map(fn($p) => [
                'id' => (int) $p['id'], 'type' => $p['type'], 'typeLabel' => self::PAIEMENT_TYPES[$p['type']] ?? $p['type'], 'montantCentimes' => (int) $p['montant_centimes'],
                'date' => $p['date_paiement'], 'moyen' => $p['moyen'], 'moyenLabel' => self::MOYENS[$p['moyen']] ?? $p['moyen'], 'reference' => $p['reference'],
                'statut' => $p['statut'], 'commentaire' => $p['commentaire'], 'auteur' => $p['auteur'],
            ], $paiements),
        ];
    }

    public static function addEntry(array $user, array $in): array
    {
        Access::require($user, 'finance.gerer');
        $vid = (int) ($in['vehiculeId'] ?? 0);
        Access::vehicule($user, $vid);
        $type = In::oneOf($in, 'type', array_keys(self::TYPES), null, 'type');
        $cat = $type === 'achat' ? 'achat' : In::oneOf($in, 'categorie', array_diff(array_keys(self::CATEGORIES), ['achat']), null, 'catégorie');
        $montant = In::cents($in, 'montant', true, 'montant TTC');
        if ($montant <= 0) {
            Http::fail(422, 'Le montant doit être supérieur à zéro.');
        }
        $ht = In::cents($in, 'montantHt', false, 'montant HT');
        if ($ht !== null && $ht > $montant) {
            Http::fail(422, 'Le montant HT ne peut pas dépasser le montant TTC.');
        }
        $doc = isset($in['documentId']) && $in['documentId'] !== '' ? (int) $in['documentId'] : null;
        if ($doc && !Db::value('SELECT COUNT(*) FROM la_documents WHERE id = ? AND vehicule_id = ?', [$doc, $vid])) {
            Http::fail(422, 'Justificatif introuvable pour ce véhicule.');
        }
        $data = [
            'vehicule_id' => $vid, 'type' => $type, 'categorie' => $cat, 'libelle' => In::str($in, 'libelle', 200),
            'montant_centimes' => $montant, 'montant_ht_centimes' => $ht, 'date_operation' => In::date($in, 'date', true, 'date'),
            'reference' => In::str($in, 'reference', 80), 'tiers' => In::str($in, 'tiers', 120),
            'statut_paiement' => In::oneOf($in, 'statutPaiement', ['', 'paye', 'a_payer'], '', 'statut de paiement'),
            'document_id' => $doc, 'statut' => 'valide', 'contre_ecriture_de_id' => null, 'cree_par' => $user['id'], 'created_at' => Db::now(),
        ];
        $id = Db::insert('la_finance_entries', $data);
        Audit::log($user, 'finance.ecriture', 'vehicule', $vid, null, ['ecriture' => $id] + $data);
        return self::forVehicule($user, $vid);
    }

    /** Correction d'une dépense : écriture inverse liée (l'originale reste visible, barrée). */
    public static function contrepasser(array $user, int $id, string $motif): array
    {
        Access::require($user, 'finance.gerer');
        $e = Db::one('SELECT * FROM la_finance_entries WHERE id = ?', [$id]);
        if (!$e) {
            Http::fail(404, 'Écriture introuvable.');
        }
        Access::vehicule($user, (int) $e['vehicule_id']);
        if ($e['contre_ecriture_de_id'] !== null) {
            Http::fail(409, 'Une contre-écriture ne peut pas être annulée : saisissez une nouvelle écriture.');
        }
        if (Db::value('SELECT COUNT(*) FROM la_finance_entries WHERE contre_ecriture_de_id = ?', [$id])) {
            Http::fail(409, 'Cette écriture a déjà été annulée.');
        }
        $motif = trim($motif);
        if ($motif === '') {
            Http::fail(422, 'Indiquez le motif de la correction.');
        }
        $rid = Db::insert('la_finance_entries', [
            'vehicule_id' => (int) $e['vehicule_id'], 'type' => $e['type'], 'categorie' => $e['categorie'],
            'libelle' => mb_substr('Annulation : ' . $e['libelle'] . ' — ' . $motif, 0, 200), 'montant_centimes' => -(int) $e['montant_centimes'],
            'montant_ht_centimes' => $e['montant_ht_centimes'] !== null ? -(int) $e['montant_ht_centimes'] : null, 'date_operation' => date('Y-m-d'),
            'reference' => $e['reference'], 'tiers' => $e['tiers'], 'statut_paiement' => '', 'document_id' => null, 'statut' => 'valide',
            'contre_ecriture_de_id' => $id, 'cree_par' => $user['id'], 'created_at' => Db::now(),
        ]);
        Audit::log($user, 'finance.contre_ecriture', 'vehicule', (int) $e['vehicule_id'], ['ecriture' => $id, 'montant' => (int) $e['montant_centimes']], ['contre_ecriture' => $rid, 'motif' => $motif]);
        return self::forVehicule($user, (int) $e['vehicule_id']);
    }

    /**
     * Réservation / vente / livraison. Une seule vente active par véhicule.
     * Le statut commercial du véhicule suit : réservée → réservé, finalisée → vendu, livrée → livré, annulée → disponible.
     */
    public static function saveVente(array $user, array $in): array
    {
        Access::require($user, 'ventes.gerer');
        $vid = (int) ($in['vehiculeId'] ?? 0);
        return Db::transaction(function () use ($user, $in, $vid) {
            $veh = Access::vehicule($user, $vid);
            Db::lockRow('la_vehicules', $vid);
            $id = (int) ($in['id'] ?? 0);
            $before = $id ? Db::one('SELECT * FROM la_ventes WHERE id = ? AND vehicule_id = ?', [$id, $vid]) : null;
            if ($id && !$before) {
                Http::fail(404, 'Vente introuvable.');
            }
            if ($before && $before['statut'] === 'annulee') {
                Http::fail(409, 'Une vente annulée ne peut plus être modifiée.');
            }
            if (!$id && self::vente($vid)) {
                Http::fail(409, 'Une vente est déjà en cours pour ce véhicule.');
            }
            $statut = In::oneOf($in, 'statut', array_keys(self::VENTE_STATUTS), 'reservee', 'statut');
            // Mise à jour partielle : un champ non transmis conserve sa valeur enregistrée
            $has = fn(string $k) => array_key_exists($k, $in);
            $keep = fn(string $k, string $col, $value) => $has($k) ? $value : ($before[$col] ?? $value);
            $clientId = isset($in['clientId']) && $in['clientId'] !== '' && $in['clientId'] !== null ? (int) $in['clientId'] : null;
            $clientId = $keep('clientId', 'client_id', $clientId);
            $clientId = $clientId !== null ? (int) $clientId : null;
            if ($clientId && !Db::value('SELECT COUNT(*) FROM la_clients WHERE id = ?', [$clientId])) {
                Http::fail(422, 'Client introuvable.');
            }
            $final = in_array($statut, ['finalisee', 'livree'], true);
            $prix = In::cents($in, 'prixFinal', false, 'prix final');
            $data = [
                'vehicule_id' => $vid, 'client_id' => $clientId, 'acheteur' => $keep('acheteur', 'acheteur', In::str($in, 'acheteur', 160)), 'statut' => $statut,
                'prix_final_centimes' => $prix ?? (int) ($before['prix_final_centimes'] ?? 0),
                'date_reservation' => In::date($in, 'dateReservation') ?? ($before['date_reservation'] ?? ($statut === 'reservee' ? date('Y-m-d') : null)),
                'date_limite_reservation' => $keep('dateLimiteReservation', 'date_limite_reservation', In::date($in, 'dateLimiteReservation')),
                'date_vente' => In::date($in, 'dateVente') ?? ($before['date_vente'] ?? null),
                'date_livraison' => In::date($in, 'dateLivraison') ?? ($before['date_livraison'] ?? null),
                'reference_document' => $keep('reference', 'reference_document', In::str($in, 'reference', 80)),
                'documents_remis' => $keep('documentsRemis', 'documents_remis', In::str($in, 'documentsRemis', 500)),
                'responsable_id' => isset($in['responsableId']) && $in['responsableId'] !== '' ? (int) $in['responsableId'] : ($before['responsable_id'] ?? $user['id']),
                'notes' => $keep('notes', 'notes', In::str($in, 'notes', 2000)), 'updated_at' => Db::now(),
            ];
            if ($final && !$data['date_vente']) {
                Http::fail(422, 'La date de vente est obligatoire.');
            }
            if ($statut === 'livree' && !$data['date_livraison']) {
                Http::fail(422, 'La date de livraison est obligatoire.');
            }
            if (!$clientId && $data['acheteur'] === '') {
                Http::fail(422, 'Indiquez l\'acheteur (fiche client ou nom).');
            }
            if (in_array($statut, ['finalisee', 'livree'], true) && $data['prix_final_centimes'] <= 0) {
                Http::fail(422, 'Le prix de vente final est obligatoire.');
            }
            $target = ['reservee' => 'reserve', 'en_cours' => 'reserve', 'finalisee' => 'vendu', 'livree' => 'livre', 'annulee' => 'disponible'][$statut];
            if ($before) {
                Db::update('la_ventes', $data, $id);
                Audit::log($user, 'vente.modifier', 'vehicule', $vid, $before, $data);
            } else {
                $data['created_at'] = Db::now();
                $id = Db::insert('la_ventes', $data);
                Audit::log($user, 'vente.creer', 'vehicule', $vid, null, $data);
            }
            if ($veh['statut'] !== $target) {
                $upd = ['statut' => $target, 'updated_at' => Db::now()];
                if ($target === 'disponible' && !$veh['publie_le']) {
                    $upd['publie_le'] = date('Y-m-d');
                }
                Db::update('la_vehicules', $upd, $vid);
                Audit::log($user, 'vehicule.statut', 'vehicule', $vid, ['statut' => $veh['statut']], ['statut' => $target, 'via' => 'vente']);
                Diffusion::vehiculeChange($user, $vid, $veh['statut']);
            }
            if ($clientId && (!$before || $before['statut'] !== $statut)) {
                Clients::history($user, $clientId, $statut === 'livree' ? 'livraison' : 'vente', self::VENTE_STATUTS[$statut] . ' — ' . $veh['marque'] . ' ' . $veh['modele'], ['vehicule_id' => $vid]);
            }
            return self::forVehicule($user, $vid);
        });
    }

    public static function addPaiement(array $user, array $in): array
    {
        Access::require($user, 'ventes.gerer');
        $vente = Db::one('SELECT * FROM la_ventes WHERE id = ?', [(int) ($in['venteId'] ?? 0)]);
        if (!$vente) {
            Http::fail(404, 'Vente introuvable.');
        }
        Access::vehicule($user, (int) $vente['vehicule_id']);
        if ($vente['statut'] === 'annulee') {
            Http::fail(409, 'Vente annulée : aucun paiement ne peut y être ajouté.');
        }
        $montant = In::cents($in, 'montant', true, 'montant');
        if ($montant <= 0) {
            Http::fail(422, 'Le montant doit être supérieur à zéro.');
        }
        $data = [
            'vente_id' => (int) $vente['id'], 'type' => In::oneOf($in, 'type', array_keys(self::PAIEMENT_TYPES), null, 'type de paiement'),
            'montant_centimes' => $montant, 'date_paiement' => In::date($in, 'date', true, 'date du paiement'),
            'moyen' => In::oneOf($in, 'moyen', array_keys(self::MOYENS), 'virement', 'moyen de paiement'), 'reference' => In::str($in, 'reference', 80),
            'statut' => 'valide', 'commentaire' => In::str($in, 'commentaire', 255), 'document_id' => null, 'cree_par' => $user['id'], 'created_at' => Db::now(),
        ];
        if ($data['type'] === 'remboursement' && $montant > self::encaisse((int) $vente['id'])) {
            Http::fail(422, 'Le remboursement dépasse les sommes encaissées.');
        }
        $id = Db::insert('la_paiements', $data);
        Audit::log($user, 'vente.paiement', 'vehicule', (int) $vente['vehicule_id'], null, ['paiement' => $id] + $data);
        return self::forVehicule($user, (int) $vente['vehicule_id']);
    }

    /** Annulation tracée d'un paiement saisi par erreur (jamais supprimé). */
    public static function annulerPaiement(array $user, int $id, string $motif): array
    {
        Access::require($user, 'ventes.gerer');
        $p = Db::one('SELECT p.*, v.vehicule_id FROM la_paiements p JOIN la_ventes v ON v.id = p.vente_id WHERE p.id = ?', [$id]);
        if (!$p) {
            Http::fail(404, 'Paiement introuvable.');
        }
        Access::vehicule($user, (int) $p['vehicule_id']);
        if ($p['statut'] !== 'valide') {
            Http::fail(409, 'Ce paiement est déjà annulé.');
        }
        if (trim($motif) === '') {
            Http::fail(422, 'Indiquez le motif de l\'annulation.');
        }
        Db::exec("UPDATE la_paiements SET statut = 'annule', commentaire = ? WHERE id = ?", [mb_substr(trim($p['commentaire'] . ' [Annulé : ' . trim($motif) . ']'), 0, 255), $id]);
        Audit::log($user, 'vente.paiement_annule', 'vehicule', (int) $p['vehicule_id'], ['paiement' => $id, 'statut' => 'valide'], ['statut' => 'annule', 'motif' => $motif]);
        return self::forVehicule($user, (int) $p['vehicule_id']);
    }

    /** Liste des ventes (réservations, ventes en cours, à encaisser, livraisons à organiser). */
    public static function ventes(array $user, array $q): array
    {
        Access::require($user, 'ventes.gerer');
        [$scope, $p] = Access::scope($user, 'veh.parc_id');
        $where = '1 = 1' . $scope;
        if (!empty($q['statut']) && isset(self::VENTE_STATUTS[$q['statut']])) {
            $where .= ' AND v.statut = ?';
            $p[] = $q['statut'];
        }
        $rows = Db::all("SELECT v.*, c.nom AS client_nom, c.prenom AS client_prenom, veh.marque, veh.modele, veh.numero_stock, veh.photos, veh.statut AS vehicule_statut
            FROM la_ventes v JOIN la_vehicules veh ON veh.id = v.vehicule_id LEFT JOIN la_clients c ON c.id = v.client_id WHERE $where ORDER BY v.updated_at DESC LIMIT 500", $p);
        $out = [];
        foreach ($rows as $r) {
            $o = self::venteOut($r) + [
                'vehiculeId' => (int) $r['vehicule_id'], 'vehicule' => $r['marque'] . ' ' . $r['modele'], 'numeroStock' => $r['numero_stock'],
                'photo' => (json_decode($r['photos'] ?: '[]', true) ?: [])[0] ?? null, 'margeEstimeeCentimes' => null,
            ];
            $t = self::totals((int) $r['vehicule_id']);
            if ($r['statut'] !== 'annulee') {
                $o['margeEstimeeCentimes'] = (int) $r['prix_final_centimes'] - $t['coutSuiviCentimes'];
            }
            if (($q['aEncaisser'] ?? '') === '1' && ($r['statut'] === 'annulee' || $o['resteCentimes'] <= 0)) {
                continue;
            }
            $out[] = $o;
        }
        return $out;
    }

    /** Rapports de gestion (période par défaut : 12 derniers mois). */
    public static function rapports(array $user, array $q): array
    {
        Access::require($user, 'finance.voir');
        $au = In::date($q, 'au') ?? date('Y-m-d');
        $du = In::date($q, 'du') ?? date('Y-m-01', strtotime("$au -11 months"));
        $vendues = Db::all("SELECT v.*, veh.marque, veh.modele, veh.numero_stock FROM la_ventes v JOIN la_vehicules veh ON veh.id = v.vehicule_id
            WHERE v.statut IN ('finalisee', 'livree') AND v.date_vente BETWEEN ? AND ? ORDER BY v.date_vente", [$du, $au]);
        $mois = [];
        for ($m = strtotime(substr($du, 0, 7) . '-01'); $m <= strtotime($au); $m = strtotime('+1 month', $m)) {
            $mois[date('Y-m', $m)] = ['mois' => date('Y-m', $m), 'ventes' => 0, 'chiffreAffairesCentimes' => 0, 'encaissementsCentimes' => 0, 'margeEstimeeCentimes' => 0];
        }
        $marges = [];
        foreach ($vendues as $v) {
            $t = self::totals((int) $v['vehicule_id']);
            $k = substr($v['date_vente'], 0, 7);
            if (isset($mois[$k])) {
                $mois[$k]['ventes']++;
                $mois[$k]['chiffreAffairesCentimes'] += (int) $v['prix_final_centimes'];
                $mois[$k]['margeEstimeeCentimes'] += (int) $v['prix_final_centimes'] - $t['coutSuiviCentimes'];
            }
            $marges[] = ['vehiculeId' => (int) $v['vehicule_id'], 'vehicule' => $v['marque'] . ' ' . $v['modele'], 'numeroStock' => $v['numero_stock'], 'dateVente' => $v['date_vente'],
                'prixFinalCentimes' => (int) $v['prix_final_centimes'], 'coutSuiviCentimes' => $t['coutSuiviCentimes'], 'margeEstimeeCentimes' => (int) $v['prix_final_centimes'] - $t['coutSuiviCentimes']];
        }
        foreach (Db::all("SELECT p.date_paiement, p.type, p.montant_centimes FROM la_paiements p WHERE p.statut = 'valide' AND p.date_paiement BETWEEN ? AND ?", [$du, $au]) as $p) {
            $k = substr($p['date_paiement'], 0, 7);
            if (isset($mois[$k])) {
                $mois[$k]['encaissementsCentimes'] += ($p['type'] === 'remboursement' ? -1 : 1) * (int) $p['montant_centimes'];
            }
        }
        $depenses = Db::all("SELECT categorie, SUM(montant_centimes) AS total FROM la_finance_entries WHERE statut = 'valide' AND date_operation BETWEEN ? AND ? GROUP BY categorie ORDER BY total DESC", [$du, $au]);
        $stock = [];
        $stockCout = 0;
        $stockPrix = 0;
        foreach (Db::all("SELECT id, marque, modele, numero_stock, prix, created_at FROM la_vehicules WHERE statut IN ('brouillon', 'disponible', 'reserve') ORDER BY created_at") as $v) {
            $t = self::totals((int) $v['id']);
            $stockCout += $t['coutSuiviCentimes'];
            $stockPrix += (int) $v['prix'] * 100;
            $stock[] = ['vehiculeId' => (int) $v['id'], 'vehicule' => $v['marque'] . ' ' . $v['modele'], 'numeroStock' => $v['numero_stock'],
                'jours' => (int) floor((time() - strtotime($v['created_at'])) / 86400), 'coutSuiviCentimes' => $t['coutSuiviCentimes'], 'prixAfficheCentimes' => (int) $v['prix'] * 100];
        }
        $aEncaisser = self::ventes($user, ['aEncaisser' => '1']);
        return [
            'du' => $du, 'au' => $au, 'parMois' => array_values($mois), 'marges' => $marges,
            'depensesParCategorie' => array_map(fn($d) => ['categorie' => $d['categorie'], 'label' => self::CATEGORIES[$d['categorie']] ?? $d['categorie'], 'totalCentimes' => (int) $d['total']], $depenses),
            'stock' => ['nombre' => count($stock), 'coutSuiviCentimes' => $stockCout, 'prixAfficheCentimes' => $stockPrix, 'vehicules' => $stock],
            'aEncaisser' => ['totalCentimes' => array_sum(array_column($aEncaisser, 'resteCentimes')), 'ventes' => $aEncaisser],
            'avertissement' => 'Marge de gestion estimée : prix de vente final moins coûts saisis (achat et frais). À valider avec le comptable (TVA, régime des véhicules d\'occasion, coûts imputés).',
        ];
    }

    /** Export CSV pour le comptable : écritures et paiements de la période. */
    public static function exportCsv(array $user, array $q): void
    {
        Access::require($user, 'finance.voir');
        $du = In::date($q, 'du', true, 'début');
        $au = In::date($q, 'au', true, 'fin');
        $fmt = fn(int $c) => number_format($c / 100, 2, ',', '');
        $rows = [];
        foreach (Db::all("SELECT f.*, v.numero_stock, v.marque, v.modele, d.nom_fichier FROM la_finance_entries f JOIN la_vehicules v ON v.id = f.vehicule_id LEFT JOIN la_documents d ON d.id = f.document_id
            WHERE f.date_operation BETWEEN ? AND ? ORDER BY f.date_operation, f.id", [$du, $au]) as $f) {
            $rows[] = [$f['date_operation'], $f['numero_stock'], $f['marque'] . ' ' . $f['modele'], $f['contre_ecriture_de_id'] ? 'Contre-écriture' : (self::TYPES[$f['type']] ?? $f['type']),
                self::CATEGORIES[$f['categorie']] ?? $f['categorie'], $f['libelle'], $fmt(-(int) $f['montant_centimes']),
                $f['montant_ht_centimes'] !== null ? $fmt(-(int) $f['montant_ht_centimes']) : '', $f['reference'], $f['tiers'], $f['nom_fichier'] ?? ''];
        }
        foreach (Db::all("SELECT p.*, v.numero_stock, v.marque, v.modele, ve.reference_document FROM la_paiements p JOIN la_ventes ve ON ve.id = p.vente_id JOIN la_vehicules v ON v.id = ve.vehicule_id
            WHERE p.statut = 'valide' AND p.date_paiement BETWEEN ? AND ? ORDER BY p.date_paiement, p.id", [$du, $au]) as $p) {
            $signe = $p['type'] === 'remboursement' ? -1 : 1;
            $rows[] = [$p['date_paiement'], $p['numero_stock'], $p['marque'] . ' ' . $p['modele'], 'Encaissement – ' . (self::PAIEMENT_TYPES[$p['type']] ?? $p['type']),
                self::MOYENS[$p['moyen']] ?? $p['moyen'], $p['commentaire'], $fmt($signe * (int) $p['montant_centimes']), '', $p['reference'] ?: $p['reference_document'], '', ''];
        }
        usort($rows, fn($a, $b) => strcmp($a[0], $b[0]));
        Audit::log($user, 'finance.export', 'finance', null, null, ['du' => $du, 'au' => $au, 'lignes' => count($rows)]);
        Http::csv("livradois-finance-$du-$au.csv", ['Date', 'N° stock', 'Véhicule', 'Type', 'Catégorie / moyen', 'Libellé', 'Montant TTC (€)', 'Montant HT (€)', 'Référence', 'Tiers', 'Justificatif'], $rows);
    }
}
