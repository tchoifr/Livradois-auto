<?php
declare(strict_types=1);

/**
 * Documents privés (carte grise, CT, factures…) : stockés HORS du site web, noms aléatoires,
 * type MIME réellement vérifié, accès uniquement par une route authentifiée.
 */
final class Documents
{
    public const TYPES = [
        'carte_grise' => 'Carte grise',
        'non_gage' => 'Certificat de non-gage',
        'entretien' => 'Carnet / factures d\'entretien',
        'controle_technique' => 'Procès-verbal de contrôle technique',
        'cession' => 'Certificat de cession',
        'bon_commande' => 'Bon de commande',
        'facture_vente' => 'Facture de vente',
        'facture_achat' => 'Facture d\'achat',
        'facture_frais' => 'Justificatif de dépense',
        'autre' => 'Autre document',
    ];
    /** Documents financiers : propriétaire uniquement. */
    public const FINANCE_TYPES = ['facture_achat', 'facture_frais', 'facture_vente', 'bon_commande'];
    private const MIMES = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    private const MAX = 10 * 1024 * 1024;

    public static function typeForItem(string $code): string
    {
        return ['doc_carte_grise' => 'carte_grise', 'doc_non_gage' => 'non_gage', 'doc_entretien' => 'entretien', 'controle_technique' => 'controle_technique', 'livraison_documents' => 'cession'][$code] ?? '';
    }

    private static function canSee(array $user, string $type): bool
    {
        return !in_array($type, self::FINANCE_TYPES, true) || Access::can($user, 'finance.voir');
    }

    public static function forVehicule(array $user, int $vid): array
    {
        Access::vehicule($user, $vid);
        $rows = Db::all('SELECT d.*, a.name AS auteur FROM la_documents d LEFT JOIN la_admins a ON a.id = d.uploaded_by WHERE d.vehicule_id = ? AND d.supprime_le IS NULL ORDER BY d.id DESC', [$vid]);
        return array_values(array_map([self::class, 'out'], array_filter($rows, fn($d) => self::canSee($user, $d['type']))));
    }

    private static function out(array $d): array
    {
        return [
            'id' => (int) $d['id'], 'type' => $d['type'], 'typeLabel' => self::TYPES[$d['type']] ?? $d['type'], 'nom' => $d['nom_fichier'],
            'mime' => $d['mime'], 'taille' => (int) $d['taille'], 'auteur' => $d['auteur'] ?? null, 'date' => $d['created_at'],
            'venteId' => $d['vente_id'] !== null ? (int) $d['vente_id'] : null,
        ];
    }

    public static function upload(array $user, array $file, array $in): array
    {
        Access::require($user, 'documents.gerer');
        if (BO_DEMO) {
            Http::fail(403, 'L\'envoi de fichiers est désactivé dans la démonstration.');
        }
        $type = In::oneOf($in, 'type', array_keys(self::TYPES), null, 'type de document');
        if (!self::canSee($user, $type)) {
            Http::fail(403, 'Ce type de document est réservé au propriétaire.');
        }
        $vid = (int) ($in['vehiculeId'] ?? 0);
        Access::vehicule($user, $vid);
        $venteId = isset($in['venteId']) && $in['venteId'] !== '' ? (int) $in['venteId'] : null;
        if ($venteId !== null && !Db::value('SELECT COUNT(*) FROM la_ventes WHERE id = ? AND vehicule_id = ?', [$venteId, $vid])) {
            Http::fail(422, 'Vente inconnue pour ce véhicule.');
        }
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) {
            Http::fail(422, 'Envoi du fichier impossible (10 Mo maximum).');
        }
        if ($file['size'] > self::MAX) {
            Http::fail(422, 'Fichier trop lourd (10 Mo maximum).');
        }
        $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']) ?: '';
        if (!isset(self::MIMES[$mime])) {
            Http::fail(422, 'Format non accepté : PDF, JPG, PNG ou WebP uniquement.');
        }
        $dir = private_dir('documents/' . date('Y/m'));
        $name = bin2hex(random_bytes(16)) . '.' . self::MIMES[$mime];
        if (!move_uploaded_file($file['tmp_name'], "$dir/$name")) {
            Http::fail(500, 'Enregistrement du document impossible.');
        }
        @chmod("$dir/$name", 0600);
        $original = preg_replace('/[^\pL\pN ._()-]/u', '_', basename((string) $file['name'])) ?: 'document';
        $id = Db::insert('la_documents', [
            'vehicule_id' => $vid, 'client_id' => null, 'vente_id' => $venteId, 'type' => $type,
            'nom_fichier' => mb_substr($original, 0, 200), 'chemin' => date('Y/m') . '/' . $name, 'mime' => $mime,
            'taille' => (int) $file['size'], 'uploaded_by' => $user['id'], 'created_at' => Db::now(),
        ]);
        Audit::log($user, 'document.ajouter', 'vehicule', $vid, null, ['document' => $id, 'type' => $type, 'nom' => $original]);
        return self::out(Db::one('SELECT d.*, a.name AS auteur FROM la_documents d LEFT JOIN la_admins a ON a.id = d.uploaded_by WHERE d.id = ?', [$id]));
    }

    public static function download(array $user, int $id): void
    {
        $d = Db::one('SELECT * FROM la_documents WHERE id = ? AND supprime_le IS NULL', [$id]);
        if (!$d) {
            Http::fail(404, 'Document introuvable.');
        }
        if ($d['vehicule_id'] !== null) {
            Access::vehicule($user, (int) $d['vehicule_id']);
        }
        if (!self::canSee($user, $d['type'])) {
            Http::fail(403, 'Document réservé au propriétaire.');
        }
        $path = private_dir('documents') . '/' . $d['chemin'];
        if (!preg_match('#^\d{4}/\d{2}/[a-f0-9]{32}\.(pdf|jpg|png|webp)$#', $d['chemin'])) {
            Http::fail(404, 'Document introuvable.');
        }
        Http::file($path, $d['nom_fichier'], $d['mime']);
    }

    /** Suppression logique (le fichier est conservé, la ligne masquée, l'action journalisée). */
    public static function remove(array $user, int $id): void
    {
        Access::require($user, 'documents.gerer');
        $d = Db::one('SELECT * FROM la_documents WHERE id = ? AND supprime_le IS NULL', [$id]);
        if (!$d) {
            Http::fail(404, 'Document introuvable.');
        }
        if ($d['vehicule_id'] !== null) {
            Access::vehicule($user, (int) $d['vehicule_id']);
        }
        if (!self::canSee($user, $d['type'])) {
            Http::fail(403, 'Document réservé au propriétaire.');
        }
        Db::exec('UPDATE la_documents SET supprime_le = ? WHERE id = ?', [Db::now(), $id]);
        Audit::log($user, 'document.retirer', 'vehicule', $d['vehicule_id'] !== null ? (int) $d['vehicule_id'] : null, ['document' => $id, 'nom' => $d['nom_fichier']], null);
    }
}
