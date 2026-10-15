<?php
declare(strict_types=1);

/**
 * Authentification du dashboard (hébergé sur GitHub Pages, API sur OVH).
 * - jeton de session aléatoire (256 bits) envoyé dans l'en-tête X-LA-Token ;
 *   seule son empreinte SHA-256 est stockée en base
 * - aucun cookie : pas de risque CSRF, fonctionne entre deux domaines
 * - expiration après 2 h d'inactivité et 12 h maximum
 * - mots de passe hachés (Argon2id si disponible, sinon bcrypt)
 * - limitation des tentatives : 5 échecs / 15 min par compte, 20 / 15 min par adresse IP
 */
final class Auth
{
    private const IDLE = 7200;
    private const ABSOLUTE = 43200;
    private const MIN_PASSWORD = 12;

    private static ?int $sessionId = null;

    private static function algo()
    {
        return defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    }

    public static function hash(string $password): string
    {
        return password_hash($password, self::algo());
    }

    public static function validatePassword(string $password): void
    {
        if (mb_strlen($password) < self::MIN_PASSWORD) {
            Http::fail(422, 'Le mot de passe doit contenir au moins ' . self::MIN_PASSWORD . ' caractères.');
        }
    }

    private static function token(): string
    {
        $t = (string) ($_SERVER['HTTP_X_LA_TOKEN'] ?? '');
        return preg_match('/^[a-f0-9]{64}$/', $t) ? $t : '';
    }

    public static function user(): ?array
    {
        $t = self::token();
        if ($t === '') {
            return null;
        }
        $row = Db::one('SELECT s.id AS sid, s.created_at AS s_created, s.last_seen_at, a.id, a.email, a.name, a.last_login_at
            FROM la_sessions s JOIN la_admins a ON a.id = s.admin_id WHERE s.token_hash = ?', [hash('sha256', $t)]);
        if (!$row) {
            return null;
        }
        $now = time();
        $seen = strtotime($row['last_seen_at']);
        if ($now - $seen > self::IDLE || $now - strtotime($row['s_created']) > self::ABSOLUTE) {
            Db::exec('DELETE FROM la_sessions WHERE id = ?', [(int) $row['sid']]);
            return null;
        }
        if ($now - $seen > 60) {
            Db::exec('UPDATE la_sessions SET last_seen_at = ? WHERE id = ?', [Db::now(), (int) $row['sid']]);
        }
        self::$sessionId = (int) $row['sid'];
        return ['id' => (int) $row['id'], 'email' => $row['email'], 'name' => $row['name'], 'last_login_at' => $row['last_login_at']];
    }

    public static function requireUser(): array
    {
        $u = self::user();
        if (!$u) {
            Http::fail(401, 'Session expirée, veuillez vous reconnecter.');
        }
        return $u;
    }

    /** @return array{user: array, token: string} */
    public static function login(string $email, string $password): array
    {
        $email = mb_strtolower(trim($email));
        if (Http::tooMany('login_fail', 20, 900) || Http::tooMany('login_fail', 5, 900, $email)) {
            Http::fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
        }
        $admin = Db::one('SELECT * FROM la_admins WHERE email = ?', [$email]);
        // Vérification systématique pour ne pas révéler l'existence du compte par le temps de réponse
        $hash = $admin['password_hash'] ?? password_hash(random_bytes(16), PASSWORD_DEFAULT);
        if ($admin === null || !password_verify($password, $hash)) {
            Http::record('login_fail', $email);
            usleep(random_int(200_000, 400_000));
            Http::fail(401, 'E-mail ou mot de passe incorrect.');
        }
        if (password_needs_rehash($admin['password_hash'], self::algo())) {
            Db::update('la_admins', ['password_hash' => self::hash($password)], (int) $admin['id']);
        }

        // Ménage des sessions expirées, puis nouvelle session
        Db::exec('DELETE FROM la_sessions WHERE last_seen_at < ? OR created_at < ?', [
            date('Y-m-d H:i:s', time() - self::IDLE), date('Y-m-d H:i:s', time() - self::ABSOLUTE),
        ]);
        $token = bin2hex(random_bytes(32));
        Db::insert('la_sessions', [
            'admin_id' => (int) $admin['id'],
            'token_hash' => hash('sha256', $token),
            'ip' => Http::ip(),
            'user_agent' => mb_substr((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 200),
            'created_at' => Db::now(),
            'last_seen_at' => Db::now(),
        ]);
        $user = ['id' => (int) $admin['id'], 'email' => $admin['email'], 'name' => $admin['name'], 'last_login_at' => $admin['last_login_at']];
        Db::update('la_admins', ['last_login_at' => Db::now()], (int) $admin['id']);
        return ['user' => $user, 'token' => $token];
    }

    public static function logout(): void
    {
        $t = self::token();
        if ($t !== '') {
            Db::exec('DELETE FROM la_sessions WHERE token_hash = ?', [hash('sha256', $t)]);
        }
    }

    /** Change le mot de passe et ferme toutes les autres sessions du compte. */
    public static function changePassword(array $user, string $current, string $new): void
    {
        $row = Db::one('SELECT password_hash FROM la_admins WHERE id = ?', [(int) $user['id']]);
        if (!$row || !password_verify($current, $row['password_hash'])) {
            Http::fail(422, 'Mot de passe actuel incorrect.');
        }
        self::validatePassword($new);
        Db::update('la_admins', ['password_hash' => self::hash($new)], (int) $user['id']);
        Db::exec('DELETE FROM la_sessions WHERE admin_id = ? AND id <> ?', [(int) $user['id'], (int) self::$sessionId]);
    }

    public static function createAdmin(string $email, string $password, string $name = ''): int
    {
        $email = mb_strtolower(trim($email));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Http::fail(422, 'Adresse e-mail invalide.');
        }
        self::validatePassword($password);
        return Db::insert('la_admins', ['email' => $email, 'name' => trim($name), 'password_hash' => self::hash($password), 'created_at' => Db::now()]);
    }
}
