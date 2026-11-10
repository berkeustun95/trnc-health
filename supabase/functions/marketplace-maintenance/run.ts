// One maintenance run, free of remote imports so it is testable offline (index.ts wires Supabase in).
// Order matters: retention first, so a listing purged now has its files swept in the same run.

export const REMOVE_CHUNK = 100

export interface Deps {
  retention(apply: boolean): Promise<{ expired_soft_deleted: number; purged: number; purge_held_by_report: number }>
  orphans(limit: number): Promise<string[]>
  remove(paths: string[]): Promise<void>
  log(code: string): void
}

// The gateway (verify_jwt) has already checked the signature, so the role claim can be read as-is: only the
// service_role key (the cron's Vault secret) carries 'service_role'. Same rule as google-places.
export function jwtRole(jwt: string): string | null {
  try {
    const p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(p + '='.repeat((4 - p.length % 4) % 4)))?.role ?? null
  } catch { return null }
}

export async function run(jwt: string, input: unknown, d: Deps): Promise<{ status: number; body: Record<string, unknown> }> {
  if (jwtRole(jwt) !== 'service_role') return { status: 403, body: { error: 'forbidden' } }
  // Dry unless asked: the nightly job sends {"apply": true}; a hand-run without it only counts.
  const apply = (input as Record<string, unknown> | null)?.apply === true

  let counts
  try { counts = await d.retention(apply) } catch { d.log('retention_failed'); return { status: 500, body: { error: 'RETENTION_FAILED' } } }

  let found: string[] = []
  try { found = await d.orphans(500) } catch { d.log('orphans_failed') }
  let removed = 0, removeFailed = 0
  if (apply) {
    for (let i = 0; i < found.length; i += REMOVE_CHUNK) {
      const chunk = found.slice(i, i + REMOVE_CHUNK)
      try { await d.remove(chunk); removed += chunk.length } catch { removeFailed += chunk.length; d.log('remove_failed') }
    }
  }
  return { status: 200, body: { applied: apply, ...counts, orphans_found: found.length, orphans_removed: removed,
                                orphans_remove_failed: removeFailed } }
}
