#!/usr/bin/env python3
"""Generate reports from the repo root."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from engineering_dashboard.cli import report_main


if __name__ == "__main__":
    report_main()
