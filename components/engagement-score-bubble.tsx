"use client"

import {
  ENGAGEMENT_POINTS,
  engagementBubbleColors,
} from "@/lib/engagement-score"

type Props = {
  score: number
  opens: number
  clicks: number
  replies: number
}

export function EngagementScoreBubble({ score, opens, clicks, replies }: Props) {
  const { background, color, border } = engagementBubbleColors(score)
  const label = [
    `Score ${score}`,
    `Open +${ENGAGEMENT_POINTS.open} · Click +${ENGAGEMENT_POINTS.click} · Reply +${ENGAGEMENT_POINTS.reply}`,
    `This row: ${opens} opens · ${clicks} clicks · ${replies} replies`,
  ].join("\n")

  return (
    <div className="flex flex-col items-end gap-1">
      <span
        title={label}
        className="inline-flex min-w-[2.75rem] items-center justify-center rounded-full border px-2.5 py-1 text-sm font-semibold tabular-nums shadow-sm"
        style={{ backgroundColor: background, color, borderColor: border }}
      >
        {score.toLocaleString()}
      </span>
      <span className="text-[10px] text-muted-foreground tabular-nums" aria-hidden>
        O{opens} · C{clicks} · R{replies}
      </span>
    </div>
  )
}
