<?php
declare(strict_types=1);

/** Tableau de bord (indicateurs issus de la base, filtrables par parc / personne) et recherche globale. */
final class Dashboard
{
    public static function tableau(array $user, array $q): array
    {
        $parc = !empty($q['parc']) ? (int) $q['parc'] : null;
        if ($parc !== null) {
            Access::requireParc($user, $parc);
        }
        $assigne = !empty($q['assigne']) ? (int) $q['assigne'] : null;
        $today = date('Y-m-d');
        $monday = date('Y-m-d', strtotime('monday this week'));
        $sunday = date('Y-m-d', strtotime('sunday this week'));

        $rdvFilter = ['actifs' => '1'] + ($parc ? ['parc' => $parc] : []) + ($assigne ? ['assigne' => $assigne] : []);
        $jour = Appointments::list($user, $rdvFilter + ['du' => $today, 'au' => $today]);
        $semaine = Appointments::list($user, $rdvFilter + ['du' => $monday, 'au' => $sunday]);
        $retard = Appointments::list($user, ($parc ? ['parc' => $parc] : []) + ($assigne ? ['assigne' => $assigne] : []) + ['retard' => '1']);

        $vq = $parc ? ['parc' => $parc] : [];
        $all = Vehicles::listAdmin($user, $vq);
        $stock = array_filter($all, fn($v) => in_array($v['statut'], ['brouillon', 'disponible', 'reserve'], true));
        $since = date('Y-m-d', strtotime('-30 days'));
        $vendus30 = (int) Db::value("SELECT COUNT(*) FROM la_ventes v JOIN la_vehicules veh ON veh.id = v.vehicule_id WHERE v.statut IN ('finalisee', 'livree') AND v.date_vente >= ?"
            . ($parc ? ' AND veh.parc_id = ?' : '') . Access::scope($user, 'veh.parc_id')[0], array_merge([$since], $parc ? [$parc] : [], Access::scope($user, 'veh.parc_id')[1]));
        $enPrep = array_filter($stock, fn($v) => $v['preparation']['faits'] < $v['preparation']['total']);

        // Alertes
        $alertes = [];
        $ctJours = (array) (Settings::get('alertes')['ct_jours'] ?? [30, 7]);
        foreach ($stock as $v) {
            if (in_array($v['ct']['etat'], ['echu', 'bientot'], true)) {
                $alertes[] = ['type' => 'ct', 'niveau' => $v['ct']['etat'] === 'echu' ? 'danger' : 'attention', 'texte' => $v['marque'] . ' ' . $v['modele'] . ' (' . $v['numeroStock'] . ') : ' . $v['ct']['label'], 'vehiculeId' => $v['dbId'], 'lien' => '#/vehicules/' . $v['dbId'] . '/preparation'];
            }
        }
        $prepJours = (int) (Settings::get('alertes')['preparation_jours'] ?? 1);
        $limite = date('Y-m-d', strtotime("+$prepJours days")) . ' 23:59:59';
        foreach (Appointments::list($user, $rdvFilter + ['du' => $today, 'au' => substr($limite, 0, 10)]) as $r) {
            if (!in_array($r['motif'], ['visite', 'essai', 'livraison'], true)) {
                continue;
            }
            $prep = Checklist::summaries([$r['vehiculeId']])[$r['vehiculeId']];
            if (!$r['vehiculePret'] || $prep['faits'] < $prep['total']) {
                $alertes[] = ['type' => 'preparation', 'niveau' => 'attention', 'texte' => 'À préparer : ' . $r['vehicule'] . ' — ' . strtolower($r['motifLabel']) . ' le ' . date('d/m à H:i', strtotime($r['debut']))
                    . ($prep['manquants'] ? ' (manque : ' . implode(', ', array_slice($prep['manquants'], 0, 3)) . ')' : ''), 'vehiculeId' => $r['vehiculeId'], 'lien' => '#/vehicules/' . $r['vehiculeId'] . '/preparation'];
            }
        }
        $nettoyage = array_filter($stock, fn($v) => (bool) array_filter($v['preparation']['manquants'], fn($m) => stripos($m, 'nettoyage') !== false));
        if ($nettoyage) {
            $alertes[] = ['type' => 'nettoyage', 'niveau' => 'info', 'texte' => count($nettoyage) . ' véhicule(s) avec un nettoyage à faire', 'lien' => '#/preparation?tache=nettoyage'];
        }
        $docs = array_filter($stock, fn($v) => (bool) array_filter($v['preparation']['manquants'], fn($m) => stripos($m, 'carte grise') !== false || stripos($m, 'non-gage') !== false));
        if ($docs) {
            $alertes[] = ['type' => 'documents', 'niveau' => 'info', 'texte' => count($docs) . ' véhicule(s) avec des documents manquants', 'lien' => '#/preparation?tache=documents'];
        }
        $msg = Notifications::stats($user);
        if ($msg['echecs']) {
            $alertes[] = ['type' => 'messages', 'niveau' => 'danger', 'texte' => $msg['echecs'] . ' message(s) en échec d\'envoi', 'lien' => '#/messages?statut=echec'];
        }
        $finance = null;
        if (Access::can($user, 'finance.voir')) {
            $ventes = Finance::ventes($user, []);
            $nonFinal = array_filter($ventes, fn($v) => in_array($v['statut'], ['reservee', 'en_cours'], true));
            $aEnc = array_filter($ventes, fn($v) => $v['statut'] !== 'annulee' && $v['resteCentimes'] > 0);
            $livrer = array_filter($ventes, fn($v) => $v['statut'] === 'finalisee');
            if ($nonFinal) {
                $alertes[] = ['type' => 'vente', 'niveau' => 'info', 'texte' => count($nonFinal) . ' vente(s) non finalisée(s)', 'lien' => '#/ventes?statut=reservee'];
            }
            if ($livrer) {
                $alertes[] = ['type' => 'livraison', 'niveau' => 'info', 'texte' => count($livrer) . ' livraison(s) à organiser', 'lien' => '#/ventes?statut=finalisee'];
            }
            if ($aEnc) {
                $alertes[] = ['type' => 'encaissement', 'niveau' => 'attention', 'texte' => count($aEnc) . ' vente(s) avec acompte ou solde à recevoir', 'lien' => '#/ventes?aEncaisser=1'];
            }
            $finance = ['aEncaisserCentimes' => array_sum(array_map(fn($v) => $v['resteCentimes'], $aEnc))];
        }
        [$dScope, $dp] = Access::scope($user, 'v.parc_id', true);
        $demandes = (int) Db::value("SELECT COUNT(*) FROM la_demandes d LEFT JOIN la_vehicules v ON v.id = d.vehicule_id WHERE d.statut = 'nouvelle'$dScope", $dp);
        if ($demandes) {
            array_unshift($alertes, ['type' => 'demandes', 'niveau' => 'info', 'texte' => $demandes . ' nouvelle(s) demande(s) du site à traiter', 'lien' => '#/demandes?statut=nouvelle']);
        }
        return [
            'rdv' => ['jour' => $jour, 'semaine' => count($semaine), 'retard' => $retard],
            'vehicules' => [
                'stock' => count($stock), 'enLigne' => count(array_filter($stock, fn($v) => $v['statut'] === 'disponible')),
                'reserves' => count(array_filter($stock, fn($v) => $v['statut'] === 'reserve')), 'brouillons' => count(array_filter($stock, fn($v) => $v['statut'] === 'brouillon')),
                'vendus30j' => $vendus30, 'enPreparation' => count($enPrep),
            ],
            'demandesNouvelles' => $demandes, 'messages' => $msg, 'alertes' => $alertes, 'finance' => $finance,
            'ctJours' => $ctJours,
        ];
    }

    /** Catégories de préparation à terminer avant un rendez-vous, selon son motif. */
    private const AVANT_RDV = ['visite' => ['preparation', 'visite'], 'essai' => ['preparation', 'visite'], 'livraison' => ['preparation', 'livraison']];

    /**
     * Programme d'une journée pour toute l'équipe : rendez-vous (et ce qu'il reste à préparer avant),
     * tâches de préparation dues, contrôles techniques, secrétariat, gestion (propriétaire).
     */
    public static function journee(array $user, array $q): array
    {
        $date = In::date($q, 'date', false, 'date') ?? date('Y-m-d');
        $parc = !empty($q['parc']) ? (int) $q['parc'] : null;
        if ($parc !== null) {
            Access::requireParc($user, $parc);
        }
        $pf = $parc ? ['parc' => $parc] : [];
        $photo = fn($json) => (json_decode((string) $json ?: '[]', true) ?: [])[0] ?? null;

        // Rendez-vous du jour (annulés exclus)
        $rdv = array_values(array_filter(Appointments::list($user, $pf + ['du' => $date, 'au' => $date]), fn($r) => $r['statut'] !== 'annule'));
        $avant = []; // véhicule => [catégories à terminer, heure du premier rendez-vous concerné, libellé]
        foreach ($rdv as $r) {
            if (isset(self::AVANT_RDV[$r['motif']]) && in_array($r['statut'], ['en_attente', 'confirme'], true) && !isset($avant[$r['vehiculeId']])) {
                $avant[$r['vehiculeId']] = [self::AVANT_RDV[$r['motif']], substr($r['debut'], 11, 5), mb_strtolower($r['motifLabel'])];
            }
        }

        // Véhicules du périmètre (stock et vendus non livrés)
        [$vs, $vp] = Access::scope($user, 'v.parc_id');
        $vehicules = [];
        foreach (Db::all("SELECT v.*, p.nom AS parc_nom FROM la_vehicules v LEFT JOIN la_parcs p ON p.id = v.parc_id
            WHERE v.statut IN ('brouillon', 'disponible', 'reserve', 'vendu')$vs" . ($parc ? ' AND v.parc_id = ?' : ''), array_merge($vp, $parc ? [$parc] : [])) as $v) {
            $vehicules[(int) $v['id']] = $v;
        }

        // Tâches de préparation ouvertes : échéance atteinte, ou à terminer avant un rendez-vous du jour
        $taches = [];
        if ($vehicules) {
            $ids = array_keys($vehicules);
            $rows = [];
            foreach (Db::all('SELECT c.*, a.name AS responsable FROM la_vehicule_checklist c LEFT JOIN la_admins a ON a.id = c.responsable_id WHERE c.vehicule_id IN (' . Db::in($ids) . ')', $ids) as $c) {
                $rows[(int) $c['vehicule_id']][(int) $c['item_id']] = $c;
            }
            $items = Checklist::items();
            foreach ($vehicules as $vid => $v) {
                foreach ($items as $it) {
                    $c = $rows[$vid][(int) $it['id']] ?? null;
                    $statut = $c['statut'] ?? 'a_faire';
                    if ($statut === 'termine' || $statut === 'non_necessaire') {
                        continue;
                    }
                    $echeance = $c['echeance'] ?? null;
                    $pourRdv = isset($avant[$vid]) && in_array($it['categorie'], $avant[$vid][0], true) && $it['code'] !== 'photos';
                    $due = $echeance !== null && $echeance <= $date;
                    if (!$pourRdv && !$due) {
                        continue;
                    }
                    $taches[] = [
                        'vehiculeId' => $vid, 'vehicule' => $v['marque'] . ' ' . $v['modele'], 'numeroStock' => $v['numero_stock'], 'parc' => $v['parc_nom'],
                        'photo' => $photo($v['photos']), 'itemId' => (int) $it['id'], 'code' => $it['code'], 'libelle' => $it['libelle'], 'categorie' => $it['categorie'],
                        'statut' => $statut, 'responsableId' => isset($c['responsable_id']) ? (int) $c['responsable_id'] : null, 'responsable' => $c['responsable'] ?? null,
                        'echeance' => $echeance, 'commentaire' => (string) ($c['commentaire'] ?? ''),
                        'avantRdv' => $pourRdv ? $avant[$vid][1] : null,
                        'raison' => $pourRdv ? 'Avant le RDV de ' . str_replace(':', 'h', $avant[$vid][1]) . ' (' . $avant[$vid][2] . ')'
                            : ($echeance < $date ? 'En retard (prévu le ' . date('d/m', strtotime($echeance)) . ')' : 'Prévu ce jour'),
                    ];
                }
            }
            usort($taches, fn($a, $b) => [$a['avantRdv'] ?? '99:99', $a['vehicule'], $a['itemId']] <=> [$b['avantRdv'] ?? '99:99', $b['vehicule'], $b['itemId']]);
        }

        // Contrôles techniques à passer (échus ou bientôt), avec le prochain rendez-vous de CT s'il existe
        $ct = [];
        $prochainCt = [];
        if ($vehicules) {
            $ids = array_keys($vehicules);
            foreach (Db::all("SELECT vehicule_id, MIN(start_at) AS debut FROM la_rendez_vous WHERE motif = 'controle_technique' AND statut IN ('en_attente', 'confirme') AND start_at >= ? AND vehicule_id IN (" . Db::in($ids) . ') GROUP BY vehicule_id', array_merge([$date . ' 00:00:00'], $ids)) as $n) {
                $prochainCt[(int) $n['vehicule_id']] = $n['debut'];
            }
        }
        foreach ($vehicules as $vid => $v) {
            if ($v['statut'] === 'vendu') {
                continue;
            }
            $e = Vehicles::ctEtat($v);
            if (in_array($e['etat'], ['echu', 'bientot'], true)) {
                $ct[] = ['vehiculeId' => $vid, 'vehicule' => $v['marque'] . ' ' . $v['modele'], 'numeroStock' => $v['numero_stock'], 'parc' => $v['parc_nom'],
                    'photo' => $photo($v['photos']), 'ct' => $e, 'rdvCt' => $prochainCt[$vid] ?? null];
            }
        }
        usort($ct, fn($a, $b) => ($a['ct']['jours'] ?? 0) <=> ($b['ct']['jours'] ?? 0));

        // Secrétariat
        $demandes = Access::can($user, 'demandes.gerer') ? Requests::list($user, ['statut' => 'nouvelle']) : [];
        $lendemain = date('Y-m-d', strtotime("$date +1 day"));
        $secretariat = [
            'demandes' => array_map(fn($d) => ['id' => $d['id'], 'type' => $d['type'], 'typeLabel' => Requests::TYPES[$d['type']] ?? $d['type'], 'nom' => $d['nom'], 'tel' => $d['tel'],
                'montant' => $d['montant'], 'vehicule' => $d['vehicule']['titre'] ?? $d['vehiculeTitre'], 'createdAt' => $d['createdAt']], array_slice($demandes, 0, 8)),
            'demandesTotal' => count($demandes),
            'aConfirmer' => Appointments::list($user, $pf + ['du' => $date, 'au' => $lendemain, 'statut' => 'en_attente']),
            'aCloturer' => Appointments::list($user, $pf + ['retard' => '1']),
            'messagesEchec' => Access::can($user, 'messages.envoyer') ? array_slice(Notifications::list($user, ['statut' => 'echec']), 0, 5) : [],
        ];

        // Propriétaire : livraisons, réservations qui expirent, encaissements, factures à payer
        $proprio = null;
        if (Access::can($user, 'ventes.gerer') && Access::can($user, 'finance.voir')) {
            $parcOf = [];
            if ($parc) {
                foreach (Db::all('SELECT id, parc_id FROM la_vehicules') as $p) {
                    $parcOf[(int) $p['id']] = (int) $p['parc_id'];
                }
            }
            $ventes = array_values(array_filter(Finance::ventes($user, []), fn($x) => $x['statut'] !== 'annulee' && (!$parc || ($parcOf[$x['vehiculeId']] ?? 0) === $parc)));
            $aEnc = array_values(array_filter($ventes, fn($x) => $x['resteCentimes'] > 0));
            $proprio = [
                'livraisons' => array_values(array_filter($ventes, fn($x) => $x['statut'] === 'finalisee' && $x['dateLivraison'] && $x['dateLivraison'] <= $date)),
                'reservations' => array_values(array_filter($ventes, fn($x) => $x['statut'] === 'reservee' && $x['dateLimiteReservation'] && $x['dateLimiteReservation'] <= $date)),
                'aEncaisser' => ['totalCentimes' => array_sum(array_column($aEnc, 'resteCentimes')), 'ventes' => array_slice($aEnc, 0, 6), 'nombre' => count($aEnc)],
                'aPayer' => array_map(fn($f) => ['id' => (int) $f['id'], 'vehiculeId' => (int) $f['vehicule_id'], 'vehicule' => $f['marque'] . ' ' . $f['modele'], 'numeroStock' => $f['numero_stock'],
                    'libelle' => $f['libelle'] ?: (Finance::CATEGORIES[$f['categorie']] ?? $f['categorie']), 'tiers' => $f['tiers'], 'montantCentimes' => (int) $f['montant_centimes'], 'date' => $f['date_operation']],
                    Db::all("SELECT f.*, v.marque, v.modele, v.numero_stock FROM la_finance_entries f JOIN la_vehicules v ON v.id = f.vehicule_id
                        WHERE f.statut = 'valide' AND f.statut_paiement = 'a_payer' AND f.contre_ecriture_de_id IS NULL
                        AND NOT EXISTS (SELECT 1 FROM la_finance_entries x WHERE x.contre_ecriture_de_id = f.id)" . ($parc ? ' AND v.parc_id = ?' : '') . ' ORDER BY f.date_operation LIMIT 10', $parc ? [$parc] : [])),
            ];
        }

        $jour = (string) date('w', strtotime($date));
        return [
            'date' => $date, 'horaires' => (array) (Settings::get('horaires')[$jour] ?? []),
            'rendezVous' => $rdv, 'preparation' => ['taches' => $taches, 'ct' => $ct],
            'secretariat' => $secretariat, 'proprietaire' => $proprio,
            'diffusion' => Diffusion::actions($user, $parc),
        ];
    }

    /** Recherche globale : immatriculation, numéro de stock, modèle, nom ou téléphone client. */
    public static function recherche(array $user, string $q): array
    {
        $q = trim($q);
        if (mb_strlen($q) < 2) {
            return ['vehicules' => [], 'clients' => []];
        }
        [$scope, $p] = Access::scope($user, 'v.parc_id');
        $like = '%' . mb_strtolower($q) . '%';
        $immat = '%' . In::immat($q) . '%';
        $veh = Db::all("SELECT v.id, v.marque, v.modele, v.version, v.numero_stock, v.immatriculation, v.statut, v.photos, p.nom AS parc FROM la_vehicules v LEFT JOIN la_parcs p ON p.id = v.parc_id
            WHERE (LOWER(v.numero_stock) LIKE ? OR v.immatriculation LIKE ? OR LOWER(v.marque) LIKE ? OR LOWER(v.modele) LIKE ? OR LOWER(v.version) LIKE ?)$scope ORDER BY v.updated_at DESC LIMIT 8",
            array_merge([$like, $immat, $like, $like, $like], $p));
        return [
            'vehicules' => array_map(fn($v) => ['id' => (int) $v['id'], 'titre' => $v['marque'] . ' ' . $v['modele'], 'version' => $v['version'], 'numeroStock' => $v['numero_stock'],
                'immatriculation' => $v['immatriculation'], 'statut' => Vehicles::STATUT_LABELS[$v['statut']] ?? $v['statut'], 'parc' => $v['parc'],
                'photo' => (json_decode($v['photos'] ?: '[]', true) ?: [])[0] ?? null], $veh),
            'clients' => Access::can($user, 'clients.gerer') ? Clients::search($user, $q, 8) : [],
        ];
    }
}
