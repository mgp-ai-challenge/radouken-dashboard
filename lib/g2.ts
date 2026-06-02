// lib/g2.ts

export interface G2Review {
  id: string
  title: string
  rating: number          // 1–5
  reviewerRole: string
  companySize: string
  body: string            // "What do you like best?" excerpt
  createdAt: string       // ISO date
}

export interface G2Product {
  id: string
  name: string
  starRating: number      // e.g. 4.7
  reviewsCount: number
}

export interface G2ProfileView {
  week: string            // ISO date of week start
  views: number
}

export interface G2Rank {
  category: string
  rank: number
  rankChange: number      // positive = rank number decreased = improved; negative = dropped
}

export interface G2Campaign {
  id: string
  name: string
  impressions: number
  clicks: number
  ctr: number             // percentage
  spend: number           // USD
  status: "active" | "paused" | "ended"
}

export interface G2IntentCompany {
  id: string
  name: string
  domain: string
  intentScore: number | null
  lastSignalAt: string    // ISO date
}

const G2_BASE = "https://data.g2.com/api/v1"
const G2_TOKEN = process.env.G2_API_TOKEN!

async function g2Fetch(path: string): Promise<unknown> {
  const res = await fetch(`${G2_BASE}${path}`, {
    headers: { Authorization: `Token token=${G2_TOKEN}` },
    cache: "no-store",
  })
  if (!res.ok) {
    throw new Error(`G2 API ${path} → ${res.status} ${res.statusText}`)
  }
  return res.json()
}

// ─── Product discovery ────────────────────────────────────────────────────────

let _cachedProduct: G2Product | null = null

export async function getG2Product(): Promise<G2Product> {
  if (_cachedProduct) return _cachedProduct
  const slug = process.env.G2_PRODUCT_SLUG ?? ""
  const qs = slug ? `?filter[slug]=${encodeURIComponent(slug)}` : ""
  const data = await g2Fetch(`/products${qs}`) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  const item = data.data[0]
  if (!item) throw new Error("G2: no product found")
  _cachedProduct = {
    id: item.id,
    name: String(item.attributes.name ?? ""),
    starRating: Number(item.attributes.star_rating ?? 0),
    reviewsCount: Number(item.attributes.reviews_count ?? 0),
  }
  return _cachedProduct
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

export async function getG2Reviews(productId: string): Promise<G2Review[]> {
  const data = await g2Fetch(
    `/reviews?filter[product_id]=${productId}&page[size]=10&sort=-created_at`
  ) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  return (data.data ?? []).map((item) => ({
    id: item.id,
    title: String(item.attributes.title ?? ""),
    rating: Number(item.attributes.star_rating ?? 0),
    reviewerRole: String(item.attributes.reviewer_job_title ?? item.attributes.submitter_title ?? ""),
    companySize: String(item.attributes.company_size ?? ""),
    body: String(item.attributes.love ?? item.attributes.body ?? ""),
    createdAt: String(item.attributes.created_at ?? ""),
  }))
}

// ─── Profile views ────────────────────────────────────────────────────────────

export async function getG2ProfileViews(productId: string): Promise<G2ProfileView[]> {
  const data = await g2Fetch(
    `/profile_views?filter[product_id]=${productId}&filter[period]=weekly`
  ) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  return (data.data ?? []).map((item) => ({
    week: String(item.attributes.period_start ?? item.attributes.date ?? ""),
    views: Number(item.attributes.views ?? item.attributes.count ?? 0),
  }))
}

// ─── Category ranking ─────────────────────────────────────────────────────────

export async function getG2Rank(productId: string): Promise<G2Rank | null> {
  try {
    const data = await g2Fetch(`/products/${productId}/ranking`) as {
      data: { id: string; attributes: Record<string, unknown> }
    }
    const attrs = data.data?.attributes ?? {}
    return {
      category: String(attrs.category_name ?? attrs.category ?? ""),
      rank: Number(attrs.rank ?? 0),
      rankChange: Number(attrs.rank_change ?? 0),
    }
  } catch {
    return null
  }
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export async function getG2Campaigns(productId: string): Promise<G2Campaign[]> {
  try {
    const data = await g2Fetch(`/campaigns?filter[product_id]=${productId}`) as {
      data: Array<{ id: string; attributes: Record<string, unknown> }>
    }
    return (data.data ?? []).map((item) => {
      const attrs = item.attributes
      return {
        id: item.id,
        name: String(attrs.name ?? ""),
        impressions: Number(attrs.impressions ?? 0),
        clicks: Number(attrs.clicks ?? 0),
        ctr: Number(attrs.ctr ?? attrs.click_through_rate ?? 0),
        spend: Number(attrs.spend ?? attrs.total_spend ?? 0),
        status: (["active", "paused", "ended"].includes(String(attrs.status))
          ? String(attrs.status)
          : "ended") as G2Campaign["status"],
      }
    })
  } catch {
    return []
  }
}
