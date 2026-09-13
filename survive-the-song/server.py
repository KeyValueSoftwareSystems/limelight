#!/usr/bin/env python3
"""Standalone Survive the Song server.

The game folder is self-contained: this server just hosts the static look
(the landing page and the arena screen). It has no hub dependency yet — the
music/frame wiring comes once the theme is signed off.

    python3 survive-the-song/server.py     then open http://localhost:8795/

    STS_PORT   this server's port (default 8795)
"""
import http.server
import os
import socketserver

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("STS_PORT", "8795"))
HOST = os.environ.get("STS_HOST", "0.0.0.0")

TYPES = {".html": "text/html; charset=utf-8", ".js": "application/javascript",
         ".css": "text/css", ".json": "application/json",
         ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
         ".ico": "image/x-icon"}


class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _file(self, rel):
        path = os.path.normpath(os.path.join(HERE, rel.lstrip("/")))
        if not path.startswith(HERE) or not os.path.isfile(path):
            self.send_error(404, "no " + rel)
            return
        ctype = TYPES.get(os.path.splitext(path)[1], "application/octet-stream")
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def do_GET(self):
        p = self.path.split("?", 1)[0]
        if p in ("/", "/index.html"):
            return self._file("index.html")
        return self._file(p)

    do_HEAD = do_GET


if __name__ == "__main__":
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer((HOST, PORT), H) as srv:
        srv.daemon_threads = True
        print("  survive-the-song on http://localhost:%d/" % PORT, flush=True)
        srv.serve_forever()
