#!/usr/bin/env python3
import http.server
import os
import sys

PORT = int(os.environ.get("PORT", "8080"))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def do_GET(self):
        if self.path in ("/admin", "/admin/"):
            self.send_response(301)
            self.send_header("Location", "/admin.html")
            self.end_headers()
            return
        super().do_GET()


if __name__ == "__main__":
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
