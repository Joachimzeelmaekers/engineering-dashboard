import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DATE_RANGE_OPTIONS } from "@/lib/dashboard-config"
import type { PROrgOption } from "@/lib/github"
export function FilterPill({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
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

export function BtnGroup({
  options,
  value,
  onChange,
  className,
  buttonClassName,
}: {
  options: { value: string; label: string }[]
  value: string
  onChange: (v: string) => void
  className?: string
  buttonClassName?: string
}) {
  return (
    <div className={`flex border border-border rounded-lg overflow-hidden ${className || ""}`}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-xs transition-colors border-r last:border-r-0 border-border ${buttonClassName || ""} ${
            value === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PROrgFilter({
  orgOptions,
  selectedOrg,
  onSelectedOrgChange,
}: {
  orgOptions: PROrgOption[]
  selectedOrg: string
  onSelectedOrgChange: (value: string) => void
}) {
  if (!orgOptions.length) return null

  return (
    <div className="mb-6 flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 flex-wrap">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Org</span>
      <Select value={selectedOrg} onValueChange={onSelectedOrgChange}>
        <SelectTrigger className="h-8 w-56 text-xs shrink-0">
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
  )
}

export function GitHubTimeRangeFilter({
  range,
  onRangeChange,
  startDate,
  onStartDateChange,
  endDate,
  onEndDateChange,
}: {
  range: string
  onRangeChange: (value: string) => void
  startDate: string
  onStartDateChange: (value: string) => void
  endDate: string
  onEndDateChange: (value: string) => void
}) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 flex-wrap">
      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground shrink-0">Date range</span>
      <Select value={range} onValueChange={onRangeChange}>
        <SelectTrigger className="h-8 w-40 text-xs shrink-0" aria-label="GitHub date range">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DATE_RANGE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {range === "custom" && (
        <div className="flex items-center gap-2">
          <input type="date" value={startDate} onChange={(event) => onStartDateChange(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs" aria-label="GitHub start date" />
          <span className="text-xs text-muted-foreground">to</span>
          <input type="date" value={endDate} onChange={(event) => onEndDateChange(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2 text-xs" aria-label="GitHub end date" />
        </div>
      )}
    </div>
  )
}

export function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
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
