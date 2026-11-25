"""Remote PC Control Web Server for Mobile Chrome over LAN."""

import argparse
import asyncio
from collections import defaultdict
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import webbrowser

from fastapi import FastAPI, Header, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from PIL import Image, ImageDraw, ImageGrab
from pydantic import BaseModel
import pyperclip
import uvicorn

import input_win

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
DATA_DIR = BASE_DIR / "data"
AUTH_STATE_FILE = DATA_DIR / "auth_state.json"

if sys.stdout is None or sys.stderr is None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _log_file = open(DATA_DIR / "server.log", "a", encoding="utf-8", buffering=1)
    if sys.stdout is None:
        sys.stdout = _log_file
    if sys.stderr is None:
        sys.stderr = _log_file

app = FastAPI(title="PC Remote Control")

# Runtime security state
PIN_CODE: str = ""
SERVER_PORT: int = 8765
LAN_IP: str = "127.0.0.1"
PUBLIC_DOMAIN: str = ""
DEFAULT_USER: str = os.environ.get("REMOTE_USER", "admin")
DEFAULT_PASS: str = os.environ.get("REMOTE_PASS", "hieuhhbg2k")
MACHINE_ID: str = ""
MACHINE_NAME: str = socket.gethostname()
USERS: dict[str, dict] = {}
ACCOUNT_TOKENS: dict[str, dict] = {}
PAIRED_DEVICES: dict[str, dict] = {}
FAILED_ATTEMPTS: dict[str, list[float]] = defaultdict(list)


def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    s = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), s.encode("utf-8"), 100_000)
    return s, dk.hex()


def _verify_password(password: str, salt: str, digest: str) -> bool:
    _, calc = _hash_password(password, salt)
    return hmac.compare_digest(calc, digest)


def _load_auth_state() -> None:
    global MACHINE_ID, USERS, ACCOUNT_TOKENS, PAIRED_DEVICES
    data = {}
    if AUTH_STATE_FILE.exists():
        try:
            data = json.loads(AUTH_STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            data = {}

    MACHINE_ID = data.get("machine_id") or f"PC-{secrets.randbelow(900000) + 100000}"
    USERS = data.get("users", {})
    ACCOUNT_TOKENS = data.get("account_tokens", {})
    PAIRED_DEVICES = data.get("paired_devices", {})

    if DEFAULT_USER not in USERS:
        salt, digest = _hash_password(DEFAULT_PASS)
        USERS[DEFAULT_USER] = {
            "salt": salt,
            "hash": digest,
            "created_at": int(time.time()),
        }
        _save_auth_state()
    elif not data.get("machine_id"):
        _save_auth_state()


def _save_auth_state() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    AUTH_STATE_FILE.write_text(
        json.dumps(
            {
                "machine_id": MACHINE_ID,
                "machine_name": MACHINE_NAME,
                "users": USERS,
                "account_tokens": ACCOUNT_TOKENS,
                "paired_devices": PAIRED_DEVICES,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


_load_auth_state()


def detect_lan_ip() -> str:
    """Detect the primary LAN IPv4 address."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"


def _get_client_ip(request: Request) -> str:
    direct_ip = request.client.host if request.client else "unknown"
    if direct_ip in ("127.0.0.1", "::1", "localhost"):
        cf_ip = request.headers.get("cf-connecting-ip")
        if cf_ip:
            return cf_ip.strip()
        xff = request.headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
    return direct_ip


def _is_rate_limited(ip: str) -> bool:
    now = time.time()
    recent = [t for t in FAILED_ATTEMPTS[ip] if now - t < 300.0]
    FAILED_ATTEMPTS[ip] = recent
    return len(recent) >= 5


def _record_failure(ip: str) -> None:
    FAILED_ATTEMPTS[ip].append(time.time())


def _verify_account_token(token: str | None) -> bool:
    return bool(token and token in ACCOUNT_TOKENS)


def _verify_device_token(token: str | None) -> bool:
    return bool(token and token in PAIRED_DEVICES)


def _verify_full_access(acct_token: str | None, dev_token: str | None) -> bool:
    return _verify_account_token(acct_token) and _verify_device_token(dev_token)


class LoginRequest(BaseModel):
    username: str
    password: str


class PairRequest(BaseModel):
    pin: str
    remember: bool = True


class LogoutRequest(BaseModel):
    forget_device: bool = False


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/host")
async def host_dashboard(request: Request):
    client_host = request.client.host if request.client else ""
    is_proxied = any(
        request.headers.get(h)
        for h in ("cf-connecting-ip", "cf-ray", "x-forwarded-for", "x-forwarded-host")
    )
    if client_host not in ("127.0.0.1", "::1", "localhost") or is_proxied:
        raise HTTPException(status_code=403, detail="Host dashboard is localhost-only")
    html = (STATIC_DIR / "host.html").read_text(encoding="utf-8")
    url = f"https://{PUBLIC_DOMAIN}" if PUBLIC_DOMAIN else f"http://{LAN_IP}:{SERVER_PORT}"
    html = (
        html.replace("__LAN_URL__", url)
        .replace("__PIN_CODE__", PIN_CODE)
        .replace("__MACHINE_ID__", MACHINE_ID)
        .replace("__MACHINE_NAME__", MACHINE_NAME)
    )
    return HTMLResponse(html)


@app.post("/api/register")
async def register(body: LoginRequest, request: Request):
    ip = _get_client_ip(request)
    if _is_rate_limited(ip):
        raise HTTPException(status_code=429, detail="Quá nhiều lần thử. Vui lòng đợi 5 phút.")

    uname = body.username.strip()
    if len(uname) < 3 or len(uname) > 32 or not uname.isalnum():
        raise HTTPException(status_code=400, detail="Tài khoản phải từ 3–32 ký tự chữ/số.")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Mật khẩu phải từ 6 ký tự trở lên.")
    if uname in USERS:
        raise HTTPException(status_code=409, detail="Tài khoản này đã tồn tại.")

    salt, digest = _hash_password(body.password)
    USERS[uname] = {
        "salt": salt,
        "hash": digest,
        "created_at": int(time.time()),
    }
    account_token = secrets.token_hex(24)
    ACCOUNT_TOKENS[account_token] = {
        "username": uname,
        "created_at": int(time.time()),
    }
    _save_auth_state()
    return {"account_token": account_token, "username": uname}


@app.post("/api/login")
async def login(body: LoginRequest, request: Request):
    ip = _get_client_ip(request)
    if _is_rate_limited(ip):
        raise HTTPException(status_code=429, detail="Quá nhiều lần thử sai. Vui lòng đợi 5 phút.")

    uname = body.username.strip()
    user_rec = USERS.get(uname)
    if not user_rec or not _verify_password(body.password, user_rec["salt"], user_rec["hash"]):
        _record_failure(ip)
        raise HTTPException(status_code=401, detail="Sai tài khoản hoặc mật khẩu.")

    account_token = secrets.token_hex(24)
    ACCOUNT_TOKENS[account_token] = {
        "username": uname,
        "created_at": int(time.time()),
    }
    _save_auth_state()
    return {"account_token": account_token, "username": uname}


@app.post("/api/pair")
async def pair_pc(
    body: PairRequest,
    request: Request,
    x_account_token: str | None = Header(default=None),
):
    if not _verify_account_token(x_account_token):
        raise HTTPException(status_code=401, detail="Phiên tài khoản hết hạn, vui lòng đăng nhập lại.")

    ip = _get_client_ip(request)
    if _is_rate_limited(ip):
        raise HTTPException(status_code=429, detail="Quá nhiều lần thử sai. Vui lòng đợi 5 phút.")

    if not hmac.compare_digest(body.pin.strip(), PIN_CODE):
        _record_failure(ip)
        raise HTTPException(status_code=401, detail="Mã PIN máy tính không đúng.")

    device_token = secrets.token_hex(24)
    ua = request.headers.get("user-agent", "Unknown")[:80]
    PAIRED_DEVICES[device_token] = {
        "username": ACCOUNT_TOKENS[x_account_token]["username"],
        "machine_id": MACHINE_ID,
        "machine_name": MACHINE_NAME,
        "label": ua,
        "paired_at": int(time.time()),
        "persistent": bool(body.remember),
    }
    _save_auth_state()
    w, h = input_win.get_screen_size()
    return {
        "device_token": device_token,
        "machine": {"id": MACHINE_ID, "name": MACHINE_NAME},
        "screen": {"width": w, "height": h},
    }


@app.get("/api/session")
async def check_session(
    x_account_token: str | None = Header(default=None),
    x_device_token: str | None = Header(default=None),
):
    acct_ok = _verify_account_token(x_account_token)
    paired_ok = _verify_device_token(x_device_token)
    w, h = input_win.get_screen_size()
    return {
        "account_ok": acct_ok,
        "paired_ok": paired_ok,
        "username": ACCOUNT_TOKENS[x_account_token]["username"] if acct_ok else None,
        "machine": {"id": MACHINE_ID, "name": MACHINE_NAME},
        "screen": {"width": w, "height": h},
    }


@app.post("/api/logout")
async def logout(
    body: LogoutRequest,
    x_account_token: str | None = Header(default=None),
    x_device_token: str | None = Header(default=None),
):
    changed = False
    if x_account_token and x_account_token in ACCOUNT_TOKENS:
        del ACCOUNT_TOKENS[x_account_token]
        changed = True
    if body.forget_device and x_device_token and x_device_token in PAIRED_DEVICES:
        del PAIRED_DEVICES[x_device_token]
        changed = True
    if changed:
        _save_auth_state()
    return {"ok": True}


def _placeholder_jpeg(message: str = "Screen locked or unavailable") -> bytes:
    img = Image.new("RGB", (640, 360), (15, 23, 42))
    draw = ImageDraw.Draw(img)
    draw.text((24, 165), message, fill=(148, 163, 184))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=60)
    return buf.getvalue()


def _capture_jpeg(max_width: int = 1024, quality: int = 60, draw_cursor: bool = True) -> bytes:
    try:
        img = ImageGrab.grab(all_screens=False)
    except OSError:
        return _placeholder_jpeg("Man hinh dang khoa hoac khong kha dung")
    orig_w, orig_h = img.size

    if draw_cursor:
        try:
            cx, cy = input_win.get_cursor_pos()
            if 0 <= cx < orig_w and 0 <= cy < orig_h:
                draw = ImageDraw.Draw(img)
                r = max(6, int(orig_w / 220))
                draw.ellipse((cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2), fill=(255, 255, 255))
                draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(239, 68, 68))
        except Exception:
            pass

    if max_width > 0 and orig_w > max_width:
        new_h = max(1, int(orig_h * (max_width / orig_w)))
        img = img.resize((max_width, new_h), Image.Resampling.BILINEAR)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=max(20, min(95, quality)), optimize=False)
    return buf.getvalue()


@app.get("/api/screenshot")
async def download_screenshot(
    token: str | None = Query(default=None),
    acct: str | None = Query(default=None),
    x_device_token: str | None = Header(default=None),
    x_account_token: str | None = Header(default=None),
):
    dev_tok = token or x_device_token
    acct_tok = acct or x_account_token
    if not _verify_full_access(acct_tok, dev_tok):
        raise HTTPException(status_code=401, detail="Unauthorized")
    data = await asyncio.to_thread(_capture_jpeg, 0, 90, False)
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Content-Disposition": 'attachment; filename="pc-screenshot.jpg"'},
    )


def _handle_control_message(msg: dict) -> dict | None:
    mtype = msg.get("type")

    if mtype == "mouse_rel":
        dx = int(round(float(msg.get("dx", 0))))
        dy = int(round(float(msg.get("dy", 0))))
        input_win.move_mouse_rel(dx, dy)

    elif mtype == "mouse_abs":
        x = float(msg.get("x", 0.5))
        y = float(msg.get("y", 0.5))
        input_win.move_mouse_abs(x, y)

    elif mtype == "mouse_btn":
        btn = str(msg.get("button", "left"))
        action = str(msg.get("action", "click"))
        input_win.mouse_button(btn, action)

    elif mtype == "tap_abs":
        x = float(msg.get("x", 0.5))
        y = float(msg.get("y", 0.5))
        btn = str(msg.get("button", "left"))
        input_win.move_mouse_abs(x, y)
        input_win.mouse_button(btn, "click")

    elif mtype == "scroll":
        dy = int(round(float(msg.get("dy", 0))))
        dx = int(round(float(msg.get("dx", 0))))
        input_win.mouse_scroll(dy, dx)

    elif mtype == "key":
        key = str(msg.get("key", ""))
        if key:
            input_win.press_key(key)

    elif mtype == "hotkey":
        keys = msg.get("keys", [])
        if isinstance(keys, list) and keys:
            input_win.press_hotkey([str(k) for k in keys])

    elif mtype == "type":
        text = str(msg.get("text", ""))
        if text:
            input_win.type_unicode_text(text)

    elif mtype == "clipboard_set":
        text = str(msg.get("text", ""))
        pyperclip.copy(text)

    elif mtype == "clipboard_get":
        try:
            text = pyperclip.paste()
        except Exception:
            text = ""
        return {"type": "clipboard", "text": text}

    elif mtype == "open_url":
        url = str(msg.get("url", "")).strip()
        if url.startswith("http://") or url.startswith("https://"):
            webbrowser.open(url)
            return {"type": "toast", "message": "Đã mở link trên máy tính"}
        return {"type": "toast", "message": "URL phải bắt đầu bằng http:// hoặc https://"}

    elif mtype == "system":
        action = str(msg.get("action", ""))
        if action == "lock":
            input_win.lock_workstation()
        elif action == "minimize_all":
            input_win.press_hotkey(["win", "d"])
        elif action == "task_mgr":
            input_win.press_hotkey(["ctrl", "shift", "esc"])
        elif action == "sleep":
            subprocess.Popen(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
        elif action == "shutdown":
            subprocess.Popen(["shutdown", "/s", "/t", "5"])
        elif action == "restart":
            subprocess.Popen(["shutdown", "/r", "/t", "5"])
        elif action == "cancel_shutdown":
            subprocess.Popen(["shutdown", "/a"])

    return None


@app.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    token: str | None = Query(default=None),
    acct: str | None = Query(default=None),
):
    if not _verify_full_access(acct, token):
        await ws.close(code=4401)
        return

    await ws.accept()

    stream_cfg = {
        "enabled": False,
        "fps": 12,
        "quality": 60,
        "max_width": 1024,
    }
    stop_event = asyncio.Event()

    async def stream_loop():
        while not stop_event.is_set():
            if not stream_cfg["enabled"]:
                await asyncio.sleep(0.1)
                continue
            t0 = time.perf_counter()
            try:
                frame = await asyncio.to_thread(
                    _capture_jpeg,
                    stream_cfg["max_width"],
                    stream_cfg["quality"],
                    True,
                )
                await ws.send_bytes(frame)
            except Exception:
                break
            interval = 1.0 / max(1, min(30, stream_cfg["fps"]))
            elapsed = time.perf_counter() - t0
            await asyncio.sleep(max(0.01, interval - elapsed))

    stream_task = asyncio.create_task(stream_loop())

    try:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            if msg.get("type") == "stream_cfg":
                stream_cfg["enabled"] = bool(msg.get("enabled", stream_cfg["enabled"]))
                if "fps" in msg:
                    stream_cfg["fps"] = max(1, min(25, int(msg["fps"])))
                if "quality" in msg:
                    stream_cfg["quality"] = max(20, min(90, int(msg["quality"])))
                if "max_width" in msg:
                    stream_cfg["max_width"] = max(480, min(1920, int(msg["max_width"])))
                continue

            reply = await asyncio.to_thread(_handle_control_message, msg)
            if reply:
                await ws.send_json(reply)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        stop_event.set()
        stream_task.cancel()


def main():
    global PIN_CODE, SERVER_PORT, LAN_IP, PUBLIC_DOMAIN
    parser = argparse.ArgumentParser(description="Remote PC Control via Mobile Chrome")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--pin", default=os.environ.get("REMOTE_PIN", ""))
    parser.add_argument("--domain", default=os.environ.get("REMOTE_DOMAIN", ""))
    parser.add_argument("--open-host", action="store_true", help="Open localhost dashboard in PC browser")
    args = parser.parse_args()

    PIN_CODE = args.pin.strip() if args.pin.strip() else f"{secrets.randbelow(900000) + 100000}"
    SERVER_PORT = args.port
    LAN_IP = detect_lan_ip()
    PUBLIC_DOMAIN = args.domain.strip().removeprefix("https://").removeprefix("http://").rstrip("/")

    lan_url = f"http://{LAN_IP}:{SERVER_PORT}"
    host_url = f"http://127.0.0.1:{SERVER_PORT}/host"

    print("\n" + "=" * 56)
    print("  DIEU KHIEN MAY TINH QUA CHROME DIEN THOAI")
    print("=" * 56)
    if PUBLIC_DOMAIN:
        print(f"  1. Mo Chrome tren dien thoai va truy cap:")
        print(f"     ->  https://{PUBLIC_DOMAIN}")
        print(f"     (Hoac LAN: {lan_url})")
    else:
        print(f"  1. Ket noi dien thoai & may tinh CUNG MANG Wi-Fi")
        print(f"  2. Mo Chrome tren dien thoai va truy cap:")
        print(f"     ->  {lan_url}")
    print(f"  Ma PIN ket noi:  {PIN_CODE}")
    print(f"  Trang thong tin tren PC: {host_url}")
    print("=" * 56 + "\n")

    if args.open_host:
        webbrowser.open(host_url)

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
