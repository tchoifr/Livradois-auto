<?php
declare(strict_types=1);

/*
 * API du back-office Livradois Automobiles (hébergée sur OVH)
 *   Public  : GET  api.php?r=vehicules          → annonces en ligne (format inchangé)
 *             POST api.php?r=demandes           → demande / offre d'un client
 *   Privé   : routes « auth/… » et « admin/… », jeton dans l'en-tête X-LA-Token ;
 *             rôle et périmètre de parcs vérifiés à chaque requête.
 *   Démo    : ?demo=1 → base de démonstration séparée (jamais la base réelle).
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

/** @var array<string, array{0: ?string, 1: callable}> [permission requise, action] */
$admin = [
    // Tableau de bord, recherche, références
    'GET admin/stats' => [null, function ($u) {
        Notifications::processDue(5, 4);
        Diffusion::traiter(3, 3);
        return Requests::stats($u);
    }],
    'GET admin/tableau' => [null, fn($u, $in) => Dashboard::tableau($u, $in)],
    'GET admin/journee' => [null, fn($u, $in) => Dashboard::journee($u, $in)],
    'GET admin/recherche' => [null, fn($u, $in) => Dashboard::recherche($u, (string) ($in['q'] ?? ''))],
    'GET admin/references' => [null, fn($u) => [
        'parcs' => Parcs::list($u, Access::can($u, 'parcs.gerer')),
        'utilisateurs' => Users::options(),
        'motifs' => Settings::get('motifs'),
        'horaires' => Settings::get('horaires'),
        'telephone' => Settings::get('telephone'),
        'redirectionEmail' => Settings::get('mail_redirect'),
        'statutsVehicule' => Vehicles::STATUT_LABELS,
        'statutsRdv' => Appointments::STATUTS,
        'statutsDemande' => Requests::STATUTS,
        'typesDemande' => Requests::TYPES,
        'ctResultats' => Vehicles::CT_RESULTATS,
        'documents' => Documents::TYPES,
        'checklistStatuts' => Checklist::STATUTS,
        'preferences' => Clients::PREFERENCES,
        'roles' => Access::ROLES,
        'energies' => Vehicles::ENERGIES, 'boites' => Vehicles::BOITES, 'carrosseries' => Vehicles::CARROSSERIES,
        'messagesStatuts' => Notifications::STATUTS,
        'smsConfigure' => false,
    ]],

    // Véhicules
    'GET admin/vehicules' => ['vehicules.voir', fn($u, $in) => Vehicles::listAdmin($u, $in)],
    'GET admin/vehicule' => ['vehicules.voir', fn($u, $in) => Vehicles::get($u, (int) ($in['id'] ?? 0))],
    'POST admin/vehicule' => ['vehicules.modifier', fn($u, $in) => Vehicles::save($u, $in)],
    'POST admin/vehicule/statut' => [null, fn($u, $in) => Vehicles::setStatut($u, (int) ($in['id'] ?? 0), (string) ($in['statut'] ?? ''))],
    'POST admin/vehicule/supprimer' => ['vehicules.supprimer', function ($u, $in) {
        Vehicles::delete($u, (int) ($in['id'] ?? 0));
        return ['ok' => true];
    }],
    'POST admin/vehicule/transfert' => ['vehicules.transferer', fn($u, $in) => Parcs::transfer($u, (int) ($in['id'] ?? 0), (int) ($in['parcId'] ?? 0), (string) ($in['commentaire'] ?? ''))],
    'GET admin/vehicule/historique' => ['vehicules.voir', function ($u, $in) {
        $id = (int) ($in['id'] ?? 0);
        Access::vehicule($u, $id);
        return ['mouvements' => Parcs::mouvements($id), 'journal' => Audit::list(['entity_type' => 'vehicule', 'entity_id' => $id, 'limit' => 100])];
    }],
    'POST admin/vehicule/pret' => ['vehicules.preparer', fn($u, $in) => Vehicles::setPret($u, (int) ($in['id'] ?? 0), !empty($in['pret']))],
    'GET admin/vehicule/checklist' => ['vehicules.voir', fn($u, $in) => Checklist::forVehicule($u, (int) ($in['id'] ?? 0))],
    'POST admin/vehicule/checklist' => ['vehicules.preparer', fn($u, $in) => Checklist::update($u, $in)],
    'POST admin/vehicule/controle-technique' => ['vehicules.preparer', fn($u, $in) => Vehicles::saveCt($u, $in)],
    'GET admin/vehicule/documents' => ['vehicules.voir', fn($u, $in) => Documents::forVehicule($u, (int) ($in['id'] ?? 0))],
    'POST admin/vehicules/retirer-demo' => ['vehicules.supprimer', fn($u) => ['retires' => Vehicles::retirerDemo($u)]],
    'POST admin/photo' => ['photos.gerer', fn($u) => Uploads::photo($_FILES['photo'] ?? [])],
    'POST admin/document' => ['documents.gerer', fn($u) => Documents::upload($u, $_FILES['fichier'] ?? [], $_POST)],
    'GET admin/document/telecharger' => ['vehicules.voir', function ($u, $in) {
        Documents::download($u, (int) ($in['id'] ?? 0));
        return null;
    }],
    'POST admin/document/retirer' => ['documents.gerer', function ($u, $in) {
        Documents::remove($u, (int) ($in['id'] ?? 0));
        return ['ok' => true];
    }],
    'GET admin/preparation' => ['vehicules.preparer', fn($u, $in) => Checklist::board($u, $in)],
    'GET admin/checklist/taches' =>[null, fn() => array_map(fn($i) => ['id' => (int) $i['id'], 'code' => $i['code'], 'libelle' => $i['libelle'], 'categorie' => $i['categorie'], 'obligatoire' => (int) $i['obligatoire'] === 1, 'actif' => (int) $i['actif'] === 1], Checklist::items(true))],
    'POST admin/checklist/tache' => ['parametres.gerer', fn($u, $in) => Checklist::saveItem($u, $in)],

    // Diffusion multicanale (site, Leboncoin, La Centrale…)
    'GET admin/diffusion' => ['diffusion.voir', fn($u, $in) => Diffusion::overview($u, $in)],
    'GET admin/diffusion/vehicule' => ['diffusion.voir', fn($u, $in) => Diffusion::vehicule($u, (int) ($in['id'] ?? 0))],
    'POST admin/diffusion/publier' => ['diffusion.publier', fn($u, $in) => Diffusion::publier($u, $in)],
    'POST admin/diffusion/manuel' => ['diffusion.publier', fn($u, $in) => Diffusion::manuel($u, $in)],
    'POST admin/diffusion/retirer' => ['diffusion.publier', fn($u, $in) => Diffusion::retirer($u, $in)],
    'POST admin/diffusion/synchroniser' => ['diffusion.publier', fn($u, $in) => Diffusion::synchroniser($u, $in)],
    'POST admin/diffusion/adaptation' => ['diffusion.publier', fn($u, $in) => Diffusion::adaptation($u, $in)],
    'GET admin/diffusion/historique' => ['diffusion.voir', fn($u, $in) => Diffusion::historique($u, $in)],
    'GET admin/diffusion/comptes' => ['diffusion.voir', fn($u) => ['plateformes' => ComptesDiffusion::list($u), 'autres' => Diffusion::canauxAutres($u)]],
    'POST admin/diffusion/compte' => ['diffusion.comptes', fn($u, $in) => ComptesDiffusion::save($u, $in)],
    'POST admin/diffusion/compte/tester' => ['diffusion.comptes', fn($u, $in) => ComptesDiffusion::tester($u, (int) ($in['canalId'] ?? 0))],
    'POST admin/diffusion/compte/apercu' => ['diffusion.comptes', fn($u, $in) => ComptesDiffusion::apercu($u, $in)],
    'POST admin/diffusion/compte/deconnecter' => ['diffusion.comptes', fn($u, $in) => ComptesDiffusion::deconnecter($u, (int) ($in['canalId'] ?? 0))],
    'POST admin/diffusion/canal' => ['diffusion.comptes', fn($u, $in) => Diffusion::saveCanal($u, $in)],

    // Parcs et comptes
    'GET admin/parcs' => [null, fn($u, $in) => Parcs::list($u, !empty($in['tous']) && Access::can($u, 'parcs.gerer'))],
    'POST admin/parc' => ['parcs.gerer', fn($u, $in) => Parcs::save($u, $in)],
    'GET admin/utilisateurs' => ['users.gerer', fn() => Users::list()],
    'POST admin/utilisateur' => ['users.gerer', fn($u, $in) => Users::save($u, $in)],
    'POST admin/utilisateur/mot-de-passe' => ['users.gerer', function ($u, $in) {
        Users::resetPassword($u, (int) ($in['id'] ?? 0), (string) ($in['password'] ?? ''));
        return ['ok' => true];
    }],

    // Clients
    'GET admin/clients' => ['clients.gerer', fn($u, $in) => Clients::search($u, (string) ($in['q'] ?? ''), (int) ($in['limite'] ?? 100))],
    'GET admin/client' => ['clients.gerer', fn($u, $in) => Clients::get($u, (int) ($in['id'] ?? 0))],
    'POST admin/client' => ['clients.gerer', fn($u, $in) => Clients::save($u, $in)],
    'POST admin/client/contact' => ['clients.gerer', fn($u, $in) => Clients::logContact($u, $in)],
    'GET admin/clients/doublons' => ['clients.gerer', fn($u, $in) => Clients::duplicates((string) ($in['telephone'] ?? ''), (string) ($in['email'] ?? ''), (int) ($in['sauf'] ?? 0))],
    'GET admin/client/export' => ['clients.exporter', fn($u, $in) => Clients::export($u, (int) ($in['id'] ?? 0))],
    'POST admin/client/anonymiser' => ['clients.exporter', function ($u, $in) {
        Clients::anonymize($u, (int) ($in['id'] ?? 0));
        return ['ok' => true];
    }],

    // Rendez-vous
    'GET admin/rendez-vous' => ['rdv.gerer', fn($u, $in) => Appointments::list($u, $in)],
    'GET admin/rendez-vous/detail' => ['rdv.gerer', fn($u, $in) => Appointments::get($u, (int) ($in['id'] ?? 0))],
    'GET admin/rendez-vous/creneaux' => ['rdv.gerer', fn($u, $in) => Appointments::creneaux($u, $in)],
    'POST admin/rendez-vous' => ['rdv.gerer', fn($u, $in) => Appointments::create($u, $in)],
    'POST admin/rendez-vous/modifier' => ['rdv.gerer', fn($u, $in) => Appointments::update($u, $in)],
    'POST admin/rendez-vous/annuler' => ['rdv.gerer', fn($u, $in) => Appointments::cancel($u, (int) ($in['id'] ?? 0), (string) ($in['raison'] ?? ''))],
    'POST admin/rendez-vous/statut' => ['rdv.gerer', fn($u, $in) => Appointments::setStatut($u, (int) ($in['id'] ?? 0), (string) ($in['statut'] ?? ''))],

    // Messages
    'GET admin/notifications' => ['messages.envoyer', fn($u, $in) => Notifications::list($u, $in)],
    'GET admin/notifications/apercu' => ['messages.envoyer', function ($u, $in) {
        Appointments::get($u, (int) ($in['rendezVousId'] ?? 0));
        return Notifications::proposition((int) ($in['rendezVousId'] ?? 0), In::oneOf($in, 'template', ['confirmation', 'rappel', 'modification', 'annulation'], 'confirmation'));
    }],
    'POST admin/notifications/envoyer' => ['messages.envoyer', fn($u, $in) => Notifications::envoyer($u, $in)],
    'POST admin/notifications/relancer' => ['messages.envoyer', fn($u, $in) => Notifications::relancer($u, (int) ($in['id'] ?? 0))],

    // Demandes du site
    'GET admin/demandes' => ['demandes.gerer', fn($u, $in) => Requests::list($u, $in)],
    'POST admin/demande/statut' => ['demandes.gerer', function ($u, $in) {
        Requests::setStatut($u, (int) ($in['id'] ?? 0), (string) ($in['statut'] ?? ''));
        return ['ok' => true];
    }],
    'POST admin/demande/associer' => ['clients.gerer', fn($u, $in) => Requests::associer($u, $in)],
    'POST admin/demande/supprimer' => ['demandes.supprimer', function ($u, $in) {
        Requests::delete($u, (int) ($in['id'] ?? 0));
        return ['ok' => true];
    }],

    // Ventes et finance (propriétaire)
    'GET admin/finance/vehicule' => ['finance.voir', fn($u, $in) => Finance::forVehicule($u, (int) ($in['id'] ?? 0))],
    'POST admin/finance/ecriture' => ['finance.gerer', fn($u, $in) => Finance::addEntry($u, $in)],
    'POST admin/finance/contre-ecriture' => ['finance.gerer', fn($u, $in) => Finance::contrepasser($u, (int) ($in['id'] ?? 0), (string) ($in['motif'] ?? ''))],
    'POST admin/vente' => ['ventes.gerer', fn($u, $in) => Finance::saveVente($u, $in)],
    'POST admin/vente/paiement' => ['ventes.gerer', fn($u, $in) => Finance::addPaiement($u, $in)],
    'POST admin/vente/paiement/annuler' => ['ventes.gerer', fn($u, $in) => Finance::annulerPaiement($u, (int) ($in['id'] ?? 0), (string) ($in['motif'] ?? ''))],
    'GET admin/ventes' => ['ventes.gerer', fn($u, $in) => Finance::ventes($u, $in)],
    'GET admin/rapports' => ['finance.voir', fn($u, $in) => Finance::rapports($u, $in)],
    'GET admin/finance/export' => ['finance.voir', function ($u, $in) {
        Finance::exportCsv($u, $in);
        return null;
    }],

    // Paramètres et journal
    'GET admin/parametres' => ['parametres.gerer', fn() => Settings::all() + ['checklist' => array_map(fn($i) => ['id' => (int) $i['id'], 'code' => $i['code'], 'libelle' => $i['libelle'], 'categorie' => $i['categorie'], 'obligatoire' => (int) $i['obligatoire'] === 1, 'actif' => (int) $i['actif'] === 1], Checklist::items(true))]],
    'POST admin/parametres' => ['parametres.gerer', fn($u, $in) => Settings::save($u, $in)],
    'GET admin/audit' => ['audit.voir', fn($u, $in) => Audit::list($in)],
];

try {
    if (BO_DEMO) {
        Demo::ensure();
    }

    // ---------- Routes publiques (site) ----------
    if (!BO_DEMO && $route === 'vehicules' && $method === 'GET') {
        header('Cache-Control: public, max-age=60');
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(Vehicles::listPublic(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    if (!BO_DEMO && $route === 'demandes' && $method === 'POST') {
        Http::json(Requests::create(Http::body()), 201);
        exit;
    }

    // ---------- Tâche planifiée (envoi des messages dus) ----------
    if ($route === 'cron/notifications' && !BO_DEMO) {
        $key = (string) cfg('cron_key', '');
        if (strlen($key) < 24 || !hash_equals($key, (string) ($_SERVER['HTTP_X_CRON_KEY'] ?? ''))) {
            Http::fail(404, 'Route inconnue.');
        }
        Http::json(Notifications::processDue(50, 25) + ['diffusion' => Diffusion::traiter(20, 20)]);
        exit;
    }

    // ---------- Connexion ----------
    if ($route === 'auth/me') {
        Http::json(['user' => Auth::user(), 'demo' => BO_DEMO]);
        exit;
    }
    if ($route === 'auth/login' && $method === 'POST') {
        $in = Http::body();
        Http::json(Auth::login((string) ($in['email'] ?? ''), (string) ($in['password'] ?? '')));
        exit;
    }
    if ($route === 'auth/demo' && $method === 'POST') {
        Http::json(Auth::demoLogin((string) (Http::body()['role'] ?? 'admin')));
        exit;
    }

    // ---------- Routes privées (jeton obligatoire) ----------
    $user = Auth::requireUser();
    $in = $method === 'GET' ? $_GET : Http::body();

    if ($route === 'auth/logout' && $method === 'POST') {
        Auth::logout();
        Http::json(['ok' => true]);
        exit;
    }
    if ($route === 'auth/password' && $method === 'POST') {
        Auth::changePassword($user, (string) ($in['current'] ?? ''), (string) ($in['new'] ?? ''));
        Http::json(['ok' => true]);
        exit;
    }

    $key = "$method $route";
    if (!isset($admin[$key])) {
        Http::fail(404, 'Route inconnue.');
    }
    [$perm, $action] = $admin[$key];
    if ($perm !== null) {
        Access::require($user, $perm);
    }
    $result = $action($user, $in);
    if ($result !== null) {
        Http::json($result);
    }
} catch (HttpError $e) {
    Http::json(['error' => $e->getMessage()] + $e->data, $e->status);
} catch (Throwable $e) {
    error_log('[backoffice] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    Http::json(['error' => 'Erreur interne du serveur.'], 500);
}
