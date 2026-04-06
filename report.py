"""HTML report generation — provider-agnostic with client-side provider filtering."""

import json
from datetime import datetime


def fmt_tokens(n: int) -> str:
    return f"{n:,}"


def fmt_compact(n: int) -> str:
    if n >= 1_000_000_000:
        return f"{n / 1_000_000_000:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def fmt_cost(c: float) -> str:
    return f"${c:.2f}"


COLORS = [
    "#d97757", "#b88a5a", "#9f7a4f", "#6f8b6e", "#4f7f78",
    "#8b6f9b", "#b35f5f", "#7f8c5a", "#a07a65", "#5f7c8a",
]

PROVIDER_COLORS = {
    "claude-code": "#d97757",  # terracotta
    "opencode": "#b88a5a",      # warm bronze
    "cursor": "#6f8b6e",        # moss
    "codex": "#8b6f9b",         # muted plum
    "continue": "#4f7f78",      # teal slate
    "gemini": "#5f7c8a",        # steel blue
    "trae": "#a07a65",          # muted clay
    "windsurf": "#7f8c5a",      # olive
    "droid": "#c9a84c",         # gold
}


def build_html(data: dict) -> str:
    model_stats = data["model_stats"]
    raw_messages = data.get("messages", [])
    provider_totals = data.get("provider_totals", {})
    github_prs = data.get("github_prs", {})

    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    sorted_models = sorted(
        model_stats.items(),
        key=lambda x: x[1]["input"] + x[1]["output"],
        reverse=True,
    )

    model_colors = {k: COLORS[i % len(COLORS)] for i, (k, _) in enumerate(sorted_models)}

    active_providers = sorted(provider_totals.keys())

    # Build full model data blob for JS (drives all charts + tables + cards)
    models_js = json.dumps([
        {
            "key": k,
            "provider": ms.get("provider", ""),
            "color": model_colors[k],
            "messages": ms["messages"],
            "input": ms["input"],
            "output": ms["output"],
            "reasoning": ms["reasoning"],
            "cache_read": ms["cache_read"],
            "cost_estimated": round(ms["cost_estimated"], 2),
        }
        for k, ms in sorted_models
    ])

    providers_js = json.dumps([
        {
            "name": p,
            "color": PROVIDER_COLORS.get(p, "#7d8590"),
            "messages": provider_totals[p]["messages"],
            "sessions": provider_totals[p]["sessions"],
            "input": provider_totals[p]["input"],
            "output": provider_totals[p]["output"],
            "cost_estimated": round(provider_totals[p]["cost_estimated"], 2),
        }
        for p in active_providers
    ])

    messages_js = json.dumps(raw_messages)
    github_prs_js = json.dumps(github_prs)

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Engineering Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
  <style>
    :root {{
      --bg: #141413;
      --surface: #1c1c1a;
      --surface-hover: #2a2926;
      --border: #3d3b36;
      --text: #eae6dc;
      --text-muted: #a39e90;
      --brand: #d97757;
      --brand-hover: #e09070;
      --space-sm: 0.75rem;
      --space-md: 1rem;
      --space-lg: 1.5rem;
      --space-xl: 2rem;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      display: flex;
      min-height: 100vh;
    }}

    /* Sidebar */
    aside {{
      width: 220px;
      background: var(--bg);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }}
    .brand {{
      height: 56px;
      display: flex;
      align-items: center;
      padding: 0 1rem;
      border-bottom: 1px solid var(--border);
    }}
    .brand h1 {{
      font-size: 1rem;
      font-weight: 700;
      color: var(--text);
    }}
    .brand h1 span {{ color: var(--brand); }}

    nav {{
      padding: 0.75rem;
      flex: 1;
    }}
    .nav-item {{
      display: flex;
      align-items: center;
      gap: 0.625rem;
      padding: 0.5rem 0.75rem;
      border-radius: 8px;
      color: var(--text-muted);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.15s;
      text-decoration: none;
    }}
    .nav-item:hover {{
      background: var(--surface-hover);
      color: var(--text);
    }}
    .nav-item.active {{
      background: var(--surface);
      color: var(--text);
    }}
    .nav-item svg {{
      width: 1rem;
      height: 1rem;
      color: var(--text-muted);
    }}
    .nav-item.active svg {{ color: var(--brand); }}

    .sidebar-footer {{
      padding: 0.75rem;
      border-top: 1px solid var(--border);
      font-size: 0.7rem;
      color: var(--text-muted);
    }}

    /* Main content */
    main {{
      flex: 1;
      overflow: auto;
      padding: 1.5rem 2rem;
    }}

    .page-header {{
      margin-bottom: var(--space-lg);
    }}
    .page-header-row {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-sm);
      flex-wrap: wrap;
    }}
    .page-header h2 {{
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
    }}
    .page-header p {{
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-top: 0.25rem;
    }}

    .filter-bar {{
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: var(--space-lg);
      padding: 0.5rem 0.75rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      flex-wrap: wrap;
    }}
    .filter-bar .filter-label {{
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 600;
      flex-shrink: 0;
    }}
    .filter-pills {{
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
      flex: 1;
      min-width: 0;
    }}
    .filter-btn {{
      padding: 0.25rem 0.65rem;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-muted);
      font-size: 0.7rem;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }}
    .filter-btn:hover {{ color: var(--text); border-color: var(--text-muted); }}
    .global-range {{
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.3rem 0.5rem;
      font-size: 0.7rem;
      flex-shrink: 0;
    }}
    .action-btn {{
      margin-left: auto;
      padding: 0.35rem 0.85rem;
      border-radius: 999px;
      border: 1px solid var(--brand);
      background: transparent;
      color: var(--brand);
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }}
    .action-btn:hover {{ background: var(--brand); color: #fff; }}

    .insights-card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 0.9rem 1.1rem;
      margin-bottom: var(--space-lg);
    }}
    .insights-card h3 {{ margin-bottom: 0.5rem; }}
    .insights-card ul {{ margin: 0; padding-left: 1.1rem; }}
    .insights-card li {{ color: var(--text-muted); font-size: 0.85rem; margin: 0.2rem 0; }}
    .session-detail {{
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 50;
    }}
    .session-detail.open {{ display: flex; }}
    .session-detail-panel {{
      width: min(920px, 92vw);
      max-height: 86vh;
      overflow: auto;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.25rem;
    }}
    .session-detail-head {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }}
    .session-detail-close {{ background: transparent; border: 1px solid var(--border); color: var(--text-muted); border-radius: 8px; padding: 0.2rem 0.5rem; cursor: pointer; }}
    .session-detail-grid {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 0.9rem; }}
    .session-detail-chip {{ border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem; }}
    .session-detail-chip .k {{ font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; }}
    .session-detail-chip .v {{ font-size: 0.95rem; font-weight: 600; }}

    .summary-grid {{
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--space-sm);
      margin-bottom: var(--space-xl);
    }}
    .card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1rem 1.25rem;
    }}
    .card .label {{ font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }}
    .card .value {{ font-size: 1.5rem; font-weight: 700; margin-top: 0.25rem; }}
    .card .sub   {{ font-size: 0.75rem; color: var(--text-muted); margin-top: 0.125rem; }}

    h3 {{
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      color: var(--text);
    }}
    .section {{ margin-bottom: var(--space-xl); }}

    .charts-grid-2 {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-md);
      margin-bottom: var(--space-xl);
    }}
    .chart-card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
    }}
    .chart-card h3 {{ margin-bottom: 1rem; }}
    .chart-wrapper {{ position: relative; height: 260px; }}
    .chart-card.full .chart-wrapper {{ height: 340px; }}
    .chart-card.full {{ margin-bottom: var(--space-md); }}

    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }}
    thead th {{
      background: var(--bg);
      padding: 0.75rem 1rem;
      text-align: left;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--text-muted);
      border-bottom: 1px solid var(--border);
    }}
    thead th.right {{ text-align: right; }}
    tbody tr {{ border-bottom: 1px solid var(--border); transition: background 0.1s; }}
    tbody tr:last-child {{ border-bottom: none; }}
    tbody tr:hover {{ background: var(--surface-hover); }}
    tbody td {{ padding: 0.75rem 1rem; }}
    .table-card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow-x: auto;
    }}
    .table-card h3 {{ padding: 1rem 1.25rem; border-bottom: 1px solid var(--border); margin: 0; }}

    .presentation-card {{ padding: 0; }}
    .presentation-header {{ padding: 1rem 1.5rem; }}
    .presentation-header h3 {{ border: none; padding: 0; margin: 0; }}
    .presentation-body {{
      padding: 0 2rem 2rem;
      line-height: 1.7;
      font-size: 0.95rem;
      color: var(--text);
    }}
    .presentation-body h2 {{
      font-size: 1.3rem;
      margin: 2.5rem 0 1rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--border);
      color: var(--text);
    }}
    .presentation-body h3 {{
      font-size: 1.05rem;
      color: var(--brand);
      margin: 1.5rem 0 0.5rem;
      padding: 0;
      border: none;
    }}
    .presentation-body h4 {{
      font-size: 0.95rem;
      color: var(--text);
      margin: 1.2rem 0 0.4rem;
    }}
    .presentation-body p {{
      margin: 0.6rem 0;
    }}
    .presentation-body ul, .presentation-body ol {{
      margin: 0.5rem 0;
      padding-left: 1.5rem;
    }}
    .presentation-body li {{
      margin: 0.35rem 0;
    }}
    .presentation-body blockquote {{
      border-left: 3px solid var(--brand);
      padding: 0.75rem 1.25rem;
      margin: 1rem 0;
      background: var(--surface-hover);
      border-radius: 0 8px 8px 0;
      color: var(--text-muted);
      font-style: italic;
    }}
    .presentation-body code {{
      background: var(--surface-hover);
      padding: 0.15rem 0.4rem;
      border-radius: 3px;
      font-size: 0.85em;
    }}
    .presentation-body hr {{
      border: none;
      border-top: 1px solid var(--border);
      margin: 2rem 0;
    }}
    .presentation-body em {{
      color: var(--text-muted);
    }}
    .presentation-body strong {{
      color: var(--text);
    }}

    .mono  {{ font-family: ui-monospace, "SF Mono", monospace; }}
    .right {{ text-align: right; }}
    .cost  {{ color: var(--brand); }}
    .path  {{ max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.8rem; color: var(--text-muted); }}

    .model-badge {{
      display: inline-flex;
      align-items: center;
      gap: 0.4em;
      padding: 0.2em 0.65em;
      border-radius: 8px;
      border: 1px solid;
      font-size: 0.8rem;
      font-weight: 500;
      font-family: inherit;
      max-width: 100%;
    }}
    .model-badge .model-name {{
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }}
    .provider-badge {{
      font-size: 0.65rem;
      font-weight: 600;
      font-family: inherit;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      padding: 0.15em 0.45em;
      border-radius: 4px;
      background: var(--surface-hover);
    }}

    .timeline-card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: var(--space-xl);
    }}
    .timeline-header {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }}
    .timeline-header h3 {{ margin: 0; }}
    .timeline-controls {{
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }}
    .timeline-select {{
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.3rem 0.55rem;
      font-size: 0.75rem;
      font-family: inherit;
      min-width: 7rem;
      cursor: pointer;
    }}
    .timeline-select:focus {{
      outline: none;
      border-color: var(--brand);
    }}
    .btn-group {{
      display: flex;
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }}
    .btn {{
      background: transparent;
      color: var(--text-muted);
      border: none;
      padding: 0.3rem 0.65rem;
      font-size: 0.7rem;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
    }}
    .btn:not(:last-child) {{ border-right: 1px solid var(--border); }}
    .btn:hover {{ color: var(--text); background: var(--surface-hover); }}
    .btn.active {{ background: var(--brand); color: #fff; }}
    .timeline-wrapper {{ position: relative; height: 500px; }}

    footer {{
      text-align: center;
      padding: 1.5rem;
      color: var(--text-muted);
      font-size: 0.75rem;
      border-top: 1px solid var(--border);
      margin-top: auto;
    }}

    .tab-bar {{
      display: flex;
      gap: 0.25rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }}
    .tab-btn {{
      padding: 0.75rem 1rem;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--text-muted);
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.15s;
    }}
    .tab-btn:hover {{ color: var(--text); }}
    .tab-btn.active {{
      color: var(--text);
      border-bottom-color: var(--brand);
    }}

    .sortable thead th {{
      cursor: pointer;
      user-select: none;
      position: relative;
      padding-right: 1.5rem;
    }}
    .sortable thead th:hover {{ color: var(--text); }}
    .sortable thead th::after {{
      content: "";
      position: absolute;
      right: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.6rem;
      color: var(--text-muted);
    }}
    .sortable thead th.sort-asc::after {{ content: "\\25B2"; color: var(--brand); }}
    .sortable thead th.sort-desc::after {{ content: "\\25BC"; color: var(--brand); }}

    @media (max-width: 900px) {{
      .charts-grid-2 {{ grid-template-columns: 1fr; }}
      .summary-grid {{ grid-template-columns: repeat(2, 1fr); }}
      .session-detail-grid {{ grid-template-columns: repeat(2, 1fr); }}
      aside {{ display: none; }}
    }}

    /* Page sections */
    .page {{ display: none; }}
    .page.active {{ display: block; }}
  </style>
</head>
<body>

<aside>
  <div class="brand">
    <h1><span>Engineering</span> Dashboard</h1>
  </div>
  <nav>
    <a class="nav-item active" data-page="overview">
      <svg viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="3" width="14" height="3" rx="1"/><rect x="1" y="8" width="14" height="3" rx="1"/><rect x="1" y="13" width="14" height="3" rx="1"/></svg>
      Overview
    </a>
    <a class="nav-item" data-page="timeline">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 12l3-3 3 3 5-5v3H2v-1z"/><circle cx="13.5" cy="4.5" r="2"/></svg>
      Timeline
    </a>
    <a class="nav-item" data-page="sessions">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a3 3 0 110 6 3 3 0 010-6zm-5 12a5 5 0 0110 0v2H3v-2z"/></svg>
      Sessions
    </a>
    <a class="nav-item" data-page="models">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM6 5l6 3-6 3V5z"/></svg>
      Models
    </a>
    <a class="nav-item" data-page="projects">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h4l1 1h7v10H2V3zm0 5h12"/></svg>
      Projects
    </a>
    <a class="nav-item" data-page="pullrequests">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.25a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0zM7.25 2a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5zM3 11.75a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0zM5.25 10.5a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5zM10 11.75a2.25 2.25 0 114.5 0 2.25 2.25 0 01-4.5 0zM12.25 10.5a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5zM7.25 5.5v5M5.25 10.5l2-5M12.25 10.5l-5-5"/></svg>
      Pull Requests
    </a>
    <a class="nav-item" data-page="prdetails">
      <svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2h5v5H2zm7 0h5v5H9zM2 9h5v5H2zm7 0h5v5H9z"/></svg>
      PR Details
    </a>
  </nav>
  <div class="sidebar-footer">
    <p>Generated {generated_at}</p>
  </div>
</aside>

<main>
  <!-- Provider filter -->
  <div class="filter-bar">
    <span class="filter-label">Filter</span>
    <div class="filter-pills">
      <button class="filter-btn active" data-provider="all">All</button>
    </div>
    <select id="globalRangeSelect" class="global-range" aria-label="Global date range">
      <option value="7d">Last 7 days</option>
      <option value="30d">Last 30 days</option>
      <option value="90d" selected>Last 90 days</option>
      <option value="180d">Last 6 months</option>
      <option value="1y">Last 1 year</option>
      <option value="2y">Last 2 years</option>
      <option value="all">All time</option>
    </select>
  </div>

  <!-- Overview Page -->
  <div class="page active" id="page-overview">
    <div class="page-header">
      <div class="page-header-row">
        <h2>Overview</h2>
        <button id="analyzeBtn" class="action-btn">Analyze</button>
      </div>
      <p>Token usage analytics across all providers</p>
    </div>

    <div id="insightsCard" class="insights-card" hidden>
      <h3>Insights</h3>
      <ul id="insightsList"></ul>
    </div>

    <!-- Summary cards -->
    <div class="summary-grid" id="summaryCards"></div>

    <!-- Charts -->
    <div class="chart-card full">
      <h3>Tokens by Model</h3>
      <div class="chart-wrapper"><canvas id="barChart"></canvas></div>
    </div>
    <div class="charts-grid-2">
      <div class="chart-card">
        <h3>Output Token Share</h3>
        <div class="chart-wrapper"><canvas id="donutChart"></canvas></div>
      </div>
      <div class="chart-card">
        <h3>Tokens by Provider</h3>
        <div class="chart-wrapper"><canvas id="provDonutChart"></canvas></div>
      </div>
    </div>
  </div>

  <!-- Sessions Page -->
  <div class="page" id="page-sessions">
    <div class="page-header">
      <h2>Sessions</h2>
      <p>Session-level usage by tool/provider</p>
    </div>
    <div class="section">
      <div class="table-card">
        <h3>Sessions by Token Usage</h3>
        <table class="sortable" id="sessionTable">
          <thead>
            <tr>
              <th data-type="string">Session</th>
              <th data-type="string">Source</th>
              <th data-type="string">Project</th>
              <th class="right" data-type="number">Models</th>
              <th class="right" data-type="number">Messages</th>
              <th class="right" data-type="number">Input</th>
              <th class="right" data-type="number">Output</th>
              <th class="right" data-type="number">Total</th>
              <th class="right" data-type="number">Est. Cost</th>
              <th data-type="string">Last Active</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Timeline Page -->
  <div class="page" id="page-timeline">
    <div class="page-header">
      <h2>Timeline</h2>
      <p>Token usage over time</p>
    </div>
    <div class="timeline-card">
      <div class="timeline-header">
        <h3>Token Usage Over Time</h3>
        <div class="timeline-controls">
          <div class="btn-group" id="chartTypeGroup">
            <button class="btn active" data-value="line">Line</button>
            <button class="btn" data-value="bar">Bar</button>
          </div>
          <div class="btn-group" id="tokenTypeGroup">
            <button class="btn" data-value="input">Input</button>
            <button class="btn" data-value="output">Output</button>
            <button class="btn" data-value="reasoning">Reasoning</button>
            <button class="btn active" data-value="total">Total</button>
          </div>
          <div class="btn-group" id="groupByGroup">
            <button class="btn" data-value="hour">Hour</button>
            <button class="btn active" data-value="day">Day</button>
            <button class="btn" data-value="week">Week</button>
            <button class="btn" data-value="month">Month</button>
          </div>
          <!-- Range controlled by global filter -->
        </div>
      </div>
      <div class="timeline-wrapper"><canvas id="lineChart"></canvas></div>
    </div>
  </div>

  <!-- Models Page -->
  <div class="page" id="page-models">
    <div class="page-header">
      <h2>Models</h2>
      <p>Token usage by model</p>
    </div>
    <div class="section">
      <div class="table-card">
        <h3>Token Usage by Model</h3>
        <table class="sortable" id="modelTable">
          <thead>
            <tr>
              <th data-type="string">Model</th>
              <th data-type="string">Source</th>
              <th class="right" data-type="number">Messages</th>
              <th class="right" data-type="number">Input</th>
              <th class="right" data-type="number">Output</th>
              <th class="right" data-type="number">Reasoning</th>
              <th class="right" data-type="number">Cache Read</th>
              <th class="right" data-type="number">Total</th>
              <th class="right" data-type="number">Est. Cost</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Projects Page -->
  <div class="page" id="page-projects">
    <div class="page-header">
      <h2>Projects</h2>
      <p>Token usage by project</p>
    </div>
    <div class="section">
      <div class="table-card">
        <h3>Projects by Token Usage</h3>
        <table class="sortable" id="projectTable">
          <thead>
            <tr>
              <th data-type="string">Project</th>
              <th class="right" data-type="number">Messages</th>
              <th class="right" data-type="number">Input</th>
              <th class="right" data-type="number">Output</th>
              <th class="right" data-type="number">Total</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- Pull Requests Page -->
  <div class="page" id="page-pullrequests">
    <div class="page-header">
      <h2>Pull Requests</h2>
      <p>GitHub PR statistics across all repositories</p>
    </div>

    <!-- Org filter -->
    <div class="filter-bar" id="prOrgFilterBar">
      <span class="filter-label">Org</span>
      <select id="prOrgSelect" class="global-range" aria-label="Organization filter">
        <option value="all" selected>All organizations</option>
      </select>
    </div>

    <!-- PR summary cards -->
    <div class="summary-grid" id="prSummaryCards"></div>

    <!-- PRs over time chart -->
    <div class="chart-card full">
      <h3>PRs Over Time (by month)</h3>
      <div class="chart-wrapper"><canvas id="prTimelineChart"></canvas></div>
    </div>

    <div class="chart-card full">
      <h3>Avg Merged PRs per Day (by month)</h3>
      <div class="chart-wrapper"><canvas id="prAvgDayChart"></canvas></div>
    </div>

    <div class="chart-card full">
      <h3>Avg Time to Merge (by month)</h3>
      <div class="chart-wrapper"><canvas id="prTimeToMergeChart"></canvas></div>
    </div>

    <!-- Reviews section -->
    <div class="summary-grid" id="reviewSummaryCards"></div>

    <div class="chart-card full">
      <h3>Reviews Over Time (by month)</h3>
      <div class="chart-wrapper"><canvas id="reviewTimelineChart"></canvas></div>
    </div>
  </div>

  <!-- PR Details Page -->
  <div class="page" id="page-prdetails">
    <div class="page-header">
      <h2>PR Details</h2>
      <p>Size percentiles and per-repository breakdown</p>
    </div>

    <!-- Org filter (shared state with PR page) -->
    <div class="filter-bar" id="prDetailsOrgFilterBar">
      <span class="filter-label">Org</span>
      <select id="prDetailsOrgSelect" class="global-range" aria-label="Organization filter">
        <option value="all" selected>All organizations</option>
      </select>
    </div>

    <!-- Size percentiles -->
    <div class="section">
      <div class="table-card">
        <h3>PR Size Percentiles</h3>
        <table id="prSizeTable">
          <thead>
            <tr>
              <th data-type="string">Metric</th>
              <th class="right" data-type="number">Avg</th>
              <th class="right" data-type="number">P25</th>
              <th class="right" data-type="number">P50</th>
              <th class="right" data-type="number">P75</th>
              <th class="right" data-type="number">P90</th>
              <th class="right" data-type="number">P95</th>
              <th class="right" data-type="number">P99</th>
              <th class="right" data-type="number">Max</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>

    <!-- PRs per project -->
    <div class="section">
      <div class="table-card">
        <h3>PRs per Repository</h3>
        <table class="sortable" id="prProjectTable">
          <thead>
            <tr>
              <th data-type="string">Repository</th>
              <th class="right" data-type="number">Total</th>
              <th class="right" data-type="number">Merged</th>
              <th class="right" data-type="number">Open</th>
              <th class="right" data-type="number">Closed</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>


  <div id="sessionDetailModal" class="session-detail" role="dialog" aria-modal="true" aria-label="Session details">
    <div class="session-detail-panel">
      <div class="session-detail-head">
        <h3 id="sessionDetailTitle">Session Details</h3>
        <button id="sessionDetailClose" class="session-detail-close">Close</button>
      </div>
      <div id="sessionDetailMeta" class="session-detail-grid"></div>
      <div class="table-card">
        <h3>Model Breakdown</h3>
        <table id="sessionDetailTable">
          <thead>
            <tr>
              <th>Model</th>
              <th class="right">Input</th>
              <th class="right">Output</th>
              <th class="right">Total</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
  </div>
</main>

<footer>Engineering Dashboard</footer>

<script>
// =========================================================================
// Data
// =========================================================================
const ALL_MODELS = {models_js};
const PROVIDERS = {providers_js};
const RAW_MESSAGES = {messages_js};
const PROVIDER_COLORS = {json.dumps(PROVIDER_COLORS)};
const GITHUB_PRS = {github_prs_js};

// Model -> provider lookup
const MODEL_PROVIDER = {{}};
ALL_MODELS.forEach(m => MODEL_PROVIDER[m.key] = m.provider);
const MODEL_META = {{}};
ALL_MODELS.forEach(m => {{ MODEL_META[m.key] = m; }});
const MODEL_RATE = {{}};
ALL_MODELS.forEach(m => {{
  const denom = (m.input || 0) + (m.output || 0) + (m.cache_read || 0);
  MODEL_RATE[m.key] = denom > 0 ? (m.cost_estimated || 0) / denom : 0;
}});

function parseModelKey(key) {{
  const match = key.match(/^(.+?)\\s*\\[(.+?)\\]$/);
  if (match) return {{ name: match[1].trim(), provider: match[2].trim() }};
  return {{ name: key, provider: "" }};
}}

const NORMALIZED_MESSAGES = RAW_MESSAGES.map(m => {{
  const provider = m.provider || "unknown";
  const modelKey = `${{m.model}} [${{provider}}]`;
  return {{
    provider,
    model: m.model,
    modelKey,
    input: m.input_tokens || 0,
    output: m.output_tokens || 0,
    reasoning: m.reasoning_tokens || 0,
    cache_read: m.cache_read_tokens || 0,
    cache_write: m.cache_write_tokens || 0,
    cost_logged: m.cost || 0,
    timestamp_ms: m.timestamp_ms || 0,
    session_id: m.session_id || "(unknown)",
    project: m.project || "unknown",
  }};
}});

// =========================================================================
// State
// =========================================================================
let activeProvider = "all"; // "all" or a provider name
let tlState = {{ chartType: "line", tokenType: "total", groupBy: "day" }};
let globalRange = "90d";

const chartDefaults = {{
  responsive: true,
  maintainAspectRatio: false,
  plugins: {{ legend: {{ labels: {{ color: "#eae6dc", font: {{ size: 12 }} }} }} }},
}};
const fmtAxis = v => v >= 1e6 ? (v/1e6).toFixed(1)+"M" : v >= 1e3 ? (v/1e3).toFixed(0)+"K" : v;
const fmtNum = n => n.toLocaleString();
const fmtCompact = n => {{
  if (n >= 1e9) return (n/1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n/1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n/1e3).toFixed(1) + "K";
  return String(n);
}};
const fmtCost = c => "$" + c.toFixed(2);

function getGlobalCutoff() {{
  if (globalRange === "all") return 0;
  const now = new Date();
  const c = new Date(now.getTime());
  if (globalRange.endsWith("d")) c.setUTCDate(c.getUTCDate() - Number(globalRange.slice(0, -1)));
  else if (globalRange.endsWith("y")) c.setUTCFullYear(c.getUTCFullYear() - Number(globalRange.slice(0, -1)));
  return c.getTime();
}}

function getFilteredMessages() {{
  const cutoff = getGlobalCutoff();
  return NORMALIZED_MESSAGES.filter(m => {{
    if (activeProvider !== "all" && m.provider !== activeProvider) return false;
    if (!cutoff || !m.timestamp_ms) return true;
    return m.timestamp_ms >= cutoff;
  }});
}}

function getSessionRows() {{
  const filtered = getFilteredMessages();
  const rows = {{}};
  const sessionModelTotals = {{}};
  for (const m of filtered) {{
    const key = `${{m.provider}}:${{m.session_id}}`;
    if (!rows[key]) {{
      rows[key] = {{
        provider: m.provider,
        session_id: m.session_id,
        project: m.project || "unknown",
        messages: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache_read: 0,
        cache_write: 0,
        total: 0,
        model_count: 0,
        models: new Set(),
        start_ms: 0,
        end_ms: 0,
      }};
    }}
    const r = rows[key];
    r.messages += 1;
    r.input += m.input;
    r.output += m.output;
    r.reasoning += m.reasoning;
    r.cache_read += m.cache_read;
    r.cache_write += m.cache_write;
    r.total += m.input + m.output;
    r.models.add(m.modelKey);
    if (!sessionModelTotals[key]) sessionModelTotals[key] = {{}};
    if (!sessionModelTotals[key][m.modelKey]) sessionModelTotals[key][m.modelKey] = 0;
    sessionModelTotals[key][m.modelKey] += m.input + m.output + m.cache_read;
    if (!r.start_ms || (m.timestamp_ms && m.timestamp_ms < r.start_ms)) r.start_ms = m.timestamp_ms;
    if (m.timestamp_ms > r.end_ms) r.end_ms = m.timestamp_ms;
    if (r.project === "unknown" && m.project) r.project = m.project;
  }}

  return Object.values(rows).map(r => {{
    let cost = 0;
    for (const modelKey of r.models) {{
      const rate = MODEL_RATE[modelKey] || 0;
      const key = `${{r.provider}}:${{r.session_id}}`;
      const modelTokens = sessionModelTotals[key]?.[modelKey] || 0;
      cost += modelTokens * rate;
    }}
    return {{ ...r, model_count: r.models.size, cost_estimated: cost }};
  }});
}}

function getModelRows() {{
  const rows = {{}};
  for (const m of getFilteredMessages()) {{
    if (!rows[m.modelKey]) {{
      const meta = MODEL_META[m.modelKey] || {{}};
      rows[m.modelKey] = {{
        key: m.modelKey,
        provider: m.provider,
        color: meta.color || "#b88a5a",
        messages: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache_read: 0,
        cost_estimated: 0,
      }};
    }}
    const r = rows[m.modelKey];
    r.messages += 1;
    r.input += m.input;
    r.output += m.output;
    r.reasoning += m.reasoning;
    r.cache_read += m.cache_read;
  }}
  return Object.values(rows).map(r => {{
    const rate = MODEL_RATE[r.key] || 0;
    return {{ ...r, cost_estimated: (r.input + r.output + r.cache_read) * rate }};
  }}).sort((a, b) => (b.input + b.output) - (a.input + a.output));
}}

function getProviderRows() {{
  const rows = {{}};
  for (const m of getFilteredMessages()) {{
    if (!rows[m.provider]) rows[m.provider] = {{ name: m.provider, input: 0, output: 0, messages: 0, sessions: new Set(), color: PROVIDER_COLORS[m.provider] || "#a39e90" }};
    const r = rows[m.provider];
    r.input += m.input;
    r.output += m.output;
    r.messages += 1;
    r.sessions.add(m.session_id);
  }}
  return Object.values(rows).map(r => ({{ ...r, sessions: r.sessions.size }}));
}}

// =========================================================================
// Navigation
// =========================================================================
function initNav() {{
  document.querySelectorAll('.nav-item').forEach(item => {{
    item.addEventListener('click', e => {{
      e.preventDefault();
      const page = item.dataset.page;
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + page).classList.add('active');
      // Hide token filter bar on pages that don't use it
      const bar = document.querySelector('.filter-bar:not(#prOrgFilterBar):not(#prDetailsOrgFilterBar)');
      if (bar) bar.style.display = ['pullrequests', 'prdetails'].includes(page) ? 'none' : '';
    }});
  }});
}}

// =========================================================================
// Filter bar
// =========================================================================
function initFilterBar() {{
  const bar = document.querySelector(".filter-bar");
  const pills = bar.querySelector(".filter-pills");
  const globalRangeSelect = document.getElementById("globalRangeSelect");
  PROVIDERS.forEach(p => {{
    const btn = document.createElement("button");
    btn.className = "filter-btn";
    btn.dataset.provider = p.name;
    btn.textContent = p.name;
    btn.style.setProperty("--pcolor", p.color);
    pills.appendChild(btn);
  }});
  pills.addEventListener("click", e => {{
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    pills.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeProvider = btn.dataset.provider;
    renderAll();
  }});
  if (globalRangeSelect) {{
    globalRangeSelect.value = globalRange;
    globalRangeSelect.addEventListener("change", e => {{
      globalRange = e.target.value;
      renderAll();
    }});
  }}
  updateFilterStyles();
}}

function updateFilterStyles() {{
  document.querySelectorAll(".filter-pills .filter-btn").forEach(btn => {{
    const p = btn.dataset.provider;
    const color = p === "all" ? "#d97757" : (PROVIDER_COLORS[p] || "#a39e90");
    if (btn.classList.contains("active")) {{
      btn.style.background = color;
      btn.style.borderColor = color;
      btn.style.color = "#fff";
    }} else {{
      btn.style.background = "transparent";
      btn.style.borderColor = "";
      btn.style.color = "";
    }}
  }});
}}

// =========================================================================
// Summary cards
// =========================================================================
function renderSummaryCards() {{
  const models = getModelRows();
  const providerRows = getProviderRows();
  const sessionRows = getSessionRows();
  const msgs = models.reduce((s, m) => s + m.messages, 0);
  const inp = models.reduce((s, m) => s + m.input, 0);
  const out = models.reduce((s, m) => s + m.output, 0);
  const rea = models.reduce((s, m) => s + m.reasoning, 0);
  const cr = models.reduce((s, m) => s + m.cache_read, 0);
  const cost = models.reduce((s, m) => s + m.cost_estimated, 0);
  const sess = sessionRows.length;

  let html = `
    <div class="card"><div class="label">Messages</div><div class="value">${{fmtCompact(msgs)}}</div><div class="sub">${{fmtNum(msgs)}} turns</div></div>
    <div class="card"><div class="label">Sessions</div><div class="value">${{fmtCompact(sess)}}</div><div class="sub">unique sessions</div></div>
    <div class="card"><div class="label">Input</div><div class="value" style="color:#b88a5a">${{fmtCompact(inp)}}</div><div class="sub">${{fmtNum(inp)}}</div></div>
    <div class="card"><div class="label">Output</div><div class="value" style="color:#6f8b6e">${{fmtCompact(out)}}</div><div class="sub">${{fmtNum(out)}}</div></div>
    <div class="card"><div class="label">Reasoning</div><div class="value" style="color:#9f7a4f">${{fmtCompact(rea)}}</div><div class="sub">${{fmtNum(rea)}}</div></div>
    <div class="card"><div class="label">Cache Read</div><div class="value" style="color:#4f7f78">${{fmtCompact(cr)}}</div><div class="sub">${{fmtNum(cr)}}</div></div>
    <div class="card"><div class="label">Est. Cost</div><div class="value" style="color:#d97757">${{fmtCost(cost)}}</div><div class="sub">selected range</div></div>
    <div class="card"><div class="label">Range</div><div class="value" style="color:#8b6f9b">${{globalRange === 'all' ? 'All' : globalRange.toUpperCase()}}</div><div class="sub">applies to all views</div></div>
  `;

  if (activeProvider === "all") {{
    providerRows.forEach(p => {{
      html += `<div class="card"><div class="label" style="color:${{p.color}}">${{p.name}}</div><div class="value">${{fmtCompact(p.messages)}}</div><div class="sub">${{fmtNum((p.input || 0) + (p.output || 0))}} tokens</div></div>`;
    }});
  }}

  document.getElementById("summaryCards").innerHTML = html;
}}

// =========================================================================
// Charts
// =========================================================================
let barChart, donutChart, provDonutChart;

function renderBarChart() {{
  const models = getModelRows();
  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById("barChart"), {{
    type: "bar",
    data: {{
      labels: models.map(m => parseModelKey(m.key).name),
      datasets: [
        {{ label: "Input", data: models.map(m => m.input), backgroundColor: models.map(m => m.color + "cc"), borderRadius: 4 }},
        {{ label: "Output", data: models.map(m => m.output), backgroundColor: models.map(m => m.color + "55"), borderRadius: 4 }},
      ]
    }},
    options: {{
      ...chartDefaults,
      scales: {{
        x: {{ ticks: {{ color: "#a39e90", maxRotation: 45, minRotation: 25 }}, grid: {{ color: "#3d3b36" }} }},
        y: {{ ticks: {{ color: "#a39e90", callback: fmtAxis }}, grid: {{ color: "#3d3b36" }} }},
      }},
    }}
  }});
}}

function renderDonutChart() {{
  const models = getModelRows();
  if (donutChart) donutChart.destroy();
  donutChart = new Chart(document.getElementById("donutChart"), {{
    type: "doughnut",
    data: {{
      labels: models.map(m => parseModelKey(m.key).name),
      datasets: [{{ data: models.map(m => m.output), backgroundColor: models.map(m => m.color), borderWidth: 0 }}],
    }},
    options: {{ ...chartDefaults, cutout: "65%" }}
  }});
}}

function renderProvDonutChart() {{
  if (provDonutChart) provDonutChart.destroy();
  const provs = getProviderRows();
  provDonutChart = new Chart(document.getElementById("provDonutChart"), {{
    type: "doughnut",
    data: {{
      labels: provs.map(p => p.name),
      datasets: [{{ data: provs.map(p => p.input + p.output), backgroundColor: provs.map(p => p.color), borderWidth: 0 }}],
    }},
    options: {{ ...chartDefaults, cutout: "65%" }}
  }});
}}

// =========================================================================
// Timeline
// =========================================================================
let tlChart = null;

function getWeekKey(d) {{
  const dt = new Date(d + ":00:00Z");
  const jan1 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - jan1) / 86400000 + jan1.getUTCDay() + 1) / 7);
  return dt.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
}}

function parseWeekKey(weekKey) {{
  const [year, weekNum] = weekKey.split("-W").map(Number);
  const jan1 = new Date(Date.UTC(year, 0, 1));
  return new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7 - jan1.getUTCDay() + 1));
}}

function groupData(groupBy) {{
  const buckets = {{}};
  for (const msg of getFilteredMessages()) {{
    if (!msg.timestamp_ms) continue;
    const iso = new Date(msg.timestamp_ms).toISOString();
    const hourKey = iso.slice(0, 13);
    let bk;
    if (groupBy === "hour") bk = hourKey;
    else if (groupBy === "day") bk = hourKey.slice(0, 10);
    else if (groupBy === "week") bk = getWeekKey(hourKey);
    else bk = hourKey.slice(0, 7);
    if (!buckets[bk]) buckets[bk] = {{}};
    if (!buckets[bk][msg.modelKey]) buckets[bk][msg.modelKey] = {{ input: 0, output: 0, reasoning: 0 }};
    buckets[bk][msg.modelKey].input += msg.input || 0;
    buckets[bk][msg.modelKey].output += msg.output || 0;
    buckets[bk][msg.modelKey].reasoning += msg.reasoning || 0;
  }}
  return buckets;
}}

function fillGaps(keys, groupBy) {{
  if (keys.length < 2 || groupBy === "hour") return [...keys].sort();
  const sorted = [...keys].sort();
  const first = sorted[0], last = sorted[sorted.length - 1];
  const filled = [];
  if (groupBy === "day") {{
    const d = new Date(first + "T00:00:00Z"), end = new Date(last + "T00:00:00Z");
    while (d <= end) {{ filled.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }}
  }} else if (groupBy === "week") {{
    const d = parseWeekKey(first), end = parseWeekKey(last);
    while (d <= end) {{ filled.push(getWeekKey(d.toISOString().slice(0, 13).replace(":", ""))); d.setUTCDate(d.getUTCDate() + 7); }}
  }} else if (groupBy === "month") {{
    const [fy, fm] = first.split("-").map(Number), [ly, lm] = last.split("-").map(Number);
    let y = fy, m = fm;
    while (y < ly || (y === ly && m <= lm)) {{ filled.push(y + "-" + String(m).padStart(2, "0")); m++; if (m > 12) {{ m = 1; y++; }} }}
  }}
  return filled.length ? filled : sorted;
}}

function fmtTimeLabel(raw, groupBy) {{
  if (groupBy === "hour") {{ const [dp, h] = raw.split("T"); const d = new Date(dp + "T00:00:00Z"); return d.toLocaleString("en", {{ month: "short", timeZone: "UTC" }}) + " " + d.getUTCDate() + " " + h + ":00"; }}
  if (groupBy === "day") {{ const d = new Date(raw + "T00:00:00Z"); return d.toLocaleString("en", {{ month: "short", timeZone: "UTC" }}) + " " + d.getUTCDate(); }}
  if (groupBy === "week") return raw;
  if (groupBy === "month") {{ const d = new Date(raw + "-01T00:00:00Z"); return d.toLocaleString("en", {{ month: "long", year: "numeric", timeZone: "UTC" }}); }}
  return raw;
}}

function parseGroupStart(groupKey, groupBy) {{
  if (groupBy === "hour") return new Date(groupKey + ":00:00Z");
  if (groupBy === "day") return new Date(groupKey + "T00:00:00Z");
  if (groupBy === "week") return parseWeekKey(groupKey);
  if (groupBy === "month") return new Date(groupKey + "-01T00:00:00Z");
  return new Date(groupKey);
}}

function getLookbackCutoff(anchorDate, lookback) {{
  if (lookback === "all") return null;
  const amount = Number(lookback.slice(0, -1));
  const unit = lookback.slice(-1);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const cutoff = new Date(anchorDate.getTime());
  if (unit === "m") cutoff.setUTCMonth(cutoff.getUTCMonth() - amount);
  if (unit === "y") cutoff.setUTCFullYear(cutoff.getUTCFullYear() - amount);
  return cutoff;
}}

function filterLabelsByLookback(labels, groupBy, lookback) {{
  if (!labels.length || lookback === "all") return labels;
  const anchorDate = parseGroupStart(labels[labels.length - 1], groupBy);
  if (Number.isNaN(anchorDate.getTime())) return labels;
  const cutoff = getLookbackCutoff(anchorDate, lookback);
  if (!cutoff) return labels;

  return labels.filter(label => {{
    const pointDate = parseGroupStart(label, groupBy);
    return !Number.isNaN(pointDate.getTime()) && pointDate >= cutoff;
  }});
}}

const CHART_GRID_COLOR = "#3d3b36";
const CHART_TEXT_COLOR = "#a39e90";

function renderTimeline() {{
  const {{ chartType, tokenType, groupBy }} = tlState;
  const grouped = groupData(groupBy);
  const labels = fillGaps(Object.keys(grouped), groupBy).sort();
  const visibleModels = getModelRows().map(m => {{
    const parsed = parseModelKey(m.key);
    return {{ key: m.key, name: parsed.name, color: m.color, provider: m.provider }};
  }});

  const datasets = visibleModels.map(m => {{
    const series = labels.map(l => {{
      const b = grouped[l]?.[m.key] || {{ input: 0, output: 0, reasoning: 0 }};
      if (tokenType === "input") return b.input;
      if (tokenType === "output") return b.output;
      if (tokenType === "reasoning") return b.reasoning;
      return b.input + b.output + b.reasoning;
    }});

    const firstRealIdx = series.findIndex(v => v > 0);
    const data = series.map((v, idx) => (firstRealIdx !== -1 && idx < firstRealIdx ? null : v));

    return {{
      label: m.name, data,
      borderColor: m.color,
      backgroundColor: chartType === "bar" ? m.color + "bb" : m.color + "20",
      tension: 0.3, fill: false,
      pointRadius: 0,
      pointHoverRadius: 3,
      borderWidth: chartType === "line" ? 2 : 0,
      borderRadius: chartType === "bar" ? 4 : 0,
    }};
  }});

  if (tlChart) tlChart.destroy();
  tlChart = new Chart(document.getElementById("lineChart"), {{
    type: chartType,
    data: {{ labels: labels.map(l => fmtTimeLabel(l, groupBy)), datasets }},
    options: {{
      ...chartDefaults,
      interaction: {{ mode: "index", intersect: false }},
      scales: {{
        x: {{
          title: {{ display: true, text: groupBy.charAt(0).toUpperCase() + groupBy.slice(1), color: CHART_TEXT_COLOR }},
          ticks: {{ color: CHART_TEXT_COLOR, maxTicksLimit: 24, maxRotation: 45, minRotation: 25 }},
          grid: {{ color: CHART_GRID_COLOR }},
          stacked: chartType === "bar",
        }},
        y: {{
          title: {{ display: true, text: tokenType.charAt(0).toUpperCase() + tokenType.slice(1) + " Tokens", color: CHART_TEXT_COLOR }},
          ticks: {{ color: CHART_TEXT_COLOR, callback: fmtAxis }},
          grid: {{ color: CHART_GRID_COLOR }},
          stacked: chartType === "bar",
        }},
      }},
      plugins: {{
        ...chartDefaults.plugins,
        tooltip: {{
          callbacks: {{
            label: ctx => ctx.dataset.label + ": " + ctx.parsed.y.toLocaleString() + " tokens"
          }}
        }}
      }},
    }},
  }});
}}



// =========================================================================
// Tables
// =========================================================================
function renderModelTable() {{
  const models = getModelRows();
  const tbody = document.querySelector("#modelTable tbody");
  tbody.innerHTML = models.map(m => {{
    const total = m.input + m.output;
    const pc = PROVIDER_COLORS[m.provider] || "#7d8590";
    const parsed = parseModelKey(m.key);
    return `<tr data-provider="${{m.provider}}">
      <td data-sort="${{parsed.name}}"><span class="model-badge" style="background:${{m.color}}20;color:${{m.color}};border-color:${{m.color}}40"><span class="model-name">${{parsed.name}}</span></span></td>
      <td data-sort="${{m.provider}}"><span class="provider-badge" style="color:${{pc}}">${{m.provider}}</span></td>
      <td class="mono right" data-sort="${{m.messages}}">${{fmtNum(m.messages)}}</td>
      <td class="mono right" data-sort="${{m.input}}">${{fmtNum(m.input)}}</td>
      <td class="mono right" data-sort="${{m.output}}">${{fmtNum(m.output)}}</td>
      <td class="mono right" data-sort="${{m.reasoning}}">${{fmtNum(m.reasoning)}}</td>
      <td class="mono right" data-sort="${{m.cache_read}}">${{fmtNum(m.cache_read)}}</td>
      <td class="mono right" data-sort="${{total}}">${{fmtNum(total)}}</td>
      <td class="mono right cost" data-sort="${{m.cost_estimated.toFixed(6)}}">${{fmtCost(m.cost_estimated)}}</td>
    </tr>`;
  }}).join("");
}}

function renderProjectTable() {{
  const tbody = document.querySelector("#projectTable tbody");
  const byProject = {{}};
  for (const m of getFilteredMessages()) {{
    const key = m.project || "unknown";
    if (!byProject[key]) byProject[key] = {{ dirName: key, path: key, msgs: 0, inp: 0, out: 0, total: 0 }};
    byProject[key].msgs += 1;
    byProject[key].inp += m.input;
    byProject[key].out += m.output;
    byProject[key].total += m.input + m.output;
  }}
  const rows = Object.values(byProject);
  rows.sort((a, b) => b.total - a.total);
  tbody.innerHTML = rows.map(r => `<tr>
    <td class="mono path" title="${{r.path}}" data-sort="${{r.dirName}}">${{r.dirName}}</td>
    <td class="mono right" data-sort="${{r.msgs}}">${{fmtNum(r.msgs)}}</td>
    <td class="mono right" data-sort="${{r.inp}}">${{fmtNum(r.inp)}}</td>
    <td class="mono right" data-sort="${{r.out}}">${{fmtNum(r.out)}}</td>
    <td class="mono right" data-sort="${{r.total}}">${{fmtNum(r.total)}}</td>
  </tr>`).join("");
}}

function fmtDateTime(ms) {{
  if (!ms) return "-";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en", {{
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }});
}}

function renderSessionTable() {{
  const tbody = document.querySelector("#sessionTable tbody");
  const rows = getSessionRows()
    .slice()
    .sort((a, b) => (b.total || 0) - (a.total || 0));

  tbody.innerHTML = rows.map(s => `<tr data-session-key="${{s.provider}}:${{s.session_id}}">
    <td class="mono" data-sort="${{s.session_id}}">${{s.session_id}}</td>
    <td data-sort="${{s.provider}}"><span class="provider-badge" style="color:${{PROVIDER_COLORS[s.provider] || '#a39e90'}}">${{s.provider}}</span></td>
    <td class="mono path" title="${{s.project}}" data-sort="${{s.project}}">${{s.project}}</td>
    <td class="mono right" data-sort="${{s.model_count}}">${{fmtNum(s.model_count || 0)}}</td>
    <td class="mono right" data-sort="${{s.messages}}">${{fmtNum(s.messages || 0)}}</td>
    <td class="mono right" data-sort="${{s.input}}">${{fmtNum(s.input || 0)}}</td>
    <td class="mono right" data-sort="${{s.output}}">${{fmtNum(s.output || 0)}}</td>
    <td class="mono right" data-sort="${{s.total}}">${{fmtNum(s.total || 0)}}</td>
    <td class="mono right cost" data-sort="${{(s.cost_estimated || 0).toFixed(6)}}">${{fmtCost(s.cost_estimated || 0)}}</td>
    <td class="mono" data-sort="${{s.end_ms || 0}}">${{fmtDateTime(s.end_ms)}}</td>
  </tr>`).join("");

  tbody.querySelectorAll("tr[data-session-key]").forEach(row => {{
    row.style.cursor = "pointer";
    row.addEventListener("click", () => openSessionDetail(row.dataset.sessionKey));
  }});
}}

function openSessionDetail(sessionKey) {{
  const [provider, ...sidParts] = (sessionKey || "").split(":");
  const sessionId = sidParts.join(":");
  const messages = getFilteredMessages().filter(m => m.provider === provider && m.session_id === sessionId);
  if (!messages.length) return;

  const modal = document.getElementById("sessionDetailModal");
  const title = document.getElementById("sessionDetailTitle");
  const meta = document.getElementById("sessionDetailMeta");
  const tbody = document.querySelector("#sessionDetailTable tbody");

  const totals = messages.reduce((a, m) => {{
    a.messages += 1; a.input += m.input; a.output += m.output; a.reasoning += m.reasoning; a.cache_read += m.cache_read;
    a.start = a.start ? Math.min(a.start, m.timestamp_ms || a.start) : m.timestamp_ms;
    a.end = Math.max(a.end, m.timestamp_ms || 0);
    return a;
  }}, {{ messages: 0, input: 0, output: 0, reasoning: 0, cache_read: 0, start: 0, end: 0 }});

  const byModel = {{}};
  messages.forEach(m => {{
    if (!byModel[m.modelKey]) byModel[m.modelKey] = {{ key: m.modelKey, input: 0, output: 0, total: 0 }};
    byModel[m.modelKey].input += m.input;
    byModel[m.modelKey].output += m.output;
    byModel[m.modelKey].total += m.input + m.output;
  }});

  title.textContent = `Session Details: ${{provider}}:${{sessionId}}`;
  meta.innerHTML = `
    <div class="session-detail-chip"><div class="k">Project</div><div class="v">${{messages[0].project || 'unknown'}}</div></div>
    <div class="session-detail-chip"><div class="k">Messages</div><div class="v">${{fmtNum(totals.messages)}}</div></div>
    <div class="session-detail-chip"><div class="k">Tokens</div><div class="v">${{fmtNum(totals.input + totals.output)}}</div></div>
    <div class="session-detail-chip"><div class="k">Last Active</div><div class="v">${{fmtDateTime(totals.end)}}</div></div>
  `;

  const modelRows = Object.values(byModel).sort((a, b) => b.total - a.total);
  tbody.innerHTML = modelRows.map(r => `<tr>
    <td class="mono">${{r.key}}</td>
    <td class="mono right">${{fmtNum(r.input)}}</td>
    <td class="mono right">${{fmtNum(r.output)}}</td>
    <td class="mono right">${{fmtNum(r.total)}}</td>
  </tr>`).join("");

  modal.classList.add("open");
}}

function initSessionDetailModal() {{
  const modal = document.getElementById("sessionDetailModal");
  const closeBtn = document.getElementById("sessionDetailClose");
  if (!modal || !closeBtn) return;
  closeBtn.addEventListener("click", () => modal.classList.remove("open"));
  modal.addEventListener("click", e => {{ if (e.target === modal) modal.classList.remove("open"); }});
}}

function buildInsights() {{
  const models = getModelRows();
  if (!models.length) return ["No data available for the selected filter."];

  const totalInput = models.reduce((s, m) => s + m.input, 0);
  const totalOutput = models.reduce((s, m) => s + m.output, 0);
  const totalTokens = totalInput + totalOutput;
  const totalCost = models.reduce((s, m) => s + m.cost_estimated, 0);
  const totalMessages = models.reduce((s, m) => s + m.messages, 0);

  const topModel = models.slice().sort((a, b) => (b.input + b.output) - (a.input + a.output))[0];
  const topSessions = getSessionRows()
    .slice()
    .sort((a, b) => (b.total || 0) - (a.total || 0))
    .slice(0, 3);

  const byDay = {{}};
  getFilteredMessages().forEach(m => {{
    if (!m.timestamp_ms) return;
    const day = new Date(m.timestamp_ms).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + m.input + m.output;
  }});
  const dayKeys = Object.keys(byDay).sort();
  const recent = dayKeys.slice(-7).map(d => byDay[d] || 0);
  const prev = dayKeys.slice(-14, -7).map(d => byDay[d] || 0);
  const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const prevAvg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
  const trendPct = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg) * 100 : 0;

  const topDay = dayKeys
    .map(d => [d, byDay[d]])
    .sort((a, b) => b[1] - a[1])[0];

  const topModelShare = totalTokens > 0 ? ((topModel.input + topModel.output) / totalTokens) * 100 : 0;

  const insights = [
    `Processed ${{fmtNum(totalMessages)}} messages and ${{fmtNum(totalTokens)}} tokens (in: ${{fmtNum(totalInput)}}, out: ${{fmtNum(totalOutput)}}).`,
    `Estimated spend is ${{fmtCost(totalCost)}} for the current filter and date range.`,
    `Top model is ${{topModel.key}} with ${{fmtNum(topModel.input + topModel.output)}} tokens (${{topModelShare.toFixed(1)}}% share).`,
  ];

  if (prev.length && recent.length) insights.push(`7-day trend is ${{trendPct >= 0 ? '+' : ''}}${{trendPct.toFixed(1)}}% vs previous 7 days.`);
  if (topDay) insights.push(`Largest usage spike happened on ${{topDay[0]}} with ${{fmtCompact(topDay[1])}} tokens.`);

  if (topSessions.length) {{
    const sessionSummary = topSessions.map(s => `${{s.provider}}:${{s.session_id}} (${{fmtCompact(s.total || 0)}})`).join(", ");
    insights.push(`Most expensive sessions by tokens: ${{sessionSummary}}.`);
  }}

  if (activeProvider === "all") {{
    const providerLead = getProviderRows().slice().sort((a, b) => (b.input + b.output) - (a.input + a.output))[0];
    if (providerLead) {{
      insights.push(`Highest token source is ${{providerLead.name}} with ${{fmtCompact((providerLead.input || 0) + (providerLead.output || 0))}} tokens.`);
    }}
  }}

  return insights;
}}

function initAnalyzeButton() {{
  const btn = document.getElementById("analyzeBtn");
  const card = document.getElementById("insightsCard");
  const list = document.getElementById("insightsList");
  if (!btn || !card || !list) return;

  btn.addEventListener("click", () => {{
    const insights = buildInsights();
    list.innerHTML = insights.map(i => `<li>${{i}}</li>`).join("");
    card.hidden = !card.hidden;
  }});
}}

// =========================================================================
// Sortable tables
// =========================================================================
function initSortable() {{
  document.querySelectorAll("table.sortable").forEach(table => {{
    table.querySelector("thead").addEventListener("click", e => {{
      const th = e.target.closest("th");
      if (!th) return;
      const headers = table.querySelectorAll("thead th");
      const colIdx = Array.from(headers).indexOf(th);
      const isNum = th.dataset.type === "number";
      const tbody = table.querySelector("tbody");
      const rows = Array.from(tbody.querySelectorAll("tr"));
      const wasAsc = th.classList.contains("sort-asc");
      headers.forEach(h => h.classList.remove("sort-asc", "sort-desc"));
      const dir = wasAsc ? -1 : 1;
      th.classList.add(dir === 1 ? "sort-asc" : "sort-desc");
      rows.sort((a, b) => {{
        const av = a.children[colIdx]?.dataset.sort || a.children[colIdx]?.textContent || "";
        const bv = b.children[colIdx]?.dataset.sort || b.children[colIdx]?.textContent || "";
        if (isNum) return (parseFloat(av) - parseFloat(bv)) * dir;
        return av.localeCompare(bv) * dir;
      }});
      rows.forEach(r => tbody.appendChild(r));
    }});
  }});
}}

// =========================================================================
// Presentations
// =========================================================================
function renderPresentations() {{
  const container = document.getElementById("presentationsList");
  if (!PRESENTATIONS.length) {{
    container.innerHTML = '<div class="table-card"><p style="color:var(--text-muted)">No presentations found. Add markdown files to the <code>presentations/</code> directory.</p></div>';
    return;
  }}
  container.innerHTML = PRESENTATIONS.map((p, i) => {{
    const html = markdownToHtml(p.content);
    return '<div class="table-card presentation-card">' +
      '<div class="presentation-header" data-index="' + i + '" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between">' +
        '<h3>' + escHtml(p.title) + '</h3>' +
        '<span class="presentation-toggle" style="color:var(--text-muted);font-size:0.85rem">&#9660;</span>' +
      '</div>' +
      '<div class="presentation-body" id="pres-' + i + '">' + html + '</div>' +
    '</div>';
  }}).join("");
  container.querySelectorAll(".presentation-header").forEach(h => {{
    h.addEventListener("click", () => {{
      const body = document.getElementById("pres-" + h.dataset.index);
      const toggle = h.querySelector(".presentation-toggle");
      if (body.style.display === "none") {{
        body.style.display = "block";
        toggle.innerHTML = "&#9660;";
      }} else {{
        body.style.display = "none";
        toggle.innerHTML = "&#9654;";
      }}
    }});
  }});
}}

function escHtml(s) {{
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}}

function markdownToHtml(md) {{
  const lines = md.split("\\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {{
    const line = lines[i];
    // Skip top-level title (already shown in header)
    if (/^# [^#]/.test(line)) {{ i++; continue; }}
    // Headings
    if (/^#### (.+)/.test(line)) {{ out.push("<h4>" + inline(line.slice(5)) + "</h4>"); i++; continue; }}
    if (/^### (.+)/.test(line)) {{ out.push("<h3>" + inline(line.slice(4)) + "</h3>"); i++; continue; }}
    if (/^## (.+)/.test(line)) {{ out.push("<h2>" + inline(line.slice(3)) + "</h2>"); i++; continue; }}
    // HR
    if (/^---\\s*$/.test(line)) {{ out.push("<hr>"); i++; continue; }}
    // Blockquote
    if (/^> (.+)/.test(line)) {{ out.push("<blockquote>" + inline(line.slice(2)) + "</blockquote>"); i++; continue; }}
    // Unordered list
    if (/^- (.+)/.test(line)) {{
      const items = [];
      while (i < lines.length && /^- (.+)/.test(lines[i])) {{
        items.push("<li>" + inline(lines[i].slice(2)) + "</li>");
        i++;
      }}
      out.push("<ul>" + items.join("") + "</ul>");
      continue;
    }}
    // Ordered list
    if (/^\\d+\\. (.+)/.test(line)) {{
      const items = [];
      while (i < lines.length && /^\\d+\\. (.+)/.test(lines[i])) {{
        items.push("<li>" + inline(lines[i].replace(/^\\d+\\.\\s*/, "")) + "</li>");
        i++;
      }}
      out.push("<ol>" + items.join("") + "</ol>");
      continue;
    }}
    // Empty line
    if (!line.trim()) {{ i++; continue; }}
    // Paragraph
    out.push("<p>" + inline(line) + "</p>");
    i++;
  }}
  return out.join("\\n");
}}

function inline(s) {{
  return s
    .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
    .replace(/\\*(.+?)\\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}}

// =========================================================================
// Pull Requests
// =========================================================================
let prTimelineChart = null;
let prAvgDayChart = null;
let prTimeToMergeChart = null;
let reviewTimelineChart = null;
let prOrgFilter = "all";

function getFilteredPRs() {{
  if (!GITHUB_PRS || !GITHUB_PRS.prs) return [];
  if (prOrgFilter === "all") return GITHUB_PRS.prs;
  return GITHUB_PRS.prs.filter(pr => (pr.org || "personal") === prOrgFilter);
}}

function computePRStats(prs) {{
  const total = prs.length;
  const merged = prs.filter(p => p.state === "MERGED").length;
  const open = prs.filter(p => p.state === "OPEN").length;
  const closed = prs.filter(p => p.state === "CLOSED").length;

  const perProject = {{}};
  prs.forEach(pr => {{
    if (!perProject[pr.repo]) perProject[pr.repo] = {{ total: 0, merged: 0, open: 0, closed: 0 }};
    perProject[pr.repo].total++;
    if (pr.state === "MERGED") perProject[pr.repo].merged++;
    else if (pr.state === "OPEN") perProject[pr.repo].open++;
    else perProject[pr.repo].closed++;
  }});

  const perOrg = {{}};
  prs.forEach(pr => {{
    const org = pr.org || "personal";
    if (!perOrg[org]) perOrg[org] = {{ total: 0, merged: 0, dates: new Set(), workday_prs: 0, weekend_prs: 0 }};
    perOrg[org].total++;
    if (pr.state === "MERGED") {{
      perOrg[org].merged++;
      if (pr.created_at) {{
        perOrg[org].dates.add(pr.created_at.slice(0, 10));
        const d = new Date(pr.created_at);
        if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5) perOrg[org].workday_prs++;
        else perOrg[org].weekend_prs++;
      }}
    }}
  }});

  const orgStats = {{}};
  const today = new Date();
  for (const [org, data] of Object.entries(perOrg)) {{
    const dates = Array.from(data.dates).sort();
    if (!dates.length) {{
      orgStats[org] = {{ total: data.total, merged: data.merged, workday_prs: 0, weekend_prs: 0, working_days: 0, weekend_days: 0, avg_per_working_day: 0, avg_per_weekend_day: 0 }};
      continue;
    }}
    const first = new Date(dates[0] + "T00:00:00Z");
    const last = new Date(Math.min(new Date(dates[dates.length - 1] + "T00:00:00Z").getTime(), today.getTime()));
    let wd = 0, we = 0;
    for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {{
      const dow = d.getUTCDay();
      if (dow >= 1 && dow <= 5) wd++; else we++;
    }}
    orgStats[org] = {{
      total: data.total, merged: data.merged,
      workday_prs: data.workday_prs, weekend_prs: data.weekend_prs,
      working_days: wd, weekend_days: we,
      avg_per_working_day: wd > 0 ? +(data.workday_prs / wd).toFixed(2) : 0,
      avg_per_weekend_day: we > 0 ? +(data.weekend_prs / we).toFixed(2) : 0,
    }};
  }}

  const sizes = prs.map(p => p.additions + p.deletions).sort((a, b) => a - b);
  const adds = prs.map(p => p.additions).sort((a, b) => a - b);
  const dels = prs.map(p => p.deletions).sort((a, b) => a - b);
  const files = prs.map(p => p.changed_files).sort((a, b) => a - b);

  function pct(arr, p) {{
    if (!arr.length) return 0;
    const k = (arr.length - 1) * (p / 100);
    const f = Math.floor(k);
    const c = Math.min(f + 1, arr.length - 1);
    return Math.round(arr[f] + (k - f) * (arr[c] - arr[f]));
  }}
  function avg(arr) {{ return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0; }}

  const sizeStats = {{
    lines_changed: {{ p25: pct(sizes,25), p50: pct(sizes,50), p75: pct(sizes,75), p90: pct(sizes,90), p95: pct(sizes,95), p99: pct(sizes,99), avg: avg(sizes), max: sizes.length ? sizes[sizes.length-1] : 0 }},
    additions: {{ p50: pct(adds,50), p90: pct(adds,90), p95: pct(adds,95), avg: avg(adds) }},
    deletions: {{ p50: pct(dels,50), p90: pct(dels,90), p95: pct(dels,95), avg: avg(dels) }},
    files_changed: {{ p50: pct(files,50), p90: pct(files,90), p95: pct(files,95), avg: avg(files) }},
  }};

  const byMonth = {{}};
  prs.forEach(pr => {{
    if (pr.created_at) {{
      const m = pr.created_at.slice(0, 7);
      if (!byMonth[m]) byMonth[m] = {{ total: 0, merged: 0, open: 0, closed: 0 }};
      byMonth[m].total++;
      if (pr.state === "MERGED") byMonth[m].merged++;
      else if (pr.state === "OPEN") byMonth[m].open++;
      else byMonth[m].closed++;
    }}
  }});

  const mergeTimes = prs
    .filter(pr => pr.state === "MERGED" && pr.created_at && pr.merged_at)
    .map(pr => (new Date(pr.merged_at) - new Date(pr.created_at)) / (1000 * 60 * 60))
    .sort((a, b) => a - b);
  const mergeTimeStats = {{
    avg: avg(mergeTimes.map(h => Math.round(h))),
    p50: pct(mergeTimes.map(h => Math.round(h)), 50),
    p90: pct(mergeTimes.map(h => Math.round(h)), 90),
  }};

  return {{ total, merged, open, closed, perProject, orgStats, sizeStats, byMonth, mergeTimeStats }};
}}

function initPROrgFilter() {{
  if (!GITHUB_PRS || !GITHUB_PRS.per_org) return;

  const selects = [document.getElementById("prOrgSelect"), document.getElementById("prDetailsOrgSelect")].filter(Boolean);
  const orgs = Object.keys(GITHUB_PRS.per_org).sort((a, b) => (GITHUB_PRS.per_org[b]?.total || 0) - (GITHUB_PRS.per_org[a]?.total || 0));

  selects.forEach(select => {{
    orgs.forEach(org => {{
      const opt = document.createElement("option");
      opt.value = org;
      opt.textContent = `${{org}} (${{GITHUB_PRS.per_org[org]?.total || 0}})`;
      select.appendChild(opt);
    }});

    select.addEventListener("change", () => {{
      prOrgFilter = select.value;
      // Sync both selects
      selects.forEach(s => {{ if (s !== select) s.value = prOrgFilter; }});
      renderPRPage();
    }});
  }});
}}

function renderPRPage() {{
  if (!GITHUB_PRS || !GITHUB_PRS.total) return;

  const prs = getFilteredPRs();
  const stats = computePRStats(prs);

  // Summary cards
  const cards = document.getElementById("prSummaryCards");
  if (cards) {{
    cards.innerHTML = `
      <div class="card"><div class="label">Total PRs</div><div class="value">${{fmtCompact(stats.total)}}</div><div class="sub">${{fmtNum(stats.total)}} pull requests</div></div>
      <div class="card"><div class="label">Merged</div><div class="value" style="color:#6f8b6e">${{fmtCompact(stats.merged)}}</div><div class="sub">${{(stats.total > 0 ? (stats.merged / stats.total * 100).toFixed(1) : 0)}}% merge rate</div></div>
      <div class="card"><div class="label">Open</div><div class="value" style="color:#b88a5a">${{fmtCompact(stats.open)}}</div><div class="sub">currently open</div></div>
      <div class="card"><div class="label">Closed (unmerged)</div><div class="value" style="color:#8b6f9b">${{fmtCompact(stats.closed)}}</div><div class="sub">closed without merge</div></div>
      <div class="card"><div class="label">Repositories</div><div class="value" style="color:#d97757">${{Object.keys(stats.perProject).length}}</div><div class="sub">unique repos</div></div>
      <div class="card"><div class="label">Organizations</div><div class="value" style="color:#4f7f78">${{Object.keys(stats.orgStats).length}}</div><div class="sub">unique orgs</div></div>
      <div class="card"><div class="label">Median Size</div><div class="value" style="color:#9f7a4f">${{fmtCompact(stats.sizeStats.lines_changed.p50)}}</div><div class="sub">lines changed (P50)</div></div>
      <div class="card"><div class="label">P90 Size</div><div class="value" style="color:#b35f5f">${{fmtCompact(stats.sizeStats.lines_changed.p90)}}</div><div class="sub">lines changed (P90)</div></div>`;

    // Add workday/weekend averages from orgStats
    const allOrgs = Object.values(stats.orgStats);
    const totalWdPrs = allOrgs.reduce((s, o) => s + (o.workday_prs || 0), 0);
    const totalWePrs = allOrgs.reduce((s, o) => s + (o.weekend_prs || 0), 0);
    const totalWd = allOrgs.reduce((s, o) => s + (o.working_days || 0), 0);
    const totalWe = allOrgs.reduce((s, o) => s + (o.weekend_days || 0), 0);
    const avgWd = totalWd > 0 ? (totalWdPrs / totalWd).toFixed(2) : "0";
    const avgWe = totalWe > 0 ? (totalWePrs / totalWe).toFixed(2) : "0";

    function fmtMergeTime(h) {{
      if (!h) return "N/A";
      if (h < 24) return h + "h";
      return (h / 24).toFixed(1) + "d";
    }}

    cards.innerHTML += `
      <div class="card"><div class="label">Workday Merges</div><div class="value" style="color:#6f8b6e">${{fmtNum(totalWdPrs)}}</div><div class="sub">${{avgWd}} avg/workday</div></div>
      <div class="card"><div class="label">Weekend Merges</div><div class="value" style="color:#8b6f9b">${{fmtNum(totalWePrs)}}</div><div class="sub">${{avgWe}} avg/weekend day</div></div>
      <div class="card"><div class="label">Median Time to Merge</div><div class="value" style="color:#4f7f78">${{fmtMergeTime(stats.mergeTimeStats.p50)}}</div><div class="sub">P50 merge time</div></div>
      <div class="card"><div class="label">P90 Time to Merge</div><div class="value" style="color:#d97757">${{fmtMergeTime(stats.mergeTimeStats.p90)}}</div><div class="sub">P90 merge time</div></div>
    `;
  }}

  // Size percentiles table
  const sizeBody = document.querySelector("#prSizeTable tbody");
  if (sizeBody) {{
    const ss = stats.sizeStats;
    const rows = [
      ["Lines Changed (add+del)", ss.lines_changed],
      ["Additions", ss.additions],
      ["Deletions", ss.deletions],
      ["Files Changed", ss.files_changed],
    ];
    sizeBody.innerHTML = rows.map(([label, s]) => {{
      if (!s) return "";
      return `<tr>
        <td>${{label}}</td>
        <td class="mono right" data-sort="${{s.avg || 0}}">${{fmtNum(s.avg || 0)}}</td>
        <td class="mono right" data-sort="${{s.p25 || 0}}">${{fmtNum(s.p25 || 0)}}</td>
        <td class="mono right" data-sort="${{s.p50 || 0}}">${{fmtNum(s.p50 || 0)}}</td>
        <td class="mono right" data-sort="${{s.p75 || 0}}">${{fmtNum(s.p75 || 0)}}</td>
        <td class="mono right" data-sort="${{s.p90 || 0}}">${{fmtNum(s.p90 || 0)}}</td>
        <td class="mono right" data-sort="${{s.p95 || 0}}">${{fmtNum(s.p95 || 0)}}</td>
        <td class="mono right" data-sort="${{s.p99 || 0}}">${{fmtNum(s.p99 || 0)}}</td>
        <td class="mono right" data-sort="${{s.max || 0}}">${{fmtNum(s.max || 0)}}</td>
      </tr>`;
    }}).join("");
  }}

  // Per-project table
  const projBody = document.querySelector("#prProjectTable tbody");
  if (projBody) {{
    const projects = Object.entries(stats.perProject).sort((a, b) => b[1].total - a[1].total);
    projBody.innerHTML = projects.map(([repo, s]) => `<tr>
      <td class="mono">${{repo}}</td>
      <td class="mono right" data-sort="${{s.total}}">${{fmtNum(s.total)}}</td>
      <td class="mono right" data-sort="${{s.merged}}">${{fmtNum(s.merged)}}</td>
      <td class="mono right" data-sort="${{s.open}}">${{fmtNum(s.open)}}</td>
      <td class="mono right" data-sort="${{s.closed}}">${{fmtNum(s.closed)}}</td>
    </tr>`).join("");
  }}

  // Timeline chart
  const months = Object.keys(stats.byMonth).sort();
  if (prTimelineChart) prTimelineChart.destroy();
  if (months.length) {{
    prTimelineChart = new Chart(document.getElementById("prTimelineChart"), {{
      type: "bar",
      data: {{
        labels: months,
        datasets: [
          {{
            label: "Merged",
            data: months.map(m => stats.byMonth[m].merged),
            backgroundColor: "#6f8b6ecc",
            borderRadius: 2,
          }},
          {{
            label: "Open",
            data: months.map(m => stats.byMonth[m].open),
            backgroundColor: "#b88a5acc",
            borderRadius: 2,
          }},
        ],
      }},
      options: {{
        ...chartDefaults,
        plugins: {{ ...chartDefaults.plugins, legend: {{ display: true, labels: {{ color: "#a39e90" }} }} }},
        scales: {{
          x: {{ stacked: true, ticks: {{ color: "#a39e90", maxRotation: 45, minRotation: 25 }}, grid: {{ color: "#3d3b36" }} }},
          y: {{ stacked: true, ticks: {{ color: "#a39e90", callback: v => Math.round(v) }}, grid: {{ color: "#3d3b36" }}, beginAtZero: true }},
        }},
      }},
    }});
  }}

  // Avg PRs per workday/weekend day per month
  if (prAvgDayChart) prAvgDayChart.destroy();
  if (months.length) {{
    // For each month, count workday PRs, weekend PRs, workdays, weekend days
    const wdAvg = [];
    const weAvg = [];
    const rollingWd = [];
    const today = new Date();

    months.forEach(m => {{
      const [y, mo] = m.split("-").map(Number);
      // Get all days in this month (up to today if current month)
      const firstDay = new Date(Date.UTC(y, mo - 1, 1));
      const lastDay = new Date(Date.UTC(y, mo, 0)); // last day of month
      const end = lastDay > today ? today : lastDay;

      let wd = 0, we = 0, wdPrs = 0, wePrs = 0;
      for (let d = new Date(firstDay); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {{
        const dow = d.getUTCDay();
        if (dow >= 1 && dow <= 5) wd++; else we++;
      }}

      prs.forEach(pr => {{
        if (pr.state !== "MERGED" || !pr.created_at || pr.created_at.slice(0, 7) !== m) return;
        const dow = new Date(pr.created_at).getUTCDay();
        if (dow >= 1 && dow <= 5) wdPrs++; else wePrs++;
      }});

      wdAvg.push(wd > 0 ? +(wdPrs / wd).toFixed(2) : 0);
      weAvg.push(we > 0 ? +(wePrs / we).toFixed(2) : 0);
    }});

    // 3-month rolling average for workday
    for (let i = 0; i < wdAvg.length; i++) {{
      const window = wdAvg.slice(Math.max(0, i - 2), i + 1);
      rollingWd.push(+(window.reduce((a, b) => a + b, 0) / window.length).toFixed(2));
    }}

    prAvgDayChart = new Chart(document.getElementById("prAvgDayChart"), {{
      type: "bar",
      data: {{
        labels: months,
        datasets: [
          {{
            label: "Avg Merged PRs / Workday",
            data: wdAvg,
            backgroundColor: "#6f8b6eaa",
            borderRadius: 4,
            order: 2,
          }},
          {{
            label: "Avg Merged PRs / Weekend Day",
            data: weAvg,
            backgroundColor: "#8b6f9baa",
            borderRadius: 4,
            order: 3,
          }},
          {{
            label: "3-month Rolling Avg (Workday)",
            data: rollingWd,
            type: "line",
            borderColor: "#d97757",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.3,
            fill: false,
            order: 1,
          }},
        ],
      }},
      options: {{
        ...chartDefaults,
        scales: {{
          x: {{ ticks: {{ color: "#a39e90", maxRotation: 45, minRotation: 25 }}, grid: {{ color: "#3d3b36" }} }},
          y: {{ ticks: {{ color: "#a39e90" }}, grid: {{ color: "#3d3b36" }}, beginAtZero: true }},
        }},
      }},
    }});
  }}

  // Avg time to merge chart
  if (prTimeToMergeChart) prTimeToMergeChart.destroy();
  if (months.length) {{
    const mergeTimeByMonth = {{}};
    prs.forEach(pr => {{
      if (pr.state !== "MERGED" || !pr.created_at || !pr.merged_at) return;
      const m = pr.created_at.slice(0, 7);
      if (!mergeTimeByMonth[m]) mergeTimeByMonth[m] = [];
      const hours = (new Date(pr.merged_at) - new Date(pr.created_at)) / (1000 * 60 * 60);
      mergeTimeByMonth[m].push(hours);
    }});

    const avgMergeHours = months.map(m => {{
      const times = mergeTimeByMonth[m];
      if (!times || !times.length) return null;
      return +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1);
    }});
    const medianMergeHours = months.map(m => {{
      const times = mergeTimeByMonth[m];
      if (!times || !times.length) return null;
      times.sort((a, b) => a - b);
      const mid = Math.floor(times.length / 2);
      const val = times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2;
      return +val.toFixed(1);
    }});

    function fmtHours(h) {{
      if (h === null || h === undefined) return "N/A";
      if (h < 24) return h.toFixed(1) + "h";
      return (h / 24).toFixed(1) + "d";
    }}

    prTimeToMergeChart = new Chart(document.getElementById("prTimeToMergeChart"), {{
      type: "bar",
      data: {{
        labels: months,
        datasets: [
          {{
            label: "Avg Time to Merge",
            data: avgMergeHours,
            backgroundColor: "#d97757aa",
            borderRadius: 4,
            order: 2,
          }},
          {{
            label: "Median Time to Merge",
            data: medianMergeHours,
            type: "line",
            borderColor: "#6f8b6e",
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: "#6f8b6e",
            tension: 0.3,
            fill: false,
            order: 1,
          }},
        ],
      }},
      options: {{
        ...chartDefaults,
        plugins: {{
          ...chartDefaults.plugins,
          tooltip: {{
            callbacks: {{
              label: function(ctx) {{
                return ctx.dataset.label + ": " + fmtHours(ctx.raw);
              }}
            }}
          }}
        }},
        scales: {{
          x: {{ ticks: {{ color: "#a39e90", maxRotation: 45, minRotation: 25 }}, grid: {{ color: "#3d3b36" }} }},
          y: {{ ticks: {{ color: "#a39e90", callback: v => fmtHours(v) }}, grid: {{ color: "#3d3b36" }}, beginAtZero: true }},
        }},
      }},
    }});
  }}

  // Reviews section
  const reviews = GITHUB_PRS.reviews || {{}};
  const allReviews = reviews.reviews || [];
  // Filter reviews by org
  const filteredReviews = prOrgFilter === "all" ? allReviews : allReviews.filter(r => (r.org || "personal") === prOrgFilter);
  const reviewTotal = filteredReviews.length;
  const reviewByState = {{}};
  filteredReviews.forEach(r => {{ reviewByState[r.state] = (reviewByState[r.state] || 0) + 1; }});

  const reviewCards = document.getElementById("reviewSummaryCards");
  if (reviewCards) {{
    reviewCards.innerHTML = `
      <div class="card"><div class="label">Total Reviews</div><div class="value">${{fmtCompact(reviewTotal)}}</div><div class="sub">${{fmtNum(reviewTotal)}} reviews given</div></div>
      <div class="card"><div class="label">Approved</div><div class="value" style="color:#6f8b6e">${{fmtCompact(reviewByState["APPROVED"] || 0)}}</div><div class="sub">${{reviewTotal > 0 ? ((reviewByState["APPROVED"] || 0) / reviewTotal * 100).toFixed(1) : 0}}%</div></div>
      <div class="card"><div class="label">Commented</div><div class="value" style="color:#b88a5a">${{fmtCompact(reviewByState["COMMENTED"] || 0)}}</div><div class="sub">${{reviewTotal > 0 ? ((reviewByState["COMMENTED"] || 0) / reviewTotal * 100).toFixed(1) : 0}}%</div></div>
      <div class="card"><div class="label">Changes Requested</div><div class="value" style="color:#d97757">${{fmtCompact(reviewByState["CHANGES_REQUESTED"] || 0)}}</div><div class="sub">${{reviewTotal > 0 ? ((reviewByState["CHANGES_REQUESTED"] || 0) / reviewTotal * 100).toFixed(1) : 0}}%</div></div>
    `;
  }}

  // Reviews timeline
  if (reviewTimelineChart) reviewTimelineChart.destroy();
  const reviewByMonth = {{}};
  filteredReviews.forEach(r => {{
    if (r.review_created_at) {{
      const m = r.review_created_at.slice(0, 7);
      reviewByMonth[m] = (reviewByMonth[m] || 0) + 1;
    }}
  }});
  const revMonths = Object.keys(reviewByMonth).sort();
  if (revMonths.length) {{
    reviewTimelineChart = new Chart(document.getElementById("reviewTimelineChart"), {{
      type: "bar",
      data: {{
        labels: revMonths,
        datasets: [{{
          label: "Reviews Given",
          data: revMonths.map(m => reviewByMonth[m]),
          backgroundColor: "#4f7f78cc",
          borderRadius: 4,
        }}],
      }},
      options: {{
        ...chartDefaults,
        scales: {{
          x: {{ ticks: {{ color: "#a39e90", maxRotation: 45, minRotation: 25 }}, grid: {{ color: "#3d3b36" }} }},
          y: {{ ticks: {{ color: "#a39e90", callback: v => Math.round(v) }}, grid: {{ color: "#3d3b36" }}, beginAtZero: true }},
        }},
      }},
    }});
  }}
}}

// =========================================================================
// Render all
// =========================================================================
function renderAll() {{
  updateFilterStyles();
  renderSummaryCards();
  renderBarChart();
  renderDonutChart();
  renderProvDonutChart();
  renderTimeline();
  renderSessionTable();
  renderModelTable();
  renderProjectTable();
  renderPRPage();
}}

// =========================================================================
// Init
// =========================================================================
initNav();
initFilterBar();
initPROrgFilter();
initSortable();

initAnalyzeButton();
initSessionDetailModal();

function setupGroup(id, stateKey) {{
  document.getElementById(id).addEventListener("click", e => {{
    const btn = e.target.closest(".btn");
    if (!btn) return;
    e.currentTarget.querySelectorAll(".btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    tlState[stateKey] = btn.dataset.value;
    renderTimeline();
  }});
}}
setupGroup("chartTypeGroup", "chartType");
setupGroup("tokenTypeGroup", "tokenType");
setupGroup("groupByGroup", "groupBy");

renderAll();
</script>
</body>
</html>"""
