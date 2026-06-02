// G2 Data API client — https://data.g2.com/api/v1/

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

async function g2Fetch(path: string): Promise<unknown> {
  const token = process.env.G2_API_TOKEN
  if (!token) throw new Error("G2_API_TOKEN environment variable is not set")
  const res = await fetch(`${G2_BASE}${path}`, {
    headers: { Authorization: `Token token=${token}` },
    cache: "no-store",
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`G2 API ${path} → ${res.status} ${res.statusText}${body ? `: ${body.slice(0, 200)}` : ""}`)
  }
  return res.json()
}

// ─── Product discovery ────────────────────────────────────────────────────────

const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
let _productCache: { product: G2Product; fetchedAt: number } | null = null

export async function getG2Product(): Promise<G2Product> {
  const now = Date.now()
  if (_productCache && now - _productCache.fetchedAt < PRODUCT_CACHE_TTL_MS) {
    return _productCache.product
  }
  const slug = process.env.G2_PRODUCT_SLUG
  if (!slug) throw new Error("G2_PRODUCT_SLUG environment variable is not set")
  const qs = `?filter[slug]=${encodeURIComponent(slug)}`
  const data = await g2Fetch(`/products${qs}`) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  if (!Array.isArray(data.data) || data.data.length === 0) {
    throw new Error("G2: no product found")
  }
  const item = data.data[0]
  const product: G2Product = {
    id: item.id,
    name: String(item.attributes.name ?? ""),
    starRating: Number(item.attributes.star_rating ?? 0),
    reviewsCount: Number(item.attributes.review_count ?? 0),
  }
  _productCache = { product, fetchedAt: now }
  return product
}

// ─── Reviews ──────────────────────────────────────────────────────────────────

export async function getG2Reviews(productId: string): Promise<G2Review[]> {
  const data = await g2Fetch(
    `/products/${encodeURIComponent(productId)}/survey-responses?page[size]=10&sort=-submitted_at`
  ) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
  return (data.data ?? []).map((item) => {
    const attrs = item.attributes
    const commentAnswers = attrs.comment_answers as Record<string, { value?: string }> | null
    const body = commentAnswers?.love?.value ?? String(attrs.body ?? "")
    return {
      id: item.id,
      title: String(attrs.title ?? ""),
      rating: Number(attrs.star_rating ?? 0),
      reviewerRole: String(attrs.user_name ?? ""),
      companySize: String(attrs.country_name ?? ""),
      body,
      createdAt: String(attrs.submitted_at ?? ""),
    }
  })
}

// ─── Profile views ────────────────────────────────────────────────────────────

export async function getG2ProfileViews(productId: string): Promise<G2ProfileView[]> {
  try {
    const data = await g2Fetch(
      `/profile_views?filter[product_id]=${encodeURIComponent(productId)}&filter[period]=weekly`
    ) as { data: Array<{ id: string; attributes: Record<string, unknown> }> }
    return (data.data ?? []).map((item) => ({
      week: String(item.attributes.period_start ?? item.attributes.date ?? ""),
      views: Number(item.attributes.views ?? item.attributes.count ?? 0),
    }))
  } catch {
    return []
  }
}

// ─── Category ranking ─────────────────────────────────────────────────────────

export async function getG2Rank(productId: string): Promise<G2Rank | null> {
  try {
    const data = await g2Fetch(`/products/${encodeURIComponent(productId)}/product-rating`) as {
      data: { id: string; attributes: Record<string, unknown> }
    }
    const attrs = data.data?.attributes ?? {}
    return {
      category: String(attrs.category_name ?? ""),
      rank: 0,
      rankChange: 0,
    }
  } catch {
    return null
  }
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

export async function getG2Campaigns(productId: string): Promise<G2Campaign[]> {
  try {
    const data = await g2Fetch(`/campaigns?filter[product_id]=${encodeURIComponent(productId)}`) as {
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
