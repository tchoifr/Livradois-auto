<?php
declare(strict_types=1);

/** Fournisseur d'e-mails (interchangeable : SMTP authentifié ou service transactionnel plus tard). */
interface EmailProvider
{
    /** @return array{0: bool, 1: string, 2: string} [succès, identifiant fournisseur, erreur] */
    public function send(string $to, string $subject, string $body, string $replyTo = ''): array;
}

interface SmsProvider
{
    public function configured(): bool;

    /** @return array{0: bool, 1: string, 2: string} */
    public function send(string $to, string $text): array;
}

/** E-mail via la fonction mail() de l'hébergement (conservée tant qu'aucun service dédié n'est choisi). */
final class MailFunctionProvider implements EmailProvider
{
    public function send(string $to, string $subject, string $body, string $replyTo = ''): array
    {
        if (!function_exists('mail')) {
            return [false, '', 'La fonction mail() est indisponible sur ce serveur.'];
        }
        $clean = fn($s) => str_replace(["\r", "\n", "\0"], ' ', $s);
        $headers = "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n";
        if ($from = cfg('mail_from')) {
            $headers .= 'From: ' . $clean((string) $from) . "\r\n";
        }
        if ($replyTo !== '' && filter_var($replyTo, FILTER_VALIDATE_EMAIL)) {
            $headers .= 'Reply-To: ' . $clean($replyTo) . "\r\n";
        }
        $id = bin2hex(random_bytes(8)) . '@livradois';
        $headers .= "Message-ID: <$id>\r\n";
        $ok = @mail($clean($to), '=?UTF-8?B?' . base64_encode($clean($subject)) . '?=', $body, $headers);
        return [$ok, $ok ? $id : '', $ok ? '' : 'Refusé par le serveur d\'envoi (mail).'];
    }
}

/** Aucun fournisseur SMS choisi pour l'instant (cf. spécification 7.2) : les SMS sont remplacés par l'e-mail quand c'est possible. */
final class NoSmsProvider implements SmsProvider
{
    public function configured(): bool
    {
        return false;
    }

    public function send(string $to, string $text): array
    {
        return [false, '', 'Aucun fournisseur SMS n\'est configuré.'];
    }
}

/**
 * File d'attente des messages (table la_notifications) et envoi idempotent.
 * États : en_attente, en_cours, envoye, livre, echec, annule, simule (démonstration).
 */
final class Notifications
{
    public const STATUTS = [
        'en_attente' => 'En attente', 'en_cours' => 'En cours d\'envoi', 'envoye' => 'Envoyé', 'livre' => 'Livré',
        'echec' => 'Échec', 'annule' => 'Annulé', 'simule' => 'Simulé (démo)',
    ];
    private const BACKOFF = [5, 15, 60]; // minutes avant chaque nouvelle tentative
    private const MAX_ATTEMPTS = 4;

    private static function email(): EmailProvider
    {
        return new MailFunctionProvider();
    }

    private static function sms(): SmsProvider
    {
        return new NoSmsProvider();
    }

    /** Remplace les variables {x} par des valeurs texte neutralisées (pas d'en-têtes injectables). */
    public static function render(string $template, array $vars): array
    {
        $t = (Settings::get('modeles') ?? [])[$template] ?? null;
        if (!$t) {
            Http::fail(422, 'Modèle de message inconnu.');
        }
        $safe = [];
        foreach ($vars as $k => $v) {
            $safe['{' . $k . '}'] = mb_substr(preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string) $v), 0, 2000);
        }
        $subject = str_replace(["\r", "\n"], ' ', strtr((string) $t['sujet'], $safe));
        $text = strtr((string) $t['texte'], $safe);
        return [mb_substr($subject, 0, 200), $text];
    }

    private static function appointment(int $id): ?array
    {
        return Db::one('SELECT r.*, v.marque, v.modele, v.id AS vid, c.id AS cid, c.nom, c.prenom, c.telephone, c.email, c.preference_contact, c.service_email, c.service_sms, c.actif AS client_actif, p.nom AS parc_nom
            FROM la_rendez_vous r JOIN la_vehicules v ON v.id = r.vehicule_id LEFT JOIN la_clients c ON c.id = r.client_id LEFT JOIN la_parcs p ON p.id = r.parc_id WHERE r.id = ?', [$id]);
    }

    private static function varsFor(array $r, array $extra = []): array
    {
        return $extra + [
            'prenom' => $r['prenom'] ?: $r['nom'], 'nom' => $r['nom'], 'vehicule' => trim($r['marque'] . ' ' . $r['modele']),
            'date' => date('d/m/Y', strtotime($r['start_at'])), 'heure' => date('H\hi', strtotime($r['start_at'])),
            'parc' => $r['parc_nom'] ?? '', 'telephone' => (string) Settings::get('telephone'),
        ];
    }

    /** Canal et destinataire selon les coordonnées et préférences de service du client. */
    private static function channel(array $r): array
    {
        if (empty($r['cid']) || (int) $r['client_actif'] !== 1) {
            return [null, '', 'Aucun client actif rattaché à ce rendez-vous.'];
        }
        $sms = self::sms()->configured();
        $canSms = $sms && (int) $r['service_sms'] === 1 && strlen(In::phoneNorm((string) $r['telephone'])) >= 10;
        $canMail = (int) $r['service_email'] === 1 && filter_var($r['email'], FILTER_VALIDATE_EMAIL);
        if ($r['preference_contact'] === 'sms' && $canSms) {
            return ['sms', (string) $r['telephone'], ''];
        }
        if ($canMail) {
            return ['email', (string) $r['email'], ''];
        }
        if ($canSms) {
            return ['sms', (string) $r['telephone'], ''];
        }
        if (!$sms && $r['preference_contact'] === 'sms') {
            return [null, '', 'Le client préfère les SMS, mais aucun fournisseur SMS n\'est encore configuré et il n\'a pas d\'e-mail utilisable.'];
        }
        return [null, '', 'Pas de coordonnée utilisable (e-mail absent ou messages de service refusés).'];
    }

    /** Aperçu du message proposé après une action (destinataire, canal, texte final) — rien n'est envoyé. */
    public static function proposition(int $rdvId, string $template, array $extra = []): array
    {
        $r = self::appointment($rdvId);
        if (!$r) {
            return ['possible' => false, 'raison' => 'Rendez-vous introuvable.'];
        }
        [$canal, $dest, $raison] = self::channel($r);
        [$sujet, $texte] = self::render($template, self::varsFor($r, $extra));
        return ['possible' => $canal !== null, 'raison' => $raison, 'template' => $template, 'canal' => $canal, 'destinataire' => $dest,
            'sujet' => $sujet, 'texte' => $texte, 'rendezVousId' => $rdvId, 'extra' => $extra, 'redirection' => (string) Settings::get('mail_redirect')];
    }

    /** Envoi validé par l'utilisateur après aperçu (texte éventuellement ajusté). */
    public static function envoyer(array $user, array $in): array
    {
        Access::require($user, 'messages.envoyer');
        $rdvId = (int) ($in['rendezVousId'] ?? 0);
        Appointments::get($user, $rdvId);
        $template = In::oneOf($in, 'template', ['confirmation', 'rappel', 'modification', 'annulation'], null, 'modèle');
        $p = self::proposition($rdvId, $template, is_array($in['extra'] ?? null) ? array_map('strval', $in['extra']) : []);
        if (!$p['possible']) {
            Http::fail(422, $p['raison']);
        }
        $texte = isset($in['texte']) && trim((string) $in['texte']) !== '' ? mb_substr((string) $in['texte'], 0, 4000) : $p['texte'];
        $r = self::appointment($rdvId);
        $id = self::enqueue([
            'rendez_vous_id' => $rdvId, 'client_id' => (int) $r['cid'], 'vehicule_id' => (int) $r['vid'], 'canal' => $p['canal'],
            'destinataire' => $p['destinataire'], 'template' => $template, 'sujet' => $p['sujet'], 'contenu' => $texte,
            'scheduled_at' => Db::now(), 'created_by' => $user['id'],
        ]);
        $row = self::processOne($id);
        Audit::log($user, 'message.envoyer', 'rendez_vous', $rdvId, null, ['message' => $id, 'canal' => $p['canal'], 'modele' => $template]);
        return $row;
    }

    public static function enqueue(array $data): ?int
    {
        $data += ['statut' => 'en_attente', 'attempts' => 0, 'created_at' => Db::now(), 'updated_at' => Db::now(), 'claim' => '', 'provider_id' => '', 'last_error' => ''];
        try {
            return Db::insert('la_notifications', $data);
        } catch (PDOException $e) {
            if (($e->errorInfo[0] ?? '') === '23000' || str_contains($e->getMessage(), 'UNIQUE')) {
                return null; // déjà planifié (clé de déduplication)
            }
            throw $e;
        }
    }

    /** Rappels automatiques (24 h / 2 h avant) si activés et si le client accepte les messages de service. */
    public static function planifierRappels(int $rdvId): int
    {
        $cfg = Settings::get('rappels') ?? [];
        if (empty($cfg['actifs'])) {
            return 0;
        }
        $r = self::appointment($rdvId);
        if (!$r || $r['statut'] !== 'confirme') {
            return 0;
        }
        [$canal, $dest] = self::channel($r);
        if ($canal === null) {
            return 0;
        }
        $n = 0;
        foreach (['h24' => 24, 'h2' => 2] as $k => $hours) {
            if (empty($cfg[$k])) {
                continue;
            }
            $when = date('Y-m-d H:i:s', strtotime($r['start_at']) - $hours * 3600);
            if ($when <= Db::now()) {
                continue;
            }
            [$sujet, $texte] = self::render('rappel', self::varsFor($r));
            $id = self::enqueue([
                'rendez_vous_id' => $rdvId, 'client_id' => (int) $r['cid'], 'vehicule_id' => (int) $r['vid'], 'canal' => $canal, 'destinataire' => $dest,
                'template' => 'rappel', 'sujet' => $sujet, 'contenu' => $texte, 'scheduled_at' => $when,
                'dedupe_key' => "rdv:$rdvId:rappel_$k:" . $r['start_at'],
            ]);
            $n += $id ? 1 : 0;
        }
        return $n;
    }

    /** Annule les messages encore en attente d'un rendez-vous (annulation, déplacement, clôture). */
    public static function annulerRappels(int $rdvId): int
    {
        return Db::exec("UPDATE la_notifications SET statut = 'annule', last_error = 'Rendez-vous annulé ou modifié', dedupe_key = NULL, updated_at = ? WHERE rendez_vous_id = ? AND statut = 'en_attente'", [Db::now(), $rdvId]);
    }

    /** Notification interne au garage pour une demande reçue sur le site. */
    public static function demandeSite(int $demandeId): void
    {
        $to = (string) Settings::get('notify_email');
        if ($to === '') {
            return;
        }
        $d = Db::one('SELECT d.*, v.marque, v.modele, v.numero_stock FROM la_demandes d LEFT JOIN la_vehicules v ON v.id = d.vehicule_id WHERE d.id = ?', [$demandeId]);
        if (!$d) {
            return;
        }
        [$sujet, $texte] = self::render('demande_site', [
            'type' => Requests::TYPES[$d['type']] ?? $d['type'],
            'vehicule' => $d['marque'] ? $d['marque'] . ' ' . $d['modele'] . ' (' . $d['numero_stock'] . ')' : 'demande générale',
            'offre' => $d['montant'] ? 'Offre : ' . number_format((int) $d['montant'], 0, ',', ' ') . " €\n" : '',
            'nom' => $d['nom'], 'telephone_client' => $d['tel'], 'email_client' => $d['email'] ?: '—', 'message' => (string) $d['message'],
            'lien' => cfg('site_url', '') . 'admin/#/demandes',
        ]);
        $id = self::enqueue([
            'demande_id' => $demandeId, 'vehicule_id' => $d['vehicule_id'], 'canal' => 'email', 'destinataire' => $to,
            'template' => 'demande_site', 'sujet' => $sujet, 'contenu' => $texte, 'scheduled_at' => Db::now(),
            'dedupe_key' => "demande:$demandeId",
        ]);
        if ($id) {
            self::processOne($id, (string) $d['email']);
        }
    }

    /** Envoie les messages dus. Idempotent : chaque message est « réservé » avant envoi. */
    public static function processDue(int $limit = 10, int $maxSeconds = 8): array
    {
        $start = time();
        // Envois interrompus (plantage) : jamais renvoyés automatiquement, pour éviter les doublons
        Db::exec("UPDATE la_notifications SET statut = 'echec', last_error = 'Envoi interrompu : vérifiez puis relancez manuellement', updated_at = ? WHERE statut = 'en_cours' AND updated_at < ?", [Db::now(), date('Y-m-d H:i:s', time() - 900)]);
        $now = Db::now();
        $ids = array_map('intval', array_column(Db::all("SELECT id FROM la_notifications WHERE statut = 'en_attente' AND scheduled_at <= ? AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY scheduled_at LIMIT " . max(1, min(100, $limit)), [$now, $now]), 'id'));
        $done = ['envoyes' => 0, 'echecs' => 0, 'annules' => 0];
        foreach ($ids as $id) {
            if (time() - $start >= $maxSeconds) {
                break;
            }
            $row = self::processOne($id);
            if ($row === null) {
                continue;
            }
            $k = in_array($row['statut'], ['envoye', 'livre', 'simule'], true) ? 'envoyes' : ($row['statut'] === 'annule' ? 'annules' : 'echecs');
            $done[$k]++;
        }
        if (random_int(1, 20) === 1) {
            // Conservation limitée : on garde les métadonnées d'audit, pas le contenu complet
            Db::exec("UPDATE la_notifications SET contenu = NULL WHERE contenu IS NOT NULL AND created_at < ? AND statut IN ('envoye', 'livre', 'annule', 'simule')", [date('Y-m-d H:i:s', time() - 90 * 86400)]);
        }
        return $done;
    }

    /** Réserve puis envoie un message ; retourne son état (null si déjà pris par un autre processus). */
    public static function processOne(int $id, string $replyTo = ''): ?array
    {
        $claim = bin2hex(random_bytes(8));
        $taken = Db::exec("UPDATE la_notifications SET statut = 'en_cours', claim = ?, updated_at = ? WHERE id = ? AND statut = 'en_attente'", [$claim, Db::now(), $id]);
        if ($taken !== 1) {
            return null;
        }
        $n = Db::one('SELECT * FROM la_notifications WHERE id = ? AND claim = ?', [$id, $claim]);
        // Un rappel n'a de sens que si le rendez-vous est toujours actif, à la même heure
        if ($n['rendez_vous_id'] && $n['template'] === 'rappel') {
            $r = Db::one('SELECT statut, start_at FROM la_rendez_vous WHERE id = ?', [(int) $n['rendez_vous_id']]);
            if (!$r || $r['statut'] !== 'confirme' || !str_ends_with((string) $n['dedupe_key'], $r['start_at'])) {
                Db::exec("UPDATE la_notifications SET statut = 'annule', last_error = 'Rendez-vous annulé ou déplacé', updated_at = ? WHERE id = ?", [Db::now(), $id]);
                return self::row($id);
            }
        }
        [$ok, $providerId, $error] = self::deliver($n, $replyTo);
        $attempts = (int) $n['attempts'] + 1;
        if ($ok) {
            Db::exec('UPDATE la_notifications SET statut = ?, provider_id = ?, attempts = ?, sent_at = ?, last_error = \'\', updated_at = ? WHERE id = ?',
                [BO_DEMO ? 'simule' : 'envoye', $providerId, $attempts, Db::now(), Db::now(), $id]);
            if ($n['client_id']) {
                Clients::history(null, (int) $n['client_id'], $n['canal'] === 'sms' ? 'sms' : 'email', ($n['sujet'] ?: ucfirst($n['template'])) . ' → ' . $n['destinataire'],
                    ['vehicule_id' => $n['vehicule_id'] !== null ? (int) $n['vehicule_id'] : null, 'rendez_vous_id' => $n['rendez_vous_id'] !== null ? (int) $n['rendez_vous_id'] : null]);
            }
        } elseif ($attempts < self::MAX_ATTEMPTS) {
            Db::exec("UPDATE la_notifications SET statut = 'en_attente', attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?",
                [$attempts, date('Y-m-d H:i:s', time() + self::BACKOFF[min($attempts - 1, 2)] * 60), mb_substr($error, 0, 500), Db::now(), $id]);
        } else {
            Db::exec("UPDATE la_notifications SET statut = 'echec', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?", [$attempts, mb_substr($error, 0, 500), Db::now(), $id]);
        }
        return self::row($id);
    }

    private static function deliver(array $n, string $replyTo): array
    {
        if (BO_DEMO) {
            return [true, 'demo', ''];
        }
        if ($n['canal'] === 'sms') {
            return self::sms()->send($n['destinataire'], (string) $n['contenu']);
        }
        if ($n['canal'] !== 'email') {
            return [false, '', 'Canal inconnu.'];
        }
        $to = $n['destinataire'];
        $subject = $n['sujet'];
        $body = (string) $n['contenu'];
        // Mode test : tout part vers l'adresse de redirection, destinataire prévu indiqué
        $redirect = trim((string) Settings::get('mail_redirect'));
        if ($redirect !== '' && filter_var($redirect, FILTER_VALIDATE_EMAIL)) {
            $subject = '[TEST → ' . $to . '] ' . $subject;
            $body = "— Mode test : ce message était destiné à $to —\n\n" . $body;
            $to = $redirect;
        }
        return self::email()->send($to, $subject, $body, $replyTo);
    }

    private static function row(int $id): array
    {
        $n = Db::one('SELECT n.*, c.nom AS client_nom, c.prenom AS client_prenom, v.marque, v.modele FROM la_notifications n
            LEFT JOIN la_clients c ON c.id = n.client_id LEFT JOIN la_vehicules v ON v.id = n.vehicule_id WHERE n.id = ?', [$id]);
        $modeles = Settings::get('modeles') ?? [];
        return [
            'id' => (int) $n['id'], 'canal' => $n['canal'], 'destinataire' => $n['destinataire'], 'template' => $n['template'],
            'templateLabel' => $modeles[$n['template']]['libelle'] ?? $n['template'], 'sujet' => $n['sujet'], 'contenu' => $n['contenu'],
            'prevuLe' => $n['scheduled_at'], 'statut' => $n['statut'], 'statutLabel' => self::STATUTS[$n['statut']] ?? $n['statut'],
            'tentatives' => (int) $n['attempts'], 'prochaineTentative' => $n['next_attempt_at'], 'envoyeLe' => $n['sent_at'], 'livreLe' => $n['delivered_at'],
            'erreur' => $n['last_error'], 'rendezVousId' => $n['rendez_vous_id'] !== null ? (int) $n['rendez_vous_id'] : null,
            'client' => $n['client_nom'] ? trim(($n['client_prenom'] ?? '') . ' ' . $n['client_nom']) : null,
            'clientId' => $n['client_id'] !== null ? (int) $n['client_id'] : null,
            'vehicule' => $n['marque'] ? $n['marque'] . ' ' . $n['modele'] : null,
        ];
    }

    public static function forAppointment(int $rdvId): array
    {
        return array_map(fn($r) => self::row((int) $r['id']), Db::all('SELECT id FROM la_notifications WHERE rendez_vous_id = ? ORDER BY scheduled_at DESC', [$rdvId]));
    }

    public static function list(array $user, array $q): array
    {
        [$scope, $p] = Access::scope($user, 'v.parc_id', true);
        $where = '1 = 1' . $scope;
        if (!empty($q['statut']) && isset(self::STATUTS[$q['statut']])) {
            $where .= ' AND n.statut = ?';
            $p[] = $q['statut'];
        }
        if (!empty($q['canal'])) {
            $where .= ' AND n.canal = ?';
            $p[] = (string) $q['canal'];
        }
        $rows = Db::all("SELECT n.id FROM la_notifications n LEFT JOIN la_vehicules v ON v.id = n.vehicule_id WHERE $where ORDER BY n.scheduled_at DESC, n.id DESC LIMIT 300", $p);
        return array_map(fn($r) => self::row((int) $r['id']), $rows);
    }

    /** Renvoi manuel d'un message en échec (sans duplication : seul un message en échec peut être relancé). */
    public static function relancer(array $user, int $id): array
    {
        Access::require($user, 'messages.envoyer');
        $n = Db::one('SELECT n.*, v.parc_id FROM la_notifications n LEFT JOIN la_vehicules v ON v.id = n.vehicule_id WHERE n.id = ?', [$id]);
        if (!$n) {
            Http::fail(404, 'Message introuvable.');
        }
        if ($n['vehicule_id'] !== null) {
            Access::requireParc($user, $n['parc_id'] !== null ? (int) $n['parc_id'] : null);
        }
        if ($n['statut'] !== 'echec') {
            Http::fail(409, 'Seul un message en échec peut être relancé.');
        }
        if ($n['contenu'] === null) {
            Http::fail(409, 'Le contenu de ce message a été effacé (conservation limitée) : envoyez un nouveau message.');
        }
        Db::exec("UPDATE la_notifications SET statut = 'en_attente', attempts = 0, next_attempt_at = NULL, scheduled_at = ?, updated_at = ? WHERE id = ? AND statut = 'echec'", [Db::now(), Db::now(), $id]);
        Audit::log($user, 'message.relancer', 'message', $id);
        return self::processOne($id) ?? self::row($id);
    }

    public static function stats(array $user): array
    {
        [$scope, $p] = Access::scope($user, 'v.parc_id', true);
        return [
            'echecs' => (int) Db::value("SELECT COUNT(*) FROM la_notifications n LEFT JOIN la_vehicules v ON v.id = n.vehicule_id WHERE n.statut = 'echec'$scope", $p),
            'enAttente' => (int) Db::value("SELECT COUNT(*) FROM la_notifications n LEFT JOIN la_vehicules v ON v.id = n.vehicule_id WHERE n.statut = 'en_attente'$scope", $p),
        ];
    }
}
