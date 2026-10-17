<?php
declare(strict_types=1);

/** Comptes nominatifs (propriétaire, secrétaires) et affectation aux parcs — réservé à l'administrateur. */
final class Users
{
    public static function list(): array
    {
        $parcs = [];
        foreach (Db::all('SELECT ap.admin_id, ap.parc_id, p.nom FROM la_admin_parcs ap JOIN la_parcs p ON p.id = ap.parc_id WHERE ap.removed_at IS NULL') as $r) {
            $parcs[(int) $r['admin_id']][] = ['id' => (int) $r['parc_id'], 'nom' => $r['nom']];
        }
        return array_map(fn($a) => [
            'id' => (int) $a['id'], 'email' => $a['email'], 'name' => $a['name'], 'telephone' => $a['telephone'] ?? '',
            'role' => $a['role'], 'roleLabel' => Access::ROLES[$a['role']] ?? $a['role'], 'actif' => (int) $a['actif'] === 1,
            'lastLogin' => $a['last_login_at'], 'parcs' => $parcs[(int) $a['id']] ?? [],
        ], Db::all('SELECT * FROM la_admins ORDER BY actif DESC, role, name, email'));
    }

    /** Liste courte pour les sélecteurs (responsable, secrétaire assignée). */
    public static function options(): array
    {
        return array_map(fn($a) => ['id' => (int) $a['id'], 'nom' => $a['name'] ?: $a['email'], 'role' => $a['role']],
            Db::all('SELECT id, name, email, role FROM la_admins WHERE actif = 1 ORDER BY name, email'));
    }

    public static function save(array $actor, array $in): array
    {
        $id = (int) ($in['id'] ?? 0);
        $role = In::oneOf($in, 'role', array_keys(Access::ROLES), 'secretaire', 'rôle');
        $name = In::str($in, 'name', 120);
        $tel = In::str($in, 'telephone', 40);
        if ($id) {
            $before = Db::one('SELECT id, email, name, role, actif, telephone FROM la_admins WHERE id = ?', [$id]);
            if (!$before) {
                Http::fail(404, 'Compte introuvable.');
            }
            $actif = In::bool($in, 'actif');
            if ($id === (int) $actor['id'] && ($role !== 'admin' || !$actif)) {
                Http::fail(422, 'Vous ne pouvez pas retirer vos propres droits d\'administrateur ni désactiver votre compte.');
            }
            if ($before['role'] === 'admin' && ($role !== 'admin' || !$actif) && (int) Db::value("SELECT COUNT(*) FROM la_admins WHERE role = 'admin' AND actif = 1") <= 1) {
                Http::fail(422, 'Il doit rester au moins un administrateur actif.');
            }
            $data = ['name' => $name, 'role' => $role, 'actif' => $actif, 'telephone' => $tel];
            Db::update('la_admins', $data, $id);
            if (!$actif) {
                Db::exec('DELETE FROM la_sessions WHERE admin_id = ?', [$id]);
            }
            Audit::log($actor, 'utilisateur.modifier', 'utilisateur', $id, $before, $data);
        } else {
            if (BO_DEMO) {
                Http::fail(403, 'La création de comptes est désactivée dans la démonstration.');
            }
            $password = (string) ($in['password'] ?? '');
            $id = Auth::createAdmin((string) ($in['email'] ?? ''), $password, $name, $role);
            Db::update('la_admins', ['telephone' => $tel], $id);
            Audit::log($actor, 'utilisateur.creer', 'utilisateur', $id, null, ['email' => $in['email'] ?? '', 'role' => $role, 'name' => $name]);
        }
        if (isset($in['parcs']) && is_array($in['parcs'])) {
            self::setParcs($actor, $id, array_map('intval', $in['parcs']));
        }
        return array_values(array_filter(self::list(), fn($u) => $u['id'] === $id))[0];
    }

    /** Remplace les affectations d'un compte (historique conservé : removed_at + journal). */
    public static function setParcs(array $actor, int $adminId, array $parcIds): void
    {
        $parcIds = array_values(array_unique(array_filter($parcIds)));
        foreach ($parcIds as $pid) {
            if (!Db::value('SELECT COUNT(*) FROM la_parcs WHERE id = ?', [$pid])) {
                Http::fail(422, 'Parc inconnu.');
            }
        }
        $current = array_map('intval', array_column(Db::all('SELECT parc_id FROM la_admin_parcs WHERE admin_id = ? AND removed_at IS NULL', [$adminId]), 'parc_id'));
        $now = Db::now();
        foreach (array_diff($parcIds, $current) as $pid) {
            if (Db::value('SELECT COUNT(*) FROM la_admin_parcs WHERE admin_id = ? AND parc_id = ?', [$adminId, $pid])) {
                Db::exec('UPDATE la_admin_parcs SET removed_at = NULL, assigned_at = ? WHERE admin_id = ? AND parc_id = ?', [$now, $adminId, $pid]);
            } else {
                Db::insert('la_admin_parcs', ['admin_id' => $adminId, 'parc_id' => $pid, 'role' => '', 'assigned_at' => $now, 'removed_at' => null]);
            }
            Audit::log($actor, 'parc.affecter', 'utilisateur', $adminId, null, ['parc_id' => $pid]);
        }
        foreach (array_diff($current, $parcIds) as $pid) {
            Db::exec('UPDATE la_admin_parcs SET removed_at = ? WHERE admin_id = ? AND parc_id = ? AND removed_at IS NULL', [$now, $adminId, $pid]);
            Audit::log($actor, 'parc.retirer', 'utilisateur', $adminId, ['parc_id' => $pid], null);
        }
    }

    /** Nouveau mot de passe temporaire défini par l'administrateur (sessions du compte fermées). */
    public static function resetPassword(array $actor, int $id, string $password): void
    {
        if (BO_DEMO) {
            Http::fail(403, 'Désactivé dans la démonstration.');
        }
        if (!Db::value('SELECT COUNT(*) FROM la_admins WHERE id = ?', [$id])) {
            Http::fail(404, 'Compte introuvable.');
        }
        Auth::validatePassword($password);
        Db::update('la_admins', ['password_hash' => Auth::hash($password)], $id);
        Db::exec('DELETE FROM la_sessions WHERE admin_id = ?', [$id]);
        Audit::log($actor, 'utilisateur.mot_de_passe', 'utilisateur', $id);
    }
}
