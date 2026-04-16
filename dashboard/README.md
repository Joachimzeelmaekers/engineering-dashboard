# Dashboard Frontend

Astro + React + shadcn UI frontend for the engineering dashboard.

## Commands

Run from this `dashboard/` directory:

- `yarn dev` — start dev server at `http://localhost:4321`
- `yarn build` — build static app to `dashboard/dist`
- `yarn preview` — preview the built app

## Data source

The app fetches `/data.json` at runtime.

From the repo root, run `make report` (or `python3 main.py`) to regenerate data. This writes:

- `output/data.json` (canonical output)
- `dashboard/public/data.json` (used by Astro dev/build)
