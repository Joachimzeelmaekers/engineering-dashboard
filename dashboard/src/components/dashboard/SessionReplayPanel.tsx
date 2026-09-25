import { useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { NormalizedMessage, SessionTranscriptTurn } from "@/lib/types"
import type { SessionRow } from "@/lib/data"
import { fmtCompact, fmtCost, fmtDateTime, fmtNum, parseModelKey, PROVIDER_COLORS } from "@/lib/constants"
import { StatCard } from "@/components/dashboard/DashboardControls"
import { VirtualizedStack } from "@/components/dashboard/DashboardTables"

type ConversationRole = "assistant" | "user" | "system"
type ConversationTurn = SessionTranscriptTurn & {
  role: ConversationRole
  order: number
  matchedMessage: NormalizedMessage | undefined
}

type SessionTimelineEntry = NormalizedMessage & {
  turnNumber: number
  gapMs: number
  turnTokens: number
}

function fmtGap(ms: number) {
  if (!ms) return "Session start"

  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m later`

  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(hours >= 10 ? 0 : 1)}h later`

  const days = hours / 24
  return `${days.toFixed(days >= 10 ? 0 : 1)}d later`
}

function fmtElapsed(ms: number) {
  if (!ms) return "0m"

  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`

  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`

  const days = hours / 24
  return `${days.toFixed(days >= 10 ? 0 : 1)}d`
}

function getConversationRole(role: string): ConversationRole {
  if (role === "assistant" || role === "user") return role
  return "system"
}
function getConversationRoleStyles(role: ConversationRole) {
  if (role === "user") {
    return {
      label: "User",
      marker: "bg-primary text-primary-foreground",
      card: "border-primary/30 bg-primary/5",
      accent: "bg-primary",
    }
  }

  if (role === "assistant") {
    return {
      label: "Assistant",
      marker: "bg-foreground text-background",
      card: "border-border bg-card",
      accent: "bg-foreground",
    }
  }

  return {
    label: "System",
    marker: "bg-muted-foreground text-background",
    card: "border-border bg-muted/40",
    accent: "bg-muted-foreground",
  }
}
function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/45 px-2.5 py-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="ml-2 font-mono text-xs text-foreground">{value}</span>
    </div>
  )
}

function ConversationTurnCard({
  turn,
  previousTimestamp,
  provider,
}: {
  turn: ConversationTurn
  previousTimestamp?: number
  provider: string
}) {
  const roleStyles = getConversationRoleStyles(turn.role)
  const gapMs = previousTimestamp && turn.timestamp_ms ? turn.timestamp_ms - previousTimestamp : 0
  const matchedMessage = turn.matchedMessage
  const modelName = turn.model ? parseModelKey(turn.model.includes("[") ? turn.model : `${turn.model} [${provider}]`).name : null

  return (
    <div className="relative pl-10">
      <div className="absolute left-[15px] top-9 bottom-[-18px] w-px bg-border" />
      <div className={`absolute left-0 top-3 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold shadow-sm ${roleStyles.marker}`}>
        {turn.order}
      </div>
      <div className={`overflow-hidden rounded-xl border shadow-sm ${roleStyles.card}`}>
        <div className={`h-1 ${roleStyles.accent}`} />
        <div className="px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="text-sm font-semibold text-foreground">{roleStyles.label}</span>
              {modelName ? <Badge variant="outline">{modelName}</Badge> : null}
              <span>{fmtDateTime(turn.timestamp_ms)}</span>
              {gapMs > 0 ? <span>{fmtGap(gapMs)}</span> : null}
            </div>
            {matchedMessage ? (
              <div className="font-mono text-xs text-muted-foreground">
                {fmtCompact(matchedMessage.input + matchedMessage.output)} tokens
              </div>
            ) : null}
          </div>

          <pre className="mt-3 max-w-none whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">{turn.text}</pre>

          {matchedMessage ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <MetricPill label="Input" value={fmtNum(matchedMessage.input)} />
              <MetricPill label="Output" value={fmtNum(matchedMessage.output)} />
              <MetricPill label="Reasoning" value={fmtNum(matchedMessage.reasoning)} />
              <MetricPill label="Cache" value={fmtNum(matchedMessage.cache_read)} />
              <MetricPill label="Cost" value={fmtCost(matchedMessage.cost_logged)} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function SessionTimelineCard({ message }: { message: SessionTimelineEntry }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium">Turn {message.turnNumber}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline" style={{ color: PROVIDER_COLORS[message.provider] || "#a39e90" }}>
              {parseModelKey(message.modelKey).name}
            </Badge>
            <span>{fmtDateTime(message.timestamp_ms)}</span>
            <span>{fmtGap(message.gapMs)}</span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm">{fmtCompact(message.turnTokens)}</p>
          <p className="text-xs text-muted-foreground">turn tokens</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Input</div>
          <div className="font-mono text-sm">{fmtNum(message.input)}</div>
        </div>
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Output</div>
          <div className="font-mono text-sm">{fmtNum(message.output)}</div>
        </div>
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Reasoning</div>
          <div className="font-mono text-sm">{fmtNum(message.reasoning)}</div>
        </div>
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Cache Read</div>
          <div className="font-mono text-sm">{fmtNum(message.cache_read)}</div>
        </div>
        <div className="rounded-md bg-muted/40 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Logged Cost</div>
          <div className="font-mono text-sm">{fmtCost(message.cost_logged)}</div>
        </div>
      </div>
    </div>
  )
}

export function SessionReplayPanel({
  row,
  messages,
  transcriptTurns,
  open,
  onClose,
}: {
  row?: SessionRow
  messages: NormalizedMessage[]
  transcriptTurns: SessionTranscriptTurn[]
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onClose])

  if (!open || !row) return null

  const modelSummary = Object.values(
    messages.reduce<Record<string, { model: string; count: number; input: number; output: number; total: number }>>((acc, message) => {
      const model = parseModelKey(message.modelKey).name
      if (!acc[message.modelKey]) {
        acc[message.modelKey] = { model, count: 0, input: 0, output: 0, total: 0 }
      }

      acc[message.modelKey].count += 1
      acc[message.modelKey].input += message.input
      acc[message.modelKey].output += message.output
      acc[message.modelKey].total += message.input + message.output
      return acc
    }, {})
  ).sort((a, b) => b.total - a.total)

  const timeline = messages.map((message, index) => {
    const previous = messages[index - 1]
    const turnTokens = message.input + message.output
    return {
      ...message,
      turnNumber: index + 1,
      gapMs: previous?.timestamp_ms && message.timestamp_ms ? message.timestamp_ms - previous.timestamp_ms : 0,
      turnTokens,
    }
  })

  const conversation: ConversationTurn[] = (() => {
    if (!transcriptTurns.length) return []

    let assistantMessageIndex = 0
    return transcriptTurns
      .slice()
      .sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0))
      .map((turn, index) => {
        const normalizedRole = getConversationRole(turn.role)
        const matchedMessage = normalizedRole === "assistant" ? messages[assistantMessageIndex++] : undefined
        return {
          ...turn,
          role: normalizedRole,
          order: index + 1,
          matchedMessage,
        }
      })
  })()
  const conversationCounts = conversation.reduce<Record<ConversationRole, number>>(
    (acc, turn) => {
      acc[turn.role] += 1
      return acc
    },
    { assistant: 0, user: 0, system: 0 }
  )
  const shouldVirtualizeConversation = conversation.length > 24
  const shouldVirtualizeTimeline = timeline.length > 40

  return (
    <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div
        className="absolute inset-y-0 right-0 h-full w-full max-w-5xl overflow-y-auto border-l border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session replay</p>
              <h3 className="mt-1 truncate font-mono text-sm font-bold md:text-base">{row.provider}:{row.session_id}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{row.project || "unknown project"}</p>
            </div>
            <Button className="shrink-0" variant="outline" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Messages" value={fmtCompact(row.messages)} sub={fmtNum(row.messages) + " assistant turns"} />
            <StatCard label="Models" value={fmtCompact(row.model_count)} sub="distinct models" />
            <StatCard label="Tokens" value={fmtCompact(row.total)} sub={fmtNum(row.total) + " total"} color="#d97757" />
            <StatCard label="Duration" value={fmtElapsed(Math.max(0, row.end_ms - row.start_ms))} sub={fmtDateTime(row.end_ms)} color="#4f7f78" />
          </div>

          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {conversation.length
              ? `Showing ${fmtNum(conversation.length)} transcript turns: ${fmtNum(conversationCounts.user)} user, ${fmtNum(conversationCounts.assistant)} assistant, ${fmtNum(conversationCounts.system)} system.`
              : "Only token metadata is available for this session, so the detail view falls back to the assistant-turn timeline."}
          </div>

          <Card>
            <CardHeader><CardTitle>Models used in this session</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {modelSummary.map((model) => (
                <div key={model.model} className="rounded-lg border border-border bg-card px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{model.model}</p>
                      <p className="text-xs text-muted-foreground">{fmtNum(model.count)} turns</p>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-mono">{fmtCompact(model.total)}</p>
                      <p className="text-xs text-muted-foreground">{fmtNum(model.total)} tokens</p>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {conversation.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Conversation replay</CardTitle>
                <p className="text-sm text-muted-foreground">Full transcript, grouped as a readable turn-by-turn timeline.</p>
              </CardHeader>
              <CardContent>
                {shouldVirtualizeConversation ? (
                  <VirtualizedStack
                    items={conversation}
                    getKey={(turn, index) => `${turn.role}:${turn.order}:${turn.timestamp_ms}:${index}`}
                    estimateHeight={(turn) => 110 + Math.min(1400, Math.ceil(turn.text.length / 100) * 24) + (turn.matchedMessage ? 64 : 0)}
                    maxHeightClassName="max-h-[76vh]"
                    rowGap={18}
                    renderItem={(turn, index) => (
                      <ConversationTurnCard
                        turn={turn}
                        previousTimestamp={conversation[index - 1]?.timestamp_ms}
                        provider={row.provider}
                      />
                    )}
                  />
                ) : (
                  <div className="space-y-5">
                    {conversation.map((turn, index) => (
                      <ConversationTurnCard
                        key={`${turn.role}:${turn.order}:${turn.timestamp_ms}:${index}`}
                        turn={turn}
                        previousTimestamp={conversation[index - 1]?.timestamp_ms}
                        provider={row.provider}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader><CardTitle>{conversation.length > 0 ? "Assistant turn metrics" : "Turn-by-turn timeline"}</CardTitle></CardHeader>
            <CardContent>
              {shouldVirtualizeTimeline ? (
                <VirtualizedStack
                  items={timeline}
                  getKey={(message) => `${message.session_id}:${message.turnNumber}:${message.timestamp_ms}`}
                  estimateHeight={() => 190}
                  maxHeightClassName="max-h-[55vh]"
                  renderItem={(message) => <SessionTimelineCard message={message} />}
                />
              ) : (
                <div className="space-y-3">
                  {timeline.map((message) => (
                    <SessionTimelineCard
                      key={`${message.session_id}:${message.turnNumber}:${message.timestamp_ms}`}
                      message={message}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
