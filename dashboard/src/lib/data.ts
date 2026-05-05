import type { DashboardData, NormalizedMessage, RawMessage, ModelStats } from "./types"
import { CHART_COLORS, PROVIDER_COLORS } from "./constants"

export function normalizeMessages(raw: RawMessage[]): NormalizedMessage[] {
  return raw.map((m) => {
    const provider = m.provider || "unknown"
    return {
      provider,
      model: m.model,
      modelKey: `${m.model} [${provider}]`,
      input: m.input_tokens || 0,
      output: m.output_tokens || 0,
      reasoning: m.reasoning_tokens || 0,
      cache_read: m.cache_read_tokens || 0,
      cache_write: m.cache_write_tokens || 0,
      cost_logged: m.cost || 0,
      timestamp_ms: m.timestamp_ms || 0,
      session_id: m.session_id || "(unknown)",
      project: m.project || "unknown",
    }
  })
}

export function getGlobalCutoff(range: string): number {
  if (range === "all") return 0
  const now = new Date()
  const c = new Date(now.getTime())
  if (range.endsWith("d")) c.setUTCDate(c.getUTCDate() - Number(range.slice(0, -1)))
  else if (range.endsWith("y")) c.setUTCFullYear(c.getUTCFullYear() - Number(range.slice(0, -1)))
  return c.getTime()
}

export function filterMessages(
  messages: NormalizedMessage[],
  provider: string,
  range: string,
  startDate?: string,
  endDate?: string
): NormalizedMessage[] {
  const cutoff = range === "custom" ? 0 : getGlobalCutoff(range)
  const customStartMs = startDate ? Date.parse(`${startDate}T00:00:00.000Z`) : Number.NaN
  const customEndMs = endDate ? Date.parse(`${endDate}T23:59:59.999Z`) : Number.NaN

  return messages.filter((m) => {
    if (provider !== "all" && m.provider !== provider) return false
    if (!m.timestamp_ms) return true

    if (range === "custom") {
      if (Number.isFinite(customStartMs) && m.timestamp_ms < customStartMs) return false
      if (Number.isFinite(customEndMs) && m.timestamp_ms > customEndMs) return false
      return true
    }

    if (!cutoff) return true
    return m.timestamp_ms >= cutoff
  })
}

export interface ModelRow {
  key: string
  provider: string
  color: string
  messages: number
  input: number
  output: number
  reasoning: number
  cache_read: number
  cost_estimated: number
}

export function getModelRows(
  filtered: NormalizedMessage[],
  modelStats: Record<string, ModelStats>
): ModelRow[] {
  const rows: Record<string, ModelRow> = {}
  const sortedModels = Object.entries(modelStats).sort(
    ([, a], [, b]) => b.input + b.output - (a.input + a.output)
  )
  const modelColors: Record<string, string> = {}
  sortedModels.forEach(([k], i) => {
    modelColors[k] = CHART_COLORS[i % CHART_COLORS.length]
  })

  const modelRate: Record<string, number> = {}
  sortedModels.forEach(([k, ms]) => {
    const denom = ms.input + ms.output + ms.cache_read
    modelRate[k] = denom > 0 ? ms.cost_estimated / denom : 0
  })

  for (const m of filtered) {
    if (!rows[m.modelKey]) {
      rows[m.modelKey] = {
        key: m.modelKey,
        provider: m.provider,
        color: modelColors[m.modelKey] || "#b88a5a",
        messages: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache_read: 0,
        cost_estimated: 0,
      }
    }
    const r = rows[m.modelKey]
    r.messages += 1
    r.input += m.input
    r.output += m.output
    r.reasoning += m.reasoning
    r.cache_read += m.cache_read
  }

  return Object.values(rows)
    .map((r) => ({
      ...r,
      cost_estimated: (r.input + r.output + r.cache_read) * (modelRate[r.key] || 0),
    }))
    .sort((a, b) => b.input + b.output - (a.input + a.output))
}

export interface SessionRow {
  provider: string
  session_id: string
  project: string
  messages: number
  input: number
  output: number
  reasoning: number
  cache_read: number
  total: number
  model_count: number
  models: Set<string>
  start_ms: number
  end_ms: number
  cost_estimated: number
}

export function getSessionRows(
  filtered: NormalizedMessage[],
  modelStats: Record<string, ModelStats>
): SessionRow[] {
  const sortedModels = Object.entries(modelStats).sort(
    ([, a], [, b]) => b.input + b.output - (a.input + a.output)
  )
  const modelRate: Record<string, number> = {}
  sortedModels.forEach(([k, ms]) => {
    const denom = ms.input + ms.output + ms.cache_read
    modelRate[k] = denom > 0 ? ms.cost_estimated / denom : 0
  })

  const rows: Record<string, SessionRow> = {}
  const sessionModelTotals: Record<string, Record<string, number>> = {}

  for (const m of filtered) {
    const key = `${m.provider}:${m.session_id}`
    if (!rows[key]) {
      rows[key] = {
        provider: m.provider,
        session_id: m.session_id,
        project: m.project || "unknown",
        messages: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache_read: 0,
        total: 0,
        model_count: 0,
        models: new Set(),
        start_ms: 0,
        end_ms: 0,
        cost_estimated: 0,
      }
    }
    const r = rows[key]
    r.messages += 1
    r.input += m.input
    r.output += m.output
    r.reasoning += m.reasoning
    r.cache_read += m.cache_read
    r.total += m.input + m.output
    r.models.add(m.modelKey)
    if (!sessionModelTotals[key]) sessionModelTotals[key] = {}
    sessionModelTotals[key][m.modelKey] =
      (sessionModelTotals[key][m.modelKey] || 0) + m.input + m.output + m.cache_read
    if (!r.start_ms || (m.timestamp_ms && m.timestamp_ms < r.start_ms)) r.start_ms = m.timestamp_ms
    if (m.timestamp_ms > r.end_ms) r.end_ms = m.timestamp_ms
    if (r.project === "unknown" && m.project) r.project = m.project
  }

  return Object.values(rows)
    .map((r) => {
      let cost = 0
      const key = `${r.provider}:${r.session_id}`
      for (const modelKey of r.models) {
        const rate = modelRate[modelKey] || 0
        const modelTokens = sessionModelTotals[key]?.[modelKey] || 0
        cost += modelTokens * rate
      }
      return { ...r, model_count: r.models.size, cost_estimated: cost }
    })
    .sort((a, b) => b.total - a.total)
}

export interface ProviderRow {
  name: string
  color: string
  input: number
  output: number
  messages: number
  sessions: number
}

export function getProviderRows(filtered: NormalizedMessage[]): ProviderRow[] {
  const rows: Record<string, { name: string; color: string; input: number; output: number; messages: number; sessions: Set<string> }> = {}
  for (const m of filtered) {
    if (!rows[m.provider]) {
      rows[m.provider] = {
        name: m.provider,
        color: PROVIDER_COLORS[m.provider] || "#a39e90",
        input: 0,
        output: 0,
        messages: 0,
        sessions: new Set(),
      }
    }
    const r = rows[m.provider]
    r.input += m.input
    r.output += m.output
    r.messages += 1
    r.sessions.add(m.session_id)
  }
  return Object.values(rows).map((r) => ({ ...r, sessions: r.sessions.size }))
}

export interface ProjectRow {
  name: string
  messages: number
  input: number
  output: number
  total: number
}

export function getProjectRows(filtered: NormalizedMessage[]): ProjectRow[] {
  const rows: Record<string, ProjectRow> = {}
  for (const m of filtered) {
    const key = m.project || "unknown"
    if (!rows[key]) rows[key] = { name: key, messages: 0, input: 0, output: 0, total: 0 }
    rows[key].messages += 1
    rows[key].input += m.input
    rows[key].output += m.output
    rows[key].total += m.input + m.output
  }
  return Object.values(rows).sort((a, b) => b.total - a.total)
}

export interface TimelineBucket {
  key: string
  label: string
  [model: string]: number | string
}

export function getTimelineData(
  filtered: NormalizedMessage[],
  groupBy: string,
  tokenType: string
): { data: TimelineBucket[]; models: { key: string; color: string }[] } {
  const buckets: Record<string, Record<string, { input: number; output: number; reasoning: number }>> = {}

  for (const msg of filtered) {
    if (!msg.timestamp_ms) continue
    const iso = new Date(msg.timestamp_ms).toISOString()
    const hourKey = iso.slice(0, 13)
    let bk: string
    if (groupBy === "hour") bk = hourKey
    else if (groupBy === "day") bk = hourKey.slice(0, 10)
    else if (groupBy === "week") bk = getWeekKey(hourKey)
    else bk = hourKey.slice(0, 7)

    if (!buckets[bk]) buckets[bk] = {}
    if (!buckets[bk][msg.modelKey]) buckets[bk][msg.modelKey] = { input: 0, output: 0, reasoning: 0 }
    buckets[bk][msg.modelKey].input += msg.input
    buckets[bk][msg.modelKey].output += msg.output
    buckets[bk][msg.modelKey].reasoning += msg.reasoning
  }

  const allModels = new Set<string>()
  for (const b of Object.values(buckets)) {
    for (const k of Object.keys(b)) allModels.add(k)
  }

  const sortedModels = Array.from(allModels)
  const modelColorMap: Record<string, string> = {}
  sortedModels.forEach((k, i) => {
    modelColorMap[k] = CHART_COLORS[i % CHART_COLORS.length]
  })

  const keys = Object.keys(buckets).sort()
  const data: TimelineBucket[] = keys.map((k) => {
    const entry: TimelineBucket = { key: k, label: fmtTimeLabel(k, groupBy) }
    for (const model of sortedModels) {
      const b = buckets[k]?.[model] || { input: 0, output: 0, reasoning: 0 }
      if (tokenType === "input") entry[model] = b.input
      else if (tokenType === "output") entry[model] = b.output
      else if (tokenType === "reasoning") entry[model] = b.reasoning
      else entry[model] = b.input + b.output + b.reasoning
    }
    return entry
  })

  return {
    data,
    models: sortedModels.map((k) => ({ key: k, color: modelColorMap[k] })),
  }
}

function getWeekKey(d: string): string {
  const dt = new Date(d + ":00:00Z")
  const jan1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((dt.getTime() - jan1.getTime()) / 86400000 + jan1.getUTCDay() + 1) / 7)
  return dt.getUTCFullYear() + "-W" + String(week).padStart(2, "0")
}

function fmtTimeLabel(raw: string, groupBy: string): string {
  if (groupBy === "hour") {
    const [dp, h] = raw.split("T")
    const d = new Date(dp + "T00:00:00Z")
    return d.toLocaleString("en", { month: "short", timeZone: "UTC" }) + " " + d.getUTCDate() + " " + h + ":00"
  }
  if (groupBy === "day") {
    const d = new Date(raw + "T00:00:00Z")
    return d.toLocaleString("en", { month: "short", timeZone: "UTC" }) + " " + d.getUTCDate()
  }
  if (groupBy === "week") return raw
  if (groupBy === "month") {
    const d = new Date(raw + "-01T00:00:00Z")
    return d.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" })
  }
  return raw
}
