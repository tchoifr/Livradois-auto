<?php
declare(strict_types=1);

/**
 * Rôles, permissions et périmètre de parcs, vérifiés côté serveur à chaque requête.
 * - admin (propriétaire) : tout, tous les parcs.
 * - referent (secrétaire référente) : droits secrétaire + gestion des annonces et transferts dans ses parcs.
 * - secretaire : rendez-vous, clients, préparation, documents, messages ; uniquement ses parcs.
 * Prix d'achat, dépenses, ventes, marges et rapports : propriétaire uniquement (décision par défaut de la spécification).
 */
final class Access
{
    public const ROLES = [
        'admin' => 'Propriétaire / administrateur',
        'referent' => 'Secrétaire référente',
        'secretaire' => 'Secrétaire',
    ];

    private const PERMS = [
        'referent' => [
            'vehicules.voir', 'vehicules.modifier', 'vehicules.statut', 'vehicules.transferer', 'vehicules.preparer',
            'photos.gerer', 'documents.gerer', 'rdv.gerer', 'clients.gerer', 'messages.envoyer', 'demandes.gerer',
        ],
        'secretaire' => [
            'vehicules.voir', 'vehicules.preparer', 'documents.gerer', 'rdv.gerer', 'clients.gerer',
            'messages.envoyer', 'demandes.gerer',
        ],
    ];

    public static function can(array $user, string $perm): bool
    {
        if (($user['role'] ?? '') === 'admin') {
            return true;
        }
        return in_array($perm, self::PERMS[$user['role'] ?? ''] ?? [], true);
    }

    public static function require(array $user, string $perm): void
    {
        if (!self::can($user, $perm)) {
            Http::fail(403, 'Action non autorisée pour votre profil.');
        }
    }

    public static function permissions(array $user): array
    {
        if (($user['role'] ?? '') === 'admin') {
            return ['*'];
        }
        return self::PERMS[$user['role'] ?? ''] ?? [];
    }

    /** Parcs accessibles : null = tous (administrateur). */
    public static function parcIds(array $user): ?array
    {
        if (($user['role'] ?? '') === 'admin') {
            return null;
        }
        static $cache = [];
        if (!isset($cache[$user['id']])) {
            $cache[$user['id']] = array_map('intval', array_column(Db::all(
                'SELECT ap.parc_id FROM la_admin_parcs ap JOIN la_parcs p ON p.id = ap.parc_id WHERE ap.admin_id = ? AND ap.removed_at IS NULL AND p.actif = 1',
                [(int) $user['id']]
            ), 'parc_id'));
        }
        return $cache[$user['id']];
    }

    public static function canParc(array $user, ?int $parcId): bool
    {
        $ids = self::parcIds($user);
        if ($ids === null) {
            return true;
        }
        return $parcId !== null && in_array($parcId, $ids, true);
    }

    public static function requireParc(array $user, ?int $parcId): void
    {
        if (!self::canParc($user, $parcId)) {
            Http::fail(403, 'Ce parc ne fait pas partie de votre périmètre.');
        }
    }

    /** Charge un véhicule et vérifie qu'il est dans le périmètre de l'utilisateur. */
    public static function vehicule(array $user, int $id): array
    {
        $v = Db::one('SELECT * FROM la_vehicules WHERE id = ?', [$id]);
        if (!$v) {
            Http::fail(404, 'Véhicule introuvable.');
        }
        self::requireParc($user, $v['parc_id'] !== null ? (int) $v['parc_id'] : null);
        return $v;
    }

    /**
     * Fragment SQL limitant une colonne parc_id au périmètre : [" AND col IN (?,?)", [ids]].
     * $nullable : les lignes sans parc restent visibles (ex. demande générale sans véhicule).
     */
    public static function scope(array $user, string $column, bool $nullable = false): array
    {
        $ids = self::parcIds($user);
        if ($ids === null) {
            return ['', []];
        }
        if (!$ids) {
            return [$nullable ? " AND $column IS NULL" : ' AND 1 = 0', []];
        }
        $sql = " AND ($column IN (" . Db::in($ids) . ')' . ($nullable ? " OR $column IS NULL" : '') . ')';
        return [$sql, $ids];
    }
}
