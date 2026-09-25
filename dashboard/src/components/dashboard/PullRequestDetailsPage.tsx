import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import { GitHubTimeRangeFilter, PROrgFilter } from "@/components/dashboard/DashboardControls"
import { OverflowText, SortButton, SortableHeader, TableNumber, VirtualizedTable, useSortedRows } from "@/components/dashboard/DashboardTables"
import type { SortValue, VirtualizedTableColumn } from "@/components/dashboard/DashboardTables"
import { VIRTUALIZED_TABLE_THRESHOLD } from "@/lib/dashboard-config"
import { fmtNum } from "@/lib/constants"
import type { PROrgOption, PRStats } from "@/lib/github"

export function PullRequestDetailsPage({
  hasGitHubData,
  stats,
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
  stats: PRStats
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

      <GitHubTimeRangeFilter
        range={range}
        onRangeChange={onRangeChange}
        startDate={startDate}
        onStartDateChange={onStartDateChange}
        endDate={endDate}
        onEndDateChange={onEndDateChange}
      />

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
