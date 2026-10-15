<?php
declare(strict_types=1);

/** Réponses JSON, CORS et utilitaires HTTP. */
final class HttpError extends RuntimeException
{
    public function __construct(public int $status, string $message)
    {
        parent::__construct($message);
    }
}

final class Http
{
    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    public static function fail(int $status, string $message): void
    {
        throw new HttpError($status, $message);
    }

    public static function body(): array
    {
        if (str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
            $raw = file_get_contents('php://input', false, null, 0, 1_000_000);
            $data = json_decode($raw ?: '[]', true);
            if (!is_array($data)) {
                self::fail(400, 'Requête invalide.');
            }
            return $data;
        }
        return $_POST;
    }

    public static function method(): string
    {
        return $_SERVER['REQUEST_METHOD'] ?? 'GET';
    }

    public static function ip(): string
    {
        return substr($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0', 0, 64);
    }

    public static function isHttps(): bool
    {
        return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
            || (($_SERVER['SERVER_PORT'] ?? '') === '443');
    }

    /** Autorise uniquement les origines du site et du dashboard (config « allowed_origins »). Aucun cookie n'est utilisé. */
    public static function cors(): void
    {
        header('Vary: Origin');
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        if ($origin !== '' && in_array($origin, cfg('allowed_origins', []), true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type, X-LA-Token');
            header('Access-Control-Max-Age: 86400');
        }
    }

    public static function securityHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: same-origin');
        if (self::isHttps()) {
            header('Strict-Transport-Security: max-age=31536000');
        }
    }

    /** Limitation de débit simple basée sur la table events. */
    public static function tooMany(string $kind, int $max, int $seconds, ?string $subject = null): bool
    {
        $since = date('Y-m-d H:i:s', time() - $seconds);
        $sql = 'SELECT COUNT(*) FROM la_events WHERE kind = ? AND created_at >= ? AND ' . ($subject === null ? 'ip = ?' : 'subject = ?');
        return (int) Db::value($sql, [$kind, $since, $subject ?? self::ip()]) >= $max;
    }

    public static function record(string $kind, string $subject = ''): void
    {
        Db::insert('la_events', ['kind' => $kind, 'ip' => self::ip(), 'subject' => substr($subject, 0, 190), 'created_at' => Db::now()]);
        // Nettoyage occasionnel des anciens événements
        if (random_int(1, 50) === 1) {
            Db::exec('DELETE FROM la_events WHERE created_at < ?', [date('Y-m-d H:i:s', time() - 86400 * 7)]);
        }
    }
}
