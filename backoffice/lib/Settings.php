<?php
declare(strict_types=1);

/** Paramètres non secrets modifiables depuis le dashboard (table la_settings). */
final class Settings
{
    private static ?array $cache = null;

    public static function defaults(): array
    {
        return [
            'telephone' => '04 73 95 85 46',
            'motifs' => [
                ['code' => 'visite', 'libelle' => 'Visite du véhicule', 'duree' => 30],
                ['code' => 'essai', 'libelle' => 'Essai', 'duree' => 45],
                ['code' => 'appel', 'libelle' => 'Appel / confirmation', 'duree' => 15],
                ['code' => 'controle_technique', 'libelle' => 'Contrôle technique', 'duree' => 60],
                ['code' => 'livraison', 'libelle' => 'Livraison', 'duree' => 60],
                ['code' => 'documents', 'libelle' => 'Remise de documents', 'duree' => 30],
            ],
            // Créneaux d'ouverture par jour (0 = dimanche)
            'horaires' => [
                '1' => [['08:00', '12:00'], ['14:00', '18:00']], '2' => [['08:00', '12:00'], ['14:00', '18:00']],
                '3' => [['08:00', '12:00'], ['14:00', '18:00']], '4' => [['08:00', '12:00'], ['14:00', '18:00']],
                '5' => [['08:00', '12:00'], ['14:00', '18:00']], '6' => [['08:00', '12:00']], '0' => [],
            ],
            'rappels' => ['actifs' => true, 'h24' => true, 'h2' => false],
            'alertes' => ['preparation_jours' => 1, 'ct_jours' => [30, 7]],
            'mail_redirect' => (string) cfg('mail_redirect', ''),
            'notify_email' => (string) cfg('notify_email', ''),
            'modeles' => [
                'confirmation' => [
                    'libelle' => 'Confirmation de rendez-vous (client)',
                    'sujet' => 'Votre rendez-vous chez Livradois Automobiles',
                    'texte' => "Bonjour {prenom},\n\nvotre rendez-vous pour le véhicule {vehicule} est prévu le {date} à {heure} chez Livradois Automobiles ({parc}).\n\nPour modifier ce rendez-vous, appelez-nous au {telephone}.\n\nMerci et à bientôt.",
                ],
                'rappel' => [
                    'libelle' => 'Rappel de rendez-vous (client)',
                    'sujet' => 'Rappel : votre rendez-vous du {date}',
                    'texte' => "Rappel : nous vous attendons le {date} à {heure} pour le véhicule {vehicule}.\nParc : {parc}.\n\nEn cas d'empêchement, contactez-nous au {telephone}.",
                ],
                'modification' => [
                    'libelle' => 'Rendez-vous déplacé (client)',
                    'sujet' => 'Votre rendez-vous a été modifié',
                    'texte' => "Votre rendez-vous du {ancienne_date} a été modifié.\nNouvelle date : {date} à {heure}.\n\nContact : {telephone}.",
                ],
                'annulation' => [
                    'libelle' => 'Rendez-vous annulé (client)',
                    'sujet' => 'Votre rendez-vous a été annulé',
                    'texte' => "Votre rendez-vous du {date} à {heure} pour le véhicule {vehicule} a été annulé.\n\nPour en fixer un nouveau, appelez-nous au {telephone}.",
                ],
                'demande_site' => [
                    'libelle' => 'Nouvelle demande du site (garage)',
                    'sujet' => 'Nouvelle demande : {type} – {vehicule}',
                    'texte' => "Nouvelle demande reçue sur le site.\n\nType : {type}\nVéhicule : {vehicule}\n{offre}Nom : {nom}\nTéléphone : {telephone_client}\nE-mail : {email_client}\n\nMessage :\n{message}\n\nGérer les demandes : {lien}",
                ],
            ],
        ];
    }

    public static function all(): array
    {
        if (self::$cache === null) {
            $values = self::defaults();
            try {
                foreach (Db::all('SELECT cle, valeur FROM la_settings') as $r) {
                    $v = json_decode((string) $r['valeur'], true);
                    if ($v !== null || $r['valeur'] === 'null') {
                        $values[$r['cle']] = is_array($v) && is_array($values[$r['cle']] ?? null) && $r['cle'] === 'modeles'
                            ? array_replace_recursive($values['modeles'], $v)
                            : $v;
                    }
                }
            } catch (PDOException $e) {
                // Table pas encore créée (avant migration) : valeurs par défaut
            }
            self::$cache = $values;
        }
        return self::$cache;
    }

    public static function get(string $key)
    {
        return self::all()[$key] ?? null;
    }

    public static function motif(string $code): ?array
    {
        foreach ((array) self::get('motifs') as $m) {
            if ($m['code'] === $code) {
                return $m;
            }
        }
        return null;
    }

    /** Enregistrement depuis le dashboard (administrateur), avec validation par clé. */
    public static function save(array $user, array $in): array
    {
        $before = self::all();
        $clean = [];
        if (array_key_exists('telephone', $in)) {
            $clean['telephone'] = mb_substr(trim((string) $in['telephone']), 0, 40);
        }
        foreach (['mail_redirect', 'notify_email'] as $k) {
            if (array_key_exists($k, $in)) {
                $v = trim((string) $in[$k]);
                if ($v !== '' && !filter_var($v, FILTER_VALIDATE_EMAIL)) {
                    Http::fail(422, 'Adresse e-mail invalide : ' . $v);
                }
                $clean[$k] = $v;
            }
        }
        if (isset($in['motifs']) && is_array($in['motifs'])) {
            $m = [];
            foreach ($in['motifs'] as $row) {
                $code = preg_replace('/[^a-z_]/', '', strtolower((string) ($row['code'] ?? '')));
                $lib = mb_substr(trim((string) ($row['libelle'] ?? '')), 0, 60);
                $duree = (int) ($row['duree'] ?? 0);
                if ($code === '' || $lib === '' || $duree < 5 || $duree > 600) {
                    Http::fail(422, 'Motif de rendez-vous invalide (code, libellé et durée de 5 à 600 minutes).');
                }
                $m[] = ['code' => $code, 'libelle' => $lib, 'duree' => $duree];
            }
            $clean['motifs'] = $m;
        }
        if (isset($in['horaires']) && is_array($in['horaires'])) {
            $h = [];
            foreach (range(0, 6) as $d) {
                $h[(string) $d] = [];
                foreach ((array) ($in['horaires'][(string) $d] ?? []) as $slot) {
                    if (!is_array($slot) || count($slot) !== 2 || !preg_match('/^\d{2}:\d{2}$/', (string) $slot[0]) || !preg_match('/^\d{2}:\d{2}$/', (string) $slot[1]) || $slot[0] >= $slot[1]) {
                        Http::fail(422, 'Horaires invalides.');
                    }
                    $h[(string) $d][] = [$slot[0], $slot[1]];
                }
            }
            $clean['horaires'] = $h;
        }
        if (isset($in['rappels']) && is_array($in['rappels'])) {
            $clean['rappels'] = ['actifs' => !empty($in['rappels']['actifs']), 'h24' => !empty($in['rappels']['h24']), 'h2' => !empty($in['rappels']['h2'])];
        }
        if (isset($in['alertes']) && is_array($in['alertes'])) {
            $jours = array_values(array_filter(array_map('intval', (array) ($in['alertes']['ct_jours'] ?? [])), fn($j) => $j > 0 && $j <= 365));
            $clean['alertes'] = ['preparation_jours' => max(0, min(30, (int) ($in['alertes']['preparation_jours'] ?? 1))), 'ct_jours' => $jours ?: [30, 7]];
        }
        if (isset($in['modeles']) && is_array($in['modeles'])) {
            $defaults = self::defaults()['modeles'];
            $mod = [];
            foreach ($in['modeles'] as $code => $t) {
                if (!isset($defaults[$code]) || !is_array($t)) {
                    continue;
                }
                $mod[$code] = [
                    'sujet' => mb_substr(str_replace(["\r", "\n"], ' ', (string) ($t['sujet'] ?? '')), 0, 200),
                    'texte' => mb_substr((string) ($t['texte'] ?? ''), 0, 4000),
                ];
            }
            $clean['modeles'] = $mod;
        }
        foreach ($clean as $k => $v) {
            $json = json_encode($v, JSON_UNESCAPED_UNICODE);
            if (Db::value('SELECT COUNT(*) FROM la_settings WHERE cle = ?', [$k])) {
                Db::exec('UPDATE la_settings SET valeur = ?, updated_by = ?, updated_at = ? WHERE cle = ?', [$json, $user['id'], Db::now(), $k]);
            } else {
                Db::insert('la_settings', ['cle' => $k, 'valeur' => $json, 'updated_by' => $user['id'], 'updated_at' => Db::now()]);
            }
        }
        self::$cache = null;
        Audit::log($user, 'parametres.modifier', 'parametres', null, array_intersect_key($before, $clean), $clean);
        return self::all();
    }
}
