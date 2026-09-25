"""Oh My Pi provider — reads OMP's Pi-format JSONL sessions."""

import os

from .base import ProviderResult
from .pi import load_from_session_dir

PROVIDER_NAME = "omp"


def _session_dir() -> str:
    direct = os.environ.get("OMP_CODING_AGENT_SESSION_DIR")
    if direct:
        return os.path.expanduser(direct)
    base = os.environ.get("OMP_CODING_AGENT_DIR") or os.environ.get("PI_CODING_AGENT_DIR")
    if base:
        return os.path.join(os.path.expanduser(base), "sessions")
    return os.path.expanduser("~/.omp/agent/sessions")


def load() -> ProviderResult:
    return load_from_session_dir(_session_dir(), PROVIDER_NAME)
