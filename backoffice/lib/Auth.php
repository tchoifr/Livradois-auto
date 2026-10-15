<?php
declare(strict_types=1);

/**
 * Authentification du dashboard.
 * - mots de passe hachés (Argon2id si disponible, sinon bcrypt)
 * - cookie de session HttpOnly / Secure / SameSite=Strict, régénéré à la connexion
 * - expiration après 2 h d'inactivité et 12 h maximum
 * - jeton CSRF obligatoire pour toute modification
 * - limitation des tentatives : 5 échecs / 15 min par compte, 20 / 15 min par adresse IP
 */
final class Auth
{
    private const IDLE = 7200;
    private const ABSOLUTE = 43200;
    private const MIN_PASSWORD = 12;

    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $secure = Http::isHttps();
        ini_set('session.use_strict_mode', '1');
        ini_set('session.use_only_cookies', '1');
        ini_set('session.gc_maxlifetime', (string) self::ABSOLUTE);
        session_name($secure ? '__Host-la_admin' : 'la_admin');
        session_set_cookie_params(['lifetime' => 0, 'path' => '/', 'secure' => $secure, 'httponly' => true, 'samesite' => 'Strict']);
        session_start();

        if (!empty($_SESSION['uid'])) {
            $now = time();
            if ($now - ($_SESSION['last'] ?? 0) > self::IDLE || $now - ($_SESSION['born'] ?? 0) > self::ABSOLUTE) {
                self::destroy();
                session_start();
            } else {
                $_SESSION['last'] = $now;
            }
        }
    }

    public static function hash(string $password): string
    {
        return password_hash($password, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
    }

    public static function validatePassword(string $password): void
    {
        if (mb_strlen($password) < self::MIN_PASSWORD) {
            Http::fail(422, 'Le mot de passe doit contenir au moins ' . self::MIN_PASSWORD . ' caractères.');
        }
    }

    public static function user(): ?array
    {
        if (empty($_SESSION['uid'])) {
            return null;
        }
        return Db::one('SELECT id, email, name, last_login_at FROM admins WHERE id = ?', [(int) $_SESSION['uid']]);
    }

    public static function requireUser(): array
    {
        $u = self::user();
        if (!$u) {
            Http::fail(401, 'Session expirée, veuillez vous reconnecter.');
        }
        return $u;
    }

    public static function csrf(): string
    {
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf'];
    }

    public static function checkCsrf(): void
    {
        $sent = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (empty($_SESSION['csrf']) || !is_string($sent) || !hash_equals($_SESSION['csrf'], $sent)) {
            Http::fail(403, 'Jeton de sécurité invalide, rechargez la page.');
        }
    }

    public static function login(string $email, string $password): array
    {
        $email = mb_strtolower(trim($email));
        if (Http::tooMany('login_fail', 20, 900) || Http::tooMany('login_fail', 5, 900, $email)) {
            Http::fail(429, 'Trop de tentatives. Réessayez dans 15 minutes.');
        }
        $admin = Db::one('SELECT * FROM admins WHERE email = ?', [$email]);
        // Vérification systématique pour ne pas révéler l'existence du compte par le temps de réponse
        $hash = $admin['password_hash'] ?? password_hash(random_bytes(16), PASSWORD_DEFAULT);
        $ok = $admin !== null && password_verify($password, $hash);
        if (!$ok) {
            Http::record('login_fail', $email);
            usleep(random_int(200_000, 400_000));
            Http::fail(401, 'E-mail ou mot de passe incorrect.');
        }
        if (password_needs_rehash($admin['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) {
            Db::update('admins', ['password_hash' => self::hash($password)], (int) $admin['id']);
        }
        session_regenerate_id(true);
        $_SESSION = ['uid' => (int) $admin['id'], 'born' => time(), 'last' => time()];
        Db::update('admins', ['last_login_at' => Db::now()], (int) $admin['id']);
        return self::user();
    }

    public static function changePassword(array $user, string $current, string $new): void
    {
        $row = Db::one('SELECT password_hash FROM admins WHERE id = ?', [(int) $user['id']]);
        if (!$row || !password_verify($current, $row['password_hash'])) {
            Http::fail(422, 'Mot de passe actuel incorrect.');
        }
        self::validatePassword($new);
        Db::update('admins', ['password_hash' => self::hash($new)], (int) $user['id']);
        session_regenerate_id(true);
        unset($_SESSION['csrf']);
    }

    public static function createAdmin(string $email, string $password, string $name = ''): int
    {
        $email = mb_strtolower(trim($email));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Http::fail(422, 'Adresse e-mail invalide.');
        }
        self::validatePassword($password);
        return Db::insert('admins', ['email' => $email, 'name' => trim($name), 'password_hash' => self::hash($password), 'created_at' => Db::now()]);
    }

    public static function destroy(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            $p = session_get_cookie_params();
            setcookie(session_name(), '', ['expires' => time() - 3600, 'path' => $p['path'], 'secure' => $p['secure'], 'httponly' => true, 'samesite' => 'Strict']);
            session_destroy();
        }
    }
}
