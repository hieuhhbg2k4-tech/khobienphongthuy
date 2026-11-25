"""Native Windows input & system control using user32.dll (DPI-aware)."""

import ctypes
from ctypes import wintypes
import time

# Make process DPI-aware so GetSystemMetrics returns physical pixels
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PROCESS_PER_MONITOR_DPI_AWARE
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

user32 = ctypes.windll.user32

# Constants
INPUT_MOUSE = 0
INPUT_KEYBOARD = 1

MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_HWHEEL = 0x1000
MOUSEEVENTF_ABSOLUTE = 0x8000

KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004

SM_CXSCREEN = 0
SM_CYSCREEN = 1

ULONG_PTR = ctypes.POINTER(ctypes.c_ulong)


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wintypes.LONG),
        ("dy", wintypes.LONG),
        ("mouseData", wintypes.DWORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wintypes.WORD),
        ("wScan", wintypes.WORD),
        ("dwFlags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wintypes.DWORD),
        ("wParamL", wintypes.WORD),
        ("wParamH", wintypes.WORD),
    ]


class _INPUT_UNION(ctypes.Union):
    _fields_ = [
        ("mi", MOUSEINPUT),
        ("ki", KEYBDINPUT),
        ("hi", HARDWAREINPUT),
    ]


class INPUT(ctypes.Structure):
    _fields_ = [
        ("type", wintypes.DWORD),
        ("union", _INPUT_UNION),
    ]


# Virtual key map for special keys & shortcuts
VK_MAP = {
    "backspace": 0x08,
    "tab": 0x09,
    "enter": 0x0D,
    "return": 0x0D,
    "shift": 0x10,
    "ctrl": 0x11,
    "control": 0x11,
    "alt": 0x12,
    "pause": 0x13,
    "capslock": 0x14,
    "esc": 0x1B,
    "escape": 0x1B,
    "space": 0x20,
    "pageup": 0x21,
    "pagedown": 0x22,
    "end": 0x23,
    "home": 0x24,
    "left": 0x25,
    "up": 0x26,
    "right": 0x27,
    "down": 0x28,
    "printscreen": 0x2C,
    "insert": 0x2D,
    "delete": 0x2E,
    "del": 0x2E,
    "win": 0x5B,
    "lwin": 0x5B,
    "f1": 0x70,
    "f2": 0x71,
    "f3": 0x72,
    "f4": 0x73,
    "f5": 0x74,
    "f6": 0x75,
    "f7": 0x76,
    "f8": 0x77,
    "f9": 0x78,
    "f10": 0x79,
    "f11": 0x7A,
    "f12": 0x7B,
    "vol_mute": 0xAD,
    "vol_down": 0xAE,
    "vol_up": 0xAF,
    "media_next": 0xB0,
    "media_prev": 0xB1,
    "media_stop": 0xB2,
    "media_play": 0xB3,
}

EXTENDED_VKS = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x5B, 0xAD, 0xAE, 0xAF, 0xB0, 0xB1, 0xB2, 0xB3}


def get_screen_size() -> tuple[int, int]:
    return user32.GetSystemMetrics(SM_CXSCREEN), user32.GetSystemMetrics(SM_CYSCREEN)


def get_cursor_pos() -> tuple[int, int]:
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    return pt.x, pt.y


def _send_inputs(inputs: list[INPUT]) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT))


def move_mouse_rel(dx: int, dy: int) -> None:
    if dx == 0 and dy == 0:
        return
    inp = INPUT(type=INPUT_MOUSE)
    inp.union.mi = MOUSEINPUT(dx=int(dx), dy=int(dy), mouseData=0, dwFlags=MOUSEEVENTF_MOVE, time=0, dwExtraInfo=0)
    _send_inputs([inp])


def move_mouse_abs(x_norm: float, y_norm: float) -> None:
    x_norm = max(0.0, min(1.0, x_norm))
    y_norm = max(0.0, min(1.0, y_norm))
    abs_x = int(x_norm * 65535)
    abs_y = int(y_norm * 65535)
    inp = INPUT(type=INPUT_MOUSE)
    inp.union.mi = MOUSEINPUT(
        dx=abs_x,
        dy=abs_y,
        mouseData=0,
        dwFlags=MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
        time=0,
        dwExtraInfo=0,
    )
    _send_inputs([inp])


def mouse_button(button: str, action: str) -> None:
    """button: 'left' | 'right' | 'middle'; action: 'down' | 'up' | 'click' | 'dblclick'."""
    btn_flags = {
        "left": (MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP),
        "right": (MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP),
        "middle": (MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP),
    }.get(button)
    if not btn_flags:
        return
    down_flag, up_flag = btn_flags

    if action == "down":
        inp = INPUT(type=INPUT_MOUSE)
        inp.union.mi = MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=down_flag, time=0, dwExtraInfo=0)
        _send_inputs([inp])
    elif action == "up":
        inp = INPUT(type=INPUT_MOUSE)
        inp.union.mi = MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=up_flag, time=0, dwExtraInfo=0)
        _send_inputs([inp])
    elif action == "click":
        d = INPUT(type=INPUT_MOUSE)
        d.union.mi = MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=down_flag, time=0, dwExtraInfo=0)
        u = INPUT(type=INPUT_MOUSE)
        u.union.mi = MOUSEINPUT(dx=0, dy=0, mouseData=0, dwFlags=up_flag, time=0, dwExtraInfo=0)
        _send_inputs([d, u])
    elif action == "dblclick":
        mouse_button(button, "click")
        time.sleep(0.05)
        mouse_button(button, "click")


def mouse_scroll(dy: int, dx: int = 0) -> None:
    inputs = []
    if dy != 0:
        inp = INPUT(type=INPUT_MOUSE)
        inp.union.mi = MOUSEINPUT(dx=0, dy=0, mouseData=int(dy) & 0xFFFFFFFF, dwFlags=MOUSEEVENTF_WHEEL, time=0, dwExtraInfo=0)
        inputs.append(inp)
    if dx != 0:
        inp = INPUT(type=INPUT_MOUSE)
        inp.union.mi = MOUSEINPUT(dx=0, dy=0, mouseData=int(dx) & 0xFFFFFFFF, dwFlags=MOUSEEVENTF_HWHEEL, time=0, dwExtraInfo=0)
        inputs.append(inp)
    if inputs:
        _send_inputs(inputs)


def _resolve_vk(key: str) -> int | None:
    k = key.lower().strip()
    if k in VK_MAP:
        return VK_MAP[k]
    if len(k) == 1:
        # ASCII letter or digit
        code = ord(k.upper())
        if (0x30 <= code <= 0x39) or (0x41 <= code <= 0x5A):
            return code
    return None


def press_key(key: str) -> None:
    vk = _resolve_vk(key)
    if vk is None:
        return
    ext = KEYEVENTF_EXTENDEDKEY if vk in EXTENDED_VKS else 0
    down = INPUT(type=INPUT_KEYBOARD)
    down.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=ext, time=0, dwExtraInfo=0)
    up = INPUT(type=INPUT_KEYBOARD)
    up.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=ext | KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
    _send_inputs([down, up])


def press_hotkey(keys: list[str]) -> None:
    vks = [vk for k in keys if (vk := _resolve_vk(k)) is not None]
    if not vks:
        return
    downs = []
    ups = []
    for vk in vks:
        ext = KEYEVENTF_EXTENDEDKEY if vk in EXTENDED_VKS else 0
        d = INPUT(type=INPUT_KEYBOARD)
        d.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=ext, time=0, dwExtraInfo=0)
        downs.append(d)
    for vk in reversed(vks):
        ext = KEYEVENTF_EXTENDEDKEY if vk in EXTENDED_VKS else 0
        u = INPUT(type=INPUT_KEYBOARD)
        u.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=ext | KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
        ups.append(u)
    _send_inputs(downs + ups)


def type_unicode_text(text: str) -> None:
    """Type arbitrary Unicode text (including Vietnamese) via KEYEVENTF_UNICODE."""
    if not text:
        return
    inputs: list[INPUT] = []
    for ch in text:
        if ch == "\n":
            vk = VK_MAP["enter"]
            d = INPUT(type=INPUT_KEYBOARD)
            d.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=0, time=0, dwExtraInfo=0)
            u = INPUT(type=INPUT_KEYBOARD)
            u.union.ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
            inputs.extend([d, u])
            continue
        if ch == "\r":
            continue
        code_units = ch.encode("utf-16-le")
        for i in range(0, len(code_units), 2):
            unit = int.from_bytes(code_units[i : i + 2], "little")
            d = INPUT(type=INPUT_KEYBOARD)
            d.union.ki = KEYBDINPUT(wVk=0, wScan=unit, dwFlags=KEYEVENTF_UNICODE, time=0, dwExtraInfo=0)
            u = INPUT(type=INPUT_KEYBOARD)
            u.union.ki = KEYBDINPUT(wVk=0, wScan=unit, dwFlags=KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, time=0, dwExtraInfo=0)
            inputs.extend([d, u])
    if inputs:
        # Send in chunks to avoid huge SendInput batches
        chunk_size = 64
        for i in range(0, len(inputs), chunk_size):
            _send_inputs(inputs[i : i + chunk_size])


def lock_workstation() -> None:
    user32.LockWorkStation()
