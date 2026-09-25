import type { DashboardData } from "./types"
import { fmtNum } from "./constants"
import { getGlobalCutoff } from "./data"

export type PRMonthSummary = { total: number; merged: number; open: number; closed: number }
export type PRRepoSummary = { total: number; merged: number; open: number; closed: number }
export type PROrgSummary = {
  total: number
  merged: number
  workday_prs: number
  weekend_prs: number
  working_days: number
  weekend_days: number
  avg_per_working_day: number
  avg_per_weekend_day: number
}
export type PRSizeSummary = {
  avg: number
  p25: number
  p50: number
  p75: number
  p90: number
  p95: number
  p99: number
  max: number
}
export type PRStats = {
  total: number
  merged: number
  open: number
  closed: number
  perProject: Record<string, PRRepoSummary>
  orgStats: Record<string, PROrgSummary>
  sizeStats: {
    lines_changed: PRSizeSummary
    additions: PRSizeSummary
    deletions: PRSizeSummary
    files_changed: PRSizeSummary
  }
  byMonth: Record<string, PRMonthSummary>
  mergeTimeStats: { avg: number; p50: number; p90: number } | null
}
export type ReviewStats = {
  total: number
  byState: Record<string, number>
  byMonth: Record<string, number>
}
export type PROrgOption = { value: string; label: string }
function getPercentile(values: number[], percentile: number) {
  if (!values.length) return 0
  const index = (values.length - 1) * (percentile / 100)
  const floor = Math.floor(index)
  const ceil = Math.min(floor + 1, values.length - 1)
  return Math.round(values[floor] + (index - floor) * (values[ceil] - values[floor]))
}
function getEmptySizeSummary(): PRSizeSummary {
  return { avg: 0, p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0, max: 0 }
}

function getSizeSummary(values: number[]): PRSizeSummary {
  const sorted = [...values].sort((a, b) => a - b)
  if (!sorted.length) return getEmptySizeSummary()

  return {
    avg: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
    p25: getPercentile(sorted, 25),
    p50: getPercentile(sorted, 50),
    p75: getPercentile(sorted, 75),
    p90: getPercentile(sorted, 90),
    p95: getPercentile(sorted, 95),
    p99: getPercentile(sorted, 99),
    max: sorted[sorted.length - 1],
  }
}

function getPRByMonth(prs: DashboardData["github_prs"]["prs"] = []): Record<string, PRMonthSummary> {
  return prs.reduce<Record<string, PRMonthSummary>>((acc, pr) => {
    if (!pr.created_at) return acc

    const month = pr.created_at.slice(0, 7)
    if (!acc[month]) {
      acc[month] = { total: 0, merged: 0, open: 0, closed: 0 }
    }

    acc[month].total += 1
    if (pr.state === "MERGED") acc[month].merged += 1
    else if (pr.state === "OPEN") acc[month].open += 1
    else acc[month].closed += 1

    return acc
  }, {})
}

export function computePRStats(prs: DashboardData["github_prs"]["prs"] = []): PRStats {
  const total = prs.length
  const merged = prs.filter((pr) => pr.state === "MERGED").length
  const open = prs.filter((pr) => pr.state === "OPEN").length
  const closed = prs.filter((pr) => pr.state === "CLOSED").length

  const perProject = prs.reduce<Record<string, PRRepoSummary>>((acc, pr) => {
    if (!acc[pr.repo]) acc[pr.repo] = { total: 0, merged: 0, open: 0, closed: 0 }
    acc[pr.repo].total += 1
    if (pr.state === "MERGED") acc[pr.repo].merged += 1
    else if (pr.state === "OPEN") acc[pr.repo].open += 1
    else acc[pr.repo].closed += 1
    return acc
  }, {})

  const perOrg = prs.reduce<Record<string, { total: number; merged: number; dates: Set<string>; workday_prs: number; weekend_prs: number }>>((acc, pr) => {
    const org = pr.org || "personal"
    if (!acc[org]) {
      acc[org] = { total: 0, merged: 0, dates: new Set<string>(), workday_prs: 0, weekend_prs: 0 }
    }

    acc[org].total += 1
    if (pr.state === "MERGED") {
      acc[org].merged += 1
      if (pr.created_at) {
        acc[org].dates.add(pr.created_at.slice(0, 10))
        const dayOfWeek = new Date(pr.created_at).getUTCDay()
        if (dayOfWeek >= 1 && dayOfWeek <= 5) acc[org].workday_prs += 1
        else acc[org].weekend_prs += 1
      }
    }

    return acc
  }, {})

  const today = new Date()
  const orgStats = Object.fromEntries(
    Object.entries(perOrg)
      .map(([org, data]) => {
        const dates = Array.from(data.dates).sort()
        if (!dates.length) {
          return [org, { total: data.total, merged: data.merged, workday_prs: 0, weekend_prs: 0, working_days: 0, weekend_days: 0, avg_per_working_day: 0, avg_per_weekend_day: 0 } satisfies PROrgSummary]
        }

        const first = new Date(`${dates[0]}T00:00:00Z`)
        const last = new Date(Math.min(new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime(), today.getTime()))
        let working_days = 0
        let weekend_days = 0
        for (const cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          const dayOfWeek = cursor.getUTCDay()
          if (dayOfWeek >= 1 && dayOfWeek <= 5) working_days += 1
          else weekend_days += 1
        }

        return [
          org,
          {
            total: data.total,
            merged: data.merged,
            workday_prs: data.workday_prs,
            weekend_prs: data.weekend_prs,
            working_days,
            weekend_days,
            avg_per_working_day: working_days > 0 ? Number((data.workday_prs / working_days).toFixed(2)) : 0,
            avg_per_weekend_day: weekend_days > 0 ? Number((data.weekend_prs / weekend_days).toFixed(2)) : 0,
          } satisfies PROrgSummary,
        ]
      })
      .sort(([, a], [, b]) => b.total - a.total)
  )

  const sizeStats = {
    lines_changed: getSizeSummary(prs.map((pr) => pr.additions + pr.deletions)),
    additions: getSizeSummary(prs.map((pr) => pr.additions)),
    deletions: getSizeSummary(prs.map((pr) => pr.deletions)),
    files_changed: getSizeSummary(prs.map((pr) => pr.changed_files)),
  }

  const mergeTimes = prs
    .filter((pr) => pr.state === "MERGED" && pr.created_at && pr.merged_at)
    .map((pr) => (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60))
    .filter((hours) => Number.isFinite(hours) && hours >= 0)
    .sort((a, b) => a - b)

  return {
    total,
    merged,
    open,
    closed,
    perProject: Object.fromEntries(Object.entries(perProject).sort(([, a], [, b]) => b.total - a.total)),
    orgStats,
    sizeStats,
    byMonth: getPRByMonth(prs),
    mergeTimeStats: mergeTimes.length
      ? {
          avg: Math.round(mergeTimes.reduce((sum, hours) => sum + hours, 0) / mergeTimes.length),
          p50: getPercentile(mergeTimes, 50),
          p90: getPercentile(mergeTimes, 90),
        }
      : null,
  }
}

export function computeReviewStats(reviews: DashboardData["github_prs"]["reviews"]["reviews"] = []): ReviewStats {
  return {
    total: reviews.length,
    byState: reviews.reduce<Record<string, number>>((acc, review) => {
      acc[review.state] = (acc[review.state] || 0) + 1
      return acc
    }, {}),
    byMonth: reviews.reduce<Record<string, number>>((acc, review) => {
      if (!review.review_created_at) return acc
      const month = review.review_created_at.slice(0, 7)
      acc[month] = (acc[month] || 0) + 1
      return acc
    }, {}),
  }
}

export function getPROrgOptions(data?: DashboardData["github_prs"]): PROrgOption[] {
  const counts = new Map<string, number>()

  data?.prs?.forEach((pr) => {
    const org = pr.org || "personal"
    counts.set(org, (counts.get(org) || 0) + 1)
  })

  data?.reviews?.reviews?.forEach((review) => {
    const org = review.org || "personal"
    counts.set(org, (counts.get(org) || 0) + 1)
  })

  Object.entries(data?.per_org || {}).forEach(([org, stats]) => {
    counts.set(org, Math.max(counts.get(org) || 0, stats.total || 0))
  })

  return Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a)
    .map(([value, count]) => ({ value, label: `${value} (${fmtNum(count)})` }))
}

export function getMergedPRsPerDayRows(prs: DashboardData["github_prs"]["prs"], months: string[]) {
  const today = new Date()
  const rows = months.map((month) => {
    const [year, monthNumber] = month.split("-").map(Number)
    const firstDay = new Date(Date.UTC(year, monthNumber - 1, 1))
    const lastDay = new Date(Date.UTC(year, monthNumber, 0))
    const endOfRange = lastDay.getTime() > today.getTime()
      ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
      : lastDay

    let workingDays = 0
    let weekendDays = 0
    for (const cursor = new Date(firstDay); cursor <= endOfRange; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const dayOfWeek = cursor.getUTCDay()
      if (dayOfWeek >= 1 && dayOfWeek <= 5) workingDays += 1
      else weekendDays += 1
    }

    let workdayMerged = 0
    let weekendMerged = 0
    prs.forEach((pr) => {
      if (pr.state !== "MERGED" || !pr.created_at || pr.created_at.slice(0, 7) !== month) return
      const dayOfWeek = new Date(pr.created_at).getUTCDay()
      if (dayOfWeek >= 1 && dayOfWeek <= 5) workdayMerged += 1
      else weekendMerged += 1
    })

    return {
      month,
      workday: workingDays > 0 ? Number((workdayMerged / workingDays).toFixed(2)) : 0,
      weekend: weekendDays > 0 ? Number((weekendMerged / weekendDays).toFixed(2)) : 0,
    }
  })

  return rows.map((row, index) => {
    const window = rows.slice(Math.max(0, index - 2), index + 1)
    return {
      ...row,
      rollingWorkday: Number((window.reduce((sum, current) => sum + current.workday, 0) / window.length).toFixed(2)),
    }
  })
}

export function getMergeTimeRows(prs: DashboardData["github_prs"]["prs"], months: string[]) {
  const mergeTimesByMonth = prs.reduce<Record<string, number[]>>((acc, pr) => {
    if (pr.state !== "MERGED" || !pr.created_at || !pr.merged_at) return acc
    const month = pr.created_at.slice(0, 7)
    const hours = (new Date(pr.merged_at).getTime() - new Date(pr.created_at).getTime()) / (1000 * 60 * 60)
    if (!Number.isFinite(hours) || hours < 0) return acc
    if (!acc[month]) acc[month] = []
    acc[month].push(hours)
    return acc
  }, {})

  return months.map((month) => {
    const times = [...(mergeTimesByMonth[month] || [])].sort((a, b) => a - b)
    if (!times.length) {
      return { month, avg: null, median: null }
    }

    const middle = Math.floor(times.length / 2)
    const median = times.length % 2 === 0 ? (times[middle - 1] + times[middle]) / 2 : times[middle]

    return {
      month,
      avg: Number((times.reduce((sum, time) => sum + time, 0) / times.length).toFixed(1)),
      median: Number(median.toFixed(1)),
    }
  })
}

export function filterGitHubDateRange<T>(
  rows: T[],
  range: string,
  getDate: (row: T) => string,
  startDate: string,
  endDate: string
): T[] {
  if (range === "all") return rows

  const cutoff = range === "custom" ? 0 : getGlobalCutoff(range)
  const customStart = startDate ? Date.parse(`${startDate}T00:00:00.000Z`) : Number.NaN
  const customEnd = endDate ? Date.parse(`${endDate}T23:59:59.999Z`) : Number.NaN

  return rows.filter((row) => {
    const timestamp = Date.parse(getDate(row))
    if (!Number.isFinite(timestamp)) return false
    if (range === "custom") {
      if (Number.isFinite(customStart) && timestamp < customStart) return false
      if (Number.isFinite(customEnd) && timestamp > customEnd) return false
      return true
    }
    return !cutoff || timestamp >= cutoff
  })
}
