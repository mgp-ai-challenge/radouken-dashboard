"use client"

import { useEffect, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { shellFilterChip } from "@/lib/utils"

const DEFAULT_CAMPAIGN_ID = "cam_DFsfaAarRiRXySWPS"
const DEFAULT_CAMPAIGN_NAME = "Q1 Indirect DAU Non-BM publishers >40k US DAU"

type Row = {
  leadId: string
  leadState: string
  contactId: string
  email: string
  firstName: string
  lastName: string
  jobTitle: string
  company: string
  usdau: string
  linkedinUrl: string
  campaigns: string[]
  clicked: boolean
  bdOverlap: boolean
  hubspot: {
    contactId: string
    dealStage: string | null
    dealName: string | null
    hubspotUrl: string | null
  } | null
}

type Campaign = {
  _id: string
  name: string
  status: string
}

const STATE_LABEL: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  emailsBounced: { label: "Bounced", variant: "destructive" },
  emailsReplied: { label: "Replied", variant: "default" },
  emailsClicked: { label: "Clicked", variant: "secondary" },
  emailsOpened: { label: "Opened", variant: "secondary" },
  emailsSent: { label: "Sent", variant: "outline" },
  reviewed: { label: "Not Sent", variant: "outline" },
  emailsUnsubscribed: { label: "Unsubscribed", variant: "destructive" },
}

function stateBadge(state: string) {
  const s = STATE_LABEL[state] ?? { label: state, variant: "outline" as const }
  return <Badge variant={s.variant}>{s.label}</Badge>
}

function dealStageBadge(stage: string | null) {
  if (!stage) return <span className="text-xs text-muted-foreground">No deal</span>
  const isMQL = stage === "Marketing Qualified Lead"
  return (
    <Badge variant={isMQL ? "default" : "secondary"} className={isMQL ? "bg-green-600 hover:bg-green-700" : ""}>
      {stage}
    </Badge>
  )
}

function formatDAU(raw: string) {
  const n = parseInt(raw?.toString().replace(/,/g, "") ?? "")
  if (isNaN(n)) return raw || "—"
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k"
  return n.toString()
}

export default function DashboardPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [selectedId, setSelectedId] = useState(DEFAULT_CAMPAIGN_ID)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [stateFilter, setStateFilter] = useState<string>("all")

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => r.json())
      .then((data: Campaign[]) => setCampaigns(data.filter((c) => c.status !== "draft")))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    setRows([])
    fetch(`/api/campaign-data?campaignId=${selectedId}`)
      .then((r) => r.json())
      .then((data) => setRows(data.rows ?? []))
      .finally(() => setLoading(false))
  }, [selectedId])

  const filtered = stateFilter === "all" ? rows : rows.filter((r) => r.leadState === stateFilter)

  const stats = {
    total: rows.length,
    sent: rows.filter((r) => !["reviewed", "emailsBounced"].includes(r.leadState)).length,
    replied: rows.filter((r) => r.leadState === "emailsReplied").length,
    clicked: rows.filter((r) => r.clicked).length,
    mql: rows.filter((r) => r.hubspot?.dealStage === "Marketing Qualified Lead").length,
    bdOverlap: rows.filter((r) => r.bdOverlap).length,
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium text-foreground">Outbound Attribution</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track campaign contacts, email activity, and HubSpot deal progression.
          </p>
        </div>
        <div className="w-[360px] shrink-0">
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger>
              <SelectValue placeholder="Select campaign" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.length === 0 && (
                <SelectItem value={DEFAULT_CAMPAIGN_ID}>{DEFAULT_CAMPAIGN_NAME}</SelectItem>
              )}
              {campaigns.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-3">
        {[
          { label: "Total Contacts", value: stats.total },
          { label: "Emails Sent", value: stats.sent },
          { label: "Replied", value: stats.replied },
          { label: "Link Clicked", value: stats.clicked },
          { label: "MQL (HubSpot)", value: stats.mql },
          { label: "BD Overlap", value: stats.bdOverlap, warn: stats.bdOverlap > 0 },
        ].map(({ label, value, warn }) => (
          <Card key={label} className="border-border bg-card p-4 text-card-foreground shadow-none">
            <p className="text-xs text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-1 h-8 w-12" />
            ) : (
              <p className={`mt-1 text-2xl font-semibold ${warn ? "text-orange-500 dark:text-orange-400" : "text-foreground"}`}>
                {value}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Filter by status:</span>
        {["all", "emailsReplied", "emailsClicked", "emailsOpened", "emailsSent", "emailsBounced", "reviewed"].map((s) => (
          <button
            type="button"
            key={s}
            onClick={() => setStateFilter(s)}
            className={shellFilterChip(stateFilter === s)}
          >
            {s === "all" ? "All" : STATE_LABEL[s]?.label ?? s}
            {s !== "all" && !loading && (
              <span className="ml-1 opacity-70">
                ({s === "emailsClicked" ? rows.filter((r) => r.clicked).length : rows.filter((r) => r.leadState === s).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="text-xs font-medium text-muted-foreground">Contact</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Company / App</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">US DAU</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Email Status</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">Link Clicked</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">HubSpot Stage</TableHead>
              <TableHead className="text-xs font-medium text-muted-foreground">BD Overlap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading &&
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                  No contacts found.
                </TableCell>
              </TableRow>
            )}
            {!loading &&
              filtered.map((row) => (
                <TableRow key={row.leadId} className="hover:bg-muted/50">
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {row.firstName} {row.lastName}
                      </p>
                      <p className="text-xs text-muted-foreground">{row.jobTitle}</p>
                      <a
                        href={`mailto:${row.email}`}
                        className="text-xs text-primary hover:underline"
                      >
                        {row.email}
                      </a>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-foreground">{row.company || "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {formatDAU(row.usdau)}
                  </TableCell>
                  <TableCell>{stateBadge(row.leadState)}</TableCell>
                  <TableCell>
                    {row.clicked ? (
                      <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100">
                        Clicked
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.hubspot?.hubspotUrl ? (
                      <a href={row.hubspot.hubspotUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col gap-0.5 group">
                        {dealStageBadge(row.hubspot.dealStage)}
                        {row.hubspot.dealName && (
                          <span className="text-xs text-muted-foreground group-hover:underline">{row.hubspot.dealName}</span>
                        )}
                      </a>
                    ) : (
                      dealStageBadge(row.hubspot?.dealStage ?? null)
                    )}
                  </TableCell>
                  <TableCell>
                    {row.bdOverlap ? (
                      <Badge variant="outline" className="border-orange-300 text-orange-600">
                        {row.campaigns.length} campaigns
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
