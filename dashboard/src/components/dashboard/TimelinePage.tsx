import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { fmtAxis, parseModelKey } from "@/lib/constants"
import type { TimelineData } from "@/lib/data"
import { BtnGroup } from "@/components/dashboard/DashboardControls"
import { TIMELINE_CHART_TYPE_OPTIONS, TIMELINE_GROUP_OPTIONS, TIMELINE_TOKEN_TYPE_OPTIONS } from "@/lib/dashboard-config"

export function TimelinePage({ timelineData, groupBy, setGroupBy, tokenType, setTokenType, chartType, setChartType }: {
  timelineData: TimelineData
  groupBy: string; setGroupBy: (value: string) => void
  tokenType: string; setTokenType: (value: string) => void
  chartType: string; setChartType: (value: string) => void
}) {
  const chartConfig = Object.fromEntries(
    timelineData.models.map((model) => [model.key, { label: parseModelKey(model.key).name, color: model.color }])
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
                options={TIMELINE_CHART_TYPE_OPTIONS}
                value={chartType}
                onChange={setChartType}
              />
              <BtnGroup
                options={TIMELINE_TOKEN_TYPE_OPTIONS}
                value={tokenType}
                onChange={setTokenType}
              />
              <BtnGroup
                options={TIMELINE_GROUP_OPTIONS}
                value={groupBy}
                onChange={setGroupBy}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="h-[500px] w-full">
            {chartType === "bar" ? (
              <BarChart data={timelineData.data} accessibilityLayer={false}>
                <CartesianGrid vertical={false} className="stroke-border/50" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {timelineData.models.map((model) => (
                  <Bar key={model.key} dataKey={model.key} stackId="a" fill={model.color} radius={0} name={parseModelKey(model.key).name} />
                ))}
              </BarChart>
            ) : chartType === "area" ? (
              <AreaChart data={timelineData.data} accessibilityLayer={false}>
                <CartesianGrid vertical={false} className="stroke-border/50" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {timelineData.models.map((model) => (
                  <Area key={model.key} dataKey={model.key} stackId="a" fill={model.color} stroke={model.color} fillOpacity={0.4} name={parseModelKey(model.key).name} />
                ))}
              </AreaChart>
            ) : (
              <LineChart data={timelineData.data} accessibilityLayer={false}>
                <CartesianGrid vertical={false} className="stroke-border/50" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} className="text-xs" angle={-25} textAnchor="end" height={60} />
                <YAxis tickLine={false} axisLine={false} tickFormatter={fmtAxis} className="text-xs" />
                <ChartTooltip content={<ChartTooltipContent />} />
                {timelineData.models.map((model) => (
                  <Line key={model.key} dataKey={model.key} stroke={model.color} strokeWidth={2} dot={false} name={parseModelKey(model.key).name} />
                ))}
              </LineChart>
            )}
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  )
}
