import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import type { DashboardData, NormalizedMessage, SessionTranscriptTurn } from "@/lib/types"
import { normalizeMessages, filterMessages, getModelRows, getSessionRows, getProviderRows, getProjectRows, getTimelineData } from "@/lib/data"
import { PROVIDER_COLORS, parseModelKey, fmtNum, fmtCompact, fmtCost, fmtDateTime } from "@/lib/constants"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, Line, LineChart, XAxis, YAxis, CartesianGrid, Pie, PieChart, Cell, Area, AreaChart, ComposedChart } from "recharts"

const NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "sessions", label: "Sessions" },
  { id: "models", label: "Models" },
  { id: "projects", label: "Projects" },
  { id: "pullrequests", label: "Pull Requests" },
  { id: "prdetails", label: "PR Details" },
]

const RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "180d", label: "Last 6 months" },
  { value: "1y", label: "Last 1 year" },
  { value: "2y", label: "Last 2 years" },
  { value: "all", label: "All time" },
]

const VIRTUALIZED_TABLE_THRESHOLD = Number.POSITIVE_INFINITY

type PRMonthSummary = { total: number; merged: number; open: number; closed: number }
type PRRepoSummary = { total: number; merged: number; open: number; closed: number }
type PROrgSummary = {
  total: number
  merged: number
  workday_prs: number
  weekend_prs: number
  working_days: number
  weekend_days: number
  avg_per_working_day: number
  avg_per_weekend_day: number
}
type PRSizeSummary = {
  avg: number
  p25: number
  p50: number
  p75: number
  p90: number
  p95: number
  p99: number
  max: number
}
type PRStats = {
  total: number
  merged: number
  open: number
  closed: number
  perProject: Record<string, PRRepoSummary>
  orgStats: Record<string, PROrgSummary>
  sizeStats: {
    lines_changed: PRSizeSummary
    additions: PRSizeSummary
    deletions: PRSizeSummary
    files_changed: PRSizeSummary
  }
  byMonth: Record<string, PRMonthSummary>
  mergeTimeStats: { avg: number; p50: number; p90: number } | null
}
type ReviewStats = {
  total: number
  byState: Record<string, number>
  byMonth: Record<string, number>
}
type PROrgOption = { value: string; label: string }
type SortDirection = "asc" | "desc"
type SortValue = string | number
type SortConfig<K extends string> = { key: K; direction: SortDirection }

function getPercentile(values: number[], percentile: number) {
  if (!values.length) return 0
  const index = (values.length - 1) * (percentile / 100)
  const floor = Math.floor(index)
  const ceil = Math.min(floor + 1, values.length - 1)
  return Math.round(values[floor] + (index - floor) * (values[ceil] - values[floor]))
}

function getSessionKey(provider: string, sessionId: string) {
  return `${provider}:${sessionId}`
}

function compareSortValues(a: SortValue, b: SortValue, type: "string" | "number") {
  if (type === "number") return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
}

function useSortedRows<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => SortValue>,
  initialSort: SortConfig<K>,
  types: Partial<Record<K, "string" | "number">>,
  defaultDirections: Partial<Record<K, SortDirection>> = {}
) {
  const [sortConfig, setSortConfig] = useState<SortConfig<K>>(initialSort)

  const sortedRows = useMemo(() => {
    const accessor = accessors[sortConfig.key]
    const type = types[sortConfig.key] || "string"
    const direction = sortConfig.direction === "asc" ? 1 : -1

    return [...rows].sort((a, b) => compareSortValues(accessor(a), accessor(b), type) * direction)
  }, [accessors, rows, sortConfig, types])

  const requestSort = (key: K) => {
    setSortConfig((current) => {
      if (current.key === key) {
        return { key, direction: current.direction === "asc" ? "desc" : "asc" }
      }

      return { key, direction: defaultDirections[key] || "asc" }
    })
  }

  return { sortedRows, sortConfig, requestSort }
}

function SortButton<K extends string>({
  label,
  sortKey,
  sortConfig,
  onSort,
  align = "left",
}: {
  label: string
  sortKey: K
  sortConfig: SortConfig<K>
  onSort: (key: K) => void
  align?: "left" | "right"
}) {
  const isActive = sortConfig.key === sortKey
  const indicator = isActive ? (sortConfig.direction === "asc" ? "▲" : "▼") : "↕"

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={`flex w-full items-center gap-1 text-left transition-colors hover:text-foreground ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      <span>{label}</span>
      <span className={`text-[10px] ${isActive ? "text-primary" : "text-muted-foreground/60"}`}>{indicator}</span>
    </button>
  )
}

function SortableHeader<K extends string>({
  label,
  sortKey,
  sortConfig,
  onSort,
  className,
  align = "left",
}: {
  label: string
  sortKey: K
  sortConfig: SortConfig<K>
  onSort: (key: K) => void
  className?: string
  align?: "left" | "right"
}) {
  return (
    <TableHead className={className}>
      <SortButton label={label} sortKey={sortKey} sortConfig={sortConfig} onSort={onSort} align={align} />
    </TableHead>
  )
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

function getEmptySizeSummary(): PRSizeSummary {
  return { avg: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, max: 0 }
}

function getSizeSummary(values: number[]): PRSizeSummary {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return getEmptySizeSummary()

  return {
    avg: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p25: getPercentile(sorted, 25),
    p50: getPercentile(sorted, 50),
    p75: getPercentile(sorted, 75),
    p90: getPercentile(sorted, 90),
    p95: getPercentile(sorted, 95),
    p99: getPercentile(sorted, 99),
    max: sorted[sorted.length - 1],
  }
}

function getPRByMonth(prs: DashboardData["github_prs"]["prs"] = []): Record<string, PRMonthSummary> {
  return prs.reduce<Record<string, PRMonthSummary>>((acc, pr) => {
    if (!pr.created_at) return acc

    const month = pr.created_at.slice(0, 7)
    if (!acc[month]) {
      acc[month] = { total: 0, merged: 0, open: 0, closed: 0 }
    }

    acc[month].total += 1
    if (pr.state === "MERGED") acc[month].merged += 1
    else if (pr.state === "OPEN") acc[month].open += 1
    else acc[month].closed += 1

    return acc
  }, {})
}

function computePRStats(prs: DashboardData["github_prs"]["prs"] = []): PRStats {
  const total = prs.length
  const merged = prs.filter((pr) => pr.state === "MERGED").length
  const open = prs.filter((pr) => pr.state === "OPEN").length
  const closed = prs.filter((pr) => pr.state === "CLOSED").length

  const perProject = prs.reduce<Record<string, PRRepoSummary>>((acc, pr) => {
    if (!acc[pr.repo]) acc[pr.repo] = { total: 0, merged: 0, open: 0, closed: 0 }
    acc[pr.repo].total += 1
    if (pr.state === "MERGED") acc[pr.repo].merged += 1
    else if (pr.state === "OPEN") acc[pr.repo].open += 1
    else acc[pr.repo].closed += 1
    return acc
  }, {})

  const perOrg = prs.reduce<Record<string, { total: number; merged: number; dates: Set<string>; workday_prs: number; weekend_prs: number }>>((acc, pr) => {
    const org = pr.org || "personal"
    if (!acc[org]) {
      acc[org] = { total: 0, merged: 0, dates: new Set<string>(), workday_prs: 0, weekend_prs: 0 }
    }

    acc[org].total += 1
    if (pr.state === "MERGED") {
      acc[org].merged += 1
      if (pr.created_at) {
        acc[org].dates.add(pr.created_at.slice(0, 10))
        const dayOfWeek = new Date(pr.created_at).getUTCDay()
        if (dayOfWeek >= 1 && dayOfWeek <= 5) acc[org].workday_prs += 1
        else acc[org].weekend_prs += 1
      }
    }

    return acc
  }, {})

  const today = new Date()
  const orgStats = Object.fromEntries(
    Object.entries(perOrg)
      .map(([org, data]) => {
        const dates = Array.from(data.dates).sort()
        if (!dates.length) {
          return [org, { total: data.total, merged: data.merged, workday_prs: 0, weekend_prs: 0, working_days: 0, weekend_days: 0, avg_per_working_day: 0, avg_per_weekend_day: 0 } satisfies PROrgSummary]
        }

        const first = new Date(`${dates[0]}T00:00:00Z`)
        const last = new Date(Math.min(new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime(), today.getTime()))
        let working_days = 0
        let weekend_days = 0
        for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          const dayOfWeek = cursor.getUTCDay()
          if (dayOfWeek >= 1 && dayOfWeek <= 5) working_days += 1
          else weekend_days += 1
        }

        return [
          org,
          {
            total: data.total,
            merged: data.merged,
            workday_prs: data.workday_prs,
            weekend_prs: data.weekend_prs,
            working_days,
            weekend_days,
            avg_per_working_day: working_days > 0 ? Number((data.workday_prs / working_days).toFixed(2)) : 0,
            avg_per_weekend_day: weekend_days > 0 ? Number((data.weekend_prs / weekend_days).toFixed(2)) : 0,
          } satisfies PROrgSummary,
        ]
      })
      .sort(([, a], [, b]) => b.total - a.total)
  )

  const sizeStats = {
    lines_changed: getSizeSummary(prs.map((pr) => pr.additions + pr.deletions)),
    additions: getSizeSummary(prs.map((pr) => pr.additions)),
    deletions: getSizeSummary(prs.map((pr) => pr.deletions)),
    files_changed: getSizeSummary(prs.map((pr) => pr.changed_files)),
  }

  const mergeTimes = prs
    .filter((pr) => pr.state === "MERGED" && pr.created_at && pr.merged_at)
    .map((pr) => (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60))
    .filter((hours) => Number.isFinite(hours) && hours >= 0)
    .sort((a, b) => a - b)

  return {
    total,
    merged,
    open,
    closed,
    perProject: Object.fromEntries(Object.entries(perProject).sort(([, a], [, b]) => b.total - a.total)),
    orgStats,
    sizeStats,
    byMonth: getPRByMonth(prs),
    mergeTimeStats: mergeTimes.length
      ? {
          avg: Math.round(mergeTimes.reduce((sum, hours) => sum + hours, 0) / mergeTimes.length),
          p50: getPercentile(mergeTimes, 50),
          p90: getPercentile(mergeTimes, 90),
        }
      : null,
  }
}

function computeReviewStats(reviews: DashboardData["github_prs"]["reviews"]["reviews"] = []): ReviewStats {
  return {
    total: reviews.length,
    byState: reviews.reduce<Record<string, number>>((acc, review) => {
      acc[review.state] = (acc[review.state] || 0) + 1
      return acc
    }, {}),
    byMonth: reviews.reduce<Record<string, number>>((acc, review) => {
      if (!review.review_created_at) return acc
      const month = review.review_created_at.slice(0, 7)
      acc[month] = (acc[month] || 0) + 1
      return acc
    }, {}),
  }
}

function getPROrgOptions(data?: DashboardData["github_prs"]): PROrgOption[] {
  const counts = new Map<string, number>()

  data?.prs?.forEach((pr) => {
    const org = pr.org || "personal"
    counts.set(org, (counts.get(org) || 0) + 1)
  })

  data?.reviews?.reviews?.forEach((review) => {
    const org = review.org || "personal"
    counts.set(org, (counts.get(org) || 0) + 1)
  })

  Object.entries(data?.per_org || {}).forEach(([org, stats]) => {
    counts.set(org, Math.max(counts.get(org) || 0, stats.total || 0))
  })

  return Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([value, count]) => ({ value, label: `${value} (${fmtNum(count)})` }))
}

function getMergedPRsPerDayRows(prs: DashboardData["github_prs"]["prs"], months: string[]) {
  const today = new Date()
  const rows = months.map((month) => {
    const [year, monthNumber] = month.split("-").map(Number)
    const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1))
    const lastDay = new Date(Date.UTC(year, monthNumber, 0))
    const endOfRange = lastDay.getTime() > today.getTime()
      ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
      : lastDay

    let workingDays = 0
    let weekendDays = 0
    for (const cursor = new Date(firstDay); cursor <= endOfRange; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const dayOfWeek = cursor.getUTCDay()
      if (dayOfWeek >= 1 && dayOfWeek <= 5) workingDays += 1
      else weekendDays += 1
    }

    let workdayMerged = 0
    let weekendMerged = 0
    prs.forEach((pr) => {
      if (pr.state !== "MERGED" || !pr.created_at || pr.created_at.slice(0, 7) !== month) return
      const dayOfWeek = new Date(pr.created_at).getUTCDay()
      if (dayOfWeek >= 1 && dayOfWeek <= 5) workdayMerged += 1
      else weekendMerged += 1
    })

    return {
      month,
      workday: workingDays > 0 ? Number((workdayMerged / workingDays).toFixed(2)) : 0,
      weekend: weekendDays > 0 ? Number((weekendMerged / weekendDays).toFixed(2)) : 0,
    }
  })

  return rows.map((row, index) => {
    const window = rows.slice(Math.max(0, index - 2), index + 1)
    return {
      ...row,
      rollingWorkday: Number((window.reduce((sum, current) => sum + current.workday, 0) / window.length).toFixed(2)),
    }
  })
}

function getMergeTimeRows(prs: DashboardData["github_prs"]["prs"], months: string[]) {
  const mergeTimesByMonth = prs.reduce<Record<string, number[]>>((acc, pr) => {
    if (pr.state !== "MERGED" || !pr.created_at || !pr.merged_at) return acc
    const month = pr.created_at.slice(0, 7)
    const hours = (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60)
    if (!Number.isFinite(hours) || hours < 0) return acc
    if (!acc[month]) acc[month] = []
    acc[month].push(hours)
    return acc
  }, {})

  return months.map((month) => {
    const times = [...(mergeTimesByMonth[month] || [])].sort((a, b) => a - b)
    if (!times.length) {
      return { month, avg: null, median: null }
    }

    const middle = Math.floor(times.length / 2)
    const median = times.length % 2 === 0 ? (times[middle - 1] + times[middle]) / 2 : times[middle]

    return {
      month,
      avg: Number((times.reduce((sum, time) => sum + time, 0) / times.length).toFixed(1)),
      median: Number(median.toFixed(1)),
    }
  })
}

export default function Dashboard({ data }: { data: DashboardData }) {
  const [page, setPage] = useState("overview")
  const [activeProvider, setActiveProvider] = useState("all")
  const [globalRange, setGlobalRange] = useState("90d")
  const [tlGroupBy, setTlGroupBy] = useState("day")
  const [tlTokenType, setTlTokenType] = useState("total")
  const [tlChartType, setTlChartType] = useState("area")
  const [prOrgFilter, setPrOrgFilter] = useState("all")

  const allMessages = useMemo(() => normalizeMessages(data.messages), [data.messages])
  const filtered = useMemo(() => filterMessages(allMessages, activeProvider, globalRange), [allMessages, activeProvider, globalRange])
  const activeProviders = useMemo(() => Object.keys(data.provider_totals).sort(), [data.provider_totals])
  const modelRows = useMemo(() => getModelRows(filtered, data.model_stats), [filtered, data.model_stats])
  const sessionRows = useMemo(() => getSessionRows(filtered, data.model_stats), [filtered, data.model_stats])
  const providerRows = useMemo(() => getProviderRows(filtered), [filtered])
  const projectRows = useMemo(() => getProjectRows(filtered), [filtered])
  const timelineData = useMemo(() => getTimelineData(filtered, tlGroupBy, tlTokenType), [filtered, tlGroupBy, tlTokenType])
  const prOrgOptions = useMemo(() => getPROrgOptions(data.github_prs), [data.github_prs])
  const filteredPRs = useMemo(() => {
    const prs = data.github_prs?.prs || []
    return prOrgFilter === "all" ? prs : prs.filter((pr) => (pr.org || "personal") === prOrgFilter)
  }, [data.github_prs, prOrgFilter])
  const filteredReviews = useMemo(() => {
    const reviews = data.github_prs?.reviews?.reviews || []
    return prOrgFilter === "all" ? reviews : reviews.filter((review) => (review.org || "personal") === prOrgFilter)
  }, [data.github_prs, prOrgFilter])
  const prStats = useMemo(() => computePRStats(filteredPRs), [filteredPRs])
  const reviewStats = useMemo(() => computeReviewStats(filteredReviews), [filteredReviews])

  useEffect(() => {
    if (prOrgFilter !== "all" && !prOrgOptions.some((option) => option.value === prOrgFilter)) {
      setPrOrgFilter("all")
    }
  }, [prOrgFilter, prOrgOptions])

  const totals = useMemo(() => {
    const msgs = modelRows.reduce((s, m) => s + m.messages, 0)
    const inp = modelRows.reduce((s, m) => s + m.input, 0)
    const out = modelRows.reduce((s, m) => s + m.output, 0)
    const rea = modelRows.reduce((s, m) => s + m.reasoning, 0)
    const cr = modelRows.reduce((s, m) => s + m.cache_read, 0)
    const cost = modelRows.reduce((s, m) => s + m.cost_estimated, 0)
    return { msgs, inp, out, rea, cr, cost, sessions: sessionRows.length }
  }, [modelRows, sessionRows])

  const showTokenFilterBar = ["overview", "timeline", "sessions", "models", "projects"].includes(page)

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r border-border flex flex-col flex-shrink-0">
        <div className="h-14 flex items-center px-4 border-b border-border">
          <h1 className="text-sm font-bold">
            <span className="text-primary">Engineering</span>{" "}
            <span className="text-muted-foreground">Dashboard</span>
          </h1>
        </div>
        <nav className="p-3 flex-1 space-y-0.5">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                page === item.id
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border text-xs text-muted-foreground">
          {data.generated_at}
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto p-6">
        {/* Filter bar */}
        {showTokenFilterBar && (
          <div className="flex items-center gap-2 mb-6 p-2.5 bg-card border border-border rounded-xl flex-wrap">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
              Filter
            </span>
            <div className="flex gap-1.5 flex-wrap flex-1">
              <FilterPill
                label="All"
                active={activeProvider === "all"}
                color="#d97757"
                onClick={() => setActiveProvider("all")}
              />
              {activeProviders.map((p) => (
                <FilterPill
                  key={p}
                  label={p}
                  active={activeProvider === p}
                  color={PROVIDER_COLORS[p] || "#a39e90"}
                  onClick={() => setActiveProvider(p)}
                />
              ))}
            </div>
            <Select value={globalRange} onValueChange={setGlobalRange}>
              <SelectTrigger className="w-36 h-8 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {page === "overview" && (
          <OverviewPage
            totals={totals}
            modelRows={modelRows}
            providerRows={providerRows}
            globalRange={globalRange}
          />
        )}
        {page === "timeline" && (
          <TimelinePage
            data={timelineData}
            groupBy={tlGroupBy}
            setGroupBy={setTlGroupBy}
            tokenType={tlTokenType}
            setTokenType={setTlTokenType}
            chartType={tlChartType}
            setChartType={setTlChartType}
          />
        )}
        {page === "sessions" && <SessionsPage rows={sessionRows} messages={filtered} sessionTranscripts={data.session_transcripts || {}} />}
        {page === "models" && <ModelsPage rows={modelRows} />}
        {page === "projects" && <ProjectsPage rows={projectRows} />}
        {page === "pullrequests" && (
          <PRPage
            hasGitHubData={Boolean(data.github_prs?.total)}
            prs={filteredPRs}
            stats={prStats}
            reviewStats={reviewStats}
            orgOptions={prOrgOptions}
            selectedOrg={prOrgFilter}
            onSelectedOrgChange={setPrOrgFilter}
          />
        )}
        {page === "prdetails" && (
          <PRDetailsPage
            hasGitHubData={Boolean(data.github_prs?.total)}
            stats={prStats}
            orgOptions={prOrgOptions}
            selectedOrg={prOrgFilter}
            onSelectedOrgChange={setPrOrgFilter}
          />
        )}
      </main>
    </div>
  )
}

function FilterPill({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors"
      style={
        active
          ? { background: color, borderColor: color, color: "#fff" }
          : { background: "transparent", borderColor: "var(--border)", color: "var(--muted-foreground)" }
      }
    >
      {label}
    </button>
  )
}

function BtnGroup({
  options,
  value,
  onChange,
  className,
  buttonClassName,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  className?: string
  buttonClassName?: string
}) {
  return (
    <div className={`flex border border-border rounded-lg overflow-hidden ${className || ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs transition-colors border-r last:border-r-0 border-border ${buttonClassName || ""} ${
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PROrgFilter({
  orgOptions,
  selectedOrg,
  onSelectedOrgChange,
}: {
  orgOptions: PROrgOption[]
  selectedOrg: string
  onSelectedOrgChange: (value: string) => void
}) {
  if (!orgOptions.length) return null

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 flex-wrap">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Org</span>
      <Select value={selectedOrg} onValueChange={onSelectedOrgChange}>
        <SelectTrigger className="h-8 w-56 text-xs shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All organizations</SelectItem>
          {orgOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 px-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-2xl font-bold mt-1" style={color ? { color } : undefined}>
          {value}
        </div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function VirtualizedListRow({
  rowKey,
  top,
  onHeightChange,
  gap = 12,
  children,
}: {
  rowKey: string
  top: number
  onHeightChange: (key: string, height: number) => void
  gap?: number
  children: ReactNode
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = rowRef.current
    if (!element) return

    const updateHeight = () => {
      const nextHeight = element.getBoundingClientRect().height
      if (nextHeight > 0) onHeightChange(rowKey, nextHeight)
    }

    updateHeight()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => updateHeight())
    observer.observe(element)
    return () => observer.disconnect()
  }, [onHeightChange, rowKey])

  return (
    <div ref={rowRef} style={{ position: "absolute", top, left: 0, right: 0, paddingBottom: gap }}>
      {children}
    </div>
  )
}

function VirtualizedStack<T>({
  items,
  getKey,
  renderItem,
  estimateHeight,
  maxHeightClassName = "max-h-[60vh]",
  emptyState = null,
  rowGap = 12,
  containerStyle,
  contentStyle,
}: {
  items: T[]
  getKey: (item: T, index: number) => string
  renderItem: (item: T, index: number) => ReactNode
  estimateHeight: (item: T, index: number) => number
  maxHeightClassName?: string
  emptyState?: ReactNode
  rowGap?: number
  containerStyle?: React.CSSProperties
  contentStyle?: React.CSSProperties
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateViewportHeight = () => setViewportHeight(container.clientHeight)
    updateViewportHeight()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(() => updateViewportHeight())
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.scrollTop = 0
    setScrollTop(0)
  }, [items])

  const handleHeightChange = (key: string, height: number) => {
    setMeasuredHeights((current) => {
      if (current[key] === height) return current
      return { ...current, [key]: height }
    })
  }

  const rows = items.map((item, index) => {
    const key = getKey(item, index)
    return {
      item,
      index,
      key,
      height: measuredHeights[key] ?? estimateHeight(item, index),
    }
  })

  let offset = 0
  const positionedRows = rows.map((row) => {
    const positionedRow = { ...row, top: offset }
    offset += row.height
    return positionedRow
  })

  const totalHeight = offset
  const overscanPx = 800
  const visibleStart = Math.max(0, scrollTop - overscanPx)
  const visibleEnd = scrollTop + viewportHeight + overscanPx
  const visibleRows = positionedRows.filter((row) => row.top + row.height >= visibleStart && row.top <= visibleEnd)

  if (!items.length) {
    return <>{emptyState}</>
  }

  return (
    <div ref={containerRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} className={`overflow-y-auto pr-1 ${maxHeightClassName}`} style={containerStyle}>
      <div style={{ position: "relative", height: totalHeight, ...contentStyle }}>
        {visibleRows.map((row) => (
          <VirtualizedListRow key={row.key} rowKey={row.key} top={row.top} onHeightChange={handleHeightChange} gap={rowGap}>
            {renderItem(row.item, row.index)}
          </VirtualizedListRow>
        ))}
      </div>
    </div>
  )
}

type VirtualizedTableColumn<T> = {
  key: string
  width: string
  header: ReactNode
  headerClassName?: string
  cellClassName?: string
  renderCell: (row: T, index: number) => ReactNode
}

function VirtualizedTable<T>({
  rows,
  columns,
  getRowKey,
  estimateRowHeight,
  maxHeightClassName = "max-h-[70vh]",
  onRowClick,
  selectedRowKey,
}: {
  rows: T[]
  columns: VirtualizedTableColumn<T>[]
  getRowKey: (row: T, index: number) => string
  estimateRowHeight: (row: T, index: number) => number
  maxHeightClassName?: string
  onRowClick?: (row: T, index: number) => void
  selectedRowKey?: string | null
}) {
  const templateColumns = columns.map((column) => column.width).join(" ")

  return (
    <div className="rounded-md border border-border">
      <div className="overflow-x-auto">
        <div className="min-w-full" style={{ width: "max-content" }}>
          <div className="border-b border-border bg-muted/20 px-2">
            <div className="grid items-center" style={{ gridTemplateColumns: templateColumns, width: "max-content", minWidth: "100%" }}>
              {columns.map((column) => (
                <div key={column.key} className={`px-2 py-2 text-sm font-medium ${column.headerClassName || ""}`}>
                  {column.header}
                </div>
              ))}
            </div>
          </div>

          <VirtualizedStack
            items={rows}
            getKey={getRowKey}
            estimateHeight={estimateRowHeight}
            maxHeightClassName={maxHeightClassName}
            rowGap={0}
            containerStyle={{ width: "max-content", minWidth: "100%" }}
            contentStyle={{ width: "max-content", minWidth: "100%" }}
            renderItem={(row, index) => {
              const rowKey = getRowKey(row, index)
              const isSelected = selectedRowKey === rowKey

              return (
                <div
                  onClick={onRowClick ? () => onRowClick(row, index) : undefined}
                  className={`grid items-center border-b border-border/60 px-2 text-sm transition-colors ${onRowClick ? "cursor-pointer hover:bg-muted/50" : ""} ${isSelected ? "bg-muted" : "bg-background"}`}
                  style={{ gridTemplateColumns: templateColumns, width: "max-content", minWidth: "100%" }}
                >
                  {columns.map((column) => (
                    <div key={column.key} className={`px-2 py-2 ${column.cellClassName || ""}`}>
                      {column.renderCell(row, index)}
                    </div>
                  ))}
                </div>
              )
            }}
          />
        </div>
      </div>
    </div>
  )
}

const compactAxisFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 2,
})

const fmtAxis = (v: number) => compactAxisFormatter.format(v)

function TableNumber({ value }: { value: number }) {
  return <span title={fmtNum(value)}>{fmtAxis(value)}</span>
}

function OverflowText({ value, className }: { value: string; className?: string }) {
  return <span className={`block overflow-hidden text-ellipsis whitespace-nowrap ${className || ""}`} title={value}>{value}</span>
}

/* ========== Overview ========== */
function OverviewPage({ totals, modelRows, providerRows, globalRange }: {
  totals: { msgs: number; inp: number; out: number; rea: number; cr: number; cost: number; sessions: number }
  modelRows: ReturnType<typeof getModelRows>
  providerRows: ReturnType<typeof getProviderRows>
  globalRange: string
}) {
  const barData = modelRows.slice(0, 12).map((m) => ({
    name: parseModelKey(m.key).name,
    input: m.input,
    output: m.output,
    color: m.color,
  }))

  const donutData = modelRows.filter((m) => m.output > 0).map((m) => ({
    name: parseModelKey(m.key).name,
    value: m.output,
    color: m.color,
  }))

  const provDonutData = providerRows.filter((p) => p.input + p.output > 0).map((p) => ({
    name: p.name,
    value: p.input + p.output,
    color: p.color,
  }))

  const barConfig = Object.fromEntries(
    barData.map((d) => [d.name, { label: d.name, color: d.color }])
  )

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Overview</h2>
        <p className="text-sm text-muted-foreground">Token usage analytics across all providers</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Messages" value={fmtCompact(totals.msgs)} sub={fmtNum(totals.msgs) + " turns"} />
        <StatCard label="Sessions" value={fmtCompact(totals.sessions)} sub="unique sessions" />
        <StatCard label="Input" value={fmtCompact(totals.inp)} sub={fmtNum(totals.inp)} color="#b88a5a" />
        <StatCard label="Output" value={fmtCompact(totals.out)} sub={fmtNum(totals.out)} color="#6f8b6e" />
        <StatCard label="Reasoning" value={fmtCompact(totals.rea)} sub={fmtNum(totals.rea)} color="#9f7a4f" />
        <StatCard label="Cache Read" value={fmtCompact(totals.cr)} sub={fmtNum(totals.cr)} color="#4f7f78" />
        <StatCard label="Est. Cost" value={fmtCost(totals.cost)} sub="selected range" color="#d97757" />
        <StatCard label="Range" value={globalRange === "all" ? "All" : globalRange.toUpperCase()} sub="applies to all views" color="#8b6f9b" />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>Tokens by Model</CardTitle></CardHeader>
        <CardContent>
          <ChartContainer config={barConfig} className="h-80 w-full">
            <BarChart data={barData} accessibilityLayer={false}>
              <CartesianGrid vertical={false} className="stroke-border/50" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="input" radius={[4, 4, 0, 0]} fill="#b88a5a" name="Input" />
              <Bar dataKey="output" radius={[4, 4, 0, 0]} fill="#6f8b6e" name="Output" />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Output Token Share</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={{}} className="h-64 w-full">
              <PieChart accessibilityLayer={false}>
                <Pie data={donutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                  {donutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Tokens by Provider</CardTitle></CardHeader>
          <CardContent>
            <ChartContainer config={{}} className="h-64 w-full">
              <PieChart accessibilityLayer={false}>
                <Pie data={provDonutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                  {provDonutData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent />} />
              </PieChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/* ========== Timeline ========== */
function TimelinePage({ data, groupBy, setGroupBy, tokenType, setTokenType, chartType, setChartType }: {
  data: ReturnType<typeof getTimelineData>
  groupBy: string; setGroupBy: (v: string) => void
  tokenType: string; setTokenType: (v: string) => void
  chartType: string; setChartType: (v: string) => void
}) {
  const chartConfig = Object.fromEntries(
    data.models.map((m) => [m.key, { label: parseModelKey(m.key).name, color: m.color }])
  )

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Timeline</h2>
        <p className="text-sm text-muted-foreground">Token usage over time</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>Token Usage Over Time</CardTitle>
            <div className="flex gap-2 flex-wrap">
              <BtnGroup
                options={[
                  { value: "area", label: "Area" },
                  { value: "bar", label: "Bar" },
                  { value: "line", label: "Line" },
                ]}
                value={chartType}
                onChange={setChartType}
              />
              <BtnGroup
                options={[
                  { value: "input", label: "Input" },
                  { value: "output", label: "Output" },
                  { value: "reasoning", label: "Reasoning" },
                  { value: "total", label: "Total" },
                ]}
                value={tokenType}
                onChange={setTokenType}
              />
              <BtnGroup
                options={[
                  { value: "hour", label: "Hour" },
                  { value: "day", label: "Day" },
                  { value: "week", label: "Week" },
                  { value: "month", label: "Month" },
                ]}
                value={groupBy}
                onChange={setGroupBy}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[500px] w-full">
            {chartType === "bar" ? (
              <BarChart data={data.data} accessibilityLayer={false}>
                <CartesianGrid vertical={false} className="stroke-border/50" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {data.models.map((m) => (
                  <Bar key={m.key} dataKey={m.key} stackId="a" fill={m.color} radius={0} name={parseModelKey(m.key).name} />
                ))}
              </BarChart>
            ) : chartType === "area" ? (
              <AreaChart data={data.data} accessibilityLayer={false}>
                <CartesianGrid vertical={false} className="stroke-border/50" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {data.models.map((m) => (
                  <Area key={m.key} dataKey={m.key} stackId="a" fill={m.color} stroke={m.color} fillOpacity={0.4} name={parseModelKey(m.key).name} />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={data.data} accessibilityLayer={false}>
                <CartesianGrid vertical={false} className="stroke-border/50" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {data.models.map((m) => (
                  <Line key={m.key} dataKey={m.key} stroke={m.color} strokeWidth={2} dot={false} name={parseModelKey(m.key).name} />
                ))}
              </LineChart>
            )}
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}

/* ========== Sessions ========== */
function SessionsPage({ rows, messages, sessionTranscripts }: { rows: ReturnType<typeof getSessionRows>; messages: NormalizedMessage[]; sessionTranscripts: Record<string, SessionTranscriptTurn[]> }) {
  type SessionSortKey = "session_id" | "provider" | "project" | "model_count" | "messages" | "input" | "output" | "total" | "cost_estimated" | "end_ms"

  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const sessionAccessors: Record<SessionSortKey, (row: ReturnType<typeof getSessionRows>[number]) => SortValue> = {
    session_id: (row) => row.session_id,
    provider: (row) => row.provider,
    project: (row) => row.project,
    model_count: (row) => row.model_count,
    messages: (row) => row.messages,
    input: (row) => row.input,
    output: (row) => row.output,
    total: (row) => row.total,
    cost_estimated: (row) => row.cost_estimated,
    end_ms: (row) => row.end_ms,
  }
  const sessionSortTypes: Partial<Record<SessionSortKey, "string" | "number">> = {
    session_id: "string",
    provider: "string",
    project: "string",
    model_count: "number",
    messages: "number",
    input: "number",
    output: "number",
    total: "number",
    cost_estimated: "number",
    end_ms: "number",
  }
  const { sortedRows, sortConfig, requestSort } = useSortedRows(
    rows,
    sessionAccessors,
    { key: "total", direction: "desc" },
    sessionSortTypes,
    { model_count: "desc", messages: "desc", input: "desc", output: "desc", total: "desc", cost_estimated: "desc", end_ms: "desc" }
  )

  useEffect(() => {
    if (selectedSessionKey && !sortedRows.some((row) => getSessionKey(row.provider, row.session_id) === selectedSessionKey)) {
      setSelectedSessionKey(null)
    }
  }, [selectedSessionKey, sortedRows])

  const selectedRow = selectedSessionKey
    ? sortedRows.find((row) => getSessionKey(row.provider, row.session_id) === selectedSessionKey)
    : undefined
  const selectedMessages = useMemo(() => {
    if (!selectedSessionKey) return []

    const [provider, ...sessionIdParts] = selectedSessionKey.split(":")
    const sessionId = sessionIdParts.join(":")
    return messages
      .filter((message) => message.provider === provider && message.session_id === sessionId)
      .sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0))
  }, [messages, selectedSessionKey])
  const selectedTranscriptTurns = selectedSessionKey ? sessionTranscripts[selectedSessionKey] || [] : []
  const useVirtualizedTable = sortedRows.length > VIRTUALIZED_TABLE_THRESHOLD
  const sessionColumns: VirtualizedTableColumn<ReturnType<typeof getSessionRows>[number]>[] = [
    {
      key: "session_id",
      width: "minmax(160px, 1.2fr)",
      header: <SortButton label="Session" sortKey="session_id" sortConfig={sortConfig} onSort={requestSort} />,
      renderCell: (row) => <OverflowText value={row.session_id} className="max-w-[24rem] font-mono text-xs" />,
    },
    {
      key: "provider",
      width: "minmax(110px, 0.8fr)",
      header: <SortButton label="Source" sortKey="provider" sortConfig={sortConfig} onSort={requestSort} />,
      renderCell: (row) => (
        <Badge variant="outline" style={{ color: PROVIDER_COLORS[row.provider] || "#a39e90" }}>
          {row.provider}
        </Badge>
      ),
    },
    {
      key: "project",
      width: "minmax(220px, 1.5fr)",
      header: <SortButton label="Project" sortKey="project" sortConfig={sortConfig} onSort={requestSort} />,
      renderCell: (row) => <OverflowText value={row.project} className="max-w-[36rem] text-xs text-muted-foreground" />,
    },
    {
      key: "model_count",
      width: "minmax(80px, 0.55fr)",
      header: <SortButton label="Models" sortKey="model_count" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.model_count} />,
    },
    {
      key: "messages",
      width: "minmax(90px, 0.6fr)",
      header: <SortButton label="Messages" sortKey="messages" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.messages} />,
    },
    {
      key: "input",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Input" sortKey="input" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.input} />,
    },
    {
      key: "output",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Output" sortKey="output" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.output} />,
    },
    {
      key: "total",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Total" sortKey="total" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.total} />,
    },
    {
      key: "cost_estimated",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Est. Cost" sortKey="cost_estimated" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-primary",
      renderCell: (row) => fmtCost(row.cost_estimated),
    },
    {
      key: "end_ms",
      width: "minmax(130px, 0.95fr)",
      header: <SortButton label="Last Active" sortKey="end_ms" sortConfig={sortConfig} onSort={requestSort} />,
      renderCell: (row) => <div className="text-xs">{fmtDateTime(row.end_ms)}</div>,
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Sessions</h2>
        <p className="text-sm text-muted-foreground">Session-level usage by tool/provider</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Sessions by Token Usage</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {useVirtualizedTable ? (
            <VirtualizedTable
              rows={sortedRows}
              columns={sessionColumns}
              getRowKey={(row) => getSessionKey(row.provider, row.session_id)}
              estimateRowHeight={() => 46}
              maxHeightClassName="max-h-[70vh]"
              selectedRowKey={selectedSessionKey}
              onRowClick={(row) => setSelectedSessionKey(getSessionKey(row.provider, row.session_id))}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader label="Session" sortKey="session_id" sortConfig={sortConfig} onSort={requestSort} />
                  <SortableHeader label="Source" sortKey="provider" sortConfig={sortConfig} onSort={requestSort} />
                  <SortableHeader label="Project" sortKey="project" sortConfig={sortConfig} onSort={requestSort} />
                  <SortableHeader label="Models" sortKey="model_count" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Messages" sortKey="messages" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Input" sortKey="input" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Output" sortKey="output" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Total" sortKey="total" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Est. Cost" sortKey="cost_estimated" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Last Active" sortKey="end_ms" sortConfig={sortConfig} onSort={requestSort} />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((s) => {
                  const sessionKey = getSessionKey(s.provider, s.session_id)
                  return (
                    <TableRow
                      key={sessionKey}
                      onClick={() => setSelectedSessionKey(sessionKey)}
                      className="cursor-pointer"
                      data-state={selectedSessionKey === sessionKey ? "selected" : undefined}
                    >
                      <TableCell className="font-mono text-xs">
                        <OverflowText value={s.session_id} className="max-w-[24rem]" />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" style={{ color: PROVIDER_COLORS[s.provider] || "#a39e90" }}>
                          {s.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <OverflowText value={s.project} className="max-w-[36rem]" />
                      </TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={s.model_count} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={s.messages} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={s.input} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={s.output} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={s.total} /></TableCell>
                      <TableCell className="text-right font-mono text-primary">{fmtCost(s.cost_estimated)}</TableCell>
                      <TableCell className="text-xs">{fmtDateTime(s.end_ms)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <SessionReplayPanel row={selectedRow} messages={selectedMessages} transcriptTurns={selectedTranscriptTurns} open={Boolean(selectedRow)} onClose={() => setSelectedSessionKey(null)} />
    </div>
  )
}

function SessionReplayPanel({
  row,
  messages,
  transcriptTurns,
  open,
  onClose,
}: {
  row?: ReturnType<typeof getSessionRows>[number]
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

  const conversation = (() => {
    if (!transcriptTurns.length) return []

    let assistantMessageIndex = 0
    return transcriptTurns
      .slice()
      .sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0))
      .map((turn, index) => {
        const normalizedRole = turn.role === "assistant" ? "assistant" : turn.role === "user" ? "user" : "system"
        const matchedMessage = normalizedRole === "assistant" ? messages[assistantMessageIndex++] : undefined
        return {
          ...turn,
          role: normalizedRole,
          order: index + 1,
          matchedMessage,
        }
      })
  })()
  const shouldVirtualizeConversation = conversation.length > 24
  const shouldVirtualizeTimeline = timeline.length > 40

  return (
    <div className="fixed inset-0 z-50 bg-black/60" onClick={onClose}>
      <div
        className="absolute inset-y-0 right-0 h-full w-full max-w-3xl overflow-y-auto border-l border-border bg-background shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-6 py-4 backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Session replay</p>
              <h3 className="mt-1 text-lg font-bold">{row.provider}:{row.session_id}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{row.project || "unknown project"}</p>
            </div>
            <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
          </div>
        </div>

        <div className="space-y-6 px-6 py-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Messages" value={fmtCompact(row.messages)} sub={fmtNum(row.messages) + " assistant turns"} />
            <StatCard label="Models" value={fmtCompact(row.model_count)} sub="distinct models" />
            <StatCard label="Tokens" value={fmtCompact(row.total)} sub={fmtNum(row.total) + " total"} color="#d97757" />
            <StatCard label="Duration" value={fmtElapsed(Math.max(0, row.end_ms - row.start_ms))} sub={fmtDateTime(row.end_ms)} color="#4f7f78" />
          </div>

          <Card>
            <CardHeader><CardTitle>How to read this</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {conversation.length
                ? "This replay uses local-only transcript data from your machine. Those generated transcript files live in gitignored paths, so they are available in the dashboard without being committed."
                : "This provider session only has token metadata available right now, so the replay below falls back to the assistant-turn timeline instead of literal prompt/response text."}
            </CardContent>
          </Card>

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
              <CardHeader><CardTitle>Conversation replay</CardTitle></CardHeader>
              <CardContent>
                {shouldVirtualizeConversation ? (
                  <VirtualizedStack
                    items={conversation}
                    getKey={(turn, index) => `${turn.role}:${turn.order}:${turn.timestamp_ms}:${index}`}
                    estimateHeight={(turn) => 120 + Math.min(1200, Math.ceil(turn.text.length / 90) * 24) + (turn.matchedMessage ? 150 : 0)}
                    maxHeightClassName="max-h-[70vh]"
                    renderItem={(turn, index) => {
                      const previous = conversation[index - 1]
                      const gapMs = previous?.timestamp_ms && turn.timestamp_ms ? turn.timestamp_ms - previous.timestamp_ms : 0
                      const matchedMessage = turn.matchedMessage

                      return (
                        <div className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-xl border px-4 py-3 ${turn.role === "user" ? "border-primary/30 bg-primary/10" : turn.role === "assistant" ? "border-border bg-card" : "border-border bg-muted/40"}`}>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-semibold uppercase tracking-wider">{turn.role}</span>
                              {turn.model && <Badge variant="outline">{parseModelKey(turn.model.includes("[") ? turn.model : `${turn.model} [${row.provider}]`).name}</Badge>}
                              <span>{fmtDateTime(turn.timestamp_ms)}</span>
                              {gapMs > 0 && <span>{fmtGap(gapMs)}</span>}
                            </div>
                            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">{turn.text}</pre>

                            {matchedMessage && (
                              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Input</div>
                                  <div className="font-mono text-sm">{fmtNum(matchedMessage.input)}</div>
                                </div>
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Output</div>
                                  <div className="font-mono text-sm">{fmtNum(matchedMessage.output)}</div>
                                </div>
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Reasoning</div>
                                  <div className="font-mono text-sm">{fmtNum(matchedMessage.reasoning)}</div>
                                </div>
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Cache Read</div>
                                  <div className="font-mono text-sm">{fmtNum(matchedMessage.cache_read)}</div>
                                </div>
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Logged Cost</div>
                                  <div className="font-mono text-sm">{fmtCost(matchedMessage.cost_logged)}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    }}
                  />
                ) : (
                  <div className="space-y-3">
                    {conversation.map((turn, index) => {
                      const previous = conversation[index - 1]
                      const gapMs = previous?.timestamp_ms && turn.timestamp_ms ? turn.timestamp_ms - previous.timestamp_ms : 0
                      const matchedMessage = turn.matchedMessage

                      return (
                        <div key={`${turn.role}:${turn.order}:${turn.timestamp_ms}:${index}`} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={`max-w-[85%] rounded-xl border px-4 py-3 ${turn.role === "user" ? "border-primary/30 bg-primary/10" : turn.role === "assistant" ? "border-border bg-card" : "border-border bg-muted/40"}`}>
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span className="font-semibold uppercase tracking-wider">{turn.role}</span>
                              {turn.model && <Badge variant="outline">{parseModelKey(turn.model.includes("[") ? turn.model : `${turn.model} [${row.provider}]`).name}</Badge>}
                              <span>{fmtDateTime(turn.timestamp_ms)}</span>
                              {gapMs > 0 && <span>{fmtGap(gapMs)}</span>}
                            </div>
                            <pre className="mt-3 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-foreground">{turn.text}</pre>

                            {matchedMessage && (
                              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Input</div>
                                  <div className="font-mono text-sm">{fmtNum(matchedMessage.input)}</div>
                                </div>
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Output</div>
                                  <div className="font-mono text-sm">{fmtNum(matchedMessage.output)}</div>
                                </div>
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Reasoning</div>
                                  <div className="font-mono text-sm">{fmtNum(matchedMessage.reasoning)}</div>
                                </div>
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Cache Read</div>
                                  <div className="font-mono text-sm">{fmtNum(matchedMessage.cache_read)}</div>
                                </div>
                                <div className="rounded-md bg-muted/40 px-3 py-2">
                                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Logged Cost</div>
                                  <div className="font-mono text-sm">{fmtCost(matchedMessage.cost_logged)}</div>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
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
                  renderItem={(message) => (
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
                  )}
                />
              ) : (
                <div className="space-y-3">
                  {timeline.map((message) => (
                    <div key={`${message.session_id}:${message.turnNumber}:${message.timestamp_ms}`} className="rounded-lg border border-border bg-card px-4 py-4">
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

/* ========== Models ========== */
function ModelsPage({ rows }: { rows: ReturnType<typeof getModelRows> }) {
  type ModelSortKey = "model" | "provider" | "messages" | "input" | "output" | "reasoning" | "cache_read" | "total" | "cost_estimated"

  const modelAccessors: Record<ModelSortKey, (row: ReturnType<typeof getModelRows>[number]) => SortValue> = {
    model: (row) => parseModelKey(row.key).name,
    provider: (row) => row.provider,
    messages: (row) => row.messages,
    input: (row) => row.input,
    output: (row) => row.output,
    reasoning: (row) => row.reasoning,
    cache_read: (row) => row.cache_read,
    total: (row) => row.input + row.output,
    cost_estimated: (row) => row.cost_estimated,
  }
  const modelSortTypes: Partial<Record<ModelSortKey, "string" | "number">> = {
    model: "string",
    provider: "string",
    messages: "number",
    input: "number",
    output: "number",
    reasoning: "number",
    cache_read: "number",
    total: "number",
    cost_estimated: "number",
  }
  const { sortedRows, sortConfig, requestSort } = useSortedRows(
    rows,
    modelAccessors,
    { key: "total", direction: "desc" },
    modelSortTypes,
    { messages: "desc", input: "desc", output: "desc", reasoning: "desc", cache_read: "desc", total: "desc", cost_estimated: "desc" }
  )
  const useVirtualizedTable = sortedRows.length > VIRTUALIZED_TABLE_THRESHOLD
  const modelColumns: VirtualizedTableColumn<ReturnType<typeof getModelRows>[number]>[] = [
    {
      key: "model",
      width: "minmax(220px, 1.4fr)",
      header: <SortButton label="Model" sortKey="model" sortConfig={sortConfig} onSort={requestSort} />,
      renderCell: (row) => {
        const parsed = parseModelKey(row.key)
        return (
          <Badge
            variant="outline"
            className="font-normal"
            style={{ color: row.color, borderColor: row.color + "60", background: row.color + "15" }}
          >
            {parsed.name}
          </Badge>
        )
      },
    },
    {
      key: "provider",
      width: "minmax(110px, 0.8fr)",
      header: <SortButton label="Source" sortKey="provider" sortConfig={sortConfig} onSort={requestSort} />,
      renderCell: (row) => (
        <Badge variant="outline" className="text-xs" style={{ color: PROVIDER_COLORS[row.provider] || "#a39e90" }}>
          {row.provider}
        </Badge>
      ),
    },
    {
      key: "messages",
      width: "minmax(90px, 0.6fr)",
      header: <SortButton label="Messages" sortKey="messages" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.messages} />,
    },
    {
      key: "input",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Input" sortKey="input" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.input} />,
    },
    {
      key: "output",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Output" sortKey="output" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.output} />,
    },
    {
      key: "reasoning",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Reasoning" sortKey="reasoning" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.reasoning} />,
    },
    {
      key: "cache_read",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Cache Read" sortKey="cache_read" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.cache_read} />,
    },
    {
      key: "total",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Total" sortKey="total" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.input + row.output} />,
    },
    {
      key: "cost_estimated",
      width: "minmax(100px, 0.7fr)",
      header: <SortButton label="Est. Cost" sortKey="cost_estimated" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono text-primary",
      renderCell: (row) => fmtCost(row.cost_estimated),
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Models</h2>
        <p className="text-sm text-muted-foreground">Token usage by model</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Token Usage by Model</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {useVirtualizedTable ? (
            <VirtualizedTable
              rows={sortedRows}
              columns={modelColumns}
              getRowKey={(row) => row.key}
              estimateRowHeight={() => 46}
              maxHeightClassName="max-h-[70vh]"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader label="Model" sortKey="model" sortConfig={sortConfig} onSort={requestSort} />
                  <SortableHeader label="Source" sortKey="provider" sortConfig={sortConfig} onSort={requestSort} />
                  <SortableHeader label="Messages" sortKey="messages" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Input" sortKey="input" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Output" sortKey="output" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Reasoning" sortKey="reasoning" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Cache Read" sortKey="cache_read" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Total" sortKey="total" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Est. Cost" sortKey="cost_estimated" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((m) => {
                  const parsed = parseModelKey(m.key)
                  return (
                    <TableRow key={m.key}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="font-normal"
                          style={{ color: m.color, borderColor: m.color + "60", background: m.color + "15" }}
                        >
                          {parsed.name}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs" style={{ color: PROVIDER_COLORS[m.provider] || "#a39e90" }}>
                          {m.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={m.messages} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={m.input} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={m.output} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={m.reasoning} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={m.cache_read} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={m.input + m.output} /></TableCell>
                      <TableCell className="text-right font-mono text-primary">{fmtCost(m.cost_estimated)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ========== Projects ========== */
function ProjectsPage({ rows }: { rows: ReturnType<typeof getProjectRows> }) {
  type ProjectSortKey = "name" | "messages" | "input" | "output" | "total"

  const projectAccessors: Record<ProjectSortKey, (row: ReturnType<typeof getProjectRows>[number]) => SortValue> = {
    name: (row) => row.name,
    messages: (row) => row.messages,
    input: (row) => row.input,
    output: (row) => row.output,
    total: (row) => row.total,
  }
  const projectSortTypes: Partial<Record<ProjectSortKey, "string" | "number">> = {
    name: "string",
    messages: "number",
    input: "number",
    output: "number",
    total: "number",
  }
  const { sortedRows, sortConfig, requestSort } = useSortedRows(
    rows,
    projectAccessors,
    { key: "total", direction: "desc" },
    projectSortTypes,
    { messages: "desc", input: "desc", output: "desc", total: "desc" }
  )
  const useVirtualizedTable = sortedRows.length > VIRTUALIZED_TABLE_THRESHOLD
  const projectColumns: VirtualizedTableColumn<ReturnType<typeof getProjectRows>[number]>[] = [
    {
      key: "name",
      width: "minmax(260px, 1.8fr)",
      header: <SortButton label="Project" sortKey="name" sortConfig={sortConfig} onSort={requestSort} />,
      renderCell: (row) => <OverflowText value={row.name} className="max-w-[44rem] font-mono text-xs text-muted-foreground" />,
    },
    {
      key: "messages",
      width: "minmax(90px, 0.7fr)",
      header: <SortButton label="Messages" sortKey="messages" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.messages} />,
    },
    {
      key: "input",
      width: "minmax(100px, 0.8fr)",
      header: <SortButton label="Input" sortKey="input" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.input} />,
    },
    {
      key: "output",
      width: "minmax(100px, 0.8fr)",
      header: <SortButton label="Output" sortKey="output" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.output} />,
    },
    {
      key: "total",
      width: "minmax(100px, 0.8fr)",
      header: <SortButton label="Total" sortKey="total" sortConfig={sortConfig} onSort={requestSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.total} />,
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Projects</h2>
        <p className="text-sm text-muted-foreground">Token usage by project</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Projects by Token Usage</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {useVirtualizedTable ? (
            <VirtualizedTable
              rows={sortedRows}
              columns={projectColumns}
              getRowKey={(row) => row.name}
              estimateRowHeight={() => 46}
              maxHeightClassName="max-h-[70vh]"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader label="Project" sortKey="name" sortConfig={sortConfig} onSort={requestSort} />
                  <SortableHeader label="Messages" sortKey="messages" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Input" sortKey="input" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Output" sortKey="output" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                  <SortableHeader label="Total" sortKey="total" sortConfig={sortConfig} onSort={requestSort} className="text-right" align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <OverflowText value={r.name} className="max-w-[44rem]" />
                    </TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.messages} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.input} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.output} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.total} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/* ========== PR Page ========== */
function PRPage({
  hasGitHubData,
  prs,
  stats,
  reviewStats,
  orgOptions,
  selectedOrg,
  onSelectedOrgChange,
}: {
  hasGitHubData: boolean
  prs: DashboardData["github_prs"]["prs"]
  stats: PRStats
  reviewStats: ReviewStats
  orgOptions: PROrgOption[]
  selectedOrg: string
  onSelectedOrgChange: (value: string) => void
}) {
  const [activeTab, setActiveTab] = useState<"creation" | "reviews">("creation")

  if (!hasGitHubData) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-2">Pull Requests</h2>
        <p className="text-muted-foreground">No GitHub PR data available.</p>
      </div>
    )
  }

  const months = Object.keys(stats.byMonth).sort()
  const timelineData = months.map((m) => ({
    month: m,
    merged: stats.byMonth[m].merged,
    open: stats.byMonth[m].open,
    closed: stats.byMonth[m].closed,
  }))
  const mergedPerDayData = getMergedPRsPerDayRows(prs, months)
  const mergeTimeData = getMergeTimeRows(prs, months)
  const reviewMonths = Object.keys(reviewStats.byMonth).sort()
  const reviewTimelineData = reviewMonths.map((month) => ({ month, reviews: reviewStats.byMonth[month] }))
  const repositoryCount = Object.keys(stats.perProject).length
  const hasPRs = stats.total > 0
  const hasReviews = reviewStats.total > 0
  function fmtMergeTime(h: number) {
    if (!h) return "N/A"
    if (h < 24) return h + "h"
    return (h / 24).toFixed(1) + "d"
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Pull Requests</h2>
        <p className="text-sm text-muted-foreground">GitHub PR statistics across all repositories</p>
      </div>

      <div className="mb-6 grid gap-3 xl:grid-cols-[1fr_auto_1fr] xl:items-center">
        <div className="hidden xl:block" />

        <div className="flex justify-center">
          <BtnGroup
            options={[
              { value: "creation", label: `Creation (${fmtNum(stats.total)})` },
              { value: "reviews", label: `Reviews (${fmtNum(reviewStats.total)})` },
            ]}
            value={activeTab}
            onChange={(value) => setActiveTab(value as "creation" | "reviews")}
            className="rounded-xl"
            buttonClassName="min-h-9 px-4 py-2 text-sm font-medium"
          />
        </div>

        {orgOptions.length > 0 && (
          <div className="flex justify-center xl:justify-end">
            <div className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5">
              <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Org</span>
              <Select value={selectedOrg} onValueChange={onSelectedOrgChange}>
                <SelectTrigger className="h-9 min-w-52 border-border/60 bg-transparent text-sm shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All organizations</SelectItem>
                  {orgOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </div>

      {!hasPRs && !hasReviews && (
        <Card className="mb-6">
          <CardContent className="px-4 py-6 text-sm text-muted-foreground">
            No pull requests or reviews found for {selectedOrg === "all" ? "the selected data" : selectedOrg}.
          </CardContent>
        </Card>
      )}

      {activeTab === "creation" && hasPRs && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
            <StatCard label="Total PRs" value={fmtCompact(stats.total)} sub={fmtNum(stats.total) + " pull requests"} />
            <StatCard label="Merged" value={fmtCompact(stats.merged)} sub={`${stats.total > 0 ? (stats.merged / stats.total * 100).toFixed(1) : "0.0"}% merge rate`} color="#6f8b6e" />
            <StatCard label="Closed" value={fmtCompact(stats.closed)} sub="closed without merge" color="#8b6f9b" />
            <StatCard label="Repositories" value={fmtCompact(repositoryCount)} sub="unique repos" color="#d97757" />
            <StatCard label="Avg Time to Merge" value={fmtMergeTime(stats.mergeTimeStats?.avg || 0)} sub="average merge time" color="#4f7f78" />
            <StatCard label="P90 Time to Merge" value={fmtMergeTime(stats.mergeTimeStats?.p90 || 0)} sub="P90 merge time" color="#d97757" />
          </div>

          <Card className="mb-6">
            <CardHeader><CardTitle>PRs Over Time</CardTitle></CardHeader>
            <CardContent>
              <ChartContainer config={{ merged: { label: "Merged", color: "#6f8b6e" }, open: { label: "Open", color: "#b88a5a" }, closed: { label: "Closed", color: "#8b6f9b" } }} className="h-72 w-full">
                <BarChart data={timelineData} accessibilityLayer={false}>
                  <CartesianGrid vertical={false} className="stroke-border/50" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={50} />
                  <YAxis tickLine={false} axisLine={false} className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="merged" stackId="a" fill="#6f8b6e" radius={0} />
                  <Bar dataKey="open" stackId="a" fill="#b88a5a" radius={0} />
                  <Bar dataKey="closed" stackId="a" fill="#8b6f9b" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader><CardTitle>Avg Merged PRs per Day</CardTitle></CardHeader>
            <CardContent>
              <ChartContainer config={{ workday: { label: "Avg Merged PRs / Workday", color: "#6f8b6e" }, weekend: { label: "Avg Merged PRs / Weekend Day", color: "#8b6f9b" }, rollingWorkday: { label: "3-month Rolling Avg (Workday)", color: "#d97757" } }} className="h-72 w-full">
                <ComposedChart data={mergedPerDayData} accessibilityLayer={false}>
                  <CartesianGrid vertical={false} className="stroke-border/50" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={50} />
                  <YAxis tickLine={false} axisLine={false} className="text-xs" />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="workday" fill="#6f8b6ecc" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="weekend" fill="#8b6f9bcc" radius={[4, 4, 0, 0]} />
                  <Line dataKey="rollingWorkday" stroke="#d97757" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader><CardTitle>Avg Time to Merge</CardTitle></CardHeader>
            <CardContent>
              <ChartContainer config={{ avg: { label: "Avg Time to Merge", color: "#d97757" }, median: { label: "Median Time to Merge", color: "#6f8b6e" } }} className="h-72 w-full">
                <ComposedChart data={mergeTimeData} accessibilityLayer={false}>
                  <CartesianGrid vertical={false} className="stroke-border/50" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={50} />
                  <YAxis tickLine={false} axisLine={false} className="text-xs" tickFormatter={(value) => fmtMergeTime(Number(value))} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="avg" name="Avg Time to Merge" fill="#d97757cc" radius={[4, 4, 0, 0]} />
                  <Line dataKey="median" name="Median Time to Merge" stroke="#6f8b6e" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </>
      )}

      {activeTab === "creation" && !hasPRs && hasReviews && (
        <Card className="mb-6">
          <CardContent className="px-4 py-6 text-sm text-muted-foreground">
            No pull request creation data found for {selectedOrg === "all" ? "the selected data" : selectedOrg}.
          </CardContent>
        </Card>
      )}

      {activeTab === "reviews" && (
        <>
          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-1">Reviews</h3>
            <p className="text-sm text-muted-foreground">Review activity for the same PR scope</p>
          </div>

          {hasReviews ? (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                <StatCard label="Total Reviews" value={fmtCompact(reviewStats.total)} sub={`${fmtNum(reviewStats.total)} reviews given`} />
                <StatCard label="Approved" value={fmtCompact(reviewStats.byState.APPROVED || 0)} sub={`${reviewStats.total > 0 ? (((reviewStats.byState.APPROVED || 0) / reviewStats.total) * 100).toFixed(1) : "0.0"}%`} color="#6f8b6e" />
                <StatCard label="Commented" value={fmtCompact(reviewStats.byState.COMMENTED || 0)} sub={`${reviewStats.total > 0 ? (((reviewStats.byState.COMMENTED || 0) / reviewStats.total) * 100).toFixed(1) : "0.0"}%`} color="#b88a5a" />
                <StatCard label="Changes Requested" value={fmtCompact(reviewStats.byState.CHANGES_REQUESTED || 0)} sub={`${reviewStats.total > 0 ? (((reviewStats.byState.CHANGES_REQUESTED || 0) / reviewStats.total) * 100).toFixed(1) : "0.0"}%`} color="#d97757" />
              </div>

              <Card>
                <CardHeader><CardTitle>Reviews Over Time</CardTitle></CardHeader>
                <CardContent>
                  <ChartContainer config={{ reviews: { label: "Reviews Given", color: "#4f7f78" } }} className="h-72 w-full">
                    <BarChart data={reviewTimelineData} accessibilityLayer={false}>
                      <CartesianGrid vertical={false} className="stroke-border/50" />
                      <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={50} />
                      <YAxis tickLine={false} axisLine={false} className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="reviews" fill="#4f7f78cc" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="mb-6">
              <CardContent className="px-4 py-6 text-sm text-muted-foreground">
                No reviews found for {selectedOrg === "all" ? "the selected data" : selectedOrg}.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

/* ========== PR Details ========== */
function PRDetailsPage({
  hasGitHubData,
  stats,
  orgOptions,
  selectedOrg,
  onSelectedOrgChange,
}: {
  hasGitHubData: boolean
  stats: PRStats
  orgOptions: PROrgOption[]
  selectedOrg: string
  onSelectedOrgChange: (value: string) => void
}) {
  if (!hasGitHubData) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-2">PR Details</h2>
        <p className="text-muted-foreground">No GitHub PR data available.</p>
      </div>
    )
  }

  const sizeRows = [
    { label: "Lines Changed", stats: stats.sizeStats.lines_changed },
    { label: "Additions", stats: stats.sizeStats.additions },
    { label: "Deletions", stats: stats.sizeStats.deletions },
    { label: "Files Changed", stats: stats.sizeStats.files_changed },
  ].filter((r) => r.stats)
  type SizeSortKey = "label" | "avg" | "p25" | "p50" | "p75" | "p90" | "p95" | "p99" | "max"
  type RepoSortKey = "repo" | "total" | "merged" | "open" | "closed"

  const sizeAccessors: Record<SizeSortKey, (row: typeof sizeRows[number]) => SortValue> = {
    label: (row) => row.label,
    avg: (row) => row.stats?.avg || 0,
    p25: (row) => row.stats?.p25 || 0,
    p50: (row) => row.stats?.p50 || 0,
    p75: (row) => row.stats?.p75 || 0,
    p90: (row) => row.stats?.p90 || 0,
    p95: (row) => row.stats?.p95 || 0,
    p99: (row) => row.stats?.p99 || 0,
    max: (row) => row.stats?.max || 0,
  }
  const sizeSortTypes: Partial<Record<SizeSortKey, "string" | "number">> = {
    label: "string",
    avg: "number",
    p25: "number",
    p50: "number",
    p75: "number",
    p90: "number",
    p95: "number",
    p99: "number",
    max: "number",
  }
  const { sortedRows: sortedSizeRows, sortConfig: sizeSortConfig, requestSort: requestSizeSort } = useSortedRows(
    sizeRows,
    sizeAccessors,
    { key: "label", direction: "asc" },
    sizeSortTypes,
    { avg: "desc", p25: "desc", p50: "desc", p75: "desc", p90: "desc", p95: "desc", p99: "desc", max: "desc" }
  )

  const perProject = Object.entries(stats.perProject).map(([repo, summary]) => ({ repo, ...summary }))
  const repoAccessors: Record<RepoSortKey, (row: typeof perProject[number]) => SortValue> = {
    repo: (row) => row.repo,
    total: (row) => row.total,
    merged: (row) => row.merged,
    open: (row) => row.open,
    closed: (row) => row.closed,
  }
  const repoSortTypes: Partial<Record<RepoSortKey, "string" | "number">> = {
    repo: "string",
    total: "number",
    merged: "number",
    open: "number",
    closed: "number",
  }
  const { sortedRows: sortedProjects, sortConfig: repoSortConfig, requestSort: requestRepoSort } = useSortedRows(
    perProject,
    repoAccessors,
    { key: "total", direction: "desc" },
    repoSortTypes,
    { total: "desc", merged: "desc", open: "desc", closed: "desc" }
  )
  const useVirtualizedRepoTable = sortedProjects.length > VIRTUALIZED_TABLE_THRESHOLD
  const repoColumns: VirtualizedTableColumn<(typeof perProject)[number]>[] = [
    {
      key: "repo",
      width: "minmax(220px, 1.7fr)",
      header: <SortButton label="Repository" sortKey="repo" sortConfig={repoSortConfig} onSort={requestRepoSort} />,
      renderCell: (row) => <OverflowText value={row.repo} className="max-w-[44rem] font-mono text-sm" />,
    },
    {
      key: "total",
      width: "minmax(90px, 0.7fr)",
      header: <SortButton label="Total" sortKey="total" sortConfig={repoSortConfig} onSort={requestRepoSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.total} />,
    },
    {
      key: "merged",
      width: "minmax(90px, 0.7fr)",
      header: <SortButton label="Merged" sortKey="merged" sortConfig={repoSortConfig} onSort={requestRepoSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.merged} />,
    },
    {
      key: "open",
      width: "minmax(90px, 0.7fr)",
      header: <SortButton label="Open" sortKey="open" sortConfig={repoSortConfig} onSort={requestRepoSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.open} />,
    },
    {
      key: "closed",
      width: "minmax(90px, 0.7fr)",
      header: <SortButton label="Closed" sortKey="closed" sortConfig={repoSortConfig} onSort={requestRepoSort} align="right" />,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => <TableNumber value={row.closed} />,
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">PR Details</h2>
        <p className="text-sm text-muted-foreground">Size percentiles and per-repository breakdown</p>
      </div>

      <PROrgFilter orgOptions={orgOptions} selectedOrg={selectedOrg} onSelectedOrgChange={onSelectedOrgChange} />

      {stats.total === 0 && (
        <Card className="mb-6">
          <CardContent className="px-4 py-6 text-sm text-muted-foreground">
            No pull requests found for {selectedOrg === "all" ? "the selected data" : selectedOrg}.
          </CardContent>
        </Card>
      )}

      {stats.total > 0 && sizeRows.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle>PR Size Percentiles</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader label="Metric" sortKey="label" sortConfig={sizeSortConfig} onSort={requestSizeSort} />
                  <SortableHeader label="Avg" sortKey="avg" sortConfig={sizeSortConfig} onSort={requestSizeSort} className="text-right" align="right" />
                  <SortableHeader label="P25" sortKey="p25" sortConfig={sizeSortConfig} onSort={requestSizeSort} className="text-right" align="right" />
                  <SortableHeader label="P50" sortKey="p50" sortConfig={sizeSortConfig} onSort={requestSizeSort} className="text-right" align="right" />
                  <SortableHeader label="P75" sortKey="p75" sortConfig={sizeSortConfig} onSort={requestSizeSort} className="text-right" align="right" />
                  <SortableHeader label="P90" sortKey="p90" sortConfig={sizeSortConfig} onSort={requestSizeSort} className="text-right" align="right" />
                  <SortableHeader label="P95" sortKey="p95" sortConfig={sizeSortConfig} onSort={requestSizeSort} className="text-right" align="right" />
                  <SortableHeader label="P99" sortKey="p99" sortConfig={sizeSortConfig} onSort={requestSizeSort} className="text-right" align="right" />
                  <SortableHeader label="Max" sortKey="max" sortConfig={sizeSortConfig} onSort={requestSizeSort} className="text-right" align="right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedSizeRows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.stats?.avg || 0} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.stats?.p25 || 0} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.stats?.p50 || 0} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.stats?.p75 || 0} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.stats?.p90 || 0} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.stats?.p95 || 0} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.stats?.p99 || 0} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={r.stats?.max || 0} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {stats.total > 0 && (
        <Card>
          <CardHeader><CardTitle>PRs per Repository</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {useVirtualizedRepoTable ? (
              <VirtualizedTable
                rows={sortedProjects}
                columns={repoColumns}
                getRowKey={(row) => row.repo}
                estimateRowHeight={() => 46}
                maxHeightClassName="max-h-[70vh]"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHeader label="Repository" sortKey="repo" sortConfig={repoSortConfig} onSort={requestRepoSort} />
                    <SortableHeader label="Total" sortKey="total" sortConfig={repoSortConfig} onSort={requestRepoSort} className="text-right" align="right" />
                    <SortableHeader label="Merged" sortKey="merged" sortConfig={repoSortConfig} onSort={requestRepoSort} className="text-right" align="right" />
                    <SortableHeader label="Open" sortKey="open" sortConfig={repoSortConfig} onSort={requestRepoSort} className="text-right" align="right" />
                    <SortableHeader label="Closed" sortKey="closed" sortConfig={repoSortConfig} onSort={requestRepoSort} className="text-right" align="right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedProjects.map((project) => (
                    <TableRow key={project.repo}>
                      <TableCell className="font-mono text-sm">
                        <OverflowText value={project.repo} className="max-w-[44rem]" />
                      </TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={project.total} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={project.merged} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={project.open} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={project.closed} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
