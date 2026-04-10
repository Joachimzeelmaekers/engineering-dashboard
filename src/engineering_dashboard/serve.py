import http.server
import socketserver
import os
import sys
import webbrowser

from .config import server_port
from .paths import OUTPUT_DIR


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


class RegeneratingHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.send_response(302)
            self.send_header('Location', '/latest.html')
            self.end_headers()
            return
        if self.path == '/latest.html' or self.path.endswith('.html'):
            print('Regenerating report...')
            from .cli import report_main

            report_main()
        return super().do_GET()


def main():
    port = server_port()
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.chdir(OUTPUT_DIR)

    try:
        with ReusableTCPServer(("", port), RegeneratingHandler) as httpd:
            url = f"http://localhost:{port}/latest.html"
            print(f"Serving at {url}")
            print("Regenerates on each page refresh")
            webbrowser.open(url)
            httpd.serve_forever()
    except OSError as e:
        if e.errno == 48:
            print(f"Port {port} is already in use.", file=sys.stderr)
            print(f"Use a different port: PORT={port + 1} engineering-dashboard serve", file=sys.stderr)
            print(f"Or stop the current process: lsof -nP -iTCP:{port} -sTCP:LISTEN", file=sys.stderr)
            sys.exit(1)
        raise


if __name__ == "__main__":
    main()
