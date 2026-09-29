import json
import queue
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class HumanSeat:
    def __init__(self, port, origin):
        self.origin = origin
        self.lock = threading.Lock()
        self.answers = queue.Queue(maxsize=1)
        self.final_seen = threading.Event()
        self.snapshot = {"revision": 0, "state": None, "prompt": None, "status": "waiting"}
        seat = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass

            def allowed(self):
                origin = self.headers.get("Origin")
                return origin is None or origin == seat.origin

            def reply(self, code, value):
                body = json.dumps(value).encode()
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-store")
                if self.headers.get("Origin") == seat.origin:
                    self.send_header("Access-Control-Allow-Origin", seat.origin)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_OPTIONS(self):
                if not self.allowed():
                    self.reply(403, {"error": "Origin rejected"})
                    return
                self.send_response(204)
                self.send_header("Access-Control-Allow-Origin", seat.origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.end_headers()

            def do_GET(self):
                if not self.allowed():
                    self.reply(403, {"error": "Origin rejected"})
                    return
                if self.path != "/snapshot":
                    self.reply(404, {"error": "Unknown path"})
                    return
                with seat.lock:
                    snapshot = dict(seat.snapshot)
                self.reply(200, snapshot)
                if snapshot["status"] in ("finished", "stopped"):
                    seat.final_seen.set()

            def do_POST(self):
                if not self.allowed():
                    self.reply(403, {"error": "Origin rejected"})
                    return
                if self.path != "/respond":
                    self.reply(404, {"error": "Unknown path"})
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if not 0 < length <= 65536:
                        raise ValueError("Invalid request size")
                    response = json.loads(self.rfile.read(length))
                    with seat.lock:
                        prompt = seat.snapshot["prompt"]
                        if not isinstance(response, dict) or response.get("kind") != "response":
                            raise ValueError("Expected canonical response")
                        if prompt is None or type(response.get("promptId")) is not int or response.get("promptId") != prompt["promptId"]:
                            raise ValueError("StalePrompt")
                        action = response.get("action")
                        if not isinstance(action, dict) or action.get("type") != prompt["input"]["type"] or not isinstance(action.get("output"), dict):
                            raise ValueError("WrongPromptType")
                        seat.answers.put_nowait(response)
                        seat.snapshot.update(prompt=None, status="waiting", revision=seat.snapshot["revision"] + 1)
                    self.reply(200, {"accepted": True})
                except (ValueError, queue.Full) as error:
                    self.reply(409, {"error": str(error)})

        self.server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def state(self, state):
        with self.lock:
            self.snapshot.update(state=state, revision=self.snapshot["revision"] + 1)

    def decide(self, prompt, timeout):
        with self.lock:
            self.snapshot.update(prompt=prompt, status="decision", revision=self.snapshot["revision"] + 1)
        return self.answers.get(timeout=timeout)

    def finish(self, completed):
        with self.lock:
            self.snapshot.update(prompt=None, status="finished" if completed else "stopped", revision=self.snapshot["revision"] + 1)

    def close(self):
        self.final_seen.wait(timeout=2)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
