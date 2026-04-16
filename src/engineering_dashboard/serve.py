"""Build and preview the Astro dashboard."""

from __future__ import annotations

import os
import subprocess
import sys
import webbrowser

from .cli import report_main
from .config import server_port
from .paths import DASHBOARD_DIR


def _run(command: list[str]):
    subprocess.run(command, cwd=str(DASHBOARD_DIR), check=True)


def main():
    port = server_port(default=4321)
    url = f"http://localhost:{port}"

    report_main()

    print("\nBuilding Astro dashboard...")
    _run(["yarn", "build"])

    print(f"Previewing Astro dashboard at {url}")
    webbrowser.open(url)

    try:
        _run(["yarn", "preview", "--host", "0.0.0.0", "--port", str(port)])
    except subprocess.CalledProcessError as err:
        print(f"Failed to start preview: {err}", file=sys.stderr)
        sys.exit(err.returncode or 1)


if __name__ == "__main__":
    main()
