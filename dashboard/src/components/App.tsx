import { useEffect, useState } from "react"
import type { DashboardData } from "@/lib/types"
import Dashboard from "./Dashboard"

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/data.json")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load data: ${res.status}`)
        return res.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <div className="text-center">
          <h2 className="text-lg font-bold mb-2">Failed to load dashboard data</h2>
          <p className="text-muted-foreground">{error}</p>
          <p className="text-sm text-muted-foreground mt-2">Run <code className="bg-muted px-1.5 py-0.5 rounded">make report</code> to generate data.json</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background text-foreground">
        <p className="text-muted-foreground">Loading dashboard data...</p>
      </div>
    )
  }

  return <Dashboard data={data} />
}
