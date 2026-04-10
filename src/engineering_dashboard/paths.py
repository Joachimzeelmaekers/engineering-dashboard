"""Shared path resolution for repo and runtime data."""

from pathlib import Path
import os


PACKAGE_DIR = Path(__file__).resolve().parent
SRC_DIR = PACKAGE_DIR.parent
REPO_ROOT = SRC_DIR.parent


def _looks_like_repo(path: Path) -> bool:
    return (path / "dashboard").exists() and (path / "README.md").exists()


def get_project_root() -> Path:
    env_root = os.environ.get("ENGINEERING_DASHBOARD_HOME")
    if env_root:
        return Path(env_root).expanduser().resolve()

    cwd = Path.cwd().resolve()
    if _looks_like_repo(cwd) or (cwd / "config.json").exists():
        return cwd

    if _looks_like_repo(REPO_ROOT):
        return REPO_ROOT

    return cwd


PROJECT_ROOT = get_project_root()
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_DIR = PROJECT_ROOT / "output"
DASHBOARD_DIR = PROJECT_ROOT / "dashboard"
DASHBOARD_PUBLIC_DIR = DASHBOARD_DIR / "public"
DEFAULT_CONFIG_FILE = PROJECT_ROOT / "config.json"
