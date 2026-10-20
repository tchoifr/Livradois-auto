<?php
declare(strict_types=1);

/**
 * Coffre : chiffrement authentifié des accès aux plateformes (AES-256-GCM via openssl, sinon XChaCha20-Poly1305 via sodium).
 * Clé : réglage « diffusion_key » (32 octets en base64) s'il existe, sinon dérivée des accès à la base
 * (une copie de la base seule ne permet donc pas de lire les accès).
 */
final class Coffre
{
    private static function cle(): string
    {
        $k = (string) cfg('diffusion_key', '');
        if ($k !== '') {
            $raw = base64_decode($k, true);
            if ($raw !== false && strlen($raw) === 32) {
                return $raw;
            }
        }
        $db = (array) cfg('db', []);
        return hash_hkdf('sha256', (string) ($db['pass'] ?? '') . '|' . (string) ($db['dsn'] ?? '') . '|' . (string) ($db['user'] ?? ''), 32, 'livradois-diffusion-v1');
    }

    /** « v1 » : AES-256-GCM (openssl) ; « v2 » : XChaCha20-Poly1305 (sodium) si openssl est absent. */
    public static function chiffrer(string $clair): string
    {
        if (function_exists('openssl_encrypt')) {
            $iv = random_bytes(12);
            $tag = '';
            $c = openssl_encrypt($clair, 'aes-256-gcm', self::cle(), OPENSSL_RAW_DATA, $iv, $tag);
            if ($c !== false) {
                return 'v1:' . base64_encode($iv . $tag . $c);
            }
        }
        if (function_exists('sodium_crypto_aead_xchacha20poly1305_ietf_encrypt')) {
            $nonce = random_bytes(SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES);
            return 'v2:' . base64_encode($nonce . sodium_crypto_aead_xchacha20poly1305_ietf_encrypt($clair, 'livradois', $nonce, self::cle()));
        }
        Http::fail(503, 'Chiffrement indisponible sur cet hébergement (extensions openssl et sodium absentes) : aucun accès n\'est enregistré.');
    }

    public static function dechiffrer(?string $blob): ?string
    {
        if (!$blob || strlen($blob) < 4) {
            return null;
        }
        $raw = base64_decode(substr($blob, 3), true);
        if ($raw === false) {
            return null;
        }
        if (str_starts_with($blob, 'v1:') && strlen($raw) > 28 && function_exists('openssl_decrypt')) {
            $clair = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', self::cle(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
            return $clair === false ? null : $clair;
        }
        $n = defined('SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES') ? SODIUM_CRYPTO_AEAD_XCHACHA20POLY1305_IETF_NPUBBYTES : 24;
        if (str_starts_with($blob, 'v2:') && strlen($raw) > $n && function_exists('sodium_crypto_aead_xchacha20poly1305_ietf_decrypt')) {
            $clair = sodium_crypto_aead_xchacha20poly1305_ietf_decrypt(substr($raw, $n), 'livradois', substr($raw, 0, $n), self::cle());
            return $clair === false ? null : $clair;
        }
        return null;
    }
}

/**
 * Comptes de diffusion : abonnement déclaré et accès API remis par chaque plateforme.
 * Jamais de mot de passe de compte Leboncoin ou La Centrale : uniquement les accès techniques (OAuth 2.0
 * identifiant/secret client, ou clé d'API) fournis avec l'abonnement pro, chiffrés, testés par un vrai appel
 * vers une adresse officielle de la plateforme.
 */
final class ComptesDiffusion
{
    public const METHODES = ['oauth2_client' => 'OAuth 2.0 — identifiant et secret client', 'cle_api' => 'Clé d\'API'];
    public const STATUTS = ['non_connecte' => 'Non connecté', 'connecte' => 'Connecté', 'erreur' => 'Erreur', 'expire' => 'Expiré'];

    /** Conditions d'accès de chaque plateforme (vérifiées en octobre 2026 ; à revoir si elles changent). */
    public const PLATEFORMES = [
        'leboncoin' => [
            'domaines' => ['leboncoin.fr', 'leboncoin.auto'],
            'conditions' => 'Diffusion automatique réservée aux professionnels ayant souscrit une offre pro adaptée (demande via leboncoinsolutionspro.fr/automobile). Les accès API sont remis par Leboncoin avec l\'abonnement, avec leur documentation.',
            'aide' => 'https://assistance.leboncoin.info/hc/fr/articles/360000033519-Comment-diffuser-automatiquement-mes-annonces-sur-leboncoin-',
        ],
        'lacentrale' => [
            'domaines' => ['lacentrale.fr'],
            'conditions' => 'Publication réservée aux professionnels abonnés à un pack La Centrale (Business, First ou Ultimate). Pas d\'API publique : les accès éventuels sont fournis par La Centrale avec l\'abonnement.',
            'aide' => 'https://offre-pro.lacentrale.fr/offre-partenaires/',
        ],
    ];

    private static function canal(int $id): array
    {
        $c = Db::one('SELECT * FROM la_canaux WHERE id = ?', [$id]);
        if (!$c || !isset(self::PLATEFORMES[$c['code']])) {
            Http::fail(404, 'Plateforme inconnue.');
        }
        return $c;
    }

    private static function compte(int $canalId): array
    {
        $c = Db::one('SELECT * FROM la_comptes_diffusion WHERE canal_id = ?', [$canalId]);
        if (!$c) {
            Db::insert('la_comptes_diffusion', ['canal_id' => $canalId, 'statut' => 'non_connecte', 'updated_at' => Db::now()]);
            $c = Db::one('SELECT * FROM la_comptes_diffusion WHERE canal_id = ?', [$canalId]);
        }
        return $c;
    }

    public static function abonnementValide(array $c): bool
    {
        return (int) $c['abonnement_actif'] === 1 && (empty($c['abonnement_fin']) || $c['abonnement_fin'] >= date('Y-m-d'));
    }

    /** Statut réel : un compte connecté dont l'abonnement est terminé passe « expiré ». */
    public static function statut(array $c): string
    {
        if ($c['statut'] === 'connecte' && !self::abonnementValide($c)) {
            return 'expire';
        }
        return $c['statut'];
    }

    public static function estConnecte(int $canalId): bool
    {
        $c = Db::one('SELECT * FROM la_comptes_diffusion WHERE canal_id = ?', [$canalId]);
        return $c !== null && self::statut($c) === 'connecte';
    }

    private static function masque(string $s): string
    {
        return strlen($s) <= 8 ? str_repeat('•', strlen($s)) : substr($s, 0, 4) . '…' . substr($s, -4);
    }

    /** Vue sans aucun secret (seulement « enregistré : oui / non »). */
    public static function out(array $canal, array $c): array
    {
        $p = self::PLATEFORMES[$canal['code']];
        $st = self::statut($c);
        return [
            'canalId' => (int) $canal['id'], 'code' => $canal['code'], 'nom' => $canal['nom'], 'urlDepot' => $canal['url_depot'],
            'conditions' => $p['conditions'], 'aide' => $p['aide'], 'domaines' => $p['domaines'],
            'abonnementActif' => (int) $c['abonnement_actif'] === 1, 'abonnementOffre' => $c['abonnement_offre'], 'abonnementFin' => $c['abonnement_fin'],
            'abonnementValide' => self::abonnementValide($c),
            'methode' => $c['methode'], 'urlJeton' => $c['url_jeton'], 'urlTest' => $c['url_test'], 'enteteCle' => $c['entete_cle'],
            'identifiant' => self::masque($c['identifiant']), 'secretEnregistre' => !empty($c['secret_chiffre']),
            'statut' => $st, 'statutLabel' => self::STATUTS[$st] ?? $st,
            'dernierTestLe' => $c['dernier_test_le'], 'dernierMessage' => $c['dernier_message'], 'connecteLe' => $c['connecte_le'],
            'publicationAuto' => Diffusion::connecteur($canal['code']) !== null && in_array('publier', Diffusion::connecteur($canal['code'])->capacites(), true),
        ];
    }

    public static function list(array $user): array
    {
        Access::require($user, 'diffusion.voir');
        $out = [];
        foreach (Db::all("SELECT * FROM la_canaux WHERE type = 'plateforme' ORDER BY ordre, id") as $canal) {
            if (isset(self::PLATEFORMES[$canal['code']])) {
                $out[] = self::out($canal, self::compte((int) $canal['id']));
            }
        }
        return $out;
    }

    /** Enregistre l'abonnement et les accès (un changement d'accès impose un nouveau test). */
    public static function save(array $user, array $in): array
    {
        Access::require($user, 'diffusion.comptes');
        $canal = self::canal((int) ($in['canalId'] ?? 0));
        $c = self::compte((int) $canal['id']);
        $methode = (string) ($in['methode'] ?? $c['methode']);
        if ($methode !== '' && !isset(self::METHODES[$methode])) {
            Http::fail(422, 'Méthode de connexion inconnue.');
        }
        // Mise à jour partielle : un champ non transmis garde sa valeur
        $keep = fn(string $k, string $col, callable $read) => array_key_exists($k, $in) ? $read() : $c[$col];
        $data = [
            'abonnement_actif' => (int) $keep('abonnementActif', 'abonnement_actif', fn() => In::bool($in, 'abonnementActif')),
            'abonnement_offre' => $keep('abonnementOffre', 'abonnement_offre', fn() => In::str($in, 'abonnementOffre', 120)),
            'abonnement_fin' => $keep('abonnementFin', 'abonnement_fin', fn() => In::date($in, 'abonnementFin', false, 'fin d\'abonnement')),
            'methode' => $methode,
            'url_jeton' => $keep('urlJeton', 'url_jeton', fn() => trim(In::str($in, 'urlJeton', 255))),
            'url_test' => $keep('urlTest', 'url_test', fn() => trim(In::str($in, 'urlTest', 255))),
            'entete_cle' => $keep('enteteCle', 'entete_cle', fn() => In::oneOf($in, 'enteteCle', ['', 'authorization', 'x-api-key'], '', 'en-tête')),
            'identifiant' => $keep('identifiant', 'identifiant', fn() => trim(In::str($in, 'identifiant', 190))),
            'updated_at' => Db::now(),
        ];
        if ($c['identifiant'] !== '' && $data['identifiant'] === self::masque($c['identifiant'])) {
            $data['identifiant'] = $c['identifiant']; // formulaire renvoyé sans changement (valeur masquée)
        }
        foreach (['url_jeton' => 'Adresse d\'authentification', 'url_test' => 'Adresse de vérification'] as $col => $label) {
            if ($data[$col] !== '') {
                self::verifierUrl($data[$col], $canal, $label, false);
            }
        }
        $secret = (string) ($in['secret'] ?? '');
        $accesChange = $secret !== '' || $data['methode'] !== $c['methode'] || $data['url_jeton'] !== $c['url_jeton'] || $data['url_test'] !== $c['url_test']
            || $data['identifiant'] !== $c['identifiant'] || $data['entete_cle'] !== $c['entete_cle'];
        if ($secret !== '') {
            if (strlen($secret) > 2000) {
                Http::fail(422, 'Secret trop long.');
            }
            $data['secret_chiffre'] = Coffre::chiffrer($secret);
        }
        if ($accesChange) {
            $data += ['statut' => 'non_connecte', 'jeton_chiffre' => null, 'jeton_expire_le' => null, 'dernier_message' => 'Accès modifiés : testez la connexion.'];
        }
        Db::update('la_comptes_diffusion', $data, (int) $c['id']);
        Diffusion::journal($user, null, (int) $canal['id'], null, 'compte_modifie', 'info',
            'Compte ' . $canal['nom'] . ' mis à jour (abonnement ' . ($data['abonnement_actif'] ? 'actif' : 'inactif') . ($data['abonnement_fin'] ? ' jusqu\'au ' . date('d/m/Y', strtotime($data['abonnement_fin'])) : '') . ($secret !== '' ? ', nouvel accès enregistré' : '') . ').');
        Audit::log($user, 'diffusion.compte', 'canal', (int) $canal['id'], null, array_diff_key($data, ['secret_chiffre' => 1]));
        return self::out($canal, self::compte((int) $canal['id']));
    }

    /** Test réel : l'abonnement doit être actif, l'adresse officielle, et la plateforme doit accepter les accès. */
    public static function tester(array $user, int $canalId): array
    {
        Access::require($user, 'diffusion.comptes');
        $canal = self::canal($canalId);
        $c = self::compte($canalId);
        if (BO_DEMO) {
            Http::fail(403, 'Le test de connexion est désactivé dans la démonstration.');
        }
        if (!self::abonnementValide($c)) {
            Http::fail(409, 'Indiquez d\'abord un abonnement pro actif chez ' . $canal['nom'] . ' (la plateforme n\'autorise la diffusion automatique qu\'aux comptes abonnés).');
        }
        $secret = Coffre::dechiffrer($c['secret_chiffre']);
        if ($c['methode'] === '' || $secret === null || $secret === '') {
            Http::fail(422, 'Renseignez la méthode de connexion et les accès remis par ' . $canal['nom'] . '.');
        }
        if ($c['methode'] === 'oauth2_client') {
            if ($c['url_jeton'] === '' || $c['identifiant'] === '') {
                Http::fail(422, 'Renseignez l\'adresse d\'authentification et l\'identifiant client indiqués dans la documentation de ' . $canal['nom'] . '.');
            }
            self::verifierUrl($c['url_jeton'], $canal, 'Adresse d\'authentification', true);
            [$status, $body] = self::requete('POST', $c['url_jeton'], ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
                http_build_query(['grant_type' => 'client_credentials', 'client_id' => $c['identifiant'], 'client_secret' => $secret]));
            $r = self::analyserJeton($status, $body);
        } else {
            if ($c['url_test'] === '') {
                Http::fail(422, 'Renseignez l\'adresse de vérification indiquée dans la documentation de ' . $canal['nom'] . '.');
            }
            self::verifierUrl($c['url_test'], $canal, 'Adresse de vérification', true);
            $header = $c['entete_cle'] === 'x-api-key' ? 'X-API-Key: ' . $secret : 'Authorization: Bearer ' . $secret;
            [$status, $body] = self::requete('GET', $c['url_test'], [$header, 'Accept: application/json'], null);
            $r = self::analyserCle($status);
        }
        $data = ['dernier_test_le' => Db::now(), 'dernier_message' => mb_substr($r['message'], 0, 500), 'updated_at' => Db::now()];
        if ($r['ok']) {
            $data += ['statut' => 'connecte', 'connecte_par' => $user['id'], 'connecte_le' => Db::now()];
            if (!empty($r['jeton'])) {
                $data['jeton_chiffre'] = Coffre::chiffrer($r['jeton']);
                $data['jeton_expire_le'] = date('Y-m-d H:i:s', time() + max(60, (int) ($r['expire'] ?? 3600)));
            }
        } else {
            $data += ['statut' => 'erreur', 'jeton_chiffre' => null, 'jeton_expire_le' => null];
        }
        Db::update('la_comptes_diffusion', $data, (int) $c['id']);
        Diffusion::journal($user, null, $canalId, null, 'compte_test', $r['ok'] ? 'succes' : 'echec', $canal['nom'] . ' : ' . $r['message']);
        return self::out($canal, self::compte($canalId));
    }

    /**
     * Jeton d'accès valide pour un connecteur (OAuth 2.0) : réutilisé tant qu'il n'a pas expiré, sinon redemandé
     * à la plateforme. Null si le compte n'est pas connecté ou si la plateforme refuse (le compte passe alors « erreur »).
     */
    public static function jeton(int $canalId): ?string
    {
        $c = Db::one('SELECT * FROM la_comptes_diffusion WHERE canal_id = ?', [$canalId]);
        if (!$c || self::statut($c) !== 'connecte') {
            return null;
        }
        if ($c['methode'] === 'cle_api') {
            return Coffre::dechiffrer($c['secret_chiffre']);
        }
        if ($c['jeton_chiffre'] && $c['jeton_expire_le'] && $c['jeton_expire_le'] > date('Y-m-d H:i:s', time() + 60)) {
            return Coffre::dechiffrer($c['jeton_chiffre']);
        }
        $canal = self::canal($canalId);
        self::verifierUrl($c['url_jeton'], $canal, 'Adresse d\'authentification', true);
        [$status, $body] = self::requete('POST', $c['url_jeton'], ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
            http_build_query(['grant_type' => 'client_credentials', 'client_id' => $c['identifiant'], 'client_secret' => (string) Coffre::dechiffrer($c['secret_chiffre'])]));
        $r = self::analyserJeton($status, $body);
        if (!$r['ok']) {
            if ($status !== 0 && $status !== 429) {
                Db::update('la_comptes_diffusion', ['statut' => 'erreur', 'jeton_chiffre' => null, 'jeton_expire_le' => null, 'dernier_message' => mb_substr('Renouvellement de l\'accès refusé : ' . $r['message'], 0, 500), 'updated_at' => Db::now()], (int) $c['id']);
                Diffusion::journal(null, null, $canalId, null, 'compte_jeton', 'echec', $canal['nom'] . ' : ' . $r['message']);
            }
            return null;
        }
        Db::update('la_comptes_diffusion', ['jeton_chiffre' => Coffre::chiffrer($r['jeton']), 'jeton_expire_le' => date('Y-m-d H:i:s', time() + max(60, (int) $r['expire'])), 'updated_at' => Db::now()], (int) $c['id']);
        return $r['jeton'];
    }

    public static function deconnecter(array $user, int $canalId): array
    {
        Access::require($user, 'diffusion.comptes');
        $canal = self::canal($canalId);
        $c = self::compte($canalId);
        Db::update('la_comptes_diffusion', [
            'secret_chiffre' => null, 'jeton_chiffre' => null, 'jeton_expire_le' => null, 'statut' => 'non_connecte',
            'connecte_par' => null, 'connecte_le' => null, 'dernier_message' => 'Compte déconnecté : accès effacés.', 'updated_at' => Db::now(),
        ], (int) $c['id']);
        Diffusion::journal($user, null, $canalId, null, 'compte_deconnecte', 'info', 'Compte ' . $canal['nom'] . ' déconnecté : accès effacés du serveur.');
        Audit::log($user, 'diffusion.deconnexion', 'canal', $canalId);
        return self::out($canal, self::compte($canalId));
    }

    /** Lecture d'une réponse OAuth 2.0 (client_credentials) ; testée unitairement. */
    public static function analyserJeton(int $status, string $body): array
    {
        if ($status === 0) {
            return ['ok' => false, 'message' => 'Plateforme injoignable (délai dépassé ou connexion refusée). Réessayez plus tard.'];
        }
        $j = json_decode($body, true);
        if ($status >= 200 && $status < 300 && is_array($j) && !empty($j['access_token']) && is_string($j['access_token'])) {
            return ['ok' => true, 'message' => 'Connexion vérifiée : la plateforme a accepté les accès.', 'jeton' => $j['access_token'], 'expire' => (int) ($j['expires_in'] ?? 3600)];
        }
        if (in_array($status, [400, 401, 403], true)) {
            $detail = is_array($j) ? (string) ($j['error_description'] ?? $j['error'] ?? '') : '';
            return ['ok' => false, 'message' => 'Accès refusés par la plateforme (HTTP ' . $status . ($detail !== '' ? ' : ' . mb_substr(strip_tags($detail), 0, 120) : '') . '). Vérifiez l\'identifiant, le secret et que l\'abonnement donne bien accès à l\'API.'];
        }
        if ($status === 429) {
            return ['ok' => false, 'message' => 'Trop de tentatives (HTTP 429) : la plateforme limite les connexions, réessayez dans quelques minutes.'];
        }
        return ['ok' => false, 'message' => 'Réponse inattendue de la plateforme (HTTP ' . $status . '). Vérifiez l\'adresse d\'authentification indiquée dans sa documentation.'];
    }

    public static function analyserCle(int $status): array
    {
        if ($status === 0) {
            return ['ok' => false, 'message' => 'Plateforme injoignable (délai dépassé ou connexion refusée). Réessayez plus tard.'];
        }
        if ($status >= 200 && $status < 300) {
            return ['ok' => true, 'message' => 'Connexion vérifiée : la plateforme a accepté la clé d\'API.'];
        }
        if (in_array($status, [401, 403], true)) {
            return ['ok' => false, 'message' => 'Clé d\'API refusée par la plateforme (HTTP ' . $status . '). Vérifiez la clé et que l\'abonnement donne accès à l\'API.'];
        }
        return ['ok' => false, 'message' => 'Réponse inattendue de la plateforme (HTTP ' . $status . '). Vérifiez l\'adresse de vérification indiquée dans sa documentation.'];
    }

    /**
     * Adresse sortante autorisée : https, domaine officiel de la plateforme, jamais une adresse interne
     * (protection contre l'utilisation du serveur pour joindre son propre réseau).
     */
    private static function verifierUrl(string $url, array $canal, string $label, bool $resoudre): void
    {
        $p = parse_url($url);
        if (!$p || ($p['scheme'] ?? '') !== 'https' || empty($p['host']) || isset($p['user']) || isset($p['pass']) || (isset($p['port']) && (int) $p['port'] !== 443)) {
            Http::fail(422, $label . ' : utilisez l\'adresse https officielle indiquée par ' . $canal['nom'] . '.');
        }
        $host = strtolower($p['host']);
        $domaines = self::PLATEFORMES[$canal['code']]['domaines'];
        $ok = false;
        foreach ($domaines as $d) {
            if ($host === $d || str_ends_with($host, '.' . $d)) {
                $ok = true;
            }
        }
        if (!$ok) {
            Http::fail(422, $label . ' : l\'adresse doit appartenir à ' . $canal['nom'] . ' (' . implode(', ', $domaines) . ').');
        }
        if ($resoudre) {
            $ips = @gethostbynamel($host) ?: [];
            if (!$ips) {
                Http::fail(422, $label . ' : adresse introuvable (' . $host . ').');
            }
            foreach ($ips as $ip) {
                if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                    Http::fail(422, $label . ' : adresse refusée (réseau interne).');
                }
            }
        }
    }

    /** Requête sortante courte, sans suivre les redirections ; renvoie [code HTTP, corps] (code 0 si injoignable). */
    public static function requete(string $method, string $url, array $headers, ?string $body): array
    {
        if (!filter_var(ini_get('allow_url_fopen'), FILTER_VALIDATE_BOOLEAN)) {
            Http::fail(503, 'Les connexions sortantes sont désactivées sur cet hébergement (allow_url_fopen).');
        }
        $ctx = stream_context_create([
            'http' => ['method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '', 'timeout' => 10,
                'ignore_errors' => true, 'follow_location' => 0, 'max_redirects' => 0, 'user_agent' => 'LivradoisBackoffice/1.0'],
            'ssl' => ['verify_peer' => true, 'verify_peer_name' => true],
        ]);
        $http_response_header = [];
        $resp = @file_get_contents($url, false, $ctx);
        $status = 0;
        foreach ($http_response_header as $h) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $h, $m)) {
                $status = (int) $m[1];
            }
        }
        return [$status, $resp === false ? '' : (string) $resp];
    }
}
