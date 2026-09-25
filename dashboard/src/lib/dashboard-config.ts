export const DASHBOARD_NAV_ITEMS = [
  { id: "overview", label: "Overview" },
  { id: "timeline", label: "Timeline" },
  { id: "sessions", label: "Sessions" },
  { id: "models", label: "Models" },
  { id: "projects", label: "Projects" },
  { id: "pullrequests", label: "Pull Requests" },
  { id: "prdetails", label: "PR Details" },
]

export const DATE_RANGE_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "180d", label: "Last 6 months" },
  { value: "1y", label: "Last 1 year" },
  { value: "2y", label: "Last 2 years" },
  { value: "custom", label: "Custom range" },
  { value: "all", label: "All time" },
]

export const VIRTUALIZED_TABLE_THRESHOLD = Number.POSITIVE_INFINITY

export const TOKEN_FILTER_PAGE_IDS = ["overview", "timeline", "sessions", "models", "projects"]

export const TIMELINE_CHART_TYPE_OPTIONS = [
  { value: "area", label: "Area" },
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
]

export const TIMELINE_TOKEN_TYPE_OPTIONS = [
  { value: "input", label: "Input" },
  { value: "output", label: "Output" },
  { value: "reasoning", label: "Reasoning" },
  { value: "total", label: "Total" },
]

export const TIMELINE_GROUP_OPTIONS = [
  { value: "hour", label: "Hour" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
]
