"""Common types for engineering report providers."""

from dataclasses import dataclass, field


@dataclass
class TokenMessage:
    """Normalized message from any provider."""
    provider: str       # e.g. "claude-code", "opencode"
    model: str          # e.g. "claude-opus-4-6", "gpt-5.4-codex"
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost: float = 0.0
    timestamp_ms: int = 0
    session_id: str = ""
    project: str = ""


@dataclass
class ProviderResult:
    """Result from a provider's load."""
    name: str
    messages: list = field(default_factory=list)   # list[TokenMessage]
    sessions: int = 0
    source: str = ""  # e.g. "sqlite", "jsonl"
