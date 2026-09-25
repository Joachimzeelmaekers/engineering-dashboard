import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import type { ProjectRow } from "@/lib/data"
import { VIRTUALIZED_TABLE_THRESHOLD } from "@/lib/dashboard-config"
import { OverflowText, SortButton, SortableHeader, TableNumber, VirtualizedTable, useSortedRows } from "@/components/dashboard/DashboardTables"
import type { SortValue, VirtualizedTableColumn } from "@/components/dashboard/DashboardTables"

export function ProjectsPage({ rows }: { rows: ProjectRow[] }) {
  type ProjectSortKey = "name" | "messages" | "input" | "output" | "total"

  const projectAccessors: Record<ProjectSortKey, (row: ProjectRow) => SortValue> = {
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
  const projectColumns: VirtualizedTableColumn<ProjectRow>[] = [
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
                {sortedRows.map((projectRow) => (
                  <TableRow key={projectRow.name}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      <OverflowText value={projectRow.name} className="max-w-[44rem]" />
                    </TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={projectRow.messages} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={projectRow.input} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={projectRow.output} /></TableCell>
                    <TableCell className="text-right font-mono"><TableNumber value={projectRow.total} /></TableCell>
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
