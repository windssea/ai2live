"""ai2live image worker — HTTP endpoints for segment / min-region inpaint.

Prefer stdlib http.server so no pip deps are required. If FastAPI+uvicorn
are installed, `python -m ai2live_worker.main --fastapi` uses them instead.

Endpoints:
  GET  /health
  GET  /capabilities
  POST /segment  JSON { master_path, labels? } → stub mask metadata (+ tiny png_b64)
  POST /inpaint  JSON { image_path, mask_path } → OpenCV TELEA/NS or telea-like fill
"""

from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse

from .inpaint import inpaint_capabilities, inpaint_min_region

# 1x1 transparent PNG
TINY_PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def segment_stub(master_path: str, labels: list[str] | None = None) -> dict[str, Any]:
    labs = labels or ["SUBJECT"]
    masks = []
    for label in labs:
        masks.append(
            {
                "label": label,
                "path": f"masks/{label.lower()}_mask.png",
                "png_b64": TINY_PNG_B64,
                "method": "stub",
            }
        )
    return {
        "method": "stub",
        "master_path": master_path,
        "labels": labs,
        "masks": masks,
        "warnings": ["stub segmentation — replace with CV model later"],
        "note": "Install FastAPI + CV deps for real segmentation",
    }


def health() -> dict[str, Any]:
    caps = inpaint_capabilities()
    return {
        "status": "ok",
        "service": "ai2live-image-worker",
        "version": "0.2.0",
        "capabilities": caps,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        if not raw:
            return {}
        return json.loads(raw.decode("utf-8"))

    def _send(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path in ("/health", "/"):
            self._send(200, health())
            return
        if path == "/capabilities":
            self._send(200, inpaint_capabilities())
            return
        self._send(404, {"error": "not_found", "path": path})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        try:
            data = self._read_json()
        except json.JSONDecodeError as e:
            self._send(400, {"error": "invalid_json", "detail": str(e)})
            return

        if path == "/segment":
            master = str(data.get("master_path") or data.get("masterPath") or "")
            labels = data.get("labels")
            if labels is not None and not isinstance(labels, list):
                self._send(400, {"error": "labels must be a list"})
                return
            self._send(200, segment_stub(master, labels))
            return

        if path == "/inpaint":
            image = str(data.get("image_path") or data.get("imagePath") or "")
            mask = str(data.get("mask_path") or data.get("maskPath") or "")
            if not image or not mask:
                self._send(400, {"error": "image_path and mask_path required"})
                return
            self._send(200, inpaint_min_region(image, mask))
            return

        self._send(404, {"error": "not_found", "path": path})


def serve_stdlib(host: str, port: int) -> None:
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"ai2live image-worker listening on http://{host}:{port} (stdlib)", flush=True)
    httpd.serve_forever()


def serve_fastapi(host: str, port: int) -> None:
    try:
        from fastapi import FastAPI
        import uvicorn
    except ImportError as e:
        raise SystemExit(
            "FastAPI/uvicorn not installed. Run without --fastapi, or: pip install fastapi uvicorn"
        ) from e

    app = FastAPI(title="ai2live-image-worker", version="0.2.0")

    @app.get("/health")
    def _health() -> dict[str, Any]:
        return health()

    @app.get("/capabilities")
    def _caps() -> dict[str, Any]:
        return inpaint_capabilities()

    @app.post("/segment")
    def _segment(body: dict[str, Any]) -> dict[str, Any]:
        master = str(body.get("master_path") or body.get("masterPath") or "")
        labels = body.get("labels")
        return segment_stub(master, labels if isinstance(labels, list) else None)

    @app.post("/inpaint")
    def _inpaint(body: dict[str, Any]) -> dict[str, Any]:
        image = str(body.get("image_path") or body.get("imagePath") or "")
        mask = str(body.get("mask_path") or body.get("maskPath") or "")
        return inpaint_min_region(image, mask)

    print(f"ai2live image-worker listening on http://{host}:{port} (fastapi)", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="ai2live image worker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8090)
    parser.add_argument(
        "--fastapi",
        action="store_true",
        help="Use FastAPI+uvicorn if installed (otherwise stdlib http.server)",
    )
    parser.add_argument(
        "--demo",
        action="store_true",
        help="Print stub segment + capabilities and exit (no server)",
    )
    parser.add_argument(
        "--inpaint-demo",
        nargs=2,
        metavar=("IMAGE", "MASK"),
        help="Run min-region inpaint offline and print method JSON (no png_b64 dump)",
    )
    args = parser.parse_args(argv)

    if args.demo:
        print(json.dumps({"segment": segment_stub("design/master_neutral.png"), "capabilities": inpaint_capabilities()}, indent=2))
        return

    if args.inpaint_demo:
        result = inpaint_min_region(args.inpaint_demo[0], args.inpaint_demo[1])
        slim = {k: v for k, v in result.items() if k != "png_b64"}
        slim["png_b64_len"] = len(result.get("png_b64") or "")
        print(json.dumps(slim, indent=2))
        return

    if args.fastapi:
        serve_fastapi(args.host, args.port)
    else:
        serve_stdlib(args.host, args.port)


if __name__ == "__main__":
    main()
