"""Configuration loader for the engineering report."""

import json
import os

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.path.join(TOOL_DIR, "config.json")

_config = None


def load_config() -> dict:
    global _config
    if _config is not None:
        return _config

    if not os.path.exists(CONFIG_FILE):
        _config = {}
        return _config

    with open(CONFIG_FILE) as f:
        _config = json.load(f)
    return _config


def is_provider_enabled(name: str) -> bool:
    cfg = load_config()
    providers = cfg.get("providers", {})
    # Enabled by default if not specified
    return providers.get(name, {}).get("enabled", True)


def is_github_enabled() -> bool:
    cfg = load_config()
    return cfg.get("github", {}).get("enabled", True)


def github_history_start_year() -> int:
    cfg = load_config()
    return cfg.get("github", {}).get("history_start_year", 2015)


def server_port() -> int:
    cfg = load_config()
    return int(os.environ.get("PORT", cfg.get("server", {}).get("port", 9999)))


def max_reports() -> int:
    cfg = load_config()
    return cfg.get("max_reports", 3)
