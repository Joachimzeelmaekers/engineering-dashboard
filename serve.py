#!/usr/bin/env python3
"""Serve reports from the repo root."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))

from engineering_dashboard.serve import main


if __name__ == "__main__":
    main()
