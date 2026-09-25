import { useEffect, useMemo, useState } from "react"
import type { DashboardData } from "@/lib/types"
import { filterMessages, getModelRows, getProjectRows, getProviderRows, getSessionRows, getTimelineData, normalizeMessages } from "@/lib/data"
import { PROVIDER_COLORS } from "@/lib/constants"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DASHBOARD_NAV_ITEMS, DATE_RANGE_OPTIONS, TOKEN_FILTER_PAGE_IDS } from "@/lib/dashboard-config"
import { computePRStats, computeReviewStats, filterGitHubDateRange, getPROrgOptions } from "@/lib/github"
import type { PROrgOption, PRStats, ReviewStats } from "@/lib/github"
import { ModelsPage } from "@/components/dashboard/ModelsPage"
import { ProjectsPage } from "@/components/dashboard/ProjectsPage"
import { OverviewPage } from "@/components/dashboard/OverviewPage"
import { TimelinePage } from "@/components/dashboard/TimelinePage"
import { SessionsPage } from "@/components/dashboard/SessionsPage"
import { PullRequestsPage } from "@/components/dashboard/PullRequestsPage"
import { PullRequestDetailsPage } from "@/components/dashboard/PullRequestDetailsPage"
import { FilterPill } from "@/components/dashboard/DashboardControls"








export default function Dashboard({ data }: { data: DashboardData }) {
  const [page, setPage] = useState("overview")
  const [activeProvider, setActiveProvider] = useState("all")
  const [globalRange, setGlobalRange] = useState("90d")
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [timelineGroupBy, setTimelineGroupBy] = useState("day")
  const [timelineTokenType, setTimelineTokenType] = useState("total")
  const [timelineChartType, setTimelineChartType] = useState("area")
  const [selectedGitHubOrg, setSelectedGitHubOrg] = useState("all")
  const [githubDateRange, setGithubDateRange] = useState("all")
  const [githubStartDate, setGithubStartDate] = useState("")
  const [githubEndDate, setGithubEndDate] = useState("")

  const normalizedMessages = useMemo(() => normalizeMessages(data.messages), [data.messages])
  const filteredMessages = useMemo(
    () => filterMessages(normalizedMessages, activeProvider, globalRange, startDate, endDate),
    [normalizedMessages, activeProvider, globalRange, startDate, endDate]
  )
  const availableProviders = useMemo(() => Object.keys(data.provider_totals).sort(), [data.provider_totals])
  const modelRows = useMemo(() => getModelRows(filteredMessages, data.model_stats), [filteredMessages, data.model_stats])
  const sessionRows = useMemo(() => getSessionRows(filteredMessages, data.model_stats), [filteredMessages, data.model_stats])
  const providerRows = useMemo(() => getProviderRows(filteredMessages), [filteredMessages])
  const projectRows = useMemo(() => getProjectRows(filteredMessages), [filteredMessages])
  const timelineData = useMemo(() => getTimelineData(filteredMessages, timelineGroupBy, timelineTokenType), [filteredMessages, timelineGroupBy, timelineTokenType])
  const prOrgOptions = useMemo(() => getPROrgOptions(data.github_prs), [data.github_prs])
  const dateFilteredPullRequests = useMemo(
    () => filterGitHubDateRange(data.github_prs?.prs || [], githubDateRange, (pullRequest) => pullRequest.created_at, githubStartDate, githubEndDate),
    [data.github_prs, githubDateRange, githubStartDate, githubEndDate]
  )
  const dateFilteredReviews = useMemo(
    () => filterGitHubDateRange(data.github_prs?.reviews?.reviews || [], githubDateRange, (review) => review.review_created_at, githubStartDate, githubEndDate),
    [data.github_prs, githubDateRange, githubStartDate, githubEndDate]
  )
  const scopedPullRequests = useMemo(
    () => selectedGitHubOrg === "all" ? dateFilteredPullRequests : dateFilteredPullRequests.filter((pullRequest) => (pullRequest.org || "personal") === selectedGitHubOrg),
    [dateFilteredPullRequests, selectedGitHubOrg]
  )
  const scopedReviews = useMemo(
    () => selectedGitHubOrg === "all" ? dateFilteredReviews : dateFilteredReviews.filter((review) => (review.org || "personal") === selectedGitHubOrg),
    [dateFilteredReviews, selectedGitHubOrg]
  )
  const prStats = useMemo(() => computePRStats(scopedPullRequests), [scopedPullRequests])
  const reviewStats = useMemo(() => computeReviewStats(scopedReviews), [scopedReviews])

  useEffect(() => {
    if (selectedGitHubOrg !== "all" && !prOrgOptions.some((option) => option.value === selectedGitHubOrg)) {
      setSelectedGitHubOrg("all")
    }
  }, [selectedGitHubOrg, prOrgOptions])

  const usageTotals = useMemo(() => ({
    messageCount: modelRows.reduce((total, modelRow) => total + modelRow.messages, 0),
    inputTokens: modelRows.reduce((total, modelRow) => total + modelRow.input, 0),
    outputTokens: modelRows.reduce((total, modelRow) => total + modelRow.output, 0),
    reasoningTokens: modelRows.reduce((total, modelRow) => total + modelRow.reasoning, 0),
    cacheReadTokens: modelRows.reduce((total, modelRow) => total + modelRow.cache_read, 0),
    estimatedCost: modelRows.reduce((total, modelRow) => total + modelRow.cost_estimated, 0),
    sessionCount: sessionRows.length,
  }), [modelRows, sessionRows])

  const showTokenFilterBar = TOKEN_FILTER_PAGE_IDS.includes(page)

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
          {DASHBOARD_NAV_ITEMS.map((item) => (
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
              {availableProviders.map((provider) => (
                <FilterPill
                  key={provider}
                  label={provider}
                  active={activeProvider === provider}
                  color={PROVIDER_COLORS[provider] || "#a39e90"}
                  onClick={() => setActiveProvider(provider)}
                />
              ))}
            </div>
            <Select value={globalRange} onValueChange={setGlobalRange}>
              <SelectTrigger className="w-36 h-8 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((dateRangeOption) => (
                  <SelectItem key={dateRangeOption.value} value={dateRangeOption.value}>
                    {dateRangeOption.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {globalRange === "custom" && (
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label="Start date"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  aria-label="End date"
                />
              </div>
            )}
          </div>
        )}

        {page === "overview" && (
          <OverviewPage
            usageTotals={usageTotals}
            modelRows={modelRows}
            providerRows={providerRows}
            globalRange={globalRange}
          />
        )}
        {page === "timeline" && (
          <TimelinePage
            timelineData={timelineData}
            groupBy={timelineGroupBy}
            setGroupBy={setTimelineGroupBy}
            tokenType={timelineTokenType}
            setTokenType={setTimelineTokenType}
            chartType={timelineChartType}
            setChartType={setTimelineChartType}
          />
        )}
        {page === "sessions" && <SessionsPage rows={sessionRows} messages={filteredMessages} sessionTranscripts={data.session_transcripts || {}} />}
        {page === "models" && <ModelsPage rows={modelRows} />}
        {page === "projects" && <ProjectsPage rows={projectRows} />}
        {page === "pullrequests" && (
          <PullRequestsPage
            hasGitHubData={Boolean(data.github_prs?.total)}
            pullRequests={scopedPullRequests}
            stats={prStats}
            reviewStats={reviewStats}
            orgOptions={prOrgOptions}
            selectedOrg={selectedGitHubOrg}
            onSelectedOrgChange={setSelectedGitHubOrg}
            range={githubDateRange}
            onRangeChange={setGithubDateRange}
            startDate={githubStartDate}
            onStartDateChange={setGithubStartDate}
            endDate={githubEndDate}
            onEndDateChange={setGithubEndDate}
          />
        )}
        {page === "prdetails" && (
          <PullRequestDetailsPage
            hasGitHubData={Boolean(data.github_prs?.total)}
            stats={prStats}
            orgOptions={prOrgOptions}
            selectedOrg={selectedGitHubOrg}
            onSelectedOrgChange={setSelectedGitHubOrg}
            range={githubDateRange}
            onRangeChange={setGithubDateRange}
            startDate={githubStartDate}
            onStartDateChange={setGithubStartDate}
            endDate={githubEndDate}
            onEndDateChange={setGithubEndDate}
          />
        )}
      </main>
    </div>
  )
}
