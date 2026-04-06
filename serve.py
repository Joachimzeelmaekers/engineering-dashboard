#!/usr/bin/env python3
import http.server
import socketserver
import subprocess
import os
import sys
import webbrowser

from config import server_port
PORT = server_port()
TOOL_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(TOOL_DIR, "output")


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
            subprocess.run(['python3', 'main.py'], cwd=TOOL_DIR)
        return super().do_GET()

os.chdir(OUTPUT_DIR)
try:
    with ReusableTCPServer(("", PORT), RegeneratingHandler) as httpd:
        url = f"http://localhost:{PORT}/latest.html"
        print(f"Serving at {url}")
        print("Regenerates on each page refresh")
        webbrowser.open(url)
        httpd.serve_forever()
except OSError as e:
    if e.errno == 48:
        print(f"Port {PORT} is already in use.", file=sys.stderr)
        print(f"Use a different port: PORT={PORT + 1} python3 serve.py", file=sys.stderr)
        print(f"Or stop the current process: lsof -nP -iTCP:{PORT} -sTCP:LISTEN", file=sys.stderr)
        sys.exit(1)
    raise
