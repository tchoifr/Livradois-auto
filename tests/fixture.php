<?php
declare(strict_types=1);

/*
 * Outils de test en ligne de commande (jamais déployés) : prépare des situations difficiles
 * à provoquer par l'API seule (message en échec, rappel dû).
 *   BO_DIR=… php tests/fixture.php notif-echec <rdvId>
 *   BO_DIR=… php tests/fixture.php rappel-du <rdvId>
 *   BO_DIR=… php tests/fixture.php notif <id>
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
    default:
        fwrite(STDERR, "Commande inconnue\n");
        exit(1);
}
