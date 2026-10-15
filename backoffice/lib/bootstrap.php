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
$GLOBALS['BO_CONFIG'] = require $configFile;

function cfg(string $key, $default = null)
{
    return $GLOBALS['BO_CONFIG'][$key] ?? $default;
}

require __DIR__ . '/Db.php';
require __DIR__ . '/Schema.php';
require __DIR__ . '/Http.php';
require __DIR__ . '/Auth.php';
require __DIR__ . '/Vehicles.php';
require __DIR__ . '/Requests.php';
require __DIR__ . '/Uploads.php';
