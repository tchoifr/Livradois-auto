<?php
declare(strict_types=1);

/**
 * Base de démonstration (SQLite, hors du site web), totalement séparée de la base réelle.
 * Reconstruite automatiquement toutes les 24 h avec des données fictives cohérentes.
 */
final class Demo
{
    private const VERSION = 2;
    private const TTL = 86400;

    public static function ensure(bool $force = false): void
    {
        if (!BO_DEMO) {
            return;
        }
        $dir = private_dir('demo');
        $file = "$dir/demo.sqlite";
        $stamp = "$dir/version.txt";
        $fresh = is_file($file) && is_file($stamp) && trim((string) file_get_contents($stamp)) === (string) self::VERSION && time() - filemtime($stamp) < self::TTL;
        if ($fresh && !$force) {
            return;
        }
        $lock = fopen("$dir/rebuild.lock", 'c');
        flock($lock, LOCK_EX);
        clearstatcache();
        $fresh = is_file($file) && is_file($stamp) && trim((string) file_get_contents($stamp)) === (string) self::VERSION && time() - filemtime($stamp) < self::TTL;
        if (!$fresh || $force) {
            @unlink($file);
            Schema::migrate();
            self::seed();
            file_put_contents($stamp, (string) self::VERSION);
        }
        flock($lock, LOCK_UN);
        fclose($lock);
    }

    private static function seed(): void
    {
        $now = Db::now();
        $pwd = Auth::hash(bin2hex(random_bytes(16)));
        $arl = (int) Db::value('SELECT id FROM la_parcs WHERE code = ?', ['ARL']);
        $amb = Db::insert('la_parcs', ['code' => 'AMB', 'nom' => 'Parc d\'Ambert', 'adresse' => 'Zone d\'activités, 63600 Ambert', 'telephone' => '04 73 00 00 00', 'notes' => 'Parc de démonstration', 'actif' => 1, 'created_at' => $now, 'updated_at' => $now]);
        $mk = fn($email, $name, $role) => Db::insert('la_admins', ['email' => $email, 'name' => $name, 'password_hash' => $pwd, 'created_at' => $now, 'role' => $role, 'actif' => 1, 'telephone' => '']);
        $adminId = $mk('proprietaire@demo.livradois', 'Démo — Propriétaire', 'admin');
        $secId = $mk('secretaire@demo.livradois', 'Sophie (secrétaire, Arlanc)', 'secretaire');
        $refId = $mk('referente@demo.livradois', 'Julie (référente, Ambert)', 'referent');
        $admin = Auth::present(Db::one('SELECT * FROM la_admins WHERE id = ?', [$adminId]));
        Users::setParcs($admin, $secId, [$arl]);
        Users::setParcs($admin, $refId, [$amb]);

        // Véhicules : annonces d'exemple du site
        $seed = json_decode((string) file_get_contents(BO_ROOT . '/seed/vehicules-demo.json'), true) ?: [];
        $ids = [];
        foreach ($seed as $i => $v) {
            $letters = 'ABCDEFGHJKLMNPQRSTVWXYZ';
            $immat = $letters[$i % 23] . $letters[($i * 7) % 23] . '-' . str_pad((string) (100 + $i * 37 % 900), 3, '0') . '-' . $letters[($i * 3) % 23] . $letters[($i * 11) % 23];
            $id = Db::insert('la_vehicules', [
                'slug' => $v['id'], 'ref' => $v['ref'], 'statut' => $v['statut'], 'marque' => $v['marque'], 'modele' => $v['modele'], 'version' => $v['version'],
                'annee' => $v['annee'], 'mise_en_circulation' => $v['miseEnCirculation'] ?? '', 'km' => $v['km'], 'energie' => $v['energie'], 'boite' => $v['boite'],
                'carrosserie' => $v['carrosserie'], 'puissance' => $v['puissance'] ?? null, 'cv' => $v['cv'] ?? null, 'portes' => $v['portes'] ?? null, 'places' => $v['places'] ?? null,
                'couleur' => $v['couleur'] ?? '', 'critair' => $v['critair'] ?? null, 'premiere_main' => !empty($v['premiereMain']) ? 1 : 0, 'quatre_roues' => !empty($v['quatreRoues']) ? 1 : 0,
                'autonomie' => $v['autonomie'] ?? null, 'garantie' => $v['garantie'] ?? 12, 'prix' => $v['prix'], 'prix_barre' => $v['prixBarre'] ?? null, 'badge' => $v['badge'] ?? null,
                'description' => $v['description'] ?? '', 'equipements' => json_encode($v['equipements'] ?? [], JSON_UNESCAPED_UNICODE),
                'photos' => json_encode($v['photos'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 'publie_le' => $v['ajoutLe'] ?? date('Y-m-d'),
                'created_at' => date('Y-m-d H:i:s', strtotime('-' . (10 + $i * 6) . ' days')), 'updated_at' => $now,
                'parc_id' => $i < 12 ? $arl : $amb, 'numero_stock' => $v['ref'], 'immatriculation' => $immat, 'vin' => '', 'emplacement' => 'Place ' . ($i + 1),
                'demo' => 1,
            ]);
            $ids[$v['id']] = $id;
            Checklist::ensure($id);
        }
        $byIndex = array_values($ids);

        // Préparation : avancement varié
        $items = array_column(Checklist::items(), 'id', 'code');
        foreach ($byIndex as $k => $vid) {
            foreach (['nettoyage_interieur', 'nettoyage_exterieur', 'photos', 'doc_carte_grise', 'doc_non_gage', 'verification_admin', 'pret_visite'] as $j => $code) {
                $statut = ($k + $j) % 4 === 0 ? 'a_faire' : (($k + $j) % 7 === 0 ? 'en_cours' : 'termine');
                Db::exec('UPDATE la_vehicule_checklist SET statut = ?, completed_at = ?, updated_by = ?, updated_at = ? WHERE vehicule_id = ? AND item_id = ?',
                    [$statut, $statut === 'termine' ? $now : null, $secId, $now, $vid, (int) $items[$code]]);
            }
        }
        // Tâches restantes : échéances (aujourd'hui, en retard, à venir) et responsables, pour la page « Aujourd'hui »
        $today = date('Y-m-d');
        $open = Db::all("SELECT c.id, i.code, v.parc_id FROM la_vehicule_checklist c JOIN la_checklist_items i ON i.id = c.item_id JOIN la_vehicules v ON v.id = c.vehicule_id
            WHERE c.statut IN ('a_faire', 'en_cours') AND i.categorie IN ('preparation', 'documents', 'administratif', 'visite') ORDER BY c.vehicule_id, i.ordre");
        foreach ($open as $n => $c) {
            $nettoyage = str_starts_with($c['code'], 'nettoyage') || $c['code'] === 'photos' || $c['code'] === 'pret_visite';
            $resp = $nettoyage ? ((int) $c['parc_id'] === $amb ? $refId : $secId) : ($n % 2 ? $adminId : null);
            $ech = [$today, null, date('Y-m-d', strtotime('+3 days')), date('Y-m-d', strtotime('-2 days')), null, date('Y-m-d', strtotime('+6 days'))][$n % 6];
            Db::exec('UPDATE la_vehicule_checklist SET responsable_id = ?, echeance = ? WHERE id = ?', [$resp, $ech, (int) $c['id']]);
        }

        // Contrôles techniques : valide, bientôt échu, échu, non renseigné
        foreach ($byIndex as $k => $vid) {
            if ($k % 5 === 4) {
                continue;
            }
            $echeance = $k % 6 === 1 ? date('Y-m-d', strtotime('+12 days')) : ($k % 6 === 3 ? date('Y-m-d', strtotime('-5 days')) : date('Y-m-d', strtotime('+' . (200 + $k * 20) . ' days')));
            Vehicles::saveCt($admin, ['id' => $vid, 'date' => date('Y-m-d', strtotime('-' . (60 + $k * 9) . ' days')), 'resultat' => 'favorable', 'echeance' => $echeance,
                'echeanceVerifiee' => $k % 4 !== 2, 'centre' => 'Autosur Ambert', 'cout' => '79,00']);
        }

        // Clients fictifs
        $clients = [];
        foreach ([['Julien', 'Martin', 'email'], ['Sophie', 'Roche', 'telephone'], ['Claire', 'Dumas', 'email'], ['Karim', 'Benali', 'sms'],
                  ['Thomas', 'Leroy', 'email'], ['Nadia', 'Perrin', 'telephone'], ['Marc', 'Vidal', 'email'], ['Élodie', 'Faure', 'email']] as $n => [$prenom, $nom, $pref]) {
            $clients[] = Clients::save($admin, ['prenom' => $prenom, 'nom' => $nom, 'telephone' => '06 00 00 00 ' . str_pad((string) ($n + 10), 2, '0'),
                'email' => strtolower(Vehicles::slugify($prenom)) . '.' . strtolower($nom) . '@exemple.fr', 'preference' => $pref, 'serviceEmail' => true, 'confirmerDoublon' => true])['id'];
        }

        // Rendez-vous : aujourd'hui, cette semaine, en retard, annulé, terminé
        $slot = function (string $day, string $time) {
            $d = date('Y-m-d', strtotime($day));
            while (in_array((int) date('w', strtotime($d)), [0], true)) {
                $d = date('Y-m-d', strtotime("$d +1 day"));
            }
            return "$d $time:00";
        };
        $rdv = [];
        $plan = [
            [0, 0, 'visite', $slot('today', '09:00'), 'confirme', $secId], [1, 2, 'essai', $slot('today', '14:30'), 'confirme', $secId],
            [2, 4, 'visite', $slot('today', '16:00'), 'en_attente', null], [4, 1, 'essai', $slot('+1 day', '10:00'), 'confirme', $secId],
            [13, 3, 'visite', $slot('+2 days', '11:00'), 'confirme', $refId], [6, 5, 'livraison', $slot('+3 days', '15:00'), 'confirme', null],
            [3, 6, 'visite', $slot('-1 day', '10:30'), 'confirme', $secId], [5, 7, 'essai', $slot('-3 days', '09:30'), 'confirme', $secId],
            [7, 0, 'visite', $slot('+4 days', '09:00'), 'confirme', null],
        ];
        foreach ($plan as [$vk, $ck, $motif, $start, $statut, $assigne]) {
            $r = Appointments::create($admin, ['vehiculeId' => $byIndex[$vk], 'clientId' => $clients[$ck], 'motif' => $motif, 'debut' => $start, 'statut' => $statut, 'assigneId' => $assigne, 'notes' => '']);
            $rdv[] = $r['rendezVous']['id'];
        }
        Appointments::setStatut($admin, $rdv[7], 'termine');
        Appointments::cancel($admin, $rdv[8], 'Le client a trouvé un autre véhicule');

        // Demandes du site
        foreach ([[0, 'offre', 'Julien Martin', 21000, 'nouvelle'], [13, 'offre', 'Sophie Roche', 23500, 'nouvelle'], [2, 'reservation', 'Claire Dumas', null, 'nouvelle'],
                  [3, 'essai', 'Karim Benali', null, 'en_cours'], [0, 'offre', 'Thomas Leroy', 19800, 'refusee'], [8, 'reprise', 'Nadia Perrin', null, 'traitee']] as $n => [$vk, $type, $nom, $montant, $statut]) {
            $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$byIndex[$vk]]);
            $did = Db::insert('la_demandes', [
                'vehicule_id' => (int) $v['id'], 'vehicule_titre' => $v['marque'] . ' ' . $v['modele'] . ' (réf. ' . $v['ref'] . ')', 'type' => $type, 'nom' => $nom,
                'tel' => '06 00 00 00 ' . str_pad((string) ($n + 10), 2, '0'), 'email' => '', 'message' => $type === 'offre' ? "Je vous propose $montant € comptant." : 'Pouvez-vous me rappeler ?',
                'montant' => $montant, 'statut' => $statut, 'ip' => '', 'client_id' => $n < 3 ? $clients[$n] : null, 'client_suggere_id' => $n === 3 ? $clients[3] : null,
                'created_at' => date('Y-m-d H:i:s', strtotime('-' . ($n * 7 + 1) . ' hours')), 'updated_at' => $now,
            ]);
        }

        // Finance et ventes : achats, frais, une vente finalisée avec solde à recevoir, une réservation avec acompte
        foreach ($byIndex as $k => $vid) {
            $prix = (int) Db::value('SELECT prix FROM la_vehicules WHERE id = ?', [$vid]);
            Finance::addEntry($admin, ['vehiculeId' => $vid, 'type' => 'achat', 'montant' => (string) round($prix * 0.78), 'date' => date('Y-m-d', strtotime('-' . (20 + $k * 6) . ' days')), 'tiers' => 'Particulier', 'reference' => 'ACH-' . (100 + $k)]);
            if ($k % 2 === 0) {
                Finance::addEntry($admin, ['vehiculeId' => $vid, 'type' => 'frais', 'categorie' => 'nettoyage', 'libelle' => 'Préparation esthétique', 'montant' => '120', 'date' => date('Y-m-d', strtotime('-' . (15 + $k * 5) . ' days'))]);
            }
            if ($k % 3 === 0) {
                Finance::addEntry($admin, ['vehiculeId' => $vid, 'type' => 'frais', 'categorie' => 'transport', 'libelle' => 'Convoyage', 'montant' => '180', 'date' => date('Y-m-d', strtotime('-' . (18 + $k * 5) . ' days'))]);
            }
        }
        $sold = $ids['citroen-berlingo-van-2019'] ?? $byIndex[15];
        Finance::saveVente($admin, ['vehiculeId' => $sold, 'statut' => 'finalisee', 'clientId' => $clients[6], 'prixFinal' => '13500', 'dateVente' => date('Y-m-d', strtotime('-6 days')), 'reference' => 'FV-2026-041']);
        $venteId = (int) Db::value('SELECT id FROM la_ventes WHERE vehicule_id = ?', [$sold]);
        Finance::addPaiement($admin, ['venteId' => $venteId, 'type' => 'acompte', 'montant' => '2000', 'date' => date('Y-m-d', strtotime('-12 days')), 'moyen' => 'cheque']);
        Finance::addPaiement($admin, ['venteId' => $venteId, 'type' => 'partiel', 'montant' => '8000', 'date' => date('Y-m-d', strtotime('-6 days')), 'moyen' => 'virement']);
        $reserved = $ids['fiat-500-2019'] ?? $byIndex[16];
        Db::update('la_vehicules', ['statut' => 'disponible'], $reserved);
        Finance::saveVente($admin, ['vehiculeId' => $reserved, 'statut' => 'reservee', 'clientId' => $clients[2], 'prixFinal' => '10290', 'dateLimiteReservation' => date('Y-m-d', strtotime('+5 days'))]);
        $venteId = (int) Db::value('SELECT id FROM la_ventes WHERE vehicule_id = ?', [$reserved]);
        Finance::addPaiement($admin, ['venteId' => $venteId, 'type' => 'acompte', 'montant' => '500', 'date' => date('Y-m-d', strtotime('-1 day')), 'moyen' => 'carte']);

        // Messages : confirmations simulées et un échec à relancer
        foreach (array_slice($rdv, 0, 4) as $rid) {
            $p = Notifications::proposition($rid, 'confirmation');
            if ($p['possible']) {
                Notifications::envoyer($admin, ['rendezVousId' => $rid, 'template' => 'confirmation']);
            }
        }
        Db::insert('la_notifications', [
            'rendez_vous_id' => $rdv[4], 'client_id' => $clients[3], 'vehicule_id' => $byIndex[13], 'canal' => 'sms', 'destinataire' => '06 00 00 00 13',
            'template' => 'confirmation', 'sujet' => 'Votre rendez-vous chez Livradois Automobiles', 'contenu' => 'Bonjour Karim, votre rendez-vous…',
            'scheduled_at' => $now, 'statut' => 'echec', 'claim' => '', 'provider_id' => '', 'attempts' => 4, 'last_error' => 'Aucun fournisseur SMS n\'est configuré.',
            'created_at' => $now, 'updated_at' => $now,
        ]);
        Clients::history($admin, $clients[1], 'appel_entrant', 'Appel pour connaître les disponibilités d\'essai du Peugeot 208.', ['vehicule_id' => $byIndex[2]], date('Y-m-d H:i:s', strtotime('-2 days')));
    }
}
