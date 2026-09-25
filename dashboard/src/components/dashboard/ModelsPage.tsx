import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { fmtCost, parseModelKey, PROVIDER_COLORS } from "@/lib/constants"
import type { ModelRow } from "@/lib/data"
import { VIRTUALIZED_TABLE_THRESHOLD } from "@/lib/dashboard-config"
import { SortButton, SortableHeader, TableNumber, VirtualizedTable, useSortedRows } from "@/components/dashboard/DashboardTables"
import type { SortValue, VirtualizedTableColumn } from "@/components/dashboard/DashboardTables"

export function ModelsPage({ rows }: { rows: ModelRow[] }) {
  type ModelSortKey = "model" | "provider" | "messages" | "input" | "output" | "reasoning" | "cache_read" | "total" | "cost_estimated"

  const modelAccessors: Record<ModelSortKey, (row: ModelRow) => SortValue> = {
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
  const modelColumns: VirtualizedTableColumn<ModelRow>[] = [
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
    {
      key: "input_price",
      width: "minmax(105px, 0.7fr)",
      header: <span className="text-right">Input $/1M</span>,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => row.input_price === null ? "—" : fmtCost(row.input_price),
    },
    {
      key: "output_price",
      width: "minmax(105px, 0.7fr)",
      header: <span className="text-right">Output $/1M</span>,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => row.output_price === null ? "—" : fmtCost(row.output_price),
    },
    {
      key: "cache_read_price",
      width: "minmax(115px, 0.7fr)",
      header: <span className="text-right">Cache Read $/1M</span>,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => row.cache_read_price === null ? "—" : fmtCost(row.cache_read_price),
    },
    {
      key: "cache_write_price",
      width: "minmax(115px, 0.7fr)",
      header: <span className="text-right">Cache Write $/1M</span>,
      headerClassName: "text-right",
      cellClassName: "text-right font-mono",
      renderCell: (row) => row.cache_write_price === null ? "—" : fmtCost(row.cache_write_price),
    },
  ]

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-bold">Models</h2>
        <p className="text-sm text-muted-foreground">Token usage and current catalog rates per 1M tokens (USD)</p>
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
                  <TableHead className="text-right">Input $/1M</TableHead>
                  <TableHead className="text-right">Output $/1M</TableHead>
                  <TableHead className="text-right">Cache Read $/1M</TableHead>
                  <TableHead className="text-right">Cache Write $/1M</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRows.map((modelRow) => {
                  const parsed = parseModelKey(modelRow.key)
                  return (
                    <TableRow key={modelRow.key}>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="font-normal"
                          style={{ color: modelRow.color, borderColor: modelRow.color + "60", background: modelRow.color + "15" }}
                        >
                          {parsed.name}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs" style={{ color: PROVIDER_COLORS[modelRow.provider] || "#a39e90" }}>
                          {modelRow.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={modelRow.messages} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={modelRow.input} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={modelRow.output} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={modelRow.reasoning} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={modelRow.cache_read} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={modelRow.input + modelRow.output} /></TableCell>
                      <TableCell className="text-right font-mono text-primary">{fmtCost(modelRow.cost_estimated)}</TableCell>
                      <TableCell className="text-right font-mono">{modelRow.input_price === null ? "—" : fmtCost(modelRow.input_price)}</TableCell>
                      <TableCell className="text-right font-mono">{modelRow.output_price === null ? "—" : fmtCost(modelRow.output_price)}</TableCell>
                      <TableCell className="text-right font-mono">{modelRow.cache_read_price === null ? "—" : fmtCost(modelRow.cache_read_price)}</TableCell>
                      <TableCell className="text-right font-mono">{modelRow.cache_write_price === null ? "—" : fmtCost(modelRow.cache_write_price)}</TableCell>
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
