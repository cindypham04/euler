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

    /* ── stream view ── */
    #stream-view{display:flex;flex-direction:column;align-items:center;width:100%}
    #vid{width:100vw;max-height:62vh;object-fit:cover;display:block}
    #status{color:#0f0;font-family:monospace;padding:8px;font-size:13px}
    #cap-btn{margin:10px;padding:16px 48px;font-size:21px;font-weight:bold;
             background:#0f0;color:#000;border:none;border-radius:12px;cursor:pointer}
    #cap-btn:disabled{background:#444;color:#666}
    #result{color:#fff;font-family:monospace;padding:10px;font-size:15px;
            max-width:92vw;word-break:break-all;text-align:center}

    /* ── crop view ── */
    #crop-view{display:none;flex-direction:column;align-items:center;width:100%;height:100dvh}
    #crop-canvas{width:100vw;flex:1;min-height:0;touch-action:none;cursor:crosshair}
    .crop-btns{display:flex;gap:16px;padding:14px;width:100%;justify-content:center}
    .crop-btns button{flex:1;max-width:160px;padding:14px;font-size:18px;font-weight:bold;
                      border:none;border-radius:10px;cursor:pointer}
    #cancel-btn{background:#333;color:#fff}
    #confirm-btn{background:#0f0;color:#000}
  </style>
</head>
<body>

<!-- stream view -->
<div id="stream-view">
  <video id="vid" autoplay playsinline muted></video>
  <div id="status">Connecting…</div>
  <button id="cap-btn" disabled>📷 Capture</button>
  <div id="result"></div>
</div>

<!-- crop view -->
<div id="crop-view">
  <canvas id="crop-canvas"></canvas>
  <div class="crop-btns">
    <button id="cancel-btn">✕ Cancel</button>
    <button id="confirm-btn">✓ Confirm</button>
  </div>
</div>

<!-- hidden canvases for streaming -->
<canvas id="stream-canvas" style="display:none"></canvas>

<script>
const proto  = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws     = new WebSocket(proto + '//' + location.host + '/ws');
const status = document.getElementById('status');
const capBtn = document.getElementById('cap-btn');
const result = document.getElementById('result');
const streamView  = document.getElementById('stream-view');
const cropView    = document.getElementById('crop-view');
const cropCanvas  = document.getElementById('crop-canvas');
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

function stopStream() { clearInterval(streamTimer); }

navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false})
  .then(stream => {
    vid.srcObject = stream;
    vid.onloadedmetadata = () => startStream();
  })
  .catch(e => status.textContent = 'Camera error: ' + e.message);

// ── crop UI ────────────────────────────────────────────────────────────────
let frozen = null;   // canvas with the frozen frame
let cropRect = null; // {x,y,w,h} in frozen-canvas coords
let drag = null;     // {mode, px,py, orig}
const HANDLE = 32;   // touch target size (pixels in canvas coords)
const MIN_SIZE = 40;

function showCropView() {
  // Freeze current frame
  frozen = document.createElement('canvas');
  frozen.width  = vid.videoWidth;
  frozen.height = vid.videoHeight;
  frozen.getContext('2d').drawImage(vid, 0, 0);

  // Default crop: centre 70%W × 25%H  (matches server's _crop_center)
  const fw = frozen.width, fh = frozen.height;
  const rw = fw * 0.7, rh = fh * 0.25;
  cropRect = {x: (fw-rw)/2, y: (fh-rh)/2, w: rw, h: rh};

  stopStream();
  streamView.style.display = 'none';
  cropView.style.display   = 'flex';
  renderCrop();
}

function hideCropView() {
  cropView.style.display   = 'none';
  streamView.style.display = 'flex';
  startStream();
}

function renderCrop() {
  const cw = frozen.width, ch = frozen.height;
  cropCanvas.width  = cw;
  cropCanvas.height = ch;
  const ctx = cropCanvas.getContext('2d');
  const {x, y, w, h} = cropRect;

  // Darkened full frame
  ctx.drawImage(frozen, 0, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, cw, ch);

  // Bright crop area
  ctx.drawImage(frozen, x, y, w, h, x, y, w, h);

  // Green border
  ctx.strokeStyle = '#00ff00';
  ctx.lineWidth = Math.max(2, cw / 300);
  ctx.strokeRect(x, y, w, h);

  // Corner handles
  const hs = HANDLE;
  ctx.fillStyle = '#00ff00';
  [[x, y], [x+w-hs, y], [x, y+h-hs], [x+w-hs, y+h-hs]].forEach(([cx, cy]) => {
    ctx.fillRect(cx, cy, hs, hs);
  });
}

function toCanvasXY(touch) {
  const r = cropCanvas.getBoundingClientRect();
  return {
    x: (touch.clientX - r.left) * (cropCanvas.width  / r.width),
    y: (touch.clientY - r.top)  * (cropCanvas.height / r.height),
  };
}

function hitCorner(tx, ty) {
  const {x, y, w, h} = cropRect;
  const t = HANDLE * 1.2;
  if (Math.abs(tx - x)     < t && Math.abs(ty - y)     < t) return 'tl';
  if (Math.abs(tx - (x+w)) < t && Math.abs(ty - y)     < t) return 'tr';
  if (Math.abs(tx - x)     < t && Math.abs(ty - (y+h)) < t) return 'bl';
  if (Math.abs(tx - (x+w)) < t && Math.abs(ty - (y+h)) < t) return 'br';
  return null;
}

function inside(tx, ty) {
  const {x, y, w, h} = cropRect;
  return tx >= x && tx <= x+w && ty >= y && ty <= y+h;
}

cropCanvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const p = touchToCanvas = toCanvasXY(e.touches[0]);
  const corner = hitCorner(p.x, p.y);
  drag = { mode: corner || (inside(p.x, p.y) ? 'move' : null),
           px: p.x, py: p.y, orig: {...cropRect} };
}, {passive: false});

cropCanvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if (!drag?.mode) return;
  const p  = toCanvasXY(e.touches[0]);
  const dx = p.x - drag.px, dy = p.y - drag.py;
  const o  = drag.orig;
  const fw = frozen.width, fh = frozen.height;
  let {x, y, w, h} = o;

  if (drag.mode === 'move') {
    x = Math.max(0, Math.min(fw - w, o.x + dx));
    y = Math.max(0, Math.min(fh - h, o.y + dy));
  } else {
    if (drag.mode === 'tl' || drag.mode === 'bl') {
      const nx = Math.max(0, Math.min(o.x + dx, o.x + o.w - MIN_SIZE));
      w = o.w - (nx - o.x);  x = nx;
    }
    if (drag.mode === 'tr' || drag.mode === 'br') {
      w = Math.max(MIN_SIZE, Math.min(o.w + dx, fw - o.x));
    }
    if (drag.mode === 'tl' || drag.mode === 'tr') {
      const ny = Math.max(0, Math.min(o.y + dy, o.y + o.h - MIN_SIZE));
      h = o.h - (ny - o.y);  y = ny;
    }
    if (drag.mode === 'bl' || drag.mode === 'br') {
      h = Math.max(MIN_SIZE, Math.min(o.h + dy, fh - o.y));
    }
  }

  cropRect = {x, y, w, h};
  renderCrop();
}, {passive: false});

cropCanvas.addEventListener('touchend',   () => { drag = null; });
cropCanvas.addEventListener('touchcancel',() => { drag = null; });

// ── buttons ────────────────────────────────────────────────────────────────
capBtn.addEventListener('click', showCropView);

document.getElementById('cancel-btn').addEventListener('click', hideCropView);

document.getElementById('confirm-btn').addEventListener('click', () => {
  const {x, y, w, h} = cropRect;

  // Render crop to a new canvas and send as JPEG
  const out = document.createElement('canvas');
  out.width = Math.round(w);
  out.height = Math.round(h);
  out.getContext('2d').drawImage(frozen, x, y, w, h, 0, 0, out.width, out.height);

  out.toBlob(blob => {
    blob.arrayBuffer().then(buf => {
      ws.send(buf);    // cropped JPEG → server buffers it
      ws.send('ocr'); // signal: OCR without server-side re-crop
    });
  }, 'image/jpeg', 0.92);

  capBtn.textContent = '⏳ Recognizing…';
  capBtn.disabled = true;
  hideCropView();
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
