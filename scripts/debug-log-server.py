from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / "debug" / "xqcoread.log"
LOG.parent.mkdir(exist_ok=True)

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        with LOG.open("a", encoding="utf-8") as handle:
            handle.write(body.strip() + "\n")
        self.send_response(204)
        self._cors()
        self.end_headers()

    def log_message(self, *_args):
        return

if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 18765), Handler)
    print(f"XQcoread log ingest on http://127.0.0.1:18765/log -> {LOG}")
    server.serve_forever()
