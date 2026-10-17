<?php
declare(strict_types=1);

/*
 * Livradois Automobiles — back-office
 * Chargement de la configuration et des classes.
 */

error_reporting(E_ALL);
ini_set('display_errors', '0');
date_default_timezone_set('Europe/Paris');

define('BO_ROOT', dirname(__DIR__));

$configFile = BO_ROOT . '/config.local.php';
if (!is_file($configFile)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Configuration manquante : copiez config.example.php en config.local.php.']);
    exit;
}
// Secrets (serveur uniquement), réglages versionnés (settings.php), puis réglages propres au serveur
// écrits par le déploiement (settings.local.php, ex. adresse du mode test — jamais dans le dépôt public)
$GLOBALS['BO_CONFIG'] = require $configFile;
foreach (['settings.php', 'settings.local.php'] as $settingsFile) {
    if (is_file(BO_ROOT . '/' . $settingsFile)) {
        $GLOBALS['BO_CONFIG'] = array_replace($GLOBALS['BO_CONFIG'], (array) require BO_ROOT . '/' . $settingsFile);
    }
}

function cfg(string $key, $default = null)
{
    return $GLOBALS['BO_CONFIG'][$key] ?? $default;
}

/** Dossier privé hors du site web : base de démonstration, documents, sauvegardes. */
function private_dir(string $sub = ''): string
{
    $dir = rtrim((string) cfg('private_dir', dirname(BO_ROOT) . '/livradois-prive'), '/');
    $path = $sub === '' ? $dir : $dir . '/' . $sub;
    if (!is_dir($path)) {
        @mkdir($path, 0700, true);
    }
    return $path;
}

/*
 * Mode démonstration (dashboard « Voir la démo ») : base SQLite séparée, jamais la base réelle.
 * Activé par le paramètre ?demo=1 de l'API, ou --demo-db en ligne de commande.
 */
define('BO_DEMO', (($_GET['demo'] ?? '') === '1') || (PHP_SAPI === 'cli' && in_array('--demo-db', $GLOBALS['argv'] ?? [], true)));
if (BO_DEMO) {
    $GLOBALS['BO_CONFIG']['db'] = ['dsn' => 'sqlite:' . private_dir('demo') . '/demo.sqlite'];
}

require __DIR__ . '/Db.php';
require __DIR__ . '/Schema.php';
require __DIR__ . '/Http.php';
require __DIR__ . '/Settings.php';
require __DIR__ . '/Access.php';
require __DIR__ . '/Audit.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/Vehicles.php';
require __DIR__ . '/Parcs.php';
require __DIR__ . '/Users.php';
require __DIR__ . '/Checklist.php';
require __DIR__ . '/Documents.php';
require __DIR__ . '/Clients.php';
require __DIR__ . '/Appointments.php';
require __DIR__ . '/Notifications.php';
require __DIR__ . '/Finance.php';
require __DIR__ . '/Dashboard.php';
require __DIR__ . '/Requests.php';
require __DIR__ . '/Uploads.php';
require __DIR__ . '/Demo.php';
