# Project Memory

## Data flow
- Python source lives under `src/engineering_dashboard/`; root `main.py` and `serve.py` are the primary local entry scripts.
- `engineering_dashboard.cli` generates the dashboard payload and writes GitHub PR stats into `output/data.json` via `src/engineering_dashboard/providers/github_prs.py`.
- The Astro app fetches `/data.json` at runtime in `dashboard/src/components/App.tsx` rather than embedding report data at build time.

## Frontend structure
- The shadcn dashboard is a single React view in `dashboard/src/components/Dashboard.tsx`; page switching is local component state, not route-based.
- Session, model, project, and PR views are derived from helper transforms in `dashboard/src/lib/data.ts` and `Dashboard.tsx`.

## GitHub PR quirks
- PR charts should tolerate legacy `github_prs.by_month` payloads because older data files stored month counts as integers instead of per-state buckets.
