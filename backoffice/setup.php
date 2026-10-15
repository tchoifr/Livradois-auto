<?php
declare(strict_types=1);

/*
 * Installation du back-office :
 *  1. crée les tables dans la base MySQL ;
 *  2. crée le premier compte administrateur ;
 *  3. (optionnel) importe les annonces de démonstration.
 *
 * Protégé par la clé « setup_key » de config.local.php, et inutilisable une fois
 * un administrateur créé. Utilisable aussi en ligne de commande :
 *   php setup.php admin@exemple.fr "mot-de-passe-solide" [--demo]
 */

require __DIR__ . '/lib/bootstrap.php';

function importDemo(): int
{
    $file = __DIR__ . '/seed/vehicules-demo.json';
    if (!is_file($file)) {
        return 0;
    }
    $n = 0;
    foreach (json_decode(file_get_contents($file), true) as $v) {
        if (Vehicles::findBySlug($v['id'])) {
            continue;
        }
        Db::insert('la_vehicules', [
            'slug' => $v['id'], 'ref' => $v['ref'], 'statut' => $v['statut'],
            'marque' => $v['marque'], 'modele' => $v['modele'], 'version' => $v['version'],
            'annee' => $v['annee'], 'mise_en_circulation' => $v['miseEnCirculation'] ?? '', 'km' => $v['km'],
            'energie' => $v['energie'], 'boite' => $v['boite'], 'carrosserie' => $v['carrosserie'],
            'puissance' => $v['puissance'] ?? null, 'cv' => $v['cv'] ?? null, 'portes' => $v['portes'] ?? null, 'places' => $v['places'] ?? null,
            'couleur' => $v['couleur'] ?? '', 'critair' => $v['critair'] ?? null,
            'premiere_main' => !empty($v['premiereMain']) ? 1 : 0, 'quatre_roues' => !empty($v['quatreRoues']) ? 1 : 0,
            'autonomie' => $v['autonomie'] ?? null, 'garantie' => $v['garantie'] ?? 12,
            'prix' => $v['prix'], 'prix_barre' => $v['prixBarre'] ?? null, 'badge' => $v['badge'] ?? null,
            'description' => $v['description'] ?? '',
            'equipements' => json_encode($v['equipements'] ?? [], JSON_UNESCAPED_UNICODE),
            'photos' => json_encode($v['photos'] ?? [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            'publie_le' => $v['ajoutLe'] ?? date('Y-m-d'),
            'created_at' => Db::now(), 'updated_at' => Db::now(),
        ]);
        $n++;
    }
    return $n;
}

// ---------- Ligne de commande ----------
// php setup.php                         → crée / met à jour les tables
// php setup.php email@exemple.fr        → crée le compte (ou réinitialise son mot de passe), saisie masquée
// php setup.php email@exemple.fr --demo → idem + importe les annonces de démonstration
if (PHP_SAPI === 'cli') {
    $ask = function (string $label): string {
        echo $label;
        $tty = DIRECTORY_SEPARATOR === '/' && function_exists('shell_exec');
        if ($tty) {
            @shell_exec('stty -echo 2>/dev/null');
        }
        $value = rtrim((string) fgets(STDIN), "\r\n");
        if ($tty) {
            @shell_exec('stty echo 2>/dev/null');
            echo "\n";
        }
        return $value;
    };

    Schema::migrate();
    echo "Tables à jour.\n";
    $args = array_values(array_filter(array_slice($argv, 1), fn($a) => !str_starts_with($a, '--')));
    if (isset($args[0])) {
        $email = mb_strtolower(trim($args[0]));
        $password = $args[1] ?? $ask('Mot de passe (12 caractères minimum, invisible à la saisie) : ');
        if (!isset($args[1]) && $ask('Confirmez le mot de passe : ') !== $password) {
            echo "Erreur : les deux mots de passe ne correspondent pas.\n";
            exit(1);
        }
        try {
            $existing = Db::one('SELECT id FROM la_admins WHERE email = ?', [$email]);
            if ($existing) {
                Auth::validatePassword($password);
                Db::update('la_admins', ['password_hash' => Auth::hash($password)], (int) $existing['id']);
                Db::exec('DELETE FROM la_sessions WHERE admin_id = ?', [(int) $existing['id']]);
                echo "Mot de passe réinitialisé pour $email (sessions ouvertes fermées).\n";
            } else {
                Auth::createAdmin($email, $password);
                echo "Compte administrateur créé : $email\n";
            }
        } catch (HttpError $e) {
            echo 'Erreur : ' . $e->getMessage() . "\n";
            exit(1);
        }
    }
    if (in_array('--demo', $argv, true)) {
        echo importDemo() . " annonce(s) de démonstration importée(s).\n";
    }
    exit;
}

// ---------- Navigateur ----------
header('Content-Type: text/html; charset=utf-8');
header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self'");

$message = '';
$done = false;
try {
    Schema::migrate();
    if (Schema::hasAdmin()) {
        http_response_code(403);
        $message = 'L\'installation est déjà terminée. Vous pouvez supprimer setup.php du serveur.';
        $done = true;
    } elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $key = (string) cfg('setup_key', '');
        if (strlen($key) < 16 || !hash_equals($key, (string) ($_POST['setup_key'] ?? ''))) {
            Http::record('login_fail', 'setup');
            throw new HttpError(403, 'Clé d\'installation incorrecte.');
        }
        if (($_POST['password'] ?? '') !== ($_POST['password2'] ?? '')) {
            throw new HttpError(422, 'Les deux mots de passe ne correspondent pas.');
        }
        Auth::createAdmin((string) $_POST['email'], (string) $_POST['password'], (string) ($_POST['name'] ?? ''));
        $imported = !empty($_POST['demo']) ? importDemo() : 0;
        $message = 'Compte créé' . ($imported ? " et $imported annonces de démonstration importées" : '') . '. Supprimez setup.php du serveur, puis connectez-vous.';
        $done = true;
    }
} catch (HttpError $e) {
    $message = $e->getMessage();
} catch (Throwable $e) {
    error_log('[setup] ' . $e->getMessage());
    $message = 'Connexion à la base impossible : vérifiez config.local.php.';
}
$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES);
?><!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Installation – Back-office Livradois Automobiles</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;background:#faf8f5;color:#1a1d23;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
form,.box{background:#fff;border:1px solid #e8e4dd;border-radius:16px;padding:32px;width:100%;max-width:420px;display:grid;gap:14px}
h1{font-size:22px;margin:0}label{font-weight:600;font-size:14px;display:grid;gap:6px}
input[type=text],input[type=email],input[type=password]{padding:12px;border:1.5px solid #e8e4dd;border-radius:10px;font:inherit}
button,a.btn{background:#d63f00;color:#fff;border:0;border-radius:999px;padding:14px;font:inherit;font-weight:700;cursor:pointer;text-align:center;text-decoration:none}
.msg{padding:12px;border-radius:10px;background:#fff4dc;color:#7a4a00;font-size:14px}.check{display:flex;gap:8px;align-items:center;font-weight:500}
</style>
</head>
<body>
<?php if ($done): ?>
  <div class="box"><h1>Back-office</h1><p class="msg"><?= $e($message) ?></p><a class="btn" href="./">Aller au tableau de bord</a></div>
<?php else: ?>
  <form method="post" autocomplete="off">
    <h1>Installation du back-office</h1>
    <p style="margin:0;color:#5f6672;font-size:14px">Création du compte administrateur du dashboard.</p>
    <?php if ($message): ?><p class="msg"><?= $e($message) ?></p><?php endif; ?>
    <label>Clé d'installation (config.local.php)<input type="password" name="setup_key" required></label>
    <label>Nom<input type="text" name="name" maxlength="120"></label>
    <label>E-mail de connexion<input type="email" name="email" required value="<?= $e($_POST['email'] ?? '') ?>"></label>
    <label>Mot de passe (12 caractères minimum)<input type="password" name="password" minlength="12" required autocomplete="new-password"></label>
    <label>Confirmer le mot de passe<input type="password" name="password2" minlength="12" required autocomplete="new-password"></label>
    <label class="check"><input type="checkbox" name="demo" value="1"> Importer les annonces de démonstration</label>
    <button type="submit">Créer le compte</button>
  </form>
<?php endif; ?>
</body>
</html>
