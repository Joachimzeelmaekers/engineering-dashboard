import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { TableHead } from "@/components/ui/table"
import { fmtAxis, fmtNum } from "@/lib/constants"

export type SortDirection = "asc" | "desc"
export type SortValue = string | number
export type SortConfig<K extends string> = { key: K; direction: SortDirection }
function compareSortValues(a: SortValue, b: SortValue, type: "string" | "number") {
  if (type === "number") return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" })
}

export function useSortedRows<T, K extends string>(
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

export function SortButton<K extends string>({
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

export function SortableHeader<K extends string>({
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

export function VirtualizedStack<T>({
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

export type VirtualizedTableColumn<T> = {
  key: string
  width: string
  header: ReactNode
  headerClassName?: string
  cellClassName?: string
  renderCell: (row: T, index: number) => ReactNode
}

export function VirtualizedTable<T>({
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


export function TableNumber({ value }: { value: number }) {
  return <span title={fmtNum(value)}>{fmtAxis(value)}</span>
}

export function OverflowText({ value, className }: { value: string; className?: string }) {
  return <span className={`block overflow-hidden text-ellipsis whitespace-nowrap ${className || ""}`} title={value}>{value}</span>
}

