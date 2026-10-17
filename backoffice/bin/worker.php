<?php
declare(strict_types=1);

/*
 * Envoi des messages dus (rappels de rendez-vous, renvois automatiques).
 * À lancer par une tâche planifiée OVH (Hébergement → Tâches planifiées - Cron),
 * par exemple toutes les heures : php bin/worker.php
 * Idempotent : un message déjà pris en charge n'est jamais envoyé deux fois.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require dirname(__DIR__) . '/lib/bootstrap.php';

$r = Notifications::processDue(100, 50);
echo date('Y-m-d H:i:s') . " — envoyés : {$r['envoyes']}, échecs : {$r['echecs']}, annulés : {$r['annules']}\n";
