export const PROVIDER_COLORS: Record<string, string> = {
  "claude-code": "#d97757",
  opencode: "#b88a5a",
  cursor: "#6f8b6e",
  codex: "#8b6f9b",
  continue: "#4f7f78",
  gemini: "#5f7c8a",
  trae: "#a07a65",
  windsurf: "#7f8c5a",
  droid: "#c9a84c",
}

export const CHART_COLORS = [
  "#d97757", "#b88a5a", "#9f7a4f", "#6f8b6e", "#4f7f78",
  "#8b6f9b", "#b35f5f", "#7f8c5a", "#a07a65", "#5f7c8a",
]

export function parseModelKey(key: string): { name: string; provider: string } {
  const match = key.match(/^(.+?)\s*\[(.+?)\]$/)
  if (match) return { name: match[1].trim(), provider: match[2].trim() }
  return { name: key, provider: "" }
}

export function fmtNum(n: number): string {
  return n.toLocaleString()
}

export function fmtCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B"
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K"
  return String(n)
}

export function fmtCost(c: number): string {
  return "$" + c.toFixed(2)
}

export function fmtDateTime(ms: number): string {
  if (!ms) return "-"
  const d = new Date(ms)
  if (isNaN(d.getTime())) return "-"
  return d.toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}
