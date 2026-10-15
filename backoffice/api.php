<?php
declare(strict_types=1);

/*
 * API du back-office Livradois Automobiles (hébergée sur OVH)
 *   Public  : GET  api.php?r=vehicules          → annonces en ligne
 *             POST api.php?r=demandes           → demande / offre d'un client
 *   Admin   : routes « auth/… » et « admin/… », jeton dans l'en-tête X-LA-Token
 * Appelée depuis le site et le dashboard publiés sur GitHub Pages (origines listées dans config.local.php).
 */

require __DIR__ . '/lib/bootstrap.php';

Http::securityHeaders();
Http::cors();
$route = trim((string) ($_GET['r'] ?? ''), '/');
$method = Http::method();

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    // ---------- Routes publiques (site) ----------
    if ($route === 'vehicules' && $method === 'GET') {
        header('Cache-Control: public, max-age=60');
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(Vehicles::listPublic(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    if ($route === 'demandes' && $method === 'POST') {
        Http::json(Requests::create(Http::body()), 201);
        exit;
    }

    // ---------- Connexion ----------
    if ($route === 'auth/me') {
        Http::json([
            'user' => Auth::user(),
            'listes' => [
                'energies' => Vehicles::ENERGIES, 'boites' => Vehicles::BOITES, 'carrosseries' => Vehicles::CARROSSERIES,
                'types' => Requests::TYPES, 'statutsDemande' => Requests::STATUTS,
            ],
        ]);
        exit;
    }
    if ($route === 'auth/login' && $method === 'POST') {
        $in = Http::body();
        Http::json(Auth::login((string) ($in['email'] ?? ''), (string) ($in['password'] ?? '')));
        exit;
    }

    // ---------- Routes du dashboard (jeton obligatoire) ----------
    $user = Auth::requireUser();
    $in = $method === 'GET' ? $_GET : Http::body();
    $id = (int) ($in['id'] ?? 0);

    switch ("$method $route") {
        case 'POST auth/logout':
            Auth::logout();
            Http::json(['ok' => true]);
            break;
        case 'POST auth/password':
            Auth::changePassword($user, (string) ($in['current'] ?? ''), (string) ($in['new'] ?? ''));
            Http::json(['ok' => true]);
            break;

        case 'GET admin/stats':
            Http::json(Requests::stats());
            break;

        case 'GET admin/vehicules':
            Http::json(Vehicles::listAdmin());
            break;
        case 'GET admin/vehicule':
            Http::json(Vehicles::get($id));
            break;
        case 'POST admin/vehicule':
            Http::json(Vehicles::save($in));
            break;
        case 'POST admin/vehicule/statut':
            Http::json(Vehicles::setStatut($id, (string) ($in['statut'] ?? '')));
            break;
        case 'POST admin/vehicule/supprimer':
            Vehicles::delete($id);
            Http::json(['ok' => true]);
            break;
        case 'POST admin/photo':
            Http::json(Uploads::photo($_FILES['photo'] ?? []));
            break;

        case 'GET admin/demandes':
            Http::json(Requests::list($in));
            break;
        case 'POST admin/demande/statut':
            Requests::setStatut($id, (string) ($in['statut'] ?? ''));
            Http::json(['ok' => true]);
            break;
        case 'POST admin/demande/supprimer':
            Requests::delete($id);
            Http::json(['ok' => true]);
            break;

        default:
            Http::fail(404, 'Route inconnue.');
    }
} catch (HttpError $e) {
    Http::json(['error' => $e->getMessage()], $e->status);
} catch (Throwable $e) {
    error_log('[backoffice] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Http::json(['error' => 'Erreur interne du serveur.'], 500);
}
