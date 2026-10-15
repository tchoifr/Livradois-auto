<?php
declare(strict_types=1);

/*
 * API du back-office Livradois Automobiles
 *   Public  : GET  api.php?r=vehicules          → annonces en ligne
 *             POST api.php?r=demandes           → demande / offre d'un client
 *   Admin   : routes « auth/… » et « admin/… » (session + jeton CSRF)
 */

require __DIR__ . '/lib/bootstrap.php';

Http::securityHeaders();
$route = trim((string) ($_GET['r'] ?? ''), '/');
$method = Http::method();

try {
    // ---------- Routes publiques (appelées par le site) ----------
    if ($route === 'vehicules' || $route === 'demandes') {
        Http::cors();
        if ($method === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
        if ($route === 'vehicules' && $method === 'GET') {
            header('Cache-Control: public, max-age=60');
            http_response_code(200);
            header('Content-Type: application/json; charset=utf-8');
            echo json_encode(Vehicles::listPublic(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            exit;
        }
        if ($route === 'demandes' && $method === 'POST') {
            Http::json(Requests::create(Http::body()), 201);
            exit;
        }
        Http::fail(405, 'Méthode non autorisée.');
    }

    // ---------- Routes du dashboard (même origine uniquement) ----------
    Auth::start();

    if ($route === 'auth/me') {
        $u = Auth::user();
        Http::json([
            'user' => $u,
            'csrf' => $u ? Auth::csrf() : null,
            'siteUrl' => cfg('site_url', ''),
            'listes' => [
                'energies' => Vehicles::ENERGIES, 'boites' => Vehicles::BOITES, 'carrosseries' => Vehicles::CARROSSERIES,
                'types' => Requests::TYPES, 'statutsDemande' => Requests::STATUTS,
            ],
        ]);
        exit;
    }

    if ($route === 'auth/login' && $method === 'POST') {
        $in = Http::body();
        $user = Auth::login((string) ($in['email'] ?? ''), (string) ($in['password'] ?? ''));
        Http::json(['user' => $user, 'csrf' => Auth::csrf()]);
        exit;
    }

    $user = Auth::requireUser();
    if ($method !== 'GET') {
        Auth::checkCsrf();
    }
    $in = $method === 'GET' ? $_GET : Http::body();
    $id = (int) ($in['id'] ?? 0);

    switch ("$method $route") {
        case 'POST auth/logout':
            Auth::destroy();
            Http::json(['ok' => true]);
            break;
        case 'POST auth/password':
            Auth::changePassword($user, (string) ($in['current'] ?? ''), (string) ($in['new'] ?? ''));
            Http::json(['ok' => true, 'csrf' => Auth::csrf()]);
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
