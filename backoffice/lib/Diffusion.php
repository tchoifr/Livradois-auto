<?php
declare(strict_types=1);

/**
 * Connecteur technique d'une plateforme. Chaque connecteur déclare explicitement les opérations qu'il sait faire :
 * le dashboard n'affiche que celles-là. Pour Leboncoin / La Centrale, le connecteur « API » n'existe que lorsque le
 * propriétaire a renseigné l'API de publication remise avec son abonnement pro (adresses + modèle d'annonce) :
 * sans cela, publication assistée, sans rien simuler.
 */
interface ConnecteurDiffusion
{
    /** Parmi : publier, modifier, retirer. */
    public function capacites(): array;

    /**
     * Exécute une opération et renvoie ['ok' => bool, 'message' => string, 'reference' => ?string, 'url' => ?string,
     * 'temporaire' => bool (erreur passagère : nouvel essai automatique),
     * 'type' => refus | abonnement | quota | connexion | droits | introuvable | limite | configuration | technique].
     */
    public function executer(string $action, array $publication, array $donnees, ?array $compte): array;
}

/**
 * Plateforme de test (bac à sable) : activée seulement par le réglage « diffusion_bac_a_sable » des tests automatiques.
 * Elle simule les réponses HTTP d'une plateforme, lues par le même analyseur que les vraies.
 */
final class ConnecteurBacASable implements ConnecteurDiffusion
{
    public function capacites(): array
    {
        return ['publier', 'modifier', 'retirer'];
    }

    public function executer(string $action, array $publication, array $donnees, ?array $compte): array
    {
        $d = $donnees['description'];
        $ref = $publication['reference_externe'] ?: 'TEST-' . $publication['vehicule_id'] . '-' . $publication['canal_id'];
        [$status, $body] = match (true) {
            str_contains($d, '[ECHEC]') => [422, '{"message":"Description non conforme"}'],
            str_contains($d, '[TEMPORAIRE]') => [503, ''],
            str_contains($d, '[ABONNEMENT]') => [402, '{"error":"subscription_required","message":"Offre pro requise pour publier"}'],
            str_contains($d, '[QUOTA]') => [403, '{"message":"Quota d\'annonces atteint pour votre offre"}'],
            default => [$action === 'retirer' ? 204 : 200, json_encode(['id' => $ref])],
        };
        return Diffusion::analyserReponse($action, $status, $body, 'id', '', 'Plateforme de test');
    }
}

/**
 * Publication par l'API d'une plateforme, configurée d'après sa documentation officielle : adresse et méthode de
 * chaque opération, modèle JSON de l'annonce ({{variables}}), chemin de la référence dans la réponse.
 * Appels limités aux domaines officiels de la plateforme, avec les accès du compte connecté.
 */
final class ConnecteurApi implements ConnecteurDiffusion
{
    public function __construct(private array $canal, private array $config)
    {
    }

    public function capacites(): array
    {
        $c = $this->config;
        return array_keys(array_filter(['publier' => $c['api_url_creation'], 'modifier' => $c['api_url_modification'], 'retirer' => $c['api_url_retrait']], fn($u) => $u !== ''));
    }

    public function executer(string $action, array $publication, array $donnees, ?array $compte): array
    {
        $c = $this->config;
        $nom = $this->canal['nom'];
        $ko = fn(string $type, string $m) => ['ok' => false, 'temporaire' => false, 'type' => $type, 'message' => $m];
        [$methode, $url] = [
            'publier' => [$c['api_methode_creation'], $c['api_url_creation']],
            'modifier' => [$c['api_methode_modification'], $c['api_url_modification']],
            'retirer' => [$c['api_methode_retrait'], $c['api_url_retrait']],
        ][$action];
        if (str_contains($url, '{reference}')) {
            if ((string) $publication['reference_externe'] === '') {
                return $ko('introuvable', 'Référence de l\'annonce ' . $nom . ' inconnue : opération automatique impossible.');
            }
            $url = str_replace('{reference}', rawurlencode((string) $publication['reference_externe']), $url);
        }
        $corps = null;
        if ($action !== 'retirer') {
            $corps = Diffusion::corps((string) $c['api_modele'], $donnees['variables'] ?? []);
            if ($corps === null) {
                return $ko('configuration', 'Modèle d\'annonce ' . $nom . ' invalide : vérifiez la publication en 1 clic dans « Comptes de diffusion ».');
            }
        }
        try {
            ComptesDiffusion::verifierUrl($url, $this->canal, 'Adresse de publication', true);
            $status = 0;
            $body = '';
            for ($essai = 0; $essai < 2; $essai++) {
                $jeton = ComptesDiffusion::jeton((int) $this->canal['id'], $essai > 0);
                if ($jeton === null) {
                    return $ko('connexion', 'Accès à ' . $nom . ' refusés ou expirés : reconnectez le compte dans « Comptes de diffusion ».');
                }
                $headers = ['Accept: application/json', $c['methode'] === 'cle_api' && $c['entete_cle'] === 'x-api-key' ? 'X-API-Key: ' . $jeton : 'Authorization: Bearer ' . $jeton];
                if ($corps !== null) {
                    $headers[] = 'Content-Type: application/json';
                }
                [$status, $body] = ComptesDiffusion::requete($methode, $url, $headers, $corps);
                // Jeton OAuth expiré entre-temps : un seul renouvellement puis nouvel essai
                if ($status !== 401 || $c['methode'] !== 'oauth2_client') {
                    break;
                }
            }
        } catch (HttpError $e) {
            return $ko('configuration', $e->getMessage());
        } catch (RuntimeException $e) {
            return ['ok' => false, 'temporaire' => true, 'type' => 'technique', 'message' => $nom . ' : ' . $e->getMessage()];
        }
        return Diffusion::analyserReponse($action, $status, $body, (string) $c['api_chemin_reference'], (string) $c['api_chemin_url'], $nom);
    }
}

/** Diffusion multicanale : une fiche véhicule, une publication par canal avec son propre statut. */
final class Diffusion
{
    public const STATUTS = [
        'non_publie' => 'Non publié', 'en_attente' => 'En attente', 'publie' => 'Publié', 'a_mettre_a_jour' => 'À mettre à jour',
        'erreur' => 'Erreur', 'suspendu' => 'Suspendu', 'expire' => 'Expiré — à renouveler', 'refuse' => 'Refusé',
        'a_retirer' => 'À retirer', 'retire' => 'Retiré', 'vendu' => 'Vendu',
    ];
    /** Variables utilisables dans le modèle d'annonce envoyé à une plateforme. */
    public const VARIABLES = [
        'titre', 'description', 'prix', 'marque', 'modele', 'version', 'annee', 'miseEnCirculation', 'km', 'energie', 'boite',
        'carrosserie', 'puissance', 'cv', 'couleur', 'portes', 'places', 'critair', 'garantie', 'premiereMain', 'equipements',
        'photos', 'reference', 'immatriculation', 'vin', 'telephone',
    ];
    /** Annonce présente sur la plateforme (à retirer si le véhicule est vendu). */
    private const EN_LIGNE = ['publie', 'a_mettre_a_jour', 'expire', 'suspendu', 'en_attente'];
    private const BACKOFF = [5, 15, 60];
    private const MAX_TENTATIVES = 4;

    // ---------------------------------------------------------------- canaux et connecteurs

    public static function connecteur(string $code): ?ConnecteurDiffusion
    {
        if ($code === 'bac_a_sable') {
            return cfg('diffusion_bac_a_sable') ? new ConnecteurBacASable() : null;
        }
        if (!isset(ComptesDiffusion::PLATEFORMES[$code])) {
            return null;
        }
        $row = Db::one('SELECT a.* FROM la_comptes_diffusion a JOIN la_canaux c ON c.id = a.canal_id WHERE c.code = ?', [$code]);
        if (!$row || (int) $row['api_actif'] !== 1 || $row['api_url_creation'] === '' || trim((string) $row['api_modele']) === '') {
            return null;
        }
        $canal = Db::one('SELECT * FROM la_canaux WHERE code = ?', [$code]);
        return new ConnecteurApi($canal, $row);
    }

    public static function canaux(): array
    {
        if (cfg('diffusion_bac_a_sable') && !Db::value("SELECT COUNT(*) FROM la_canaux WHERE code = 'bac_a_sable'")) {
            Db::insert('la_canaux', ['code' => 'bac_a_sable', 'nom' => 'Plateforme de test', 'type' => 'test', 'url_depot' => '', 'actif' => 1, 'ordre' => 90, 'created_at' => Db::now()]);
        }
        return array_values(array_filter(Db::all('SELECT * FROM la_canaux WHERE actif = 1 ORDER BY ordre, id'),
            fn($c) => $c['code'] !== 'bac_a_sable' || cfg('diffusion_bac_a_sable')));
    }

    private static function canal(int $id): array
    {
        foreach (self::canaux() as $c) {
            if ((int) $c['id'] === $id) {
                return $c;
            }
        }
        Http::fail(404, 'Canal de diffusion inconnu.');
    }

    /**
     * Publication en 1 clic : prête, ou première étape manquante, dans l'ordre exigé par les plateformes :
     * abonnement pro → compte connecté → API de publication renseignée.
     */
    public static function autoEtat(array $canal): array
    {
        $nom = $canal['nom'];
        if ($canal['type'] === 'site' || ($canal['code'] === 'bac_a_sable' && cfg('diffusion_bac_a_sable'))) {
            return ['etat' => 'pret', 'message' => '', 'aide' => ''];
        }
        $p = ComptesDiffusion::PLATEFORMES[$canal['code']] ?? null;
        if (!$p) {
            return ['etat' => 'indisponible', 'message' => 'Publication assistée : cette plateforme n\'a pas d\'intégration automatique.', 'aide' => ''];
        }
        $c = Db::one('SELECT * FROM la_comptes_diffusion WHERE canal_id = ?', [(int) $canal['id']]);
        if (!$c || !ComptesDiffusion::abonnementValide($c)) {
            return ['etat' => 'abonnement', 'aide' => $p['aide'], 'message' => $nom . ' réserve la publication automatique aux professionnels abonnés'
                . ($c && (int) $c['abonnement_actif'] === 1 ? ' : votre abonnement est terminé.' : ' : souscrivez une offre pro ' . $nom . ' puis indiquez-la dans « Comptes de diffusion ».')];
        }
        if (ComptesDiffusion::statut($c) !== 'connecte') {
            return ['etat' => 'non_connecte', 'aide' => '', 'message' => 'Compte ' . $nom . ' non connecté' . ($c['statut'] === 'erreur' ? ' (accès refusés)' : '') . ' : connectez-le dans « Comptes de diffusion ».'];
        }
        $con = self::connecteur($canal['code']);
        if (!$con || !in_array('publier', $con->capacites(), true)) {
            return ['etat' => 'a_configurer', 'aide' => '', 'message' => 'Compte connecté : renseignez l\'API de publication de ' . $nom . ' (d\'après sa documentation) dans « Comptes de diffusion » pour publier en 1 clic.'];
        }
        return ['etat' => 'pret', 'message' => '', 'aide' => ''];
    }

    /** Publication automatique possible : connecteur configuré + abonnement valide + compte connecté. */
    public static function autoDisponible(array $canal): bool
    {
        return $canal['type'] !== 'site' && self::autoEtat($canal)['etat'] === 'pret';
    }

    /** Explication affichée quand la publication automatique n'est pas possible (jamais de promesse trompeuse). */
    private static function raisonManuel(array $canal): string
    {
        $e = self::autoEtat($canal);
        return $e['etat'] === 'indisponible' ? $e['message'] : 'Publication assistée en attendant le 1 clic. ' . $e['message'];
    }

    // ---------------------------------------------------------------- réponses des plateformes

    /**
     * Lecture de la réponse d'une plateforme à une opération : rien n'est « réussi » sans confirmation explicite
     * (code 2xx et, pour une création, la référence de l'annonce). Testée unitairement.
     */
    public static function analyserReponse(string $action, int $status, string $body, string $cheminRef, string $cheminUrl, string $nom): array
    {
        $j = json_decode($body, true);
        $msg = self::messagePlateforme($j);
        $detail = $msg !== '' ? ' (« ' . $msg . ' »)' : '';
        $ko = fn(string $type, string $m, bool $temp = false) => ['ok' => false, 'type' => $type, 'temporaire' => $temp, 'message' => $m];
        if ($status === 0) {
            return $ko('technique', ucfirst($nom) . ' injoignable (délai dépassé ou connexion refusée).', true);
        }
        if ($status >= 200 && $status < 300) {
            if ($action !== 'publier') {
                return ['ok' => true, 'type' => '', 'message' => ($action === 'retirer' ? 'Annonce retirée de ' : 'Annonce mise à jour sur ') . $nom . '.'];
            }
            $ref = is_array($j) ? self::chemin($j, $cheminRef !== '' ? $cheminRef : 'id') : null;
            if ($ref === null || is_array($ref) || (string) $ref === '') {
                return $ko('technique', ucfirst($nom) . ' a répondu sans référence d\'annonce : publication non confirmée. Vérifiez sur ' . $nom . ' avant de réessayer.');
            }
            $url = $cheminUrl !== '' && is_array($j) ? self::chemin($j, $cheminUrl) : null;
            return ['ok' => true, 'type' => '', 'reference' => (string) $ref, 'url' => is_string($url) && str_starts_with($url, 'https://') ? $url : '',
                'message' => 'Annonce publiée sur ' . $nom . ' (réf. ' . $ref . ').'];
        }
        if ($action === 'retirer' && in_array($status, [404, 410], true)) {
            return ['ok' => true, 'type' => '', 'message' => 'Annonce déjà absente de ' . $nom . '.'];
        }
        $texte = mb_strtolower($body);
        $quota = (bool) preg_match('/quota|limite|limit|crédit|credit|maximum|plafond/u', $texte);
        $abonnement = (bool) preg_match('/abonnement|subscription|souscri|offre|offer|\bplan\b|\bpack|payment|paiement|billing|upgrade|premium/u', $texte);
        if (in_array($status, [400, 422], true)) {
            return $ko('refus', 'Annonce refusée par ' . $nom . ($msg !== '' ? ' : ' . $msg : ' : données non acceptées.'));
        }
        if ($status === 413) {
            return $ko('refus', 'Annonce refusée par ' . $nom . ' : photos ou texte trop volumineux.');
        }
        if ($status === 401) {
            return $ko('connexion', 'Accès refusés par ' . $nom . ' (session expirée ou révoquée) : reconnectez le compte.');
        }
        if ($status === 402 || ($status === 403 && ($quota || $abonnement))) {
            return $quota
                ? $ko('quota', 'Limite de votre offre ' . $nom . ' atteinte (nombre d\'annonces)' . $detail . ' : retirez une annonce ou passez à une offre supérieure.')
                : $ko('abonnement', 'Votre abonnement ' . $nom . ' ne permet pas cette publication' . $detail . ' : une offre pro payante est requise.');
        }
        if ($status === 403) {
            return $ko('droits', 'Opération refusée par ' . $nom . ' pour ce compte' . $detail . '.');
        }
        if ($status === 404) {
            return $ko('introuvable', 'Annonce introuvable sur ' . $nom . ' (supprimée ou expirée ?).');
        }
        if ($status === 409) {
            return $ko('refus', 'Conflit signalé par ' . $nom . ($msg !== '' ? ' : ' . $msg : ' : annonce déjà existante ?'));
        }
        if ($status === 429) {
            return $ko('limite', 'Trop de demandes envoyées à ' . $nom . '.', true);
        }
        if ($status >= 500) {
            return $ko('technique', ucfirst($nom) . ' rencontre un problème (HTTP ' . $status . ').', true);
        }
        return $ko('technique', 'Réponse inattendue de ' . $nom . ' (HTTP ' . $status . ').');
    }

    /** Message lisible d'une réponse d'erreur (formats courants : message, detail, errors…). */
    private static function messagePlateforme($j): string
    {
        $net = fn($s) => mb_substr(trim(preg_replace('/\s+/', ' ', strip_tags((string) $s))), 0, 200);
        if (!is_array($j)) {
            return '';
        }
        foreach (['message', 'error_description', 'detail', 'title'] as $k) {
            if (!empty($j[$k]) && is_string($j[$k])) {
                return $net($j[$k]);
            }
        }
        if (isset($j['error']) && is_array($j['error']) && !empty($j['error']['message'])) {
            return $net($j['error']['message']);
        }
        if (!empty($j['errors']) && is_array($j['errors'])) {
            $parts = [];
            foreach ($j['errors'] as $k => $e) {
                if (is_string($e)) {
                    $parts[] = (is_string($k) ? $k . ' : ' : '') . $e;
                } elseif (is_array($e) && array_is_list($e) && $e && is_string($e[0])) {
                    $parts[] = (is_string($k) ? $k . ' : ' : '') . implode(', ', $e);
                } elseif (is_array($e)) {
                    $champ = $e['field'] ?? $e['champ'] ?? (is_string($k) ? $k : '');
                    $parts[] = ($champ !== '' ? $champ . ' : ' : '') . ($e['message'] ?? $e['detail'] ?? '');
                }
            }
            return $net(implode(' ; ', array_filter($parts)));
        }
        if (!empty($j['error']) && is_string($j['error'])) {
            return $net($j['error']);
        }
        return '';
    }

    /** Valeur à un chemin « a.b.0.c » d'une réponse JSON. */
    private static function chemin(array $j, string $chemin)
    {
        $v = $j;
        foreach (explode('.', $chemin) as $k) {
            if (!is_array($v) || !array_key_exists($k, $v)) {
                return null;
            }
            $v = $v[$k];
        }
        return is_int($v) || is_float($v) ? (string) $v : $v;
    }

    /** Corps JSON envoyé : modèle de la plateforme, variables remplacées par leur valeur JSON. Null si invalide. */
    public static function corps(string $modele, array $vars): ?string
    {
        if (self::erreurModele($modele) !== '') {
            return null;
        }
        $out = preg_replace_callback('/\{\{\s*([A-Za-z]+)\s*\}\}/', fn($m) => json_encode($vars[$m[1]] ?? null, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $modele);
        json_decode((string) $out);
        return $out !== null && json_last_error() === JSON_ERROR_NONE ? $out : null;
    }

    /** Contrôle d'un modèle d'annonce : message d'erreur, ou chaîne vide s'il est valide. */
    public static function erreurModele(string $modele): string
    {
        if (trim($modele) === '') {
            return 'Le modèle d\'annonce est vide.';
        }
        if (strlen($modele) > 20000) {
            return 'Modèle d\'annonce trop long.';
        }
        preg_match_all('/\{\{\s*([A-Za-z]+)\s*\}\}/', $modele, $m);
        $inconnues = array_diff(array_unique($m[1]), self::VARIABLES);
        if ($inconnues) {
            return 'Variable inconnue dans le modèle : {{' . implode('}}, {{', $inconnues) . '}}.';
        }
        if (preg_match('/"\s*\{\{|\}\}\s*"/', $modele)) {
            return 'Les variables s\'écrivent sans guillemets, par exemple "title": {{titre}} (la valeur est mise en forme automatiquement).';
        }
        $test = preg_replace('/\{\{\s*[A-Za-z]+\s*\}\}/', '"x"', $modele);
        json_decode((string) $test);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return 'Le modèle d\'annonce n\'est pas un JSON valide (' . json_last_error_msg() . ').';
        }
        return '';
    }

    /** Valeurs des variables du modèle pour un véhicule (photos en adresses complètes, dans l'ordre choisi). */
    public static function variables(array $v, array $d): array
    {
        $site = (string) cfg('site_url', '');
        $s = parse_url($site) ?: [];
        $abs = function (array $p) use ($site, $s): string {
            $u = (string) ($p['url'] ?? '');
            if ($u === '' && !empty($p['fichier'])) {
                return rtrim($site, '/') . '/public/assets/vehicules/' . $p['fichier'] . '.webp';
            }
            if (str_starts_with($u, '/')) {
                return ($s['scheme'] ?? 'https') . '://' . ($s['host'] ?? '') . $u;
            }
            return $u;
        };
        return [
            'titre' => $d['titre'], 'description' => $d['description'], 'prix' => (int) $v['prix'], 'marque' => $v['marque'], 'modele' => $v['modele'],
            'version' => $v['version'], 'annee' => (int) $v['annee'], 'miseEnCirculation' => $v['mise_en_circulation'], 'km' => (int) $v['km'],
            'energie' => $v['energie'], 'boite' => $v['boite'], 'carrosserie' => $v['carrosserie'],
            'puissance' => $v['puissance'] !== null ? (int) $v['puissance'] : null, 'cv' => $v['cv'] !== null ? (int) $v['cv'] : null, 'couleur' => $v['couleur'],
            'portes' => $v['portes'] !== null ? (int) $v['portes'] : null, 'places' => $v['places'] !== null ? (int) $v['places'] : null,
            'critair' => $v['critair'] !== null ? (int) $v['critair'] : null, 'garantie' => (int) $v['garantie'], 'premiereMain' => (int) $v['premiere_main'] === 1,
            'equipements' => json_decode((string) ($v['equipements'] ?: '[]'), true) ?: [],
            'photos' => array_values(array_filter(array_map($abs, $d['photos']))), 'reference' => (string) $v['numero_stock'],
            'immatriculation' => (string) $v['immatriculation'], 'vin' => (string) $v['vin'], 'telephone' => (string) Settings::get('telephone'),
        ];
    }

    // ---------------------------------------------------------------- données d'annonce

    private static function photoKey(array $p): string
    {
        return (string) ($p['fichier'] ?? $p['url'] ?? '');
    }

    /** Données envoyées à un canal : texte de la fiche, ou adaptation propre au canal (sans jamais modifier la fiche). */
    public static function donnees(array $v, array $canal, ?array $pub): array
    {
        $photos = json_decode((string) ($v['photos'] ?: '[]'), true) ?: [];
        $equip = json_decode((string) ($v['equipements'] ?: '[]'), true) ?: [];
        $titreDefaut = mb_substr(trim(preg_replace('/\s+/', ' ', $v['marque'] . ' ' . $v['modele'] . ' ' . $v['version'])) . ' — ' . $v['annee'], 0, 100);
        $carac = array_filter([
            'Année : ' . $v['annee'] . ($v['mise_en_circulation'] ? ' (mise en circulation ' . $v['mise_en_circulation'] . ')' : ''),
            'Kilométrage : ' . number_format((int) $v['km'], 0, ',', ' ') . ' km',
            'Énergie : ' . $v['energie'], 'Boîte : ' . $v['boite'],
            $v['puissance'] ? 'Puissance : ' . $v['puissance'] . ' ch' . ($v['cv'] ? ' (' . $v['cv'] . ' CV)' : '') : null,
            $v['couleur'] ? 'Couleur : ' . $v['couleur'] : null,
            (int) $v['premiere_main'] ? 'Première main' : null,
            'Garantie : ' . (int) $v['garantie'] . ' mois',
        ]);
        $descDefaut = trim((string) $v['description']) . "\n\n" . implode("\n", $carac)
            . ($equip ? "\n\nÉquipements :\n- " . implode("\n- ", $equip) : '')
            . "\n\nLivradois Automobiles — " . Settings::get('telephone');
        $titre = $pub && $pub['titre_perso'] !== null && $pub['titre_perso'] !== '' ? $pub['titre_perso'] : $titreDefaut;
        $description = $pub && $pub['description_perso'] !== null && $pub['description_perso'] !== '' ? $pub['description_perso'] : $descDefaut;
        $choix = $pub && $pub['photos_perso'] ? (json_decode($pub['photos_perso'], true) ?: []) : null;
        $byKey = [];
        foreach ($photos as $p) {
            $byKey[self::photoKey($p)] = $p;
        }
        $sel = $choix !== null ? array_values(array_filter(array_map(fn($k) => $byKey[$k] ?? null, $choix))) : $photos;
        return [
            'titre' => $titre, 'description' => $description, 'photos' => $sel, 'toutesPhotos' => $photos,
            'titreDefaut' => $titreDefaut, 'descriptionDefaut' => $descDefaut,
            'titrePerso' => $titre !== $titreDefaut, 'descriptionPerso' => $description !== $descDefaut, 'photosPerso' => $choix !== null,
            'prix' => (int) $v['prix'], 'km' => (int) $v['km'], 'annee' => (int) $v['annee'], 'energie' => $v['energie'], 'boite' => $v['boite'],
            'carrosserie' => $v['carrosserie'], 'miseEnCirculation' => $v['mise_en_circulation'], 'marque' => $v['marque'], 'modele' => $v['modele'],
            'version' => $v['version'], 'puissance' => $v['puissance'] !== null ? (int) $v['puissance'] : null, 'couleur' => $v['couleur'],
        ];
    }

    public static function empreinte(array $d): string
    {
        return sha1(json_encode([$d['titre'], $d['description'], $d['prix'], $d['km'], $d['annee'], $d['energie'], $d['boite'], array_map([self::class, 'photoKey'], $d['photos'])]));
    }

    /** Contrôles de base avant publication ; les exigences propres à chaque plateforme s'ajoutent à la publication. */
    public static function manquants(array $d, array $canal): array
    {
        $m = [];
        $add = fn($champ, $msg, $bloquant = true) => $m[] = ['champ' => $champ, 'message' => $msg, 'bloquant' => $bloquant];
        if ($d['marque'] === '' || $d['modele'] === '') {
            $add('marque', 'Marque et modèle');
        }
        if ($d['prix'] <= 0) {
            $add('prix', 'Prix de vente');
        }
        if ($d['annee'] < 1950) {
            $add('annee', 'Année');
        }
        if ($canal['type'] === 'site') {
            if (!$d['photos']) {
                $add('photos', 'Au moins une photo (conseillé)', false);
            }
            return $m;
        }
        if ($d['energie'] === '' || $d['boite'] === '') {
            $add('energie', 'Énergie et boîte de vitesses');
        }
        if (!$d['photos']) {
            $add('photos', 'Au moins une photo');
        } elseif (count($d['photos']) < 5) {
            $add('photos', 'Au moins 5 photos (conseillé)', false);
        }
        if (mb_strlen(trim($d['description'])) < 80) {
            $add('description', 'Description d\'au moins 80 caractères');
        }
        if ($d['miseEnCirculation'] === '') {
            $add('miseEnCirculation', 'Date de mise en circulation (conseillé)', false);
        }
        if (mb_strlen($d['titre']) > 100) {
            $add('titre', 'Titre de 100 caractères maximum');
        }
        return $m;
    }

    private static function bloquants(array $d, array $canal): array
    {
        return array_values(array_filter(self::manquants($d, $canal), fn($x) => $x['bloquant']));
    }

    // ---------------------------------------------------------------- lecture

    private static function siteStatut(string $vstatut): string
    {
        return ['brouillon' => 'non_publie', 'disponible' => 'publie', 'reserve' => 'publie', 'retire' => 'suspendu', 'vendu' => 'vendu', 'livre' => 'vendu'][$vstatut] ?? 'non_publie';
    }

    /** Annonces arrivées à expiration : « à renouveler ». */
    private static function rafraichirExpirations(): void
    {
        Db::exec("UPDATE la_publications SET statut = 'expire', updated_at = ? WHERE statut IN ('publie', 'a_mettre_a_jour') AND expire_le IS NOT NULL AND expire_le < ?", [Db::now(), date('Y-m-d')]);
    }

    private static function publicationOut(array $v, array $canal, ?array $pub): array
    {
        $site = $canal['type'] === 'site';
        $d = self::donnees($v, $canal, $pub);
        $statut = $site ? self::siteStatut($v['statut']) : ($pub['statut'] ?? 'non_publie');
        $label = self::STATUTS[$statut] ?? $statut;
        if ($site && $statut === 'suspendu') {
            $label = 'Retiré du site';
        }
        $etat = self::autoEtat($canal);
        $auto = $site || $etat['etat'] === 'pret';
        $pending = $pub ? (int) Db::value("SELECT COUNT(*) FROM la_diffusion_taches WHERE publication_id = ? AND statut IN ('en_attente', 'en_cours')", [(int) $pub['id']]) : 0;
        return [
            'canalId' => (int) $canal['id'], 'code' => $canal['code'], 'nom' => $canal['nom'], 'type' => $canal['type'], 'urlDepot' => $canal['url_depot'],
            'mode' => $site ? 'site' : ($auto ? 'auto' : 'manuel'), 'raisonManuel' => $site || $auto ? '' : self::raisonManuel($canal),
            'unClic' => $site ? null : $etat, 'aide' => ComptesDiffusion::PLATEFORMES[$canal['code']]['aide'] ?? '',
            'capacites' => $site ? ['publier', 'retirer'] : ($auto ? self::connecteur($canal['code'])->capacites() : []),
            'statut' => $statut, 'statutLabel' => $label,
            'url' => $site ? (in_array($v['statut'], ['disponible', 'reserve'], true) ? rtrim((string) cfg('site_url', ''), '/') . '/vehicule.html?id=' . rawurlencode($v['slug']) : '') : ($pub['url'] ?? ''),
            'reference' => $pub['reference_externe'] ?? '', 'publieLe' => $site ? $v['publie_le'] : ($pub['publie_le'] ?? null),
            'expireLe' => $pub['expire_le'] ?? null, 'derniereSynchro' => $site ? $v['updated_at'] : ($pub['derniere_synchro'] ?? null),
            'erreur' => $pub['derniere_erreur'] ?? '', 'erreurType' => $pub['erreur_type'] ?? '', 'prixPublie' => isset($pub['prix_publie']) ? (int) $pub['prix_publie'] : null,
            'aJour' => $site || !$pub || $pub['empreinte'] === '' || $pub['empreinte'] === self::empreinte($d),
            'tachesEnCours' => $pending,
            'donnees' => $site ? null : $d, 'manquants' => self::manquants($d, $canal),
        ];
    }

    public static function vehicule(array $user, int $vid): array
    {
        Access::require($user, 'diffusion.voir');
        Access::vehicule($user, $vid);
        self::rafraichirExpirations();
        $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$vid]);
        $pubs = [];
        foreach (Db::all('SELECT * FROM la_publications WHERE vehicule_id = ?', [$vid]) as $p) {
            $pubs[(int) $p['canal_id']] = $p;
        }
        return [
            'vehiculeId' => $vid, 'statutVehicule' => $v['statut'],
            'canaux' => array_map(fn($c) => self::publicationOut($v, $c, $pubs[(int) $c['id']] ?? null), self::canaux()),
            'historique' => self::historique($user, ['vehicule' => $vid, 'limite' => 30]),
        ];
    }

    /** Synthèse : compteurs et tableau véhicules × canaux. */
    public static function overview(array $user, array $q): array
    {
        Access::require($user, 'diffusion.voir');
        self::rafraichirExpirations();
        [$scope, $p] = Access::scope($user, 'v.parc_id');
        $parc = !empty($q['parc']) ? (int) $q['parc'] : null;
        $canaux = self::canaux();
        $pubs = [];
        foreach (Db::all('SELECT pu.* FROM la_publications pu JOIN la_vehicules v ON v.id = pu.vehicule_id WHERE 1 = 1' . $scope . ($parc ? ' AND v.parc_id = ?' : ''), array_merge($p, $parc ? [$parc] : [])) as $r) {
            $pubs[(int) $r['vehicule_id']][(int) $r['canal_id']] = $r;
        }
        // Véhicules en stock, plus les vendus dont une annonce est encore à retirer
        $rows = Db::all("SELECT v.* FROM la_vehicules v WHERE (v.statut IN ('brouillon', 'disponible', 'reserve')" . ($pubs ? ' OR v.id IN (' . Db::in(array_keys($pubs)) . ')' : '') . ')' . $scope . ($parc ? ' AND v.parc_id = ?' : '') . ' ORDER BY v.updated_at DESC',
            array_merge($pubs ? array_keys($pubs) : [], $p, $parc ? [$parc] : []));
        $compte = ['actives' => 0, 'enAttente' => 0, 'erreurs' => 0, 'aRenouveler' => 0, 'aRetirer' => 0, 'aMettreAJour' => 0, 'parCanal' => []];
        $lignes = [];
        foreach ($rows as $v) {
            $cells = [];
            foreach ($canaux as $c) {
                $pub = $pubs[(int) $v['id']][(int) $c['id']] ?? null;
                $st = $c['type'] === 'site' ? self::siteStatut($v['statut']) : ($pub['statut'] ?? 'non_publie');
                $cells[] = ['canalId' => (int) $c['id'], 'statut' => $st, 'statutLabel' => $c['type'] === 'site' && $st === 'suspendu' ? 'Retiré du site' : (self::STATUTS[$st] ?? $st),
                    'erreur' => $pub['derniere_erreur'] ?? '', 'erreurType' => $pub['erreur_type'] ?? ''];
                if (in_array($st, ['publie', 'a_mettre_a_jour', 'expire'], true)) {
                    $compte['parCanal'][(int) $c['id']] = ($compte['parCanal'][(int) $c['id']] ?? 0) + 1;
                }
                $map = ['en_attente' => 'enAttente', 'erreur' => 'erreurs', 'refuse' => 'erreurs', 'expire' => 'aRenouveler', 'a_retirer' => 'aRetirer', 'a_mettre_a_jour' => 'aMettreAJour'];
                if (isset($map[$st])) {
                    $compte[$map[$st]]++;
                }
            }
            if (in_array($v['statut'], ['disponible', 'reserve'], true)) {
                $compte['actives']++;
            }
            // Véhicule vendu ou retiré : affiché seulement tant qu'une annonce externe reste à traiter
            $horsVente = !in_array($v['statut'], ['brouillon', 'disponible', 'reserve'], true);
            if ($horsVente && !array_filter($cells, fn($x) => in_array($x['statut'], ['a_retirer', 'erreur', 'en_attente', 'publie', 'a_mettre_a_jour', 'expire', 'suspendu'], true))) {
                continue;
            }
            $photos = json_decode((string) ($v['photos'] ?: '[]'), true) ?: [];
            $lignes[] = ['vehiculeId' => (int) $v['id'], 'vehicule' => $v['marque'] . ' ' . $v['modele'], 'numeroStock' => $v['numero_stock'], 'prix' => (int) $v['prix'],
                'statutVehicule' => $v['statut'], 'statutVehiculeLabel' => Vehicles::STATUT_LABELS[$v['statut']] ?? $v['statut'], 'photo' => $photos[0] ?? null, 'canaux' => $cells];
        }
        return [
            'canaux' => array_map(fn($c) => ['canalId' => (int) $c['id'], 'code' => $c['code'], 'nom' => $c['nom'], 'type' => $c['type'],
                'mode' => $c['type'] === 'site' ? 'site' : (self::autoDisponible($c) ? 'auto' : 'manuel'), 'unClic' => $c['type'] === 'site' ? null : self::autoEtat($c),
                'aide' => ComptesDiffusion::PLATEFORMES[$c['code']]['aide'] ?? ''], $canaux),
            'compteurs' => $compte, 'lignes' => $lignes,
        ];
    }

    public static function historique(array $user, array $q): array
    {
        Access::require($user, 'diffusion.voir');
        [$scope, $p] = Access::scope($user, 'v.parc_id', true);
        $w = ['1 = 1' . $scope];
        if ($user['role'] !== 'admin') {
            $w[] = 'h.vehicule_id IS NOT NULL';
        }
        foreach (['vehicule' => 'h.vehicule_id', 'canal' => 'h.canal_id'] as $k => $col) {
            if (!empty($q[$k])) {
                $w[] = "$col = ?";
                $p[] = (int) $q[$k];
            }
        }
        if (!empty($q['resultat']) && in_array($q['resultat'], ['succes', 'echec', 'info'], true)) {
            $w[] = 'h.resultat = ?';
            $p[] = $q['resultat'];
        }
        if ($du = In::date($q, 'du')) {
            $w[] = 'h.created_at >= ?';
            $p[] = "$du 00:00:00";
        }
        if ($au = In::date($q, 'au')) {
            $w[] = 'h.created_at <= ?';
            $p[] = "$au 23:59:59";
        }
        $lim = max(1, min(500, (int) ($q['limite'] ?? 200)));
        return array_map(fn($h) => [
            'id' => (int) $h['id'], 'date' => $h['created_at'], 'vehiculeId' => $h['vehicule_id'] !== null ? (int) $h['vehicule_id'] : null,
            'vehicule' => $h['marque'] ? $h['marque'] . ' ' . $h['modele'] . ' (' . $h['numero_stock'] . ')' : null, 'canal' => $h['canal_nom'],
            'action' => $h['action'], 'resultat' => $h['resultat'], 'message' => $h['message'], 'acteur' => $h['acteur'] ?: 'Système',
        ], Db::all('SELECT h.*, v.marque, v.modele, v.numero_stock, c.nom AS canal_nom, a.name AS acteur FROM la_diffusion_historique h
            LEFT JOIN la_vehicules v ON v.id = h.vehicule_id LEFT JOIN la_canaux c ON c.id = h.canal_id LEFT JOIN la_admins a ON a.id = h.acteur_id
            WHERE ' . implode(' AND ', $w) . " ORDER BY h.id DESC LIMIT $lim", $p));
    }

    /** Annonces demandant une action (liste « À faire » du tableau de bord, compteur du menu). */
    public static function actions(array $user, ?int $parc = null, int $limite = 12): array
    {
        if (!Access::can($user, 'diffusion.voir')) {
            return ['total' => 0, 'items' => []];
        }
        self::rafraichirExpirations();
        [$scope, $p] = Access::scope($user, 'v.parc_id');
        $where = "pu.statut IN ('a_retirer', 'a_mettre_a_jour', 'erreur', 'refuse', 'expire')" . $scope . ($parc ? ' AND v.parc_id = ?' : '');
        $params = array_merge($p, $parc ? [$parc] : []);
        $total = (int) Db::value("SELECT COUNT(*) FROM la_publications pu JOIN la_vehicules v ON v.id = pu.vehicule_id WHERE $where", $params);
        if ($limite <= 0) {
            return ['total' => $total, 'items' => []];
        }
        $items = array_map(fn($r) => [
            'vehiculeId' => (int) $r['vehicule_id'], 'vehicule' => $r['marque'] . ' ' . $r['modele'], 'numeroStock' => $r['numero_stock'],
            'canal' => $r['canal_nom'], 'statut' => $r['statut'], 'mode' => $r['mode'], 'erreur' => $r['derniere_erreur'], 'erreurType' => $r['erreur_type'],
            'prixPublie' => $r['prix_publie'] !== null ? (int) $r['prix_publie'] : null, 'prix' => (int) $r['prix'], 'statutVehicule' => $r['vstatut'],
        ], Db::all("SELECT pu.*, v.marque, v.modele, v.numero_stock, v.prix, v.statut AS vstatut, c.nom AS canal_nom FROM la_publications pu
            JOIN la_vehicules v ON v.id = pu.vehicule_id JOIN la_canaux c ON c.id = pu.canal_id WHERE $where
            ORDER BY CASE pu.statut WHEN 'a_retirer' THEN 0 WHEN 'erreur' THEN 1 WHEN 'refuse' THEN 2 WHEN 'a_mettre_a_jour' THEN 3 ELSE 4 END, pu.updated_at LIMIT $limite", $params));
        return ['total' => $total, 'items' => $items];
    }

    // ---------------------------------------------------------------- historique

    public static function journal(?array $user, ?int $vid, ?int $canalId, ?int $pubId, string $action, string $resultat, string $message): void
    {
        Db::insert('la_diffusion_historique', [
            'vehicule_id' => $vid, 'canal_id' => $canalId, 'publication_id' => $pubId, 'action' => $action, 'resultat' => $resultat,
            'message' => mb_substr($message, 0, 500), 'acteur_id' => $user['id'] ?? null, 'created_at' => Db::now(),
        ]);
    }

    // ---------------------------------------------------------------- actions

    private static function publication(int $vid, int $canalId, string $mode): array
    {
        $p = Db::one('SELECT * FROM la_publications WHERE vehicule_id = ? AND canal_id = ?', [$vid, $canalId]);
        if (!$p) {
            Db::insert('la_publications', ['vehicule_id' => $vid, 'canal_id' => $canalId, 'mode' => $mode, 'statut' => 'non_publie', 'created_at' => Db::now(), 'updated_at' => Db::now()]);
            $p = Db::one('SELECT * FROM la_publications WHERE vehicule_id = ? AND canal_id = ?', [$vid, $canalId]);
        }
        return $p;
    }

    private static function prixTexte(?int $p): string
    {
        return $p === null ? '—' : number_format($p, 0, ',', ' ') . ' €';
    }

    /** « Publier sur les plateformes » : site (mise en ligne) et canaux automatiques. Les canaux assistés passent par manuel(). */
    public static function publier(array $user, array $in): array
    {
        $vid = (int) ($in['vehiculeId'] ?? 0);
        Access::vehicule($user, $vid);
        $resultats = [];
        foreach (array_unique(array_map('intval', (array) ($in['canaux'] ?? []))) as $cid) {
            $canal = self::canal($cid);
            $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$vid]);
            $d = self::donnees($v, $canal, null);
            if ($canal['type'] === 'site') {
                if (in_array($v['statut'], ['disponible', 'reserve'], true)) {
                    $resultats[] = ['canalId' => $cid, 'ok' => true, 'message' => 'Déjà en ligne sur le site.'];
                    continue;
                }
                if (!in_array($v['statut'], ['brouillon', 'retire'], true)) {
                    $resultats[] = ['canalId' => $cid, 'ok' => false, 'message' => 'Véhicule ' . strtolower(Vehicles::STATUT_LABELS[$v['statut']]) . ' : il ne peut pas être remis en ligne.'];
                    continue;
                }
                if ($b = self::bloquants($d, $canal)) {
                    $resultats[] = ['canalId' => $cid, 'ok' => false, 'message' => 'À compléter : ' . implode(', ', array_column($b, 'message')) . '.'];
                    continue;
                }
                Vehicles::setStatut($user, $vid, 'disponible');
                $resultats[] = ['canalId' => $cid, 'ok' => true, 'message' => 'Annonce en ligne sur le site.'];
                continue;
            }
            // 1 clic impossible : on dit pourquoi (abonnement, connexion, configuration) et la publication assistée reste proposée
            $etat = self::autoEtat($canal);
            if ($etat['etat'] !== 'pret') {
                $resultats[] = ['canalId' => $cid, 'ok' => false, 'manuel' => true, 'bloque' => $etat['etat'], 'aide' => $etat['aide'], 'message' => $etat['message']];
                continue;
            }
            if (!in_array($v['statut'], ['brouillon', 'disponible', 'reserve'], true)) {
                $resultats[] = ['canalId' => $cid, 'ok' => false, 'message' => 'Véhicule ' . strtolower(Vehicles::STATUT_LABELS[$v['statut']]) . ' : publication impossible.'];
                continue;
            }
            $pub = self::publication($vid, $cid, 'auto');
            $d = self::donnees($v, $canal, $pub);
            if ($b = self::bloquants($d, $canal)) {
                $resultats[] = ['canalId' => $cid, 'ok' => false, 'message' => 'À compléter pour ' . $canal['nom'] . ' : ' . implode(', ', array_column($b, 'message')) . '.'];
                continue;
            }
            if (in_array($pub['statut'], ['publie', 'a_mettre_a_jour'], true) && $pub['reference_externe'] !== '') {
                $resultats[] = ['canalId' => $cid, 'ok' => true, 'message' => 'Déjà publié sur ' . $canal['nom'] . ' (utilisez « Synchroniser » pour envoyer les modifications).'];
                continue;
            }
            Db::update('la_publications', ['mode' => 'auto', 'statut' => 'en_attente', 'derniere_erreur' => '', 'erreur_type' => '', 'updated_at' => Db::now()], (int) $pub['id']);
            $tache = self::enqueue((int) $pub['id'], 'publier', $user, '');
            self::journal($user, $vid, $cid, (int) $pub['id'], 'publication_demandee', 'info', 'Publication demandée sur ' . $canal['nom'] . ' : en attente de confirmation de la plateforme.');
            $r = $tache ? self::traiterUne($tache) : null;
            $resultats[] = ['canalId' => $cid, 'ok' => (bool) ($r['ok'] ?? false), 'message' => $r['message'] ?? 'En attente de traitement.', 'type' => $r['type'] ?? '',
                'aide' => ComptesDiffusion::PLATEFORMES[$canal['code']]['aide'] ?? ''];
        }
        return ['resultats' => $resultats, 'diffusion' => self::vehicule($user, $vid)];
    }

    /** Retrait : site (statut « retiré ») ou canal automatique (tâche de retrait). */
    public static function retirer(array $user, array $in): array
    {
        $vid = (int) ($in['vehiculeId'] ?? 0);
        $canal = self::canal((int) ($in['canalId'] ?? 0));
        Access::vehicule($user, $vid);
        $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$vid]);
        if ($canal['type'] === 'site') {
            if (!in_array($v['statut'], ['disponible', 'reserve'], true)) {
                Http::fail(409, 'L\'annonce n\'est pas en ligne sur le site.');
            }
            Vehicles::setStatut($user, $vid, 'retire');
            return self::vehicule($user, $vid);
        }
        $pub = Db::one('SELECT * FROM la_publications WHERE vehicule_id = ? AND canal_id = ?', [$vid, (int) $canal['id']]);
        if (!$pub || !self::autoDisponible($canal) || !in_array('retirer', self::connecteur($canal['code'])->capacites(), true)) {
            Http::fail(409, 'Retrait automatique impossible sur ' . $canal['nom'] . ' : retirez l\'annonce sur la plateforme puis indiquez-le ici.');
        }
        $t = self::enqueue((int) $pub['id'], 'retirer', $user, '');
        if ($t) {
            self::traiterUne($t);
        }
        return self::vehicule($user, $vid);
    }

    /** « Synchroniser maintenant » / « Réessayer » : envoie la fiche aux canaux automatiques en retard ou en erreur. */
    public static function synchroniser(array $user, array $in): array
    {
        $vid = (int) ($in['vehiculeId'] ?? 0);
        Access::vehicule($user, $vid);
        $only = !empty($in['canalId']) ? (int) $in['canalId'] : null;
        foreach (Db::all('SELECT * FROM la_publications WHERE vehicule_id = ?', [$vid]) as $pub) {
            $canal = self::canal((int) $pub['canal_id']);
            if (($only && $only !== (int) $canal['id']) || !self::autoDisponible($canal)) {
                continue;
            }
            $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$vid]);
            $action = null;
            if ($pub['statut'] === 'a_retirer' || ($pub['statut'] === 'erreur' && !in_array($v['statut'], ['brouillon', 'disponible', 'reserve'], true) && $pub['reference_externe'] !== '')) {
                $action = 'retirer';
            } elseif ($pub['statut'] === 'erreur' || $pub['statut'] === 'en_attente') {
                $action = $pub['reference_externe'] !== '' ? 'modifier' : 'publier';
            } elseif (in_array($pub['statut'], ['a_mettre_a_jour', 'publie', 'expire'], true)) {
                $action = 'modifier';
            }
            if ($action) {
                // « Réessayer » : on relance une tâche en échec plutôt que d'en créer une seconde
                Db::exec("UPDATE la_diffusion_taches SET statut = 'annule', dedupe_key = NULL, updated_at = ? WHERE publication_id = ? AND statut IN ('echec', 'en_attente')", [Db::now(), (int) $pub['id']]);
                $t = self::enqueue((int) $pub['id'], $action, $user, $action === 'modifier' ? self::empreinte(self::donnees($v, $canal, $pub)) : '');
                if ($t) {
                    self::traiterUne($t);
                }
            }
        }
        return self::vehicule($user, $vid);
    }

    /** Publication assistée : l'utilisateur publie lui-même sur la plateforme puis enregistre ici le résultat. */
    public static function manuel(array $user, array $in): array
    {
        $vid = (int) ($in['vehiculeId'] ?? 0);
        $canal = self::canal((int) ($in['canalId'] ?? 0));
        Access::vehicule($user, $vid);
        if ($canal['type'] === 'site') {
            Http::fail(422, 'Le site du garage se gère directement (mise en ligne / retrait).');
        }
        $action = In::oneOf($in, 'action', ['publie', 'mis_a_jour', 'renouvele', 'suspendu', 'reactive', 'refuse', 'retire'], null, 'action');
        $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$vid]);
        $pub = self::publication($vid, (int) $canal['id'], 'manuel');
        $d = self::donnees($v, $canal, $pub);
        $now = Db::now();
        $data = ['mode' => 'manuel', 'erreur_type' => '', 'updated_at' => $now];
        $msg = '';
        switch ($action) {
            case 'publie':
                $url = trim(In::str($in, 'url', 500));
                if ($url !== '') {
                    $p = parse_url($url);
                    if (!$p || ($p['scheme'] ?? '') !== 'https' || empty($p['host'])) {
                        Http::fail(422, 'Indiquez le lien https de l\'annonce publiée.');
                    }
                    $dom = ComptesDiffusion::PLATEFORMES[$canal['code']]['domaines'] ?? null;
                    if ($dom && !array_filter($dom, fn($x) => strtolower($p['host']) === $x || str_ends_with(strtolower($p['host']), '.' . $x))) {
                        Http::fail(422, 'Ce lien n\'est pas une adresse ' . $canal['nom'] . ' (' . implode(', ', $dom) . ').');
                    }
                } elseif ($canal['type'] === 'plateforme' && trim(In::str($in, 'reference', 120)) === '') {
                    Http::fail(422, 'Indiquez le lien de l\'annonce (ou sa référence) pour pouvoir la retrouver.');
                }
                $data += ['statut' => 'publie', 'url' => $url, 'reference_externe' => In::str($in, 'reference', 120), 'expire_le' => In::date($in, 'expireLe', false, 'date d\'expiration'),
                    'publie_le' => $pub['publie_le'] ?: $now, 'empreinte' => self::empreinte($d), 'prix_publie' => (int) $v['prix'], 'derniere_synchro' => $now, 'derniere_erreur' => ''];
                $msg = 'Annonce publiée sur ' . $canal['nom'] . ' (publication assistée)' . ($url !== '' ? ' : lien enregistré.' : '.');
                break;
            case 'mis_a_jour':
                $data += ['statut' => 'publie', 'empreinte' => self::empreinte($d), 'prix_publie' => (int) $v['prix'], 'derniere_synchro' => $now, 'derniere_erreur' => ''];
                $msg = 'Annonce mise à jour sur ' . $canal['nom'] . ' (prix ' . self::prixTexte((int) $v['prix']) . ').';
                break;
            case 'renouvele':
                $data += ['statut' => 'publie', 'expire_le' => In::date($in, 'expireLe', false, 'date d\'expiration'), 'derniere_synchro' => $now];
                $msg = 'Annonce renouvelée sur ' . $canal['nom'] . '.';
                break;
            case 'suspendu':
                $data += ['statut' => 'suspendu'];
                $msg = 'Annonce suspendue sur ' . $canal['nom'] . (($m = In::str($in, 'motif', 200)) !== '' ? ' : ' . $m : '') . '.';
                break;
            case 'reactive':
                $data += ['statut' => 'publie', 'derniere_synchro' => $now];
                $msg = 'Annonce réactivée sur ' . $canal['nom'] . '.';
                break;
            case 'refuse':
                $m = In::str($in, 'motif', 200);
                if ($m === '') {
                    Http::fail(422, 'Indiquez le motif du refus donné par la plateforme.');
                }
                $data = ['statut' => 'refuse', 'derniere_erreur' => $m, 'erreur_type' => 'refus'] + $data;
                $msg = 'Annonce refusée par ' . $canal['nom'] . ' : ' . $m;
                break;
            case 'retire':
                $data += ['statut' => 'retire', 'derniere_synchro' => $now];
                $msg = 'Annonce retirée de ' . $canal['nom'] . '.';
                break;
        }
        Db::update('la_publications', $data, (int) $pub['id']);
        self::journal($user, $vid, (int) $canal['id'], (int) $pub['id'], 'manuel_' . $action, $action === 'refuse' ? 'echec' : 'succes', $msg);
        return self::vehicule($user, $vid);
    }

    /** Adaptation du titre, de la description ou des photos pour un canal (la fiche du véhicule n'est pas modifiée). */
    public static function adaptation(array $user, array $in): array
    {
        $vid = (int) ($in['vehiculeId'] ?? 0);
        $canal = self::canal((int) ($in['canalId'] ?? 0));
        Access::vehicule($user, $vid);
        if ($canal['type'] === 'site') {
            Http::fail(422, 'Le site utilise directement la fiche du véhicule.');
        }
        $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$vid]);
        $pub = self::publication($vid, (int) $canal['id'], self::autoDisponible($canal) ? 'auto' : 'manuel');
        $def = self::donnees($v, $canal, null);
        $titre = trim(In::str($in, 'titre', 160));
        $desc = trim((string) ($in['description'] ?? ''));
        if (mb_strlen($desc) > 8000) {
            Http::fail(422, 'Description trop longue (8 000 caractères maximum).');
        }
        $photos = null;
        if (isset($in['photos']) && is_array($in['photos'])) {
            $valid = array_map([self::class, 'photoKey'], $def['toutesPhotos']);
            $photos = array_values(array_unique(array_filter(array_map('strval', $in['photos']), fn($k) => in_array($k, $valid, true))));
            if ($photos === $valid) {
                $photos = null;
            }
        }
        Db::update('la_publications', [
            'titre_perso' => $titre === '' || $titre === $def['titreDefaut'] ? null : $titre,
            'description_perso' => $desc === '' || $desc === $def['descriptionDefaut'] ? null : $desc,
            'photos_perso' => $photos === null ? null : json_encode($photos, JSON_UNESCAPED_SLASHES),
            'updated_at' => Db::now(),
        ], (int) $pub['id']);
        self::journal($user, $vid, (int) $canal['id'], (int) $pub['id'], 'adaptation', 'info', 'Annonce adaptée pour ' . $canal['nom'] . ' (titre, description ou photos) — la fiche du véhicule est inchangée.');
        self::vehiculeChange($user, $vid);
        return self::vehicule($user, $vid);
    }

    /** Plateformes supplémentaires en publication assistée (ex. autres sites d'annonces). */
    public static function saveCanal(array $user, array $in): array
    {
        Access::require($user, 'diffusion.comptes');
        $id = (int) ($in['id'] ?? 0);
        $nom = In::str($in, 'nom', 80);
        $url = trim(In::str($in, 'urlDepot', 255));
        if ($nom === '') {
            Http::fail(422, 'Indiquez le nom de la plateforme.');
        }
        if ($url !== '' && (parse_url($url, PHP_URL_SCHEME) !== 'https')) {
            Http::fail(422, 'L\'adresse de dépôt doit commencer par https://');
        }
        if ($id) {
            $c = Db::one('SELECT * FROM la_canaux WHERE id = ?', [$id]);
            if (!$c) {
                Http::fail(404, 'Canal inconnu.');
            }
            $data = ['url_depot' => $url, 'actif' => array_key_exists('actif', $in) ? In::bool($in, 'actif') : 1];
            if ($c['type'] === 'autre') {
                $data['nom'] = $nom;
            }
            Db::update('la_canaux', $data, $id);
        } else {
            $code = 'autre_' . substr(Vehicles::slugify($nom), 0, 20) . '_' . bin2hex(random_bytes(2));
            $id = Db::insert('la_canaux', ['code' => str_replace('-', '_', $code), 'nom' => $nom, 'type' => 'autre', 'url_depot' => $url, 'actif' => 1,
                'ordre' => (int) Db::value('SELECT COALESCE(MAX(ordre), 0) + 1 FROM la_canaux'), 'created_at' => Db::now()]);
        }
        self::journal($user, null, $id, null, 'canal', 'info', 'Plateforme « ' . $nom . ' » enregistrée (publication assistée).');
        return array_map(fn($c) => ['canalId' => (int) $c['id'], 'code' => $c['code'], 'nom' => $c['nom'], 'type' => $c['type'], 'urlDepot' => $c['url_depot'], 'actif' => (int) $c['actif'] === 1],
            Db::all("SELECT * FROM la_canaux WHERE type IN ('autre') ORDER BY ordre, id"));
    }

    public static function canauxAutres(array $user): array
    {
        Access::require($user, 'diffusion.voir');
        return array_map(fn($c) => ['canalId' => (int) $c['id'], 'code' => $c['code'], 'nom' => $c['nom'], 'type' => $c['type'], 'urlDepot' => $c['url_depot'], 'actif' => (int) $c['actif'] === 1],
            Db::all("SELECT * FROM la_canaux WHERE type = 'autre' ORDER BY ordre, id"));
    }

    // ---------------------------------------------------------------- synchronisation avec la fiche

    /**
     * À appeler après toute modification d'un véhicule (fiche, statut, vente). Idempotent.
     * - vendu / livré / retiré : annonces externes « à retirer » (tâche automatique si le canal le permet) ;
     * - vente annulée : annonce « à retirer » redevenue « publiée » ;
     * - fiche modifiée (prix, texte, photos…) : « à mettre à jour » (tâche automatique si le canal le permet).
     */
    public static function vehiculeChange(?array $user, int $vid, ?string $ancienStatut = null): void
    {
        $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$vid]);
        if (!$v) {
            return;
        }
        $site = Db::one("SELECT * FROM la_canaux WHERE code = 'site'");
        if ($site && $ancienStatut !== null && $ancienStatut !== $v['statut']) {
            $avant = self::siteStatut($ancienStatut);
            $apres = self::siteStatut($v['statut']);
            if ($avant !== $apres) {
                $msg = ['publie' => 'Annonce en ligne sur le site.', 'suspendu' => 'Annonce retirée du site.', 'non_publie' => 'Annonce repassée en brouillon (retirée du site).',
                    'vendu' => 'Véhicule ' . strtolower(Vehicles::STATUT_LABELS[$v['statut']]) . ' : annonce retirée du site automatiquement.'][$apres] ?? '';
                if ($msg !== '') {
                    self::journal($user, $vid, (int) $site['id'], null, 'site_' . $apres, 'succes', $msg);
                }
            }
        }
        $horsVente = !in_array($v['statut'], ['brouillon', 'disponible', 'reserve'], true);
        foreach (Db::all('SELECT pu.*, c.code, c.nom, c.type FROM la_publications pu JOIN la_canaux c ON c.id = pu.canal_id WHERE pu.vehicule_id = ?', [$vid]) as $pub) {
            $canal = ['id' => $pub['canal_id'], 'code' => $pub['code'], 'nom' => $pub['nom'], 'type' => $pub['type'], 'url_depot' => ''];
            $auto = $pub['mode'] === 'auto' && self::autoDisponible($canal);
            if ($horsVente) {
                if (in_array($pub['statut'], self::EN_LIGNE, true) || ($pub['statut'] === 'erreur' && $pub['reference_externe'] !== '')) {
                    $raison = 'Véhicule ' . strtolower(Vehicles::STATUT_LABELS[$v['statut']]);
                    if ($auto && in_array('retirer', self::connecteur($canal['code'])->capacites(), true)) {
                        Db::update('la_publications', ['statut' => 'a_retirer', 'updated_at' => Db::now()], (int) $pub['id']);
                        self::enqueue((int) $pub['id'], 'retirer', $user, '');
                        self::journal($user, $vid, (int) $pub['canal_id'], (int) $pub['id'], 'retrait_demande', 'info', $raison . ' : retrait demandé sur ' . $pub['nom'] . '.');
                    } else {
                        Db::update('la_publications', ['statut' => 'a_retirer', 'updated_at' => Db::now()], (int) $pub['id']);
                        self::journal($user, $vid, (int) $pub['canal_id'], (int) $pub['id'], 'a_retirer', 'info', $raison . ' : retirez l\'annonce sur ' . $pub['nom'] . ' puis indiquez-le dans le dashboard.');
                    }
                }
                continue;
            }
            if ($pub['statut'] === 'a_retirer') {
                Db::update('la_publications', ['statut' => 'publie', 'updated_at' => Db::now()], (int) $pub['id']);
                self::journal($user, $vid, (int) $pub['canal_id'], (int) $pub['id'], 'retrait_annule', 'info', 'Véhicule de nouveau en vente : l\'annonce ' . $pub['nom'] . ' est conservée.');
                $pub['statut'] = 'publie';
            }
            if (in_array($pub['statut'], ['publie', 'expire', 'a_mettre_a_jour'], true) && $pub['empreinte'] !== '') {
                $d = self::donnees($v, $canal, $pub);
                $e = self::empreinte($d);
                if ($e === $pub['empreinte']) {
                    continue;
                }
                $detail = $pub['prix_publie'] !== null && (int) $pub['prix_publie'] !== (int) $v['prix']
                    ? 'prix ' . self::prixTexte((int) $pub['prix_publie']) . ' → ' . self::prixTexte((int) $v['prix']) : 'texte, photos ou caractéristiques modifiés';
                if ($auto && in_array('modifier', self::connecteur($canal['code'])->capacites(), true)) {
                    if (self::enqueue((int) $pub['id'], 'modifier', $user, $e)) {
                        Db::update('la_publications', ['statut' => 'a_mettre_a_jour', 'updated_at' => Db::now()], (int) $pub['id']);
                        self::journal($user, $vid, (int) $pub['canal_id'], (int) $pub['id'], 'maj_demandee', 'info', 'Fiche modifiée (' . $detail . ') : mise à jour envoyée à ' . $pub['nom'] . ', en attente de confirmation.');
                    }
                } elseif ($pub['statut'] !== 'a_mettre_a_jour') {
                    Db::update('la_publications', ['statut' => 'a_mettre_a_jour', 'updated_at' => Db::now()], (int) $pub['id']);
                    self::journal($user, $vid, (int) $pub['canal_id'], (int) $pub['id'], 'a_mettre_a_jour', 'info', 'Fiche modifiée (' . $detail . ') : mettez à jour l\'annonce sur ' . $pub['nom'] . '.');
                }
            }
        }
    }

    // ---------------------------------------------------------------- file de tâches (connecteurs API)

    /** Ajoute une tâche ; une seule tâche en cours par publication, action et version des données. */
    private static function enqueue(int $pubId, string $action, ?array $user, string $version): ?int
    {
        $key = 'pub:' . $pubId . ':' . $action . ':' . $version;
        if (Db::value('SELECT COUNT(*) FROM la_diffusion_taches WHERE dedupe_key = ?', [$key])) {
            return null;
        }
        // Une demande plus récente remplace les envois pas encore partis (une mise à jour remplace la précédente,
        // un retrait annule une publication ou une mise à jour en attente)
        $remplacees = $action === 'modifier' ? ['modifier'] : ($action === 'retirer' ? ['publier', 'modifier'] : []);
        if ($remplacees) {
            Db::exec("UPDATE la_diffusion_taches SET statut = 'annule', dedupe_key = NULL, updated_at = ? WHERE publication_id = ? AND statut = 'en_attente' AND action IN (" . Db::in($remplacees) . ')',
                array_merge([Db::now(), $pubId], $remplacees));
        }
        try {
            return Db::insert('la_diffusion_taches', ['publication_id' => $pubId, 'action' => $action, 'statut' => 'en_attente', 'claim' => '', 'tentatives' => 0,
                'derniere_erreur' => '', 'dedupe_key' => $key, 'acteur_id' => $user['id'] ?? null, 'created_at' => Db::now(), 'updated_at' => Db::now()]);
        } catch (PDOException $e) {
            return null; // déjà en file (requêtes simultanées)
        }
    }

    /** Traite les tâches dues (appelé par le dashboard, la tâche planifiée et le worker). */
    public static function traiter(int $limite = 5, int $maxSecondes = 4): array
    {
        $t0 = microtime(true);
        $faits = 0;
        // Tâche bloquée « en cours » (processus interrompu) : remise en attente
        Db::exec("UPDATE la_diffusion_taches SET statut = 'en_attente', claim = '', updated_at = ? WHERE statut = 'en_cours' AND updated_at < ?", [Db::now(), date('Y-m-d H:i:s', time() - 600)]);
        foreach (Db::all("SELECT id FROM la_diffusion_taches WHERE statut = 'en_attente' AND (prochaine_tentative IS NULL OR prochaine_tentative <= ?) ORDER BY id LIMIT $limite", [Db::now()]) as $t) {
            if (microtime(true) - $t0 > $maxSecondes) {
                break;
            }
            if (self::traiterUne((int) $t['id']) !== null) {
                $faits++;
            }
        }
        return ['traitees' => $faits];
    }

    public static function traiterUne(int $id): ?array
    {
        $claim = bin2hex(random_bytes(8));
        if (!Db::exec("UPDATE la_diffusion_taches SET statut = 'en_cours', claim = ?, updated_at = ? WHERE id = ? AND statut = 'en_attente'", [$claim, Db::now(), $id])) {
            return null;
        }
        $t = Db::one('SELECT * FROM la_diffusion_taches WHERE id = ? AND claim = ?', [$id, $claim]);
        $pub = Db::one('SELECT * FROM la_publications WHERE id = ?', [(int) $t['publication_id']]);
        $canal = $pub ? Db::one('SELECT * FROM la_canaux WHERE id = ?', [(int) $pub['canal_id']]) : null;
        $v = $pub ? Db::one('SELECT * FROM la_vehicules WHERE id = ?', [(int) $pub['vehicule_id']]) : null;
        $acteur = $t['acteur_id'] ? ['id' => (int) $t['acteur_id']] : null;
        $fail = function (string $message, bool $temporaire, string $type = 'technique') use ($t, $pub, $canal, $acteur): array {
            $tent = (int) $t['tentatives'] + 1;
            if ($temporaire && $tent < self::MAX_TENTATIVES) {
                $next = date('Y-m-d H:i:s', time() + self::BACKOFF[min($tent - 1, 2)] * 60);
                Db::exec("UPDATE la_diffusion_taches SET statut = 'en_attente', claim = '', tentatives = ?, prochaine_tentative = ?, derniere_erreur = ?, updated_at = ? WHERE id = ?",
                    [$tent, $next, mb_substr($message, 0, 500), Db::now(), (int) $t['id']]);
                if ($pub) {
                    Db::update('la_publications', ['derniere_erreur' => mb_substr($message . ' Nouvel essai à ' . date('H:i', strtotime($next)) . '.', 0, 500), 'erreur_type' => $type, 'updated_at' => Db::now()], (int) $pub['id']);
                    self::journal($acteur, (int) $pub['vehicule_id'], (int) $pub['canal_id'], (int) $pub['id'], $t['action'], 'echec', ($canal['nom'] ?? '') . ' : ' . $message . ' Nouvel essai automatique à ' . date('H:i', strtotime($next)) . '.');
                }
                return ['ok' => false, 'type' => $type, 'message' => $message . ' Nouvel essai automatique prévu.'];
            }
            Db::exec("UPDATE la_diffusion_taches SET statut = 'echec', claim = '', tentatives = ?, derniere_erreur = ?, dedupe_key = NULL, updated_at = ? WHERE id = ?",
                [$tent, mb_substr($message, 0, 500), Db::now(), (int) $t['id']]);
            if ($pub) {
                // Annonce refusée à la création : « refusée » (motif de la plateforme) ; sinon « erreur » avec son type
                $statut = $type === 'refus' && $t['action'] === 'publier' ? 'refuse' : 'erreur';
                Db::update('la_publications', ['statut' => $statut, 'derniere_erreur' => mb_substr($message, 0, 500), 'erreur_type' => $type, 'updated_at' => Db::now()], (int) $pub['id']);
                self::journal($acteur, (int) $pub['vehicule_id'], (int) $pub['canal_id'], (int) $pub['id'], $t['action'], 'echec', ($canal['nom'] ?? '') . ' : ' . $message);
            }
            // Accès refusés par la plateforme : le compte doit être reconnecté
            if ($type === 'connexion' && $canal && ($c = Db::one('SELECT id FROM la_comptes_diffusion WHERE canal_id = ?', [(int) $canal['id']]))) {
                Db::update('la_comptes_diffusion', ['statut' => 'erreur', 'jeton_chiffre' => null, 'jeton_expire_le' => null, 'dernier_message' => mb_substr($message, 0, 500), 'updated_at' => Db::now()], (int) $c['id']);
            }
            return ['ok' => false, 'type' => $type, 'message' => $message];
        };
        if (!$pub || !$canal || !$v) {
            return $fail('Publication introuvable.', false);
        }
        // Contrôles avant envoi, dans l'ordre exigé par la plateforme
        $etat = self::autoEtat($canal);
        if ($etat['etat'] !== 'pret') {
            return $fail($etat['message'], false, ['abonnement' => 'abonnement', 'non_connecte' => 'connexion'][$etat['etat']] ?? 'configuration');
        }
        $con = self::connecteur($canal['code']);
        if (!$con || !in_array($t['action'], $con->capacites(), true)) {
            return $fail('Opération non proposée par ' . $canal['nom'] . ' : renseignez son adresse dans « Comptes de diffusion » ou faites-la sur la plateforme.', false, 'configuration');
        }
        $compte = $canal['code'] === 'bac_a_sable' ? null : Db::one('SELECT * FROM la_comptes_diffusion WHERE canal_id = ?', [(int) $canal['id']]);
        $d = self::donnees($v, $canal, $pub);
        $d['variables'] = self::variables($v, $d);
        try {
            $r = $con->executer($t['action'], $pub, $d, $compte);
        } catch (Throwable $e) {
            error_log('[diffusion] ' . $canal['code'] . ' : ' . $e->getMessage());
            $r = ['ok' => false, 'temporaire' => true, 'type' => 'technique', 'message' => 'Erreur technique pendant l\'envoi.'];
        }
        if (empty($r['ok'])) {
            return $fail((string) ($r['message'] ?? 'Échec sans explication de la plateforme.'), !empty($r['temporaire']), (string) ($r['type'] ?? 'technique'));
        }
        $now = Db::now();
        $upd = ['derniere_synchro' => $now, 'derniere_erreur' => '', 'erreur_type' => '', 'updated_at' => $now];
        if ($t['action'] === 'retirer') {
            $upd['statut'] = 'retire';
        } else {
            $upd += ['statut' => 'publie', 'empreinte' => self::empreinte($d), 'prix_publie' => (int) $v['prix'], 'reference_externe' => (string) ($r['reference'] ?? $pub['reference_externe']),
                'url' => (string) (($r['url'] ?? '') !== '' ? $r['url'] : $pub['url']), 'publie_le' => $pub['publie_le'] ?: $now];
        }
        Db::update('la_publications', $upd, (int) $pub['id']);
        Db::exec("UPDATE la_diffusion_taches SET statut = 'fait', claim = '', dedupe_key = NULL, tentatives = tentatives + 1, updated_at = ? WHERE id = ?", [$now, (int) $t['id']]);
        self::journal($acteur, (int) $pub['vehicule_id'], (int) $pub['canal_id'], (int) $pub['id'], $t['action'], 'succes', (string) ($r['message'] ?? $canal['nom'] . ' : opération confirmée.'));
        return ['ok' => true, 'type' => '', 'message' => (string) ($r['message'] ?? 'Opération confirmée par ' . $canal['nom'] . '.')];
    }
}
