"use client"

import React, { useEffect, useState, useCallback } from "react"
import { RefreshCw, Play, Clock, CheckCircle2, XCircle, Loader2, Bot, Database, GitMerge, MessageSquare, FileText, ArrowRight, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"

type AgentStatus = "idle" | "running" | "success" | "error"

interface AgentState {
  id: string
  name: string
  description: string
  schedule: string
  status: AgentStatus
  lastRunAt: string | null
  lastRunDuration: number | null
  lastError: string | null
  stats: Record<string, number | string>
}

function statusBadge(status: AgentStatus) {
  switch (status) {
    case "running":
      return (
        <Badge className="gap-1.5 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">
          <Loader2 className="size-3 animate-spin" />
          Running
        </Badge>
      )
    case "success":
      return (
        <Badge className="gap-1.5 bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
          <CheckCircle2 className="size-3" />
          Success
        </Badge>
      )
    case "error":
      return (
        <Badge className="gap-1.5 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20">
          <XCircle className="size-3" />
          Error
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className="gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-muted-foreground/40 inline-block" />
          Idle
        </Badge>
      )
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "—"
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return "Never"
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

const STATUS_COLORS: Record<AgentStatus, { bg: string; border: string; text: string; dot: string }> = {
  idle:    { bg: "bg-muted/30",         border: "border-border",          text: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  running: { bg: "bg-blue-500/8",       border: "border-blue-500/30",     text: "text-blue-500",         dot: "bg-blue-500" },
  success: { bg: "bg-emerald-500/8",    border: "border-emerald-500/30",  text: "text-emerald-500",      dot: "bg-emerald-500" },
  error:   { bg: "bg-red-500/8",        border: "border-red-500/30",      text: "text-red-500",          dot: "bg-red-500" },
}

const AGENT_META: Record<string, { icon: React.ElementType; role: string; feeds: string[] }> = {
  "lemlist-sync":  { icon: Database,     role: "Pulls campaigns & leads from Lemlist",        feeds: ["attribution"] },
  "hubspot-sync":  { icon: Database,     role: "Pulls contacts & deals from HubSpot",          feeds: ["attribution"] },
  "attribution":   { icon: GitMerge,     role: "Matches Lemlist leads to HubSpot deals",       feeds: ["communications", "weekly-report"] },
  "communications":{ icon: MessageSquare,role: "Builds reports & posts to Slack",              feeds: [] },
  "weekly-report": { icon: FileText,     role: "Generates AI insights & delivers to Telegram", feeds: [] },
  "code-review":   { icon: ShieldCheck,  role: "Scans source files for bugs & security issues", feeds: [] },
}

function PipelineNode({ agent, agents }: { agent: AgentState; agents: AgentState[] }) {
  const meta = AGENT_META[agent.id]
  const colors = STATUS_COLORS[agent.status]
  const Icon = meta?.icon ?? Bot

  return (
    <div className={`relative flex flex-col gap-2 rounded-xl border p-4 min-w-[160px] flex-1 ${colors.bg} ${colors.border}`}>
      <div className="flex items-center gap-2">
        <div className={`flex size-8 items-center justify-center rounded-lg border ${colors.border} ${colors.bg}`}>
          <Icon className={`size-4 ${colors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate">{agent.name}</p>
          <div className="flex items-center gap-1 mt-0.5">
            <span className={`size-1.5 rounded-full inline-block ${colors.dot} ${agent.status === "running" ? "animate-pulse" : ""}`} />
            <span className={`text-[10px] capitalize ${colors.text}`}>{agent.status}</span>
          </div>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">{meta?.role}</p>
      <p className="text-[10px] text-muted-foreground/60 border-t border-border pt-1.5 mt-auto">
        {agent.lastRunAt ? formatRelativeTime(agent.lastRunAt) : "Never run"}
      </p>
      {/* Downstream feeds */}
      {meta?.feeds.length > 0 && (
        <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 z-10">
          {meta.feeds.map((feedId) => {
            const target = agents.find((a) => a.id === feedId)
            return target ? (
              <span key={feedId} className="text-[9px] text-muted-foreground/50 bg-background border border-border rounded px-1">
                → {target.name}
              </span>
            ) : null
          })}
        </div>
      )}
    </div>
  )
}

function AgentPipeline({ agents }: { agents: AgentState[] }) {
  if (agents.length === 0) return null

  const sources  = agents.filter((a) => ["lemlist-sync", "hubspot-sync"].includes(a.id))
  const middle   = agents.filter((a) => a.id === "attribution")
  const outputs  = agents.filter((a) => ["communications", "weekly-report", "code-review"].includes(a.id))

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Pipeline</p>
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {/* Sources */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {sources.map((a) => <PipelineNode key={a.id} agent={a} agents={agents} />)}
        </div>

        <ArrowRight className="size-4 text-muted-foreground/40 shrink-0" />

        {/* Attribution */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {middle.map((a) => <PipelineNode key={a.id} agent={a} agents={agents} />)}
        </div>

        <ArrowRight className="size-4 text-muted-foreground/40 shrink-0" />

        {/* Outputs */}
        <div className="flex flex-col gap-2 flex-1 min-w-0">
          {outputs.map((a) => <PipelineNode key={a.id} agent={a} agents={agents} />)}
        </div>
      </div>
    </div>
  )
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentState[]>([])
  const [triggering, setTriggering] = useState<Set<string>>(new Set())
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents")
      const data = await res.json()
      setAgents(data)
      setLastRefreshed(new Date())
    } catch {}
  }, [])

  useEffect(() => {
    fetchAgents()
    const interval = setInterval(fetchAgents, 3000)
    return () => clearInterval(interval)
  }, [fetchAgents])

  async function triggerAgent(id: string) {
    setTriggering((prev) => new Set(prev).add(id))
    try {
      await fetch(`/api/agents/${id}/run`, { method: "POST" })
      await fetchAgents()
    } finally {
      setTriggering((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const anyRunning = agents.some((a) => a.status === "running")

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Monitor and control data sync and analysis agents.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <span className="text-xs text-muted-foreground">
              Refreshed {formatRelativeTime(lastRefreshed.toISOString())}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAgents}
            className="gap-2"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Pipeline Visualization */}
      <AgentPipeline agents={agents} />

      {/* Run All */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex items-center gap-3">
          <Bot className="size-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Run all agents</p>
            <p className="text-xs text-muted-foreground">Trigger a full sync + attribution + report cycle</p>
          </div>
        </div>
        <Button
          size="sm"
          disabled={anyRunning}
          onClick={() => {
            agents.forEach((a) => {
              if (a.status !== "running") triggerAgent(a.id)
            })
          }}
          className="gap-2"
        >
          {anyRunning ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
          {anyRunning ? "Running…" : "Run All"}
        </Button>
      </div>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {agents.map((agent) => (
          <Card key={agent.id} className="p-5 space-y-4">
            {/* Card Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">{agent.name}</p>
                  {statusBadge(agent.status)}
                </div>
                <p className="text-xs text-muted-foreground">{agent.description}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={agent.status === "running" || triggering.has(agent.id)}
                onClick={() => triggerAgent(agent.id)}
                className="shrink-0 gap-1.5"
              >
                {agent.status === "running" || triggering.has(agent.id) ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Play className="size-3.5" />
                )}
                Run
              </Button>
            </div>

            {/* Stats */}
            {Object.keys(agent.stats).length > 0 && (
              <div className="flex flex-wrap gap-3">
                {Object.entries(agent.stats).map(([key, val]) => (
                  <div key={key} className="rounded-lg bg-muted/50 px-3 py-1.5 text-center">
                    <p className="text-sm font-semibold tabular-nums">{val}</p>
                    <p className="text-[11px] text-muted-foreground capitalize">{key.replace(/([A-Z])/g, " $1")}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Error */}
            {agent.status === "error" && agent.lastError && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400 font-mono">
                {agent.lastError}
              </p>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between text-xs text-muted-foreground border-t border-border pt-3">
              <span className="flex items-center gap-1.5">
                <Clock className="size-3" />
                {agent.schedule}
              </span>
              <span>
                Last run: {formatRelativeTime(agent.lastRunAt)}
                {agent.lastRunDuration !== null && (
                  <span className="ml-1.5 text-muted-foreground/70">
                    ({formatDuration(agent.lastRunDuration)})
                  </span>
                )}
              </span>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
