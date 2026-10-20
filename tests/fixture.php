<?php
declare(strict_types=1);

/*
 * Outils de test en ligne de commande (jamais déployés) : prépare des situations difficiles
 * à provoquer par l'API seule (message en échec, rappel dû).
 *   BO_DIR=… php tests/fixture.php notif-echec <rdvId>
 *   BO_DIR=… php tests/fixture.php rappel-du <rdvId>
 *   BO_DIR=… php tests/fixture.php notif <id>
 *   BO_DIR=… php tests/fixture.php compte-brut <canalId> | analyse-jeton | diffusion-taches <vehiculeId> [dues]
 *   BO_DIR=… php tests/fixture.php publication-expiree <vehiculeId> <canalId>
 */

$dir = getenv('BO_DIR') ?: dirname(__DIR__) . '/backoffice';
require $dir . '/lib/bootstrap.php';

[$cmd, $arg] = [$argv[1] ?? '', (int) ($argv[2] ?? 0)];
$r = $arg ? Db::one('SELECT r.*, c.email, c.telephone FROM la_rendez_vous r LEFT JOIN la_clients c ON c.id = r.client_id WHERE r.id = ?', [$arg]) : null;

switch ($cmd) {
    case 'notif-echec':
        // Message SMS sans fournisseur, déjà à sa dernière tentative : passera en échec au prochain passage
        $id = Db::insert('la_notifications', [
            'rendez_vous_id' => $arg, 'client_id' => $r['client_id'], 'vehicule_id' => $r['vehicule_id'], 'canal' => 'sms', 'destinataire' => $r['telephone'] ?: '0600000000',
            'template' => 'confirmation', 'sujet' => 'Test échec', 'contenu' => 'Message de test', 'scheduled_at' => Db::now(), 'statut' => 'en_attente',
            'claim' => '', 'provider_id' => '', 'attempts' => 3, 'last_error' => '', 'created_at' => Db::now(), 'updated_at' => Db::now(),
        ]);
        echo json_encode(['id' => $id]);
        break;
    case 'rappel-du':
        // Rappel dû maintenant (clé de déduplication cohérente avec l'heure du rendez-vous)
        $id = Db::insert('la_notifications', [
            'rendez_vous_id' => $arg, 'client_id' => $r['client_id'], 'vehicule_id' => $r['vehicule_id'], 'canal' => 'email', 'destinataire' => $r['email'],
            'template' => 'rappel', 'sujet' => 'Rappel idempotence ' . $arg, 'contenu' => 'Rappel de test idempotence ' . $arg, 'scheduled_at' => date('Y-m-d H:i:s', time() - 60),
            'statut' => 'en_attente', 'claim' => '', 'provider_id' => '', 'attempts' => 0, 'last_error' => '', 'dedupe_key' => "rdv:$arg:rappel_test:" . $r['start_at'],
            'created_at' => Db::now(), 'updated_at' => Db::now(),
        ]);
        echo json_encode(['id' => $id]);
        break;
    case 'notif':
        echo json_encode(Db::one('SELECT id, statut, attempts, canal, destinataire FROM la_notifications WHERE id = ?', [$arg]));
        break;
    case 'compte-brut':
        // Accès d'une plateforme tels que stockés en base (doivent être chiffrés)
        $c = Db::one('SELECT secret_chiffre FROM la_comptes_diffusion WHERE canal_id = ?', [$arg]);
        echo json_encode(['stocke' => $c['secret_chiffre'] ?? null, 'dechiffre' => Coffre::dechiffrer($c['secret_chiffre'] ?? null)]);
        break;
    case 'analyse-jeton':
        // Lecture des réponses OAuth 2.0 d'une plateforme (sans appel réseau)
        echo json_encode([
            'ok' => ComptesDiffusion::analyserJeton(200, '{"access_token":"abc","expires_in":1800}'),
            'refuse' => ComptesDiffusion::analyserJeton(401, '{"error":"invalid_client"}'),
            'limite' => ComptesDiffusion::analyserJeton(429, ''),
            'injoignable' => ComptesDiffusion::analyserJeton(0, ''),
            'sansJeton' => ComptesDiffusion::analyserJeton(200, '{"foo":1}'),
        ]);
        break;
    case 'diffusion-taches':
        // File d'opérations d'un véhicule ; « dues » avance les nouveaux essais pour les exécuter tout de suite
        if (($argv[3] ?? '') === 'dues') {
            Db::exec("UPDATE la_diffusion_taches SET prochaine_tentative = ? WHERE statut = 'en_attente' AND publication_id IN (SELECT id FROM la_publications WHERE vehicule_id = ?)", [date('Y-m-d H:i:s', time() - 60), $arg]);
        }
        echo json_encode(Db::all('SELECT t.id, t.action, t.statut, t.tentatives, c.code FROM la_diffusion_taches t JOIN la_publications p ON p.id = t.publication_id JOIN la_canaux c ON c.id = p.canal_id WHERE p.vehicule_id = ? ORDER BY t.id', [$arg]));
        break;
    case 'publication-expiree':
        // Annonce dont la durée de parution est dépassée
        Db::exec('UPDATE la_publications SET expire_le = ? WHERE vehicule_id = ? AND canal_id = ?', [date('Y-m-d', time() - 86400), $arg, (int) ($argv[3] ?? 0)]);
        echo json_encode(['ok' => true]);
        break;
    default:
        fwrite(STDERR, "Commande inconnue\n");
        exit(1);
}
