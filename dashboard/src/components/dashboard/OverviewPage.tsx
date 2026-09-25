import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { fmtAxis, fmtCompact, fmtCost, fmtNum, parseModelKey } from "@/lib/constants"
import type { ModelRow, ProviderRow } from "@/lib/data"
import { StatCard } from "@/components/dashboard/DashboardControls"

export interface UsageTotals {
  messageCount: number
  sessionCount: number
  inputTokens: number
  outputTokens: number
  reasoningTokens: number
  cacheReadTokens: number
  estimatedCost: number
}

export function OverviewPage({ usageTotals, modelRows, providerRows, globalRange }: {
  usageTotals: UsageTotals
  modelRows: ModelRow[]
  providerRows: ProviderRow[]
  globalRange: string
}) {
  const barData = modelRows.slice(0, 12).map((model) => ({
    name: parseModelKey(model.key).name,
    input: model.input,
    output: model.output,
    color: model.color,
  }))
  const donutData = modelRows.filter((model) => model.output > 0).map((model) => ({
    name: parseModelKey(model.key).name,
    value: model.output,
    color: model.color,
  }))
  const providerDonutData = providerRows.filter((provider) => provider.input + provider.output > 0).map((provider) => ({
    name: provider.name,
    value: provider.input + provider.output,
    color: provider.color,
  }))
  const barConfig = Object.fromEntries(
    barData.map((chartDatum) => [chartDatum.name, { label: chartDatum.name, color: chartDatum.color }])
  )

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Overview</h2>
        <p className="text-sm text-muted-foreground">Token usage analytics across all providers</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Messages" value={fmtCompact(usageTotals.messageCount)} sub={fmtNum(usageTotals.messageCount) + " turns"} />
        <StatCard label="Sessions" value={fmtCompact(usageTotals.sessionCount)} sub="unique sessions" />
        <StatCard label="Input" value={fmtCompact(usageTotals.inputTokens)} sub={fmtNum(usageTotals.inputTokens)} color="#b88a5a" />
        <StatCard label="Output" value={fmtCompact(usageTotals.outputTokens)} sub={fmtNum(usageTotals.outputTokens)} color="#6f8b6e" />
        <StatCard label="Reasoning" value={fmtCompact(usageTotals.reasoningTokens)} sub={fmtNum(usageTotals.reasoningTokens)} color="#9f7a4f" />
        <StatCard label="Cache Read" value={fmtCompact(usageTotals.cacheReadTokens)} sub={fmtNum(usageTotals.cacheReadTokens)} color="#4f7f78" />
        <StatCard label="Est. Cost" value={fmtCost(usageTotals.estimatedCost)} sub="selected range" color="#d97757" />
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
                  {donutData.map((chartDatum, index) => <Cell key={index} fill={chartDatum.color} />)}
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
                <Pie data={providerDonutData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                  {providerDonutData.map((chartDatum, index) => <Cell key={index} fill={chartDatum.color} />)}
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
