# G2 Weekly Report — ICP Fit Hot Count — Design

## Goal

Add a "Hot companies" count to the G2 weekly report — a single KPI showing how many qualified intent companies this week scored in the Hot fit tier. Surfaced in the Telegram message header and in the dashboard panel KPI chips.

## Architecture

Two files touched, nothing new created. No new env vars.

| File | Change |
|------|--------|
| `lib/g2-weekly-report.ts` | Add `fitScore()` helper; compute `hotCount` from `thisWeek`; add to `kpis` |
| `components/g2-dashboard.tsx` | Add `hotCount` KPI chip to Weekly Intent Report panel |

---

## Scoring

### `fitScore(co: IntentCompany): number`

Pure function defined in `lib/g2-weekly-report.ts`. Mirrors the `computeFit` logic from the dashboard but without the `hasApp` signal (SensorTower enrichment is not fetched in the weekly report context). Maximum score: 90.

| Signal | Points |
|--------|--------|
| activityLevel === "high" | 40 |
| activityLevel === "medium" | 25 |
| activityLevel === "low" | 10 |
| buyingStage === "decision" | 25 |
| buyingStage === "consideration" | 15 |
| buyingStage === "awareness" | 5 |
| lifecycleStage === "opportunity" | 20 |
| lifecycleStage === "salesqualifiedlead" | 15 |
| lifecycleStage === "marketingqualifiedlead" | 10 |
| lifecycleStage ∈ { "lead", "subscriber" } | 5 |
| relatedProducts.length > 0 OR productName set | 5 |

Hot tier: score ≥ 76.

`hotCount` = count of `thisWeek` (qualified) companies where `fitScore(co) >= 76`.

---

## Data Changes

### `G2WeeklyReport.kpis`

Add one field:

```typescript
hotCount: number
```

Full updated shape:

```typescript
kpis: {
  qualifiedThisWeek: number
  qualifiedLastWeek: number
  newThisWeek: number
  escalatedCount: number
  hotCount: number
}
```

---

## Telegram Message

Updated `formatTelegramMessage` — append hot count to the second line:

```
📊 *G2 Intent Report — W24 · Jun 9–15 2026*

Qualified signals: 14 this week (was 11, +3)
New companies: 4 | Escalations: 2 | 🔥 Hot: 3

[Claude insights]
```

---

## Dashboard Panel

The Weekly Intent Report panel currently shows 3 KPI chips (Qualified this week, New this week, Escalations). A fourth chip is added:

- Label: `🔥 Hot`
- Value: `report.kpis.hotCount`
- Color: accent (`#05c79b`) — consistent with Hot tier color used in the intent table

The chip only renders if `report.kpis.hotCount !== undefined` — backwards compatible with cached reports that predate this change.

---

## Error Handling

- `fitScore` is a pure function with no I/O — cannot fail.
- Cached `.g2-weekly-report.json` files written before this change will have `hotCount: undefined`. The dashboard chip guard (`hotCount !== undefined`) handles this silently.

## Dependencies

No new env vars. No new routes. Uses existing `HUBSPOT_ACCESS_TOKEN`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
