"""Configuration loader for the engineering dashboard."""

import json
import os

from .paths import DEFAULT_CONFIG_FILE

CONFIG_FILE = os.path.expanduser(
    os.environ.get("ENGINEERING_DASHBOARD_CONFIG", str(DEFAULT_CONFIG_FILE))
)

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


def server_port(default: int = 4321) -> int:
    cfg = load_config()
    return int(os.environ.get("PORT", cfg.get("server", {}).get("port", default)))
