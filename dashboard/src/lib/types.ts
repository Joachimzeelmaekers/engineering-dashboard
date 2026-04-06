export interface RawMessage {
  provider: string
  model: string
  input_tokens: number
  output_tokens: number
  reasoning_tokens: number
  cache_read_tokens: number
  cache_write_tokens: number
  cost: number
  timestamp_ms: number
  session_id: string
  project: string
}

export interface ModelStats {
  messages: number
  input: number
  output: number
  reasoning: number
  cache_read: number
  cache_write: number
  cost_logged: number
  cost_estimated: number
  provider: string
}

export interface ProviderTotal {
  messages: number
  sessions: number
  input: number
  output: number
  cost_estimated: number
}

export interface DashboardData {
  generated_at: string
  model_stats: Record<string, ModelStats>
  provider_totals: Record<string, ProviderTotal>
  messages: RawMessage[]
  total_messages: number
  total_sessions: number
  month_cost_estimated: number
  current_month: string
  github_prs: GitHubPRData
}

export interface GitHubPRData {
  total: number
  merged: number
  open: number
  closed: number
  prs: GitHubPR[]
  reviews: { total: number; reviews: GitHubReview[] }
  per_org: Record<string, { total: number }>
  size_stats: Record<string, Record<string, number>>
  by_month: Record<string, { total: number; merged: number; open: number; closed: number }>
  merge_time_stats: { avg: number; p50: number; p90: number }
}

export interface GitHubPR {
  repo: string
  org: string
  state: string
  created_at: string
  merged_at: string
  additions: number
  deletions: number
  changed_files: number
}

export interface GitHubReview {
  org: string
  state: string
  review_created_at: string
}

export interface NormalizedMessage {
  provider: string
  model: string
  modelKey: string
  input: number
  output: number
  reasoning: number
  cache_read: number
  cache_write: number
  cost_logged: number
  timestamp_ms: number
  session_id: string
  project: string
}
