#!/usr/bin/env python3
"""Local dev server for Lanternfall (ES modules need http://, not file://).

    python3 serve.py [--port 8770]
"""
import argparse, functools, http.server, os

ap = argparse.ArgumentParser()
ap.add_argument('--port', type=int, default=8770)
args = ap.parse_args()
root = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


print(f'Lanternfall: http://127.0.0.1:{args.port}/')
http.server.ThreadingHTTPServer(('127.0.0.1', args.port),
                                functools.partial(Handler, directory=root)).serve_forever()
