import { useEffect, useMemo, useState } from "react"
import type { NormalizedMessage, SessionTranscriptTurn } from "@/lib/types"
import type { SessionRow } from "@/lib/data"
import { fmtCost, fmtDateTime, PROVIDER_COLORS } from "@/lib/constants"
import { VIRTUALIZED_TABLE_THRESHOLD } from "@/lib/dashboard-config"
import { OverflowText, SortButton, SortableHeader, TableNumber, VirtualizedTable, useSortedRows } from "@/components/dashboard/DashboardTables"
import type { SortValue, VirtualizedTableColumn } from "@/components/dashboard/DashboardTables"
import { SessionReplayPanel } from "@/components/dashboard/SessionReplayPanel"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"

function getSessionKey(provider: string, sessionId: string) {
  return `${provider}:${sessionId}`
}


export function SessionsPage({ rows, messages, sessionTranscripts }: { rows: SessionRow[]; messages: NormalizedMessage[]; sessionTranscripts: Record<string, SessionTranscriptTurn[]> }) {
  type SessionSortKey = "session_id" | "provider" | "project" | "model_count" | "messages" | "input" | "output" | "total" | "cost_estimated" | "end_ms"

  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const sessionAccessors: Record<SessionSortKey, (row: SessionRow) => SortValue> = {
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
  const sessionColumns: VirtualizedTableColumn<SessionRow>[] = [
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
                {sortedRows.map((session) => {
                  const sessionKey = getSessionKey(session.provider, session.session_id)
                  return (
                    <TableRow
                      key={sessionKey}
                      onClick={() => setSelectedSessionKey(sessionKey)}
                      className="cursor-pointer"
                      data-state={selectedSessionKey === sessionKey ? "selected" : undefined}
                    >
                      <TableCell className="font-mono text-xs">
                        <OverflowText value={session.session_id} className="max-w-[24rem]" />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" style={{ color: PROVIDER_COLORS[session.provider] || "#a39e90" }}>
                          {session.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <OverflowText value={session.project} className="max-w-[36rem]" />
                      </TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={session.model_count} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={session.messages} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={session.input} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={session.output} /></TableCell>
                      <TableCell className="text-right font-mono"><TableNumber value={session.total} /></TableCell>
                      <TableCell className="text-right font-mono text-primary">{fmtCost(session.cost_estimated)}</TableCell>
                      <TableCell className="text-xs">{fmtDateTime(session.end_ms)}</TableCell>
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
