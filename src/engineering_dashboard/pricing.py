"""Pricing data per 1M tokens (USD): (input, output, cache_read, cache_write).

cache_write uses the 5-minute ephemeral cache write price (most common in CLI usage).

Pricing resolution order:
1) Local explicit mapping (PRICING below)
2) Dynamic lookup from LiteLLM model price catalog (via ccusage approach)
3) Dynamic lookup from llm-prices.com (cached JSON)
"""

import json
import os
import time
from urllib.request import Request, urlopen

from .paths import DATA_DIR


LLM_PRICES_URL = "https://www.llm-prices.com/current-v1.json"
LLM_PRICES_CACHE = os.path.join(
    DATA_DIR, "cache", "llm-prices-current-v1.json"
)
LLM_PRICES_TTL_SECONDS = 24 * 60 * 60
LITELLM_PRICES_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
)
LITELLM_PRICES_CACHE = os.path.join(
    DATA_DIR, "cache", "litellm-model-prices.json"
)

PRICING = {
    # -------------------------------------------------------------------------
    # Claude (Anthropic) — used by Claude Code
    # Format: (base_input, output, cache_read, cache_write_5m)
    # -------------------------------------------------------------------------
    "claude-opus-4-6":             (5.00, 25.00, 0.50, 6.25),
    "claude-opus-4-5-20251101":    (5.00, 25.00, 0.50, 6.25),
    "claude-opus-4-1":             (15.00, 75.00, 1.50, 18.75),
    "claude-opus-4":               (15.00, 75.00, 1.50, 18.75),
    "claude-sonnet-4-6":           (3.00, 15.00, 0.30, 3.75),
    "claude-sonnet-4-5-20250929":  (3.00, 15.00, 0.30, 3.75),
    "claude-sonnet-4":             (3.00, 15.00, 0.30, 3.75),
    "claude-sonnet-3-7":           (3.00, 15.00, 0.30, 3.75),
    "claude-haiku-4-5-20251001":   (1.00, 5.00, 0.10, 1.25),
    "claude-haiku-3-5":            (0.80, 4.00, 0.08, 1.00),
    "claude-opus-3":               (15.00, 75.00, 1.50, 18.75),
    "claude-haiku-3":              (0.25, 1.25, 0.03, 0.30),

    # -------------------------------------------------------------------------
    # Cursor — priced at Opus 4.5 rates (user's configured model)
    # -------------------------------------------------------------------------
    "cursor-chat":    (5.00, 25.00, 0.50, 6.25),
    "cursor-edit":    (5.00, 25.00, 0.50, 6.25),
    "cursor-default": (5.00, 25.00, 0.50, 6.25),
    "cursor-agent":   (5.00, 25.00, 0.50, 6.25),
    "cursor-plan":    (5.00, 25.00, 0.50, 6.25),
    "cursor-unknown": (5.00, 25.00, 0.50, 6.25),

    # -------------------------------------------------------------------------
    # OpenCode — free-tier / internal
    # -------------------------------------------------------------------------
    "kimi-k2.5-free":    (0.0, 0.0, 0.0, 0.0),
    "glm-4.7-free":      (0.0, 0.0, 0.0, 0.0),
    "glm-5-free":        (0.0, 0.0, 0.0, 0.0),
    "big-pickle":        (0.0, 0.0, 0.0, 0.0),
    "minimax-m2.5-free": (0.0, 0.0, 0.0, 0.0),

    # -------------------------------------------------------------------------
    # OpenAI — used by OpenCode and potentially Codex
    # -------------------------------------------------------------------------
    "gpt-5.4-codex":       (2.50, 15.00, 0.25, 0.0),
    "gpt-5.4":             (2.50, 15.00, 0.25, 0.0),
    "gpt-5.4-long":        (5.00, 22.50, 0.50, 0.0),
    "gpt-5.4-pro":         (30.00, 180.00, 0.0, 0.0),
    "gpt-5.4-pro-long":    (60.00, 270.00, 0.0, 0.0),
    "gpt-5.2":             (1.75, 14.00, 0.175, 0.0),
    "gpt-5.1":             (1.25, 10.00, 0.125, 0.0),
    "gpt-5":               (1.25, 10.00, 0.125, 0.0),
    "gpt-5-mini":          (0.25, 2.00, 0.025, 0.0),
    "gpt-5-nano":          (0.05, 0.40, 0.005, 0.0),
    "gpt-5.3-chat-latest": (1.75, 14.00, 0.175, 0.0),
    "gpt-5.2-chat-latest": (1.75, 14.00, 0.175, 0.0),
    "gpt-5.1-chat-latest": (1.25, 10.00, 0.125, 0.0),
    "gpt-5-chat-latest":   (1.25, 10.00, 0.125, 0.0),
    "gpt-5.3-codex":       (1.75, 14.00, 0.175, 0.0),
    "gpt-5.2-codex":       (1.75, 14.00, 0.175, 0.0),
    "gpt-5.1-codex-max":   (1.25, 10.00, 0.125, 0.0),
    "gpt-5.1-codex":       (1.25, 10.00, 0.125, 0.0),
    "gpt-5-codex":         (1.25, 10.00, 0.125, 0.0),
    "gpt-5.2-pro":         (21.00, 168.00, 0.0, 0.0),
    "gpt-5-pro":           (15.00, 120.00, 0.0, 0.0),
}


MODEL_ALIASES = {
    # Claude naming differences
    "claude-sonnet-4-6": "claude-sonnet-4.5",
    "claude-sonnet-4-5-20250929": "claude-sonnet-4.5",
    "claude-opus-4-6": "claude-opus-4-5",
    "claude-opus-4-5-20251101": "claude-opus-4-5",
    "claude-haiku-4-5-20251001": "claude-4.5-haiku",

    # OpenAI/Codex naming differences
    "gpt-5-codex": "gpt-5",
    "gpt-5.1-codex": "gpt-5.1-codex",
    "gpt-5.1-codex-max": "gpt-5.1-codex",
    "gpt-5.2-codex": "gpt-5.2",
    "gpt-5.4-codex": "gpt-5.4",
    "gpt-5.4-long": "gpt-5.4-272k",
    "gpt-5.4-pro-long": "gpt-5.4-pro-272k",

    # OpenRouter/free route naming -> closest paid baseline
    "minimax-m2.5-free": "minimax-m2",
}

_LLM_PRICES_CACHE_BY_ID = None
_LITELLM_PRICES_CACHE_BY_ID = None


def _normalize_model(model: str) -> str:
    m = model.strip().lower()
    if " [" in m:
        m = m.split(" [", 1)[0]
    return m


def _read_cached_json(path: str) -> dict | None:
    try:
        if not os.path.exists(path):
            return None
        age = time.time() - os.path.getmtime(path)
        if age > LLM_PRICES_TTL_SECONDS:
            return None
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def _fetch_json(url: str, cache_path: str) -> dict | None:
    try:
        req = Request(
            url,
            headers={"User-Agent": "engineering-report/1.0 (+local)"},
        )
        with urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w") as f:
            json.dump(data, f)
        return data
    except Exception:
        return None


def _read_cached_llm_prices() -> dict | None:
    return _read_cached_json(LLM_PRICES_CACHE)


def _fetch_llm_prices() -> dict | None:
    return _fetch_json(LLM_PRICES_URL, LLM_PRICES_CACHE)


def _load_llm_prices() -> dict:
    global _LLM_PRICES_CACHE_BY_ID
    if _LLM_PRICES_CACHE_BY_ID is not None:
        return _LLM_PRICES_CACHE_BY_ID

    data = _read_cached_llm_prices() or _fetch_llm_prices() or {}
    out = {}
    for p in data.get("prices", []):
        pid = _normalize_model(str(p.get("id", "")))
        if not pid:
            continue
        inp = float(p.get("input") or 0.0)
        outp = float(p.get("output") or 0.0)
        cached = p.get("input_cached")
        cache_read = float(cached) if cached is not None else 0.0
        # llm-prices does not expose cache-write pricing
        out[pid] = (inp, outp, cache_read, 0.0)

    _LLM_PRICES_CACHE_BY_ID = out
    return out


def _read_cached_litellm_prices() -> dict | None:
    return _read_cached_json(LITELLM_PRICES_CACHE)


def _fetch_litellm_prices() -> dict | None:
    return _fetch_json(LITELLM_PRICES_URL, LITELLM_PRICES_CACHE)


def _load_litellm_prices() -> dict:
    global _LITELLM_PRICES_CACHE_BY_ID
    if _LITELLM_PRICES_CACHE_BY_ID is not None:
        return _LITELLM_PRICES_CACHE_BY_ID

    data = _read_cached_litellm_prices() or _fetch_litellm_prices() or {}
    out = {}
    for key, val in data.items():
        if not isinstance(key, str) or not isinstance(val, dict):
            continue
        model_id = _normalize_model(key)
        inp = float(val.get("input_cost_per_token") or 0.0) * 1_000_000
        outp = float(val.get("output_cost_per_token") or 0.0) * 1_000_000
        cache_read = float(val.get("cache_read_input_token_cost") or 0.0) * 1_000_000
        cache_write = float(val.get("cache_creation_input_token_cost") or 0.0) * 1_000_000
        out[model_id] = (inp, outp, cache_read, cache_write)

    _LITELLM_PRICES_CACHE_BY_ID = out
    return out


def _resolve_price(model: str) -> tuple[float, float, float, float]:
    base = _normalize_model(model)

    # Prefer explicit local pricing first (keeps known cache-write rates)
    if base in PRICING:
        return PRICING[base]

    mapped = MODEL_ALIASES.get(base, base)

    # Prefer LiteLLM catalog (ccusage uses this source; broad model coverage)
    litellm = _load_litellm_prices()
    litellm_candidates = [
        mapped,
        f"openai/{mapped}",
        f"anthropic/{mapped}",
        f"azure/{mapped}",
        f"openrouter/openai/{mapped}",
    ]
    if mapped.endswith("-free"):
        base_no_free = mapped[: -len("-free")]
        litellm_candidates.extend([
            base_no_free,
            f"openai/{base_no_free}",
            f"anthropic/{base_no_free}",
            f"openrouter/openai/{base_no_free}",
        ])
    for candidate in litellm_candidates:
        if candidate in litellm:
            return litellm[candidate]

    # Fallback to llm-prices simplified catalog
    dynamic = _load_llm_prices()
    return dynamic.get(mapped, (0.0, 0.0, 0.0, 0.0))


def estimate_cost(model: str, input_tokens: int, output_tokens: int,
                  cache_read_tokens: int, cache_write_tokens: int = 0) -> float:
    price = _resolve_price(model)
    inp_price, out_price, cr_price, cw_price = price
    return (
        input_tokens / 1_000_000 * inp_price
        + output_tokens / 1_000_000 * out_price
        + cache_read_tokens / 1_000_000 * cr_price
        + cache_write_tokens / 1_000_000 * cw_price
    )
