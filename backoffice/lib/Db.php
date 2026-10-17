<?php
declare(strict_types=1);

/** Accès base de données (MySQL sur OVH, SQLite pour la démo et les tests). */
final class Db
{
    private static ?PDO $pdo = null;
    private static int $depth = 0;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $c = cfg('db');
            self::$pdo = new PDO($c['dsn'], $c['user'] ?? null, $c['pass'] ?? null, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]);
            if (self::driver() === 'sqlite') {
                self::$pdo->exec('PRAGMA foreign_keys = ON');
                self::$pdo->exec('PRAGMA busy_timeout = 5000');
            } else {
                self::$pdo->exec("SET time_zone = '" . date('P') . "'");
            }
        }
        return self::$pdo;
    }

    public static function driver(): string
    {
        return self::pdo()->getAttribute(PDO::ATTR_DRIVER_NAME);
    }

    public static function isMysql(): bool
    {
        return self::driver() === 'mysql';
    }

    public static function all(string $sql, array $params = []): array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->fetchAll();
    }

    public static function one(string $sql, array $params = []): ?array
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row === false ? null : $row;
    }

    public static function value(string $sql, array $params = [])
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        $v = $st->fetchColumn();
        return $v === false ? null : $v;
    }

    public static function exec(string $sql, array $params = []): int
    {
        $st = self::pdo()->prepare($sql);
        $st->execute($params);
        return $st->rowCount();
    }

    public static function insert(string $table, array $data): int
    {
        $cols = array_keys($data);
        $sql = 'INSERT INTO ' . $table . ' (' . implode(', ', $cols) . ') VALUES (:' . implode(', :', $cols) . ')';
        self::exec($sql, $data);
        return (int) self::pdo()->lastInsertId();
    }

    public static function update(string $table, array $data, int $id): void
    {
        if (!$data) {
            return;
        }
        $set = implode(', ', array_map(fn($c) => "$c = :$c", array_keys($data)));
        $data['id'] = $id;
        self::exec("UPDATE $table SET $set WHERE id = :id", $data);
    }

    /**
     * Exécute $fn dans une transaction. En SQLite, BEGIN IMMEDIATE prend tout de suite le verrou
     * d'écriture (les créations simultanées sont donc sérialisées) ; en MySQL, on verrouille les
     * lignes nécessaires avec lockRow().
     */
    public static function transaction(callable $fn)
    {
        if (self::$depth > 0) {
            self::$depth++;
            try {
                return $fn();
            } finally {
                self::$depth--;
            }
        }
        $pdo = self::pdo();
        if (self::isMysql()) {
            $pdo->beginTransaction();
        } else {
            $pdo->exec('BEGIN IMMEDIATE');
        }
        self::$depth = 1;
        try {
            $result = $fn();
            if (self::isMysql()) {
                $pdo->commit();
            } else {
                $pdo->exec('COMMIT');
            }
            return $result;
        } catch (Throwable $e) {
            if (self::isMysql()) {
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
            } else {
                $pdo->exec('ROLLBACK');
            }
            throw $e;
        } finally {
            self::$depth = 0;
        }
    }

    /** Verrouille une ligne jusqu'à la fin de la transaction en cours (MySQL : SELECT … FOR UPDATE). */
    public static function lockRow(string $table, int $id): ?array
    {
        return self::one("SELECT * FROM $table WHERE id = ?" . (self::isMysql() ? ' FOR UPDATE' : ''), [$id]);
    }

    public static function now(): string
    {
        return date('Y-m-d H:i:s');
    }

    /** Liste de paramètres « ?, ?, ? » pour une clause IN. */
    public static function in(array $values): string
    {
        return implode(', ', array_fill(0, max(1, count($values)), '?'));
    }
}
