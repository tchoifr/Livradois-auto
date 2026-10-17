<?php
declare(strict_types=1);

/** Journal d'audit des opérations sensibles (qui, quoi, quand, avant/après filtrés). */
final class Audit
{
    /** Champs jamais journalisés. */
    private const SECRETS = ['password', 'password_hash', 'token', 'token_hash', 'pass', 'setup_key'];

    public static function log(?array $user, string $action, string $entityType, ?int $entityId, $before = null, $after = null): void
    {
        [$before, $after] = self::diff($before, $after);
        Db::insert('la_audit_log', [
            'actor_id' => $user['id'] ?? null,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'avant' => $before === null ? null : json_encode($before, JSON_UNESCAPED_UNICODE),
            'apres' => $after === null ? null : json_encode($after, JSON_UNESCAPED_UNICODE),
            'ip' => Http::ip(),
            'created_at' => Db::now(),
        ]);
    }

    /** Ne conserve que les champs modifiés et retire les secrets. */
    private static function diff($before, $after): array
    {
        $clean = function ($a) {
            if (!is_array($a)) {
                return $a;
            }
            foreach (self::SECRETS as $s) {
                unset($a[$s]);
            }
            foreach ($a as $k => $v) {
                if (is_string($v) && mb_strlen($v) > 300) {
                    $a[$k] = mb_substr($v, 0, 300) . '…';
                }
            }
            return $a;
        };
        $before = $clean($before);
        $after = $clean($after);
        if (is_array($before) && is_array($after)) {
            $b = $a = [];
            foreach ($after as $k => $v) {
                if (!array_key_exists($k, $before) || (string) json_encode($before[$k]) !== (string) json_encode($v)) {
                    $b[$k] = $before[$k] ?? null;
                    $a[$k] = $v;
                }
            }
            return [$b ?: null, $a ?: null];
        }
        return [$before, $after];
    }

    public static function list(array $q): array
    {
        $where = [];
        $p = [];
        if (!empty($q['entity_type'])) {
            $where[] = 'l.entity_type = ?';
            $p[] = (string) $q['entity_type'];
        }
        if (!empty($q['entity_id'])) {
            $where[] = 'l.entity_id = ?';
            $p[] = (int) $q['entity_id'];
        }
        if (!empty($q['actor_id'])) {
            $where[] = 'l.actor_id = ?';
            $p[] = (int) $q['actor_id'];
        }
        $limit = max(1, min(500, (int) ($q['limit'] ?? 200)));
        $rows = Db::all('SELECT l.*, a.name AS actor_name, a.email AS actor_email FROM la_audit_log l LEFT JOIN la_admins a ON a.id = l.actor_id'
            . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . " ORDER BY l.id DESC LIMIT $limit", $p);
        return array_map(fn($r) => [
            'id' => (int) $r['id'], 'action' => $r['action'], 'entityType' => $r['entity_type'], 'entityId' => $r['entity_id'] !== null ? (int) $r['entity_id'] : null,
            'avant' => $r['avant'] ? json_decode($r['avant'], true) : null, 'apres' => $r['apres'] ? json_decode($r['apres'], true) : null,
            'acteur' => $r['actor_name'] ?: ($r['actor_email'] ?: 'Système'), 'date' => $r['created_at'],
        ], $rows);
    }
}
