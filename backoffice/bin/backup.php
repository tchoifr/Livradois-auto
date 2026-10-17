<?php
declare(strict_types=1);

/*
 * Sauvegarde restaurable des tables du back-office (la_*) avant chaque déploiement.
 * Fichier SQL compressé dans le dossier privé (hors du site web) : livradois-prive/sauvegardes/.
 * Les 30 sauvegardes les plus récentes sont conservées.
 * Restauration : décompresser puis importer le .sql (phpMyAdmin ou mysql) dans la base.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require dirname(__DIR__) . '/lib/bootstrap.php';

$pdo = Db::pdo();
$mysql = Db::isMysql();
$tables = $mysql
    ? array_column(Db::all("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'la\\_%'"), 't')
    : array_column(Db::all("SELECT name AS t FROM sqlite_master WHERE type = 'table' AND name LIKE 'la_%'"), 't');
sort($tables);

$dir = private_dir('sauvegardes');
$file = $dir . '/livradois-' . date('Ymd-His') . '.sql.gz';
$gz = gzopen($file, 'wb6');
gzwrite($gz, "-- Sauvegarde Livradois Automobiles — " . date('c') . "\n-- Tables : " . implode(', ', $tables) . "\n\n");
if ($mysql) {
    gzwrite($gz, "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n\n");
}
$rows = 0;
foreach ($tables as $t) {
    if ($mysql) {
        $create = Db::one("SHOW CREATE TABLE `$t`")['Create Table'];
        gzwrite($gz, "DROP TABLE IF EXISTS `$t`;\n$create;\n\n");
    } else {
        $create = Db::value("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", [$t]);
        gzwrite($gz, "DROP TABLE IF EXISTS $t;\n$create;\n\n");
    }
    $st = $pdo->query("SELECT * FROM $t");
    while ($r = $st->fetch(PDO::FETCH_ASSOC)) {
        $vals = array_map(fn($v) => $v === null ? 'NULL' : (is_int($v) || is_float($v) ? (string) $v : $pdo->quote((string) $v)), array_values($r));
        gzwrite($gz, 'INSERT INTO ' . $t . ' (' . implode(', ', array_keys($r)) . ') VALUES (' . implode(', ', $vals) . ");\n");
        $rows++;
    }
    gzwrite($gz, "\n");
}
if ($mysql) {
    gzwrite($gz, "SET FOREIGN_KEY_CHECKS = 1;\n");
}
gzclose($gz);
@chmod($file, 0600);

// Rotation : 30 sauvegardes conservées
$all = glob($dir . '/livradois-*.sql.gz') ?: [];
rsort($all);
foreach (array_slice($all, 30) as $old) {
    @unlink($old);
}
printf("Sauvegarde : %s (%d tables, %d lignes, %s Ko)\n", basename($file), count($tables), $rows, number_format(filesize($file) / 1024, 1, ',', ' '));
