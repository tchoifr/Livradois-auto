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
