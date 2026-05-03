/**
 * Super admin gating — Phase 4
 *
 * La liste des super admins est définie via la variable d'environnement
 * SUPER_ADMIN_EMAILS (séparateur `,`). Ces comptes peuvent :
 *   - approuver / rejeter des WorkspaceMember PENDING
 *   - gérer la whitelist d'emails
 *   - générer / révoquer des codes invitation
 *
 * V1 : check email exact (case-insensitive). V2 : déplacer dans une table
 * `super_admins` si on veut multi-rôles dynamiques.
 */

function parseEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

let cached: Set<string> | null = null;

function getEmails(): Set<string> {
  if (cached) return cached;
  cached = parseEmails(process.env.SUPER_ADMIN_EMAILS);
  return cached;
}

export function isSuperAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getEmails().has(email.toLowerCase());
}

/** Pour les tests / hot reload — vide le cache des emails super admin. */
export function _resetSuperAdminCache(): void {
  cached = null;
}
