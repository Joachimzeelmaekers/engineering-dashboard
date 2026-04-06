import { useState, useMemo } from "react"
import type { DashboardData, NormalizedMessage } from "@/lib/types"
import { normalizeMessages, filterMessages, getModelRows, getSessionRows, getProviderRows, getProjectRows, getTimelineData } from "@/lib/data"
import { PROVIDER_COLORS, parseModelKey, fmtNum, fmtCompact, fmtCost, fmtDateTime } from "@/lib/constants"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Bar, BarChart, Line, LineChart, XAxis, YAxis, CartesianGrid, Pie, PieChart, Cell, Area, AreaChart } from "recharts"

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

export default function Dashboard({ data }: { data: DashboardData }) {
  const [page, setPage] = useState("overview")
  const [activeProvider, setActiveProvider] = useState("all")
  const [globalRange, setGlobalRange] = useState("90d")
  const [tlGroupBy, setTlGroupBy] = useState("day")
  const [tlTokenType, setTlTokenType] = useState("total")
  const [tlChartType, setTlChartType] = useState("area")

  const allMessages = useMemo(() => normalizeMessages(data.messages), [data.messages])
  const filtered = useMemo(() => filterMessages(allMessages, activeProvider, globalRange), [allMessages, activeProvider, globalRange])
  const activeProviders = useMemo(() => Object.keys(data.provider_totals).sort(), [data.provider_totals])
  const modelRows = useMemo(() => getModelRows(filtered, data.model_stats), [filtered, data.model_stats])
  const sessionRows = useMemo(() => getSessionRows(filtered, data.model_stats), [filtered, data.model_stats])
  const providerRows = useMemo(() => getProviderRows(filtered), [filtered])
  const projectRows = useMemo(() => getProjectRows(filtered), [filtered])
  const timelineData = useMemo(() => getTimelineData(filtered, tlGroupBy, tlTokenType), [filtered, tlGroupBy, tlTokenType])

  const totals = useMemo(() => {
    const msgs = modelRows.reduce((s, m) => s + m.messages, 0)
    const inp = modelRows.reduce((s, m) => s + m.input, 0)
    const out = modelRows.reduce((s, m) => s + m.output, 0)
    const rea = modelRows.reduce((s, m) => s + m.reasoning, 0)
    const cr = modelRows.reduce((s, m) => s + m.cache_read, 0)
    const cost = modelRows.reduce((s, m) => s + m.cost_estimated, 0)
    return { msgs, inp, out, rea, cr, cost, sessions: sessionRows.length }
  }, [modelRows, sessionRows])

  const showTokenPages = !["pullrequests", "prdetails"].includes(page)

  return (
    <div className="flex min-h-screen bg-background">
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
      <main className="flex-1 overflow-auto p-6 min-w-0">
        {/* Filter bar */}
        {showTokenPages && (
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
        {page === "sessions" && <SessionsPage rows={sessionRows} />}
        {page === "models" && <ModelsPage rows={modelRows} />}
        {page === "projects" && <ProjectsPage rows={projectRows} />}
        {page === "pullrequests" && <PRPage data={data.github_prs} />}
        {page === "prdetails" && <PRDetailsPage data={data.github_prs} />}
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

function BtnGroup({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex border border-border rounded-lg overflow-hidden">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs transition-colors border-r last:border-r-0 border-border ${
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          }`}
        >
          {o.label}
        </button>
      ))}
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

const fmtAxis = (v: number) => {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M"
  if (v >= 1e3) return (v / 1e3).toFixed(0) + "K"
  return String(v)
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
            <BarChart data={barData}>
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
              <PieChart>
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
              <PieChart>
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
              <BarChart data={data.data}>
                <CartesianGrid vertical={false} className="stroke-border/50" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {data.models.map((m) => (
                  <Bar key={m.key} dataKey={m.key} stackId="a" fill={m.color} radius={0} name={parseModelKey(m.key).name} />
                ))}
              </BarChart>
            ) : chartType === "area" ? (
              <AreaChart data={data.data}>
                <CartesianGrid vertical={false} className="stroke-border/50" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {data.models.map((m) => (
                  <Area key={m.key} dataKey={m.key} stackId="a" fill={m.color} stroke={m.color} fillOpacity={0.4} name={parseModelKey(m.key).name} />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={data.data}>
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
function SessionsPage({ rows }: { rows: ReturnType<typeof getSessionRows> }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Sessions</h2>
        <p className="text-sm text-muted-foreground">Session-level usage by tool/provider</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Sessions by Token Usage</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Models</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
                <TableHead>Last Active</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.slice(0, 100).map((s) => (
                <TableRow key={`${s.provider}:${s.session_id}`}>
                  <TableCell className="font-mono text-xs max-w-32 truncate">{s.session_id}</TableCell>
                  <TableCell>
                    <Badge variant="outline" style={{ color: PROVIDER_COLORS[s.provider] || "#a39e90" }}>
                      {s.provider}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-48 truncate" title={s.project}>{s.project}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.model_count)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.messages)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.input)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.output)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.total)}</TableCell>
                  <TableCell className="text-right font-mono text-primary">{fmtCost(s.cost_estimated)}</TableCell>
                  <TableCell className="text-xs">{fmtDateTime(s.end_ms)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

/* ========== Models ========== */
function ModelsPage({ rows }: { rows: ReturnType<typeof getModelRows> }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Models</h2>
        <p className="text-sm text-muted-foreground">Token usage by model</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Token Usage by Model</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Reasoning</TableHead>
                <TableHead className="text-right">Cache Read</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Est. Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((m) => {
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
                    <TableCell className="text-right font-mono">{fmtNum(m.messages)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(m.input)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(m.output)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(m.reasoning)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(m.cache_read)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(m.input + m.output)}</TableCell>
                    <TableCell className="text-right font-mono text-primary">{fmtCost(m.cost_estimated)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

/* ========== Projects ========== */
function ProjectsPage({ rows }: { rows: ReturnType<typeof getProjectRows> }) {
  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Projects</h2>
        <p className="text-sm text-muted-foreground">Token usage by project</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Projects by Token Usage</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Messages</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <TableCell className="font-mono text-xs text-muted-foreground max-w-96 truncate" title={r.name}>{r.name}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(r.messages)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(r.input)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(r.output)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

/* ========== PR Page ========== */
function PRPage({ data }: { data: DashboardData["github_prs"] }) {
  if (!data?.total) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-2">Pull Requests</h2>
        <p className="text-muted-foreground">No GitHub PR data available.</p>
      </div>
    )
  }

  const months = Object.keys(data.by_month || {}).sort()
  const timelineData = months.map((m) => ({
    month: m,
    merged: data.by_month[m].merged,
    open: data.by_month[m].open,
    closed: data.by_month[m].closed,
  }))

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Total PRs" value={fmtCompact(data.total)} sub={fmtNum(data.total) + " pull requests"} />
        <StatCard label="Merged" value={fmtCompact(data.merged)} sub={`${(data.merged / data.total * 100).toFixed(1)}% merge rate`} color="#6f8b6e" />
        <StatCard label="Open" value={fmtCompact(data.open)} sub="currently open" color="#b88a5a" />
        <StatCard label="Closed" value={fmtCompact(data.closed)} sub="closed without merge" color="#8b6f9b" />
        <StatCard label="Median Time to Merge" value={fmtMergeTime(data.merge_time_stats?.p50)} sub="P50 merge time" color="#4f7f78" />
        <StatCard label="P90 Time to Merge" value={fmtMergeTime(data.merge_time_stats?.p90)} sub="P90 merge time" color="#d97757" />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle>PRs Over Time</CardTitle></CardHeader>
        <CardContent>
          <ChartContainer config={{ merged: { label: "Merged", color: "#6f8b6e" }, open: { label: "Open", color: "#b88a5a" } }} className="h-72 w-full">
            <BarChart data={timelineData}>
              <CartesianGrid vertical={false} className="stroke-border/50" />
              <XAxis dataKey="month" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={50} />
              <YAxis tickLine={false} axisLine={false} className="text-xs" />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="merged" stackId="a" fill="#6f8b6e" radius={0} />
              <Bar dataKey="open" stackId="a" fill="#b88a5a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}

/* ========== PR Details ========== */
function PRDetailsPage({ data }: { data: DashboardData["github_prs"] }) {
  if (!data?.total) {
    return (
      <div>
        <h2 className="text-xl font-bold mb-2">PR Details</h2>
        <p className="text-muted-foreground">No GitHub PR data available.</p>
      </div>
    )
  }

  const ss = data.size_stats || {}
  const sizeRows = [
    { label: "Lines Changed", stats: ss.lines_changed },
    { label: "Additions", stats: ss.additions },
    { label: "Deletions", stats: ss.deletions },
    { label: "Files Changed", stats: ss.files_changed },
  ].filter((r) => r.stats)

  const perProject = data.prs
    ? Object.entries(
        data.prs.reduce<Record<string, { total: number; merged: number; open: number; closed: number }>>((acc, pr) => {
          if (!acc[pr.repo]) acc[pr.repo] = { total: 0, merged: 0, open: 0, closed: 0 }
          acc[pr.repo].total++
          if (pr.state === "MERGED") acc[pr.repo].merged++
          else if (pr.state === "OPEN") acc[pr.repo].open++
          else acc[pr.repo].closed++
          return acc
        }, {})
      ).sort(([, a], [, b]) => b.total - a.total)
    : []

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">PR Details</h2>
        <p className="text-sm text-muted-foreground">Size percentiles and per-repository breakdown</p>
      </div>

      {sizeRows.length > 0 && (
        <Card className="mb-6">
          <CardHeader><CardTitle>PR Size Percentiles</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Avg</TableHead>
                  <TableHead className="text-right">P50</TableHead>
                  <TableHead className="text-right">P90</TableHead>
                  <TableHead className="text-right">P95</TableHead>
                  <TableHead className="text-right">P99</TableHead>
                  <TableHead className="text-right">Max</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sizeRows.map((r) => (
                  <TableRow key={r.label}>
                    <TableCell>{r.label}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(r.stats?.avg || 0)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(r.stats?.p50 || 0)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(r.stats?.p90 || 0)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(r.stats?.p95 || 0)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(r.stats?.p99 || 0)}</TableCell>
                    <TableCell className="text-right font-mono">{fmtNum(r.stats?.max || 0)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>PRs per Repository</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Merged</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Closed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {perProject.map(([repo, s]) => (
                <TableRow key={repo}>
                  <TableCell className="font-mono text-sm">{repo}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.total)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.merged)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.open)}</TableCell>
                  <TableCell className="text-right font-mono">{fmtNum(s.closed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
