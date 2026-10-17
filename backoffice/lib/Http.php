<?php
declare(strict_types=1);

/** Réponses JSON, CORS et utilitaires HTTP. */
final class HttpError extends RuntimeException
{
    public function __construct(public int $status, string $message, public array $data = [])
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

    public static function fail(int $status, string $message, array $data = []): void
    {
        throw new HttpError($status, $message, $data);
    }

    public static function body(): array
    {
        if (str_starts_with($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) {
            $raw = file_get_contents('php://input', false, null, 0, 2_000_000);
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
            header('Access-Control-Expose-Headers: Content-Disposition');
            header('Access-Control-Max-Age: 86400');
        }
    }

    public static function securityHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        if (self::isHttps()) {
            header('Strict-Transport-Security: max-age=31536000');
        }
    }

    /** Envoie un fichier privé (document) au navigateur authentifié. */
    public static function file(string $path, string $name, string $mime): void
    {
        if (!is_file($path)) {
            self::fail(404, 'Fichier introuvable.');
        }
        $safe = preg_replace('/[^A-Za-z0-9._ -]/', '_', $name) ?: 'document';
        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($path));
        header('Content-Disposition: attachment; filename="' . $safe . '"; filename*=UTF-8\'\'' . rawurlencode($name));
        header('Cache-Control: private, no-store');
        readfile($path);
    }

    /** Export CSV (séparateur « ; », UTF-8 avec BOM pour Excel). */
    public static function csv(string $filename, array $header, array $rows): void
    {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $filename . '"');
        header('Cache-Control: private, no-store');
        $out = fopen('php://output', 'w');
        fwrite($out, "\xEF\xBB\xBF");
        fputcsv($out, $header, ';');
        foreach ($rows as $r) {
            fputcsv($out, $r, ';');
        }
        fclose($out);
    }

    /** Limitation de débit simple basée sur la table la_events. */
    public static function tooMany(string $kind, int $max, int $seconds, ?string $subject = null): bool
    {
        $since = date('Y-m-d H:i:s', time() - $seconds);
        $sql = 'SELECT COUNT(*) FROM la_events WHERE kind = ? AND created_at >= ? AND ' . ($subject === null ? 'ip = ?' : 'subject = ?');
        return (int) Db::value($sql, [$kind, $since, $subject ?? self::ip()]) >= $max;
    }

    public static function record(string $kind, string $subject = ''): void
    {
        Db::insert('la_events', ['kind' => $kind, 'ip' => self::ip(), 'subject' => substr($subject, 0, 190), 'created_at' => Db::now()]);
        if (random_int(1, 50) === 1) {
            Db::exec('DELETE FROM la_events WHERE created_at < ?', [date('Y-m-d H:i:s', time() - 86400 * 7)]);
        }
    }
}

/** Validation des entrées : petites aides partagées par les modules. */
final class In
{
    public static function str(array $in, string $k, int $max = 160): string
    {
        return mb_substr(trim((string) ($in[$k] ?? '')), 0, $max);
    }

    public static function int(array $in, string $k, int $min, int $max, bool $required = false, string $label = ''): ?int
    {
        $v = $in[$k] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                Http::fail(422, 'Le champ « ' . ($label ?: $k) . ' » est obligatoire.');
            }
            return null;
        }
        if (!is_numeric($v) || (int) $v != $v || $v < $min || $v > $max) {
            Http::fail(422, 'Valeur invalide pour « ' . ($label ?: $k) . ' ».');
        }
        return (int) $v;
    }

    /** Montant saisi en euros (« 1 234,56 ») → centimes entiers. */
    public static function cents(array $in, string $k, bool $required = false, string $label = '', bool $allowNegative = false): ?int
    {
        $v = $in[$k] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                Http::fail(422, 'Le montant « ' . ($label ?: $k) . ' » est obligatoire.');
            }
            return null;
        }
        $s = str_replace([' ', "\u{00a0}", "\u{202f}", '€'], '', (string) $v);
        $s = str_replace(',', '.', $s);
        if (!preg_match('/^-?\d{1,9}(\.\d{1,2})?$/', $s)) {
            Http::fail(422, 'Montant invalide pour « ' . ($label ?: $k) . ' ».');
        }
        $neg = str_starts_with($s, '-');
        [$e, $c] = array_pad(explode('.', ltrim($s, '-')), 2, '0');
        $cents = (int) $e * 100 + (int) str_pad(substr($c, 0, 2), 2, '0');
        if ($neg) {
            if (!$allowNegative) {
                Http::fail(422, 'Le montant « ' . ($label ?: $k) . ' » doit être positif.');
            }
            $cents = -$cents;
        }
        return $cents;
    }

    public static function date(array $in, string $k, bool $required = false, string $label = ''): ?string
    {
        $v = trim((string) ($in[$k] ?? ''));
        if ($v === '') {
            if ($required) {
                Http::fail(422, 'La date « ' . ($label ?: $k) . ' » est obligatoire.');
            }
            return null;
        }
        $d = DateTime::createFromFormat('!Y-m-d', $v);
        if (!$d || $d->format('Y-m-d') !== $v) {
            Http::fail(422, 'Date invalide pour « ' . ($label ?: $k) . ' » (AAAA-MM-JJ).');
        }
        return $v;
    }

    public static function datetime(array $in, string $k, bool $required = false, string $label = ''): ?string
    {
        $v = str_replace('T', ' ', trim((string) ($in[$k] ?? '')));
        if ($v === '') {
            if ($required) {
                Http::fail(422, 'Le champ « ' . ($label ?: $k) . ' » est obligatoire.');
            }
            return null;
        }
        if (strlen($v) === 16) {
            $v .= ':00';
        }
        $d = DateTime::createFromFormat('!Y-m-d H:i:s', $v);
        if (!$d || $d->format('Y-m-d H:i:s') !== $v) {
            Http::fail(422, 'Date et heure invalides pour « ' . ($label ?: $k) . ' ».');
        }
        return $v;
    }

    public static function oneOf(array $in, string $k, array $allowed, ?string $default = null, string $label = ''): string
    {
        $v = (string) ($in[$k] ?? '');
        if ($v === '' && $default !== null) {
            return $default;
        }
        if (!in_array($v, $allowed, true)) {
            Http::fail(422, 'Valeur invalide pour « ' . ($label ?: $k) . ' ».');
        }
        return $v;
    }

    public static function bool(array $in, string $k): int
    {
        $v = $in[$k] ?? false;
        return ($v === true || $v === 1 || $v === '1' || $v === 'on' || $v === 'true') ? 1 : 0;
    }

    public static function phoneNorm(string $tel): string
    {
        $d = preg_replace('/\D/', '', $tel);
        if (str_starts_with($d, '0033')) {
            $d = '0' . substr($d, 4);
        } elseif (str_starts_with($d, '33') && strlen($d) === 11) {
            $d = '0' . substr($d, 2);
        }
        return substr($d, 0, 20);
    }

    public static function emailNorm(string $email): string
    {
        return mb_strtolower(trim($email));
    }

    public static function immat(string $v): string
    {
        $v = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $v));
        // Format SIV : AB123CD → AB-123-CD
        if (preg_match('/^([A-Z]{2})(\d{3})([A-Z]{2})$/', $v, $m)) {
            return "$m[1]-$m[2]-$m[3]";
        }
        return substr($v, 0, 20);
    }
}
