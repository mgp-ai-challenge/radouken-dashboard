# Paid Search Attribution Fix — Design Spec
**Date:** 2026-07-22
**Project:** radouken-dashboard (outbound-attribution)
**Status:** Approved — ready for implementation planning

---

## Problem

The "Last Touch Source" panels on the self-serve dashboard (`/self-serve`) under-report Paid Search deals. When a publisher first arrives via Google Ads (`hs_analytics_source = "PAID_SEARCH"`) but later returns organically, the last-touch field (`hs_analytics_last_source`) gets overwritten to "ORGANIC_SEARCH". The current priority chain always picks last_source first, so Paid Search attribution is lost.

Confirmed impact: ~11 deals totalling ~1.3M norm DAU are currently attributed to Organic Search or Direct instead of Paid Search.

Known affected deals (across self-serve pipeline 52357803 and indirect pipeline 961280):
- **Self-serve approved:** Famobi, Bilge Bulut, XTEN Limited (~21,770 norm DAU)
- **Self-serve waitlist:** Turborilla AB, Dcard Taiwan, Dragunov (~86,951 norm DAU)
- **Indirect/supply pipeline:** Duke/Grus Studio, Cranberry Apps, GOBLINGAMES/Glowmind, ZigZaGame Inc., Muzz LTD (~1,215,984 norm DAU)

---

## Decision

**Paid Search wins if it appears in ANY source field.** If `hs_analytics_source`, `hs_analytics_last_source`, or `hs_latest_source` equals `"PAID_SEARCH"` for a contact, that contact is attributed to Paid Search — regardless of what the other fields say.

For all other sources, the existing priority chain remains unchanged: `hs_analytics_last_source → hs_latest_source → hs_analytics_source`, skipping OFFLINE.

This is a targeted fix. Organic Search, Email, Direct, and all other source counts are unaffected unless a contact also has a PAID_SEARCH value in one of their source fields.

---

## Changes

### File modified: `app/api/self-serve/contact-sources/route.ts`

**Function:** `getContactSources` (lines ~85–93)

Old logic (picks first non-OFFLINE in priority order):
```typescript
const candidates = [p.hs_analytics_last_source, p.hs_latest_source, p.hs_analytics_source]
const src = candidates.find((s) => s && s !== "OFFLINE") ?? "UNKNOWN"
map.set(c.id, src)
```

New logic (Paid Search wins if present in any field, otherwise existing priority chain):
```typescript
const allSources = [p.hs_analytics_source, p.hs_analytics_last_source, p.hs_latest_source]
if (allSources.some((s) => s === "PAID_SEARCH")) {
  map.set(c.id, "PAID_SEARCH")
  continue
}
const candidates = [p.hs_analytics_last_source, p.hs_latest_source, p.hs_analytics_source]
const src = candidates.find((s) => s && s !== "OFFLINE") ?? "UNKNOWN"
map.set(c.id, src)
```

**No other changes.**

- Deal fetch logic: unchanged
- Aggregation and QoQ logic: unchanged
- Pipeline coverage (52357803 + 961280 + 145970019): unchanged
- UI (`components/self-serve-dashboard.tsx`): unchanged

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Contact has `hs_analytics_source = "PAID_SEARCH"` and `hs_analytics_last_source = "ORGANIC_SEARCH"` | Attributed to Paid Search (was: Organic Search) |
| Contact has `hs_analytics_last_source = "PAID_SEARCH"` (returned via paid ad) | Attributed to Paid Search (unchanged — already working) |
| Contact has no PAID_SEARCH in any field | Attribution unchanged — priority chain applies as before |
| Contact is OFFLINE across all fields | Attributed to UNKNOWN (unchanged) |

---

## Out of Scope

- Applying similar first-touch-wins logic to other sources (Email, Referral, etc.)
- Deduplication by company name (not needed — deals already deduplicated at the HubSpot pipeline level)
- Backfilling historical QoQ data for previously miscounted deals
- Modifying pipeline stage breakdown or KPI routes
