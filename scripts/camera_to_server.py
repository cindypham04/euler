"""Stream phone camera to laptop via WebSocket for real-time math OCR.

Usage:
    pip install aiohttp requests  # one-time
    # Start the Next.js app first: npm run dev  (default port 3000)
    python camera_to_server.py

    # In a second terminal (school / any network):
    ssh -R 80:localhost:8080 nokey@localhost.run

    Open the https URL on your iPhone in Safari.
    Tap 📷 Capture, adjust the crop box, tap ✓ Confirm.
    Result (problem + solution) appears on phone and laptop terminal.
    Press SPACE on laptop to OCR with server-side crop, Q to quit.

    Override the Next.js server URL:
        UNBLIND_SERVER=http://localhost:3000 python camera_to_server.py
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import sys
import threading
from datetime import datetime

import cv2
import numpy as np

try:
    from aiohttp import web, WSMsgType
except ImportError:
    sys.exit("Run:  pip install aiohttp requests")

try:
    import requests as _requests
except ImportError:
    sys.exit("Run:  pip install requests")

# ── constants ─────────────────────────────────────────────────────────────────

PORT         = 8080
CROP_W       = 0.7
CROP_H       = 0.25
WINDOW       = "unblind – phone stream  |  SPACE=OCR  Q=quit"
NEXT_SERVER  = os.getenv("UNBLIND_SERVER", "http://localhost:3000")

# ── shared state ──────────────────────────────────────────────────────────────

class FrameBuffer:
    def __init__(self) -> None:
        self._data: bytes | None = None
        self._lock = threading.Lock()

    def put(self, data: bytes) -> None:
        with self._lock:
            self._data = data

    def get(self) -> bytes | None:
        with self._lock:
            return self._data


BUFFER           = FrameBuffer()
CAPTURE_EVENT    = threading.Event()   # SPACE on laptop  → crop server-side
OCR_NOCROP_EVENT = threading.Event()   # phone confirmed  → image already cropped
_CONNECTED: set  = set()
_LOOP: asyncio.AbstractEventLoop | None = None

# ── broadcast result back to phone ───────────────────────────────────────────

async def _broadcast(text: str) -> None:
    dead = set()
    for ws in _CONNECTED.copy():
        try:
            await ws.send_str(text)
        except Exception:
            dead.add(ws)
    _CONNECTED.difference_update(dead)


def broadcast_sync(text: str) -> None:
    if _LOOP:
        asyncio.run_coroutine_threadsafe(_broadcast(text), _LOOP)


# ── web page ──────────────────────────────────────────────────────────────────

PAGE_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>unblind</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#000;font-family:system-ui;display:flex;flex-direction:column;
         align-items:center;height:100dvh;overflow:hidden}
    #vid{width:100vw;max-height:62vh;object-fit:cover;display:block}
    #status{color:#0f0;font-family:monospace;padding:8px;font-size:13px}
    #cap-btn{margin:10px;padding:16px 48px;font-size:21px;font-weight:bold;
             background:#0f0;color:#000;border:none;border-radius:12px;cursor:pointer}
    #cap-btn:disabled{background:#444;color:#666}
    #result{color:#fff;font-family:monospace;padding:10px;font-size:15px;
            max-width:92vw;word-break:break-all;text-align:center}
  </style>
</head>
<body>

<video id="vid" autoplay playsinline muted></video>
<div id="status">Connecting…</div>
<button id="cap-btn" disabled>📷 Capture</button>
<div id="result"></div>
<canvas id="stream-canvas" style="display:none"></canvas>

<script>
const proto  = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws     = new WebSocket(proto + '//' + location.host + '/ws');
const status = document.getElementById('status');
const capBtn = document.getElementById('cap-btn');
const result = document.getElementById('result');
const streamCanvas = document.getElementById('stream-canvas');
const vid = document.getElementById('vid');

ws.onopen    = () => { status.textContent = 'Streaming ●'; capBtn.disabled = false; };
ws.onclose   = () => { status.textContent = 'Disconnected'; capBtn.disabled = true; };
ws.onerror   = () => { status.textContent = 'Connection error'; };
ws.onmessage = e => {
  result.textContent = '';
  try {
    const r = JSON.parse(e.data);
    if (r.ok) {
      const pl = document.createElement('div');
      pl.style.cssText = 'color:#0f0;font-size:11px;margin-bottom:4px';
      pl.textContent = 'PROBLEM';
      const pt = document.createElement('div');
      pt.style.marginBottom = '12px';
      pt.textContent = r.problem;
      const rl = document.createElement('div');
      rl.style.cssText = 'color:#0f0;font-size:11px;margin-bottom:4px';
      rl.textContent = 'RESPONSE';
      const rt = document.createElement('div');
      rt.textContent = r.response;
      result.append(pl, pt, rl, rt);
    } else {
      result.textContent = 'Error: ' + (r.error ?? 'unknown');
    }
  } catch {
    result.textContent = e.data;
  }
  capBtn.textContent = '📷 Capture';
  capBtn.disabled = false;
};

// ── continuous streaming ───────────────────────────────────────────────────
let streamCtx, streamTimer;

function startStream() {
  streamCanvas.width  = vid.videoWidth  || 640;
  streamCanvas.height = vid.videoHeight || 480;
  streamCtx = streamCanvas.getContext('2d');
  clearInterval(streamTimer);
  streamTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    streamCtx.drawImage(vid, 0, 0, streamCanvas.width, streamCanvas.height);
    streamCanvas.toBlob(b => { if (b) ws.send(b); }, 'image/jpeg', 0.75);
  }, 150);
}

navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false})
  .then(stream => {
    vid.srcObject = stream;
    vid.onloadedmetadata = () => startStream();
  })
  .catch(e => status.textContent = 'Camera error: ' + e.message);

// ── capture button ─────────────────────────────────────────────────────────
capBtn.addEventListener('click', () => {
  streamCtx.drawImage(vid, 0, 0, streamCanvas.width, streamCanvas.height);
  streamCanvas.toBlob(blob => {
    blob.arrayBuffer().then(buf => {
      ws.send(buf);
      ws.send('ocr');
    });
  }, 'image/jpeg', 0.92);
  capBtn.textContent = '⏳ Recognizing…';
  capBtn.disabled = true;
});
</script>
</body>
</html>"""


# ── aiohttp handlers ──────────────────────────────────────────────────────────

async def _page_handler(request: web.Request) -> web.Response:
    return web.Response(text=PAGE_HTML, content_type="text/html", charset="utf-8")


async def _ws_handler(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    _CONNECTED.add(ws)
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                BUFFER.put(msg.data)
            elif msg.type == WSMsgType.TEXT:
                if msg.data == "capture":
                    CAPTURE_EVENT.set()
                elif msg.data == "ocr":
                    OCR_NOCROP_EVENT.set()
    finally:
        _CONNECTED.discard(ws)
    return ws


def _run_server(port: int) -> None:
    global _LOOP

    async def _serve() -> None:
        global _LOOP
        _LOOP = asyncio.get_running_loop()
        app = web.Application()
        app.router.add_get("/",   _page_handler)
        app.router.add_get("/ws", _ws_handler)
        runner = web.AppRunner(app, access_log=None)
        await runner.setup()
        await web.TCPSite(runner, "0.0.0.0", port).start()
        await asyncio.Future()

    asyncio.run(_serve())


# ── image helpers ─────────────────────────────────────────────────────────────

def _local_ip() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"


def _crop_center(frame):
    h, w = frame.shape[:2]
    cw, ch = int(w * CROP_W), int(h * CROP_H)
    x0, y0 = (w - cw) // 2, (h - ch) // 2
    return frame[y0:y0+ch, x0:x0+cw]


def _decode(data: bytes):
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def _run_ocr(*, crop: bool) -> str | None:
    data = BUFFER.get()
    if data is None:
        print("[no frame yet]", flush=True)
        return None

    if crop:
        frame = _decode(data)
        if frame is None:
            print("[corrupt frame]", flush=True)
            return None
        region = _crop_center(frame)
        ok, buf = cv2.imencode(".jpg", region, [cv2.IMWRITE_JPEG_QUALITY, 90])
        if not ok:
            return None
        img_bytes = buf.tobytes()
    else:
        img_bytes = data  # already a cropped JPEG from the phone

    print("Recognizing…", flush=True)
    try:
        resp = _requests.post(
            f"{NEXT_SERVER}/api/solve",
            files={"image": ("frame.jpg", img_bytes, "image/jpeg")},
            timeout=60,
        )
        resp.raise_for_status()
        result = resp.json()
        ts = datetime.now().strftime("%H:%M:%S")
        if result.get("ok"):
            print(f"[{ts}] {result['problem']}", flush=True)
        else:
            print(f"[{ts}] error: {result.get('error')}", file=sys.stderr)
            return None
        return json.dumps(result)
    except Exception as exc:
        print(f"[ocr error] {exc}", file=sys.stderr)
        return None


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> int:
    ip = _local_ip()
    threading.Thread(target=_run_server, args=(PORT,), daemon=True).start()

    print(f"\n  Direct URL:  http://{ip}:{PORT}/")
    print(f"  (or your tunnel URL)\n")
    print(f"  Solve endpoint: {NEXT_SERVER}/api/solve\n", flush=True)
    print("Waiting for phone stream…\n", flush=True)

    placeholder_shown = False

    try:
        while True:
            data = BUFFER.get()

            if data is None:
                if not placeholder_shown:
                    blank = np.zeros((480, 640, 3), np.uint8)
                    cv2.putText(blank, f"Open http://{ip}:{PORT}/ on your phone",
                                (20, 230), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 200, 0), 2)
                    cv2.putText(blank, "Waiting for camera stream…",
                                (140, 270), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0, 200, 0), 2)
                    cv2.imshow(WINDOW, blank)
                    placeholder_shown = True
                key = cv2.waitKey(200) & 0xFF
            else:
                placeholder_shown = False
                frame = _decode(data)
                if frame is not None:
                    h, w = frame.shape[:2]
                    cw, ch = int(w * CROP_W), int(h * CROP_H)
                    x0, y0 = (w - cw) // 2, (h - ch) // 2
                    preview = frame.copy()
                    cv2.rectangle(preview, (x0, y0), (x0+cw, y0+ch), (0, 255, 0), 2)
                    cv2.putText(preview, "SPACE=OCR  Q=quit",
                                (x0, max(y0 - 8, 16)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
                    cv2.imshow(WINDOW, preview)
                key = cv2.waitKey(30) & 0xFF

            if key == ord("q"):
                break
            if key == ord(" ") or CAPTURE_EVENT.is_set():
                CAPTURE_EVENT.clear()
                result = _run_ocr(crop=True)
                if result:
                    broadcast_sync(result)
            elif OCR_NOCROP_EVENT.is_set():
                OCR_NOCROP_EVENT.clear()
                result = _run_ocr(crop=False)
                if result:
                    broadcast_sync(result)
    finally:
        cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    sys.exit(main())
