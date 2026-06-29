/**
 * How we resolve "company" from Lemlist:
 * - `companyName` — standard Lemlist field for the organization (prefer this).
 * - `leadCompanyName` — sometimes present on activity payloads.
 * - `gameName` — often a custom variable (app / game title); use as fallback only.
 */

export function companyFromLemlistActivity(a: Record<string, unknown>): string {
  const o = a as Record<string, string | undefined>
  const pick = (v: string | undefined) => (v != null && String(v).trim() !== "" ? String(v).trim() : "")
  return pick(o.companyName) || pick(o.leadCompanyName) || pick(o.gameName) || ""
}

/** GET /contacts/:id — `fields` object */
export function companyFromLemlistContactFields(
  fields: Record<string, unknown> | undefined,
): string {
  if (!fields) return ""
  const pick = (v: unknown) => (v != null && String(v).trim() !== "" ? String(v).trim() : "")
  return pick(fields.companyName) || pick(fields.gameName) || pick(fields.companyDomain) || ""
}
