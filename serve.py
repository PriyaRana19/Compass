#!/usr/bin/env python3
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8000"))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

if __name__ == "__main__":
    with ThreadingHTTPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"Serving {DIRECTORY} at http://0.0.0.0:{PORT}")
        httpd.serve_forever()
