import { useState } from "react"
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { BtnGroup, GitHubTimeRangeFilter, StatCard } from "@/components/dashboard/DashboardControls"
import { fmtCompact, fmtNum } from "@/lib/constants"
import type { GitHubPR } from "@/lib/types"
import { getMergedPRsPerDayRows, getMergeTimeRows } from "@/lib/github"
import type { PROrgOption, PRStats, ReviewStats } from "@/lib/github"

export function PullRequestsPage({
  hasGitHubData,
  pullRequests,
  stats,
  reviewStats,
  orgOptions,
  selectedOrg,
  onSelectedOrgChange,
  range,
  onRangeChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
}: {
  hasGitHubData: boolean
  pullRequests: GitHubPR[]
  stats: PRStats
  reviewStats: ReviewStats
  orgOptions: PROrgOption[]
  selectedOrg: string
  onSelectedOrgChange: (value: string) => void
  range: string
  onRangeChange: (value: string) => void
  startDate: string
  onStartDateChange: (value: string) => void
  endDate: string
  onEndDateChange: (value: string) => void
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

  const pullRequestMonths = Object.keys(stats.byMonth).sort()
  const pullRequestTimelineData = pullRequestMonths.map((month) => ({
    month,
    merged: stats.byMonth[month].merged,
    open: stats.byMonth[month].open,
    closed: stats.byMonth[month].closed,
  }))
  const mergedPerDayData = getMergedPRsPerDayRows(pullRequests, pullRequestMonths)
  const mergeTimeData = getMergeTimeRows(pullRequests, pullRequestMonths)
  const reviewMonths = Object.keys(reviewStats.byMonth).sort()
  const reviewTimelineData = reviewMonths.map((month) => ({ month, reviews: reviewStats.byMonth[month] }))
  const repositoryCount = Object.keys(stats.perProject).length
  const hasPRs = stats.total > 0
  const hasReviews = reviewStats.total > 0
  function fmtMergeTime(hours: number) {
    if (!hours) return "N/A"
    if (hours < 24) return hours + "h"
    return (hours / 24).toFixed(1) + "d"
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Pull Requests</h2>
        <p className="text-sm text-muted-foreground">GitHub PR statistics across all repositories</p>
      </div>

      <GitHubTimeRangeFilter
        range={range}
        onRangeChange={onRangeChange}
        startDate={startDate}
        onStartDateChange={onStartDateChange}
        endDate={endDate}
        onEndDateChange={onEndDateChange}
      />

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
                <BarChart data={pullRequestTimelineData} accessibilityLayer={false}>
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
