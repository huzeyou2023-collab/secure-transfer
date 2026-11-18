import os
import sys
import math
import re
import json
import time
import ctypes
import ctypes.wintypes
import socket
import struct
import secrets
import threading
import queue
import shutil
import hashlib
import base64
import tempfile
import traceback
import urllib.request
import urllib.parse
from pathlib import Path
import tkinter as tk
from tkinter import ttk, filedialog, messagebox, simpledialog, scrolledtext

try:
    from tkinterdnd2 import TkinterDnD, DND_FILES
    HAS_DND = True
except Exception:
    HAS_DND = False

from cryptography.hazmat.primitives.asymmetric import x25519
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageTk, ImageChops

VERSION = "V3.3"
CHUNK = 65536
ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"

if sys.platform == "win32":
    from ctypes import wintypes as _wt
    _u, _g = ctypes.windll.user32, ctypes.windll.gdi32
    _s, _d = ctypes.windll.shell32, ctypes.windll.dwmapi
    _k = ctypes.windll.kernel32
    _L, _P = ctypes.c_long, ctypes.c_void_p
    _u.RegisterClassW.argtypes = [_P]
    _u.CreateWindowExW.argtypes = [
        _wt.DWORD, _wt.LPCWSTR, _wt.LPCWSTR, _wt.DWORD, ctypes.c_int,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, _wt.HWND, _wt.HMENU,
        _wt.HINSTANCE, _P]
    _u.CreateWindowExW.restype = _wt.HWND
    for _f in (_u.GetWindowRect, _u.GetClientRect, _u.GetMonitorInfoW):
        _f.argtypes = [_wt.HWND, _P]
    _u.MonitorFromWindow.argtypes = [_wt.HWND, _wt.DWORD]
    _u.MonitorFromWindow.restype = _wt.HMONITOR
    _u.GetWindowLongW.argtypes = [_wt.HWND, ctypes.c_int]
    _u.GetWindowLongW.restype = _L
    _u.SetWindowLongW.argtypes = [_wt.HWND, ctypes.c_int, _L]
    _u.SetWindowLongW.restype = _L
    _u.SetWindowRgn.argtypes = [_wt.HWND, _wt.HRGN, _wt.BOOL]
    _u.SetWindowPos.argtypes = [
        _wt.HWND, _wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        ctypes.c_int, _wt.UINT]
    _u.ShowWindow.argtypes = [_wt.HWND, ctypes.c_int]
    _u.SetLayeredWindowAttributes.argtypes = [
        _wt.HWND, _wt.COLORREF, _wt.BYTE, _wt.DWORD]
    _u.UpdateLayeredWindow.argtypes = [
        _wt.HWND, _wt.HDC, _P, _P, _wt.HDC, _P, _wt.COLORREF, _P, _wt.DWORD]
    _u.GetDC.argtypes = [_wt.HWND]
    _u.GetDC.restype = _wt.HDC
    _u.ReleaseDC.argtypes = [_wt.HWND, _wt.HDC]
    _u.PrintWindow.argtypes = [_wt.HWND, _wt.HDC, _wt.UINT]
    _u.GetParent.argtypes = [_wt.HWND]
    _u.GetParent.restype = _wt.HWND
    _u.SendMessageW.argtypes = [_wt.HWND, _wt.UINT, _wt.WPARAM, _wt.LPARAM]
    _u.SendMessageW.restype = _L
    _u.PostMessageW.argtypes = [_wt.HWND, _wt.UINT, _wt.WPARAM, _wt.LPARAM]
    _u.ReleaseCapture.argtypes = []
    for _f in (_u.IsIconic, _u.IsZoomed, _u.IsWindowVisible):
        _f.argtypes = [_wt.HWND]
    _u.FindWindowW.argtypes = [_wt.LPCWSTR, _wt.LPCWSTR]
    _u.FindWindowW.restype = _wt.HWND
    _u.SetForegroundWindow.argtypes = [_wt.HWND]
    _u.GetForegroundWindow.restype = _wt.HWND
    _u.GetWindowThreadProcessId.argtypes = [_wt.HWND, _P]
    _u.GetWindowThreadProcessId.restype = _wt.DWORD
    _u.AttachThreadInput.argtypes = [_wt.DWORD, _wt.DWORD, _wt.BOOL]
    _u.LoadCursorW.argtypes = [_wt.HINSTANCE, ctypes.c_void_p]
    _u.LoadCursorW.restype = ctypes.c_void_p
    _g.CreateCompatibleDC.argtypes = [_wt.HDC]
    _g.CreateCompatibleDC.restype = _wt.HDC
    _g.DeleteDC.argtypes = [_wt.HDC]
    _g.CreateDIBSection.argtypes = [
        _wt.HDC, _P, _wt.UINT, _P, _wt.HANDLE, _wt.DWORD]
    _g.CreateDIBSection.restype = _wt.HBITMAP
    _g.SelectObject.argtypes = [_wt.HDC, _wt.HGDIOBJ]
    _g.SelectObject.restype = _wt.HGDIOBJ
    _g.DeleteObject.argtypes = [_wt.HGDIOBJ]
    _g.CreatePolygonRgn.argtypes = [_P, ctypes.c_int, ctypes.c_int]
    _g.CreatePolygonRgn.restype = _wt.HRGN
    _g.BitBlt.argtypes = [
        _wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        _wt.HDC, ctypes.c_int, ctypes.c_int, _wt.DWORD]
    _g.StretchBlt.argtypes = [
        _wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        _wt.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        _wt.DWORD]
    _g.SetStretchBltMode.argtypes = [_wt.HDC, ctypes.c_int]
    _s.SHAppBarMessage.argtypes = [_wt.DWORD, _P]
    _s.SHAppBarMessage.restype = ctypes.c_size_t
    _d.DwmSetWindowAttribute.argtypes = [
        _wt.HWND, _wt.DWORD, _P, _wt.DWORD]
    _d.DwmExtendFrameIntoClientArea.argtypes = [_wt.HWND, _P]
    _d.DwmFlush.argtypes = []
    _k.GetModuleHandleW.argtypes = [_wt.LPCWSTR]
    _k.GetModuleHandleW.restype = _wt.HMODULE


class BMIH(ctypes.Structure):
    _fields_ = [("biSize", ctypes.wintypes.DWORD),
                ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
                ("biPlanes", ctypes.wintypes.WORD),
                ("biBitCount", ctypes.wintypes.WORD),
                ("biCompression", ctypes.wintypes.DWORD),
                ("biSizeImage", ctypes.wintypes.DWORD),
                ("biXPelsPerMeter", ctypes.c_long),
                ("biYPelsPerMeter", ctypes.c_long),
                ("biClrUsed", ctypes.wintypes.DWORD),
                ("biClrImportant", ctypes.wintypes.DWORD)]


class BLEND(ctypes.Structure):
    _fields_ = [("op", ctypes.c_byte), ("flags", ctypes.c_byte),
                ("alpha", ctypes.c_byte), ("fmt", ctypes.c_byte)]


class LPT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

if sys.platform == "win32":
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def _writable(p):
    try:
        t = p / ".wtest"
        t.write_bytes(b"1")
        t.unlink()
        return True
    except Exception:
        return False


if getattr(sys, "frozen", False):
    _exe_dir = Path(sys.executable).resolve().parent
    APP_DIR = _exe_dir if _writable(_exe_dir) else \
        Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "安全传输"
else:
    APP_DIR = Path(__file__).resolve().parent
try:
    APP_DIR.mkdir(parents=True, exist_ok=True)
except Exception:
    APP_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "安全传输"
    APP_DIR.mkdir(parents=True, exist_ok=True)
RECV_DIR = APP_DIR / "接收文件"

SCALE = 1.0
UI_FONT = "Microsoft YaHei UI"
MONO_FONT = "Consolas"


def sp(x):
    return int(round(x * SCALE))


THEMES = {
    "macaron": {
        "bg": (240, 242, 247), "fill": (250, 250, 252), "chat": (253, 253, 254),
        "ink": (88, 92, 106), "muted": (166, 170, 182),
        "accent": (178, 204, 241), "accent_d": (146, 178, 226),
        "green": (172, 210, 184), "danger": (224, 140, 148),
        "t_blue": (183, 207, 242), "t_pink": (247, 214, 221),
        "t_purple": (223, 214, 242), "t_yellow": (248, 234, 198),
        "t_green": (207, 231, 214)},
    "mono": {
        "bg": (234, 234, 236), "fill": (249, 249, 250), "chat": (255, 255, 255),
        "ink": (28, 28, 32), "muted": (140, 140, 146),
        "accent": (120, 120, 126), "accent_d": (86, 86, 92),
        "green": (128, 128, 134), "danger": (186, 96, 96),
        "t_blue": (226, 226, 230), "t_pink": (232, 228, 230),
        "t_purple": (222, 222, 226), "t_yellow": (238, 238, 240),
        "t_green": (224, 224, 228)},
    "vivid": {
        "bg": (233, 239, 252), "fill": (255, 255, 255), "chat": (248, 250, 255),
        "ink": (30, 42, 74), "muted": (100, 116, 146),
        "accent": (66, 126, 255), "accent_d": (36, 96, 230),
        "green": (26, 184, 102), "danger": (230, 66, 80),
        "t_blue": (120, 168, 255), "t_pink": (255, 150, 170),
        "t_purple": (178, 150, 250), "t_yellow": (255, 214, 110),
        "t_green": (110, 220, 150)},
    "lux": {
        "bg": (235, 230, 218), "fill": (248, 245, 235), "chat": (252, 250, 243),
        "ink": (102, 86, 54), "muted": (176, 162, 134),
        "accent": (208, 170, 92), "accent_d": (178, 142, 70),
        "green": (184, 200, 150), "danger": (206, 138, 120),
        "t_blue": (226, 228, 234), "t_pink": (244, 224, 214),
        "t_purple": (230, 220, 234), "t_yellow": (246, 232, 192),
        "t_green": (220, 232, 206), "t_gold": (240, 222, 178),
        "rim": (255, 248, 226), "shadow": (96, 74, 32, 70),
        "on_accent": (255, 252, 244)},
}
P = THEMES["macaron"]

b64e = lambda b: base64.b64encode(b).decode()
b64d = lambda s: base64.b64decode(s)


def excepthook(et, e, tb):
    try:
        (APP_DIR / "error.log").write_text("".join(traceback.format_exception(et, e, tb)), encoding="utf-8")
    except Exception:
        pass


sys.excepthook = excepthook


def gen_id():
    return "".join(secrets.choice(ID_ALPHABET) for _ in range(8))


def hx(c):
    return "#%02x%02x%02x" % c


def mix(c, t, k):
    return tuple(int(a + (b - a) * k) for a, b in zip(c, t))


def pil_font(px):
    root = os.environ.get("WINDIR", r"C:\Windows")
    for name in ("msyhbd.ttc", "msyh.ttc", "segoeuib.ttf", "segoeui.ttf",
                 "arialbd.ttf", "arial.ttf"):
        q = Path(root) / "Fonts" / name
        try:
            if q.exists():
                return ImageFont.truetype(str(q), px)
        except Exception:
            pass
    return ImageFont.load_default()


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return f"{n:.1f}{u}" if u != "B" else f"{n}B"
        n /= 1024


EXP_UI = 4.4
EXP_TL = 3.4


EXP_WIN = 4.2


def squircle_rect_pts(w, h, r, n=EXP_WIN, seg=None):
    r = max(0.0, min(r, w/2 - 1, h/2 - 1))
    if r <= 1:
        return [(0, 0), (w-1, 0), (w-1, h-1), (0, h-1)]
    if not seg:
        seg = max(28, int(2*r/3))
    e = 2.0/n
    pts = []
    corners = ((w-r, r, -math.pi/2, 0),
               (w-r, h-r, 0, math.pi/2),
               (r, h-r, math.pi/2, math.pi),
               (r, r, math.pi, 3*math.pi/2))
    for cx, cy, a0, a1 in corners:
        for i in range(seg + 1):
            t = a0 + (a1-a0)*i/seg
            ct, st = math.cos(t), math.sin(t)
            pts.append((cx + r*math.copysign(abs(ct)**e, ct),
                        cy + r*math.copysign(abs(st)**e, st)))
    return pts[:-1]


def ss_factor(w=1, h=1, cap=45_000_000):
    f = max(1, int(round(3.0 / max(SCALE, 1e-6))))
    while f > 1 and (w*f)*(h*f) > cap:
        f -= 1
    return f


def sq_path(box, r, exp, seg=None):
    x1, y1, x2, y2 = box
    w, h = x2-x1, y2-y1
    pts = squircle_rect_pts(w, h, r, exp, seg)
    return [(x1+x, y1+y) for x, y in pts]


def _blurred_poly(size, pts, color, blur):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).polygon(pts, fill=color)
    return layer.filter(ImageFilter.GaussianBlur(max(1, blur)))


def glass_shape(w, h, r, fill, surface, exp=EXP_UI, pressed=False, shadow=True,
                flat=False, glowc=None):
    ss = ss_factor(w, h)
    W, H = w*ss, h*ss
    canvas = Image.new("RGBA", (W, H), surface+(255,))
    m = max(2*ss, int(round(min(w, h)*.13*ss)))
    m = min(m, int(round(sp(10)*ss)))
    box = (m, m, W-m, H-m)
    bw, bh = box[2]-box[0], box[3]-box[1]
    rr = max(0.0, min(r*ss, bw/2-1.5, bh/2-1.5))
    nseg = max(56, int(rr*1.6))
    pts = sq_path(box, rr, exp, nseg)
    fmask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(fmask).polygon(pts, fill=255)
    recessed = pressed or flat
    d = min(max(1.5*ss, h*.15*ss), sp(10)*ss)
    blur = min(max(1, h*.17*ss), sp(12)*ss)
    if not recessed:
        dark = _blurred_poly((W, H), [(x+d, y+d) for x, y in pts],
                             mix(surface, (0, 0, 0), .18)+(95,), blur)
        light = _blurred_poly((W, H), [(x-d, y-d) for x, y in pts],
                              mix(surface, (255, 255, 255), .95)+(125,), blur)
        canvas = Image.alpha_composite(canvas, dark)
        canvas = Image.alpha_composite(canvas, light)
    face = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fc = mix(fill, (0, 0, 0), .05) if recessed else fill
    ImageDraw.Draw(face).polygon(pts, fill=fc+(255,))
    if recessed:
        idk = _blurred_poly((W, H), [(x-d/2, y-d/2) for x, y in pts],
                            (0, 0, 0, 100), blur*.7)
        ilt = _blurred_poly((W, H), [(x+d/2, y+d/2) for x, y in pts],
                            (255, 255, 255, 120), blur*.7)
        idk.putalpha(ImageChops.multiply(idk.getchannel("A"), fmask))
        ilt.putalpha(ImageChops.multiply(ilt.getchannel("A"), fmask))
        face = Image.alpha_composite(face, idk)
        face = Image.alpha_composite(face, ilt)
    else:
        grad = Image.new("L", (1, bh), 0)
        gp = grad.load()
        for i in range(bh):
            gp[0, i] = int(92*(1-i/max(1, bh-1))**1.8)
        sheen = Image.new("L", (W, H), 0)
        sheen.paste(grad, (box[0], box[1]))
        white = Image.new("RGBA", (W, H), (255, 255, 255, 0))
        white.putalpha(ImageChops.multiply(sheen, fmask))
        face = Image.alpha_composite(face, white)
    rim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    if recessed:
        rimc, rima = mix(fill, (0, 0, 0), .3), 120
    else:
        rimc, rima = (glowc or (255, 255, 255)), 150
    ImageDraw.Draw(rim).line(pts+[pts[0]], fill=rimc+(rima,),
                             width=max(1, int(.9*ss)), joint="curve")
    rim.putalpha(ImageChops.multiply(
        rim.getchannel("A"), fmask.filter(ImageFilter.MinFilter(3))))
    face = Image.alpha_composite(face, rim)
    canvas = Image.alpha_composite(canvas, face)
    return canvas.resize((w, h), Image.LANCZOS)


def recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        part = sock.recv(n - len(buf))
        if not part:
            raise ConnectionError("连接断开")
        buf += part
    return bytes(buf)


def send_frame(sock, data):
    sock.sendall(struct.pack(">I", len(data)) + data)


def recv_frame(sock):
    return recv_exact(sock, struct.unpack(">I", recv_exact(sock, 4))[0])


def norm_host(h):
    return h[7:] if h.startswith("::ffff:") else h


def local_addrs():
    r = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("223.5.5.5", 80))
        r.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        s = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
        s.connect(("2400:3200::1", 80))
        r.append(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return r


def make_listener(port):
    s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    except Exception:
        pass
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("", port))
    s.listen(32)
    return s


def rand_perm():
    p = list(range(256))
    for i in range(255, 0, -1):
        j = int.from_bytes(os.urandom(1), "little") % (i + 1)
        p[i], p[j] = p[j], p[i]
    return bytes(p)


def merge_tables(my_pub, my_perm, my_base, peer_pub, peer_perm, peer_base):
    if my_pub < peer_pub:
        lo, hi = my_perm, peer_perm
    else:
        lo, hi = peer_perm, my_perm
    perm = bytes(hi[lo[i]] for i in range(256))
    inv = bytes(perm.index(i) for i in range(256))
    base = bytes(a ^ b for a, b in zip(my_base, peer_base))
    return perm, inv, base


class NeuButton:
    def __init__(self, parent, app, text, cmd, kind="soft", w=120, h=36, fs=10, tint=None):
        self.app, self.kind, self.cmd, self.text = app, kind, cmd, text
        self.tint, self.w, self.h, self.fs = tint, w, h, fs
        self.hover = self.pressed = False
        self.parent = parent
        self.cv = tk.Canvas(parent, width=w, height=h, highlightthickness=0,
                            bg=hx(self._surface()), bd=0)
        self._photo = None
        self._img = self.cv.create_image(0, 0, anchor="nw")
        self._txt = self.cv.create_text(w/2, h/2)
        self.redraw()
        self.cv.bind("<ButtonPress-1>", self._press)
        self.cv.bind("<ButtonRelease-1>", self._release)
        self.cv.bind("<Enter>", lambda _e: self._set_hover(True))
        self.cv.bind("<Leave>", lambda _e: self._set_hover(False))
        app.redrawers.append(self)

    def _surface(self):
        h = self.parent.cget("bg")
        return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))

    def _press(self, _e):
        self.pressed = True
        self.redraw()

    def _release(self, _e):
        self.pressed = False
        self.redraw()
        if self.cmd:
            self.cmd()

    def _set_hover(self, v):
        a = self.app
        if getattr(a, "_moving", False) or getattr(a, "_resizing", False):
            return
        self.hover = v
        self.redraw()

    def _base_fill(self, p):
        if self.kind == "primary":
            return p["accent"]
        if self.kind == "pastel" or self.kind == "tlight":
            return p.get(self.tint or "t_blue")
        if self.kind == "danger":
            return mix(p["danger"], (255, 255, 255), .5)
        return mix(p["fill"], (255, 255, 255), .55)

    def redraw(self):
        p = self.app.pal()
        surface = self._surface()
        self.cv.configure(bg=hx(surface))
        fill = self._base_fill(p)
        if self.hover and not self.pressed:
            fill = mix(fill, (255, 255, 255), .1)
        exp = EXP_TL if self.kind == "tlight" else EXP_UI
        r = self.h*(.34 if self.kind == "tlight" else .30)
        img = glass_shape(self.w, self.h, r, fill, surface, exp, self.pressed,
                          glowc=p.get("rim"))
        self._photo = ImageTk.PhotoImage(img, master=self.cv)
        self.cv.itemconfigure(self._img, image=self._photo)
        if self.kind == "primary" and p.get("on_accent"):
            fg = p["on_accent"]
        else:
            fg = mix(p["accent_d"], (0, 0, 0), .08) if self.kind == "ghost" \
                else mix(fill, (0, 0, 0), .34)
        self.cv.itemconfigure(
            self._txt, text=self.text, fill=hx(fg),
            font=(UI_FONT, self.fs,
                  "bold" if self.kind in ("primary", "tlight") else "normal"))


class Avatar:
    def __init__(self, parent, app, size=52):
        self.app, self.size, self.ch = app, size, "?"
        self.parent = parent
        self.cv = tk.Canvas(parent, width=size, height=size, highlightthickness=0,
                            bg=hx(self._surface()), bd=0)
        self._photo = None
        self.cv.create_image(0, 0, anchor="nw")
        app.redrawers.append(self)

    def _surface(self):
        h = self.parent.cget("bg")
        return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))

    def draw(self, ch):
        self.ch = ch
        self.redraw()

    def redraw(self):
        p = self.app.pal()
        surface = self._surface()
        self.cv.configure(bg=hx(surface))
        s = self.size
        ss = ss_factor(s, s)
        S = s*ss
        img = Image.new("RGBA", (S, S), surface+(255,))
        m = Image.new("L", (S, S), 0)
        ImageDraw.Draw(m).ellipse((1, 1, S-2, S-2), fill=255)
        ac, acd = p["accent"], p["accent_d"]
        grad = Image.new("RGB", (1, S))
        gp = grad.load()
        for i in range(S):
            gp[0, i] = mix(acd, ac, 1-i/max(1, S-1))
        disc = Image.composite(grad.resize((S, S)).convert("RGBA"),
                               Image.new("RGBA", (S, S), (0, 0, 0, 0)), m)
        hl = Image.new("L", (S, S), 0)
        ImageDraw.Draw(hl).ellipse((S*.18, S*.12, S*.72, S*.46), fill=120)
        white = Image.new("RGBA", (S, S), (255, 255, 255, 0))
        white.putalpha(hl)
        disc = Image.alpha_composite(disc, white)
        rim = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(rim).ellipse(
            (1, 1, S-2, S-2),
            outline=mix(acd, (255, 255, 255), .5)+(180,),
            width=max(1, int(ss)))
        disc = Image.alpha_composite(disc, rim)
        img = Image.alpha_composite(img, disc)
        ft = pil_font(int(S*.42))
        d = ImageDraw.Draw(img)
        bb = d.textbbox((0, 0), self.ch, font=ft)
        tw, th = bb[2]-bb[0], bb[3]-bb[1]
        d.text((S/2-tw/2-bb[0], S/2-th/2-bb[1]), self.ch,
               font=ft, fill=(255, 255, 255, 245))
        img = img.resize((s, s), Image.LANCZOS)
        self._photo = ImageTk.PhotoImage(img, master=self.cv)
        self.cv.itemconfigure(1, image=self._photo)


class Session:
    def __init__(self, app, sock, outbound):
        self.app = app
        self.sock = sock
        self.outbound = outbound
        self.alive = True
        self.sendq = queue.Queue()
        self.ready_evt = threading.Event()
        self.wlock = threading.Lock()
        self.priv = x25519.X25519PrivateKey.generate()
        self.my_pub = self.priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
        self.my_perm = rand_perm()
        self.my_base = os.urandom(32)
        self.perm = self.inv = self.base = None
        self.sctr = self.rctr = 0
        self.host = norm_host(sock.getpeername()[0])
        self.pname = None
        self.puid = None
        self.pport = None
        self.accepted = True if outbound else None
        self.infiles = {}
        self.fwait = {}
        self.out_keys = {}
        self.last_recv = time.monotonic()
        try:
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
        except Exception:
            pass

    def start(self):
        threading.Thread(target=self.run, daemon=True).start()

    def _seal(self, pt):
        nonce = self.sctr.to_bytes(12, "big")
        self.sctr += 1
        return self.gcm.encrypt(nonce, pt, None)

    def _open(self, ct):
        nonce = self.rctr.to_bytes(12, "big")
        self.rctr += 1
        return self.gcm.decrypt(nonce, ct, None)

    def _handshake(self):
        hello = json.dumps({"pub": b64e(self.my_pub)}, separators=(",", ":")).encode()
        if self.outbound:
            send_frame(self.sock, b"H"+hello)
            raw = recv_frame(self.sock)
        else:
            raw = recv_frame(self.sock)
            send_frame(self.sock, b"H"+hello)
        if raw[:1] != b"H":
            raise ConnectionError("握手失败")
        peer_pub = b64d(json.loads(raw[1:])["pub"])
        shared = self.priv.exchange(x25519.X25519PublicKey.from_public_bytes(peer_pub))
        lo, hi = sorted([self.my_pub, peer_pub])
        key = HKDF(algorithm=hashes.SHA256(), length=32,
                    salt=hashlib.sha256(lo+hi).digest(), info=b"ht-v1").derive(shared)
        self.gcm = AESGCM(key)
        self.peer_pub = peer_pub

    def _send_ctrl(self, obj):
        pt = b"J" + json.dumps(obj, separators=(",", ":")).encode()
        with self.wlock:
            send_frame(self.sock, self._seal(pt))

    def run(self):
        try:
            self._handshake()
            self._send_ctrl({"t": "id",
                             "n": self.app.settings.get("name") or socket.gethostname(),
                             "p": self.app.settings.get("port", 50090),
                             "id": self.app.uid})
            self._send_ctrl({"t": "tab", "pm": b64e(self.my_perm), "bs": b64e(self.my_base)})
            threading.Thread(target=self._writer, daemon=True).start()
            threading.Thread(target=self._heartbeat, daemon=True).start()
            while self.alive:
                frame = recv_frame(self.sock)
                self.last_recv = time.monotonic()
                self._dispatch(self._open(frame))
        except Exception:
            pass
        finally:
            self._close()

    def _heartbeat(self):
        while self.alive:
            time.sleep(15)
            if not self.alive:
                return
            try:
                if time.monotonic() - self.last_recv > 45:
                    raise OSError("心跳超时")
                self._send_ctrl({"t": "ping"})
            except Exception:
                self.alive = False
                try:
                    self.sock.close()
                except Exception:
                    pass

    def _check_ready(self):
        if self.puid and self.perm is not None and not self.ready_evt.is_set():
            self.ready_evt.set()
            self.app.event(("ready", self))

    def _haomi_enc(self, data):
        perm, base, n = self.perm, self.base, len(self.base)
        return bytes((perm[b] + base[i % n]) & 255 for i, b in enumerate(data))

    def _haomi_dec(self, data):
        inv, base, n = self.inv, self.base, len(self.base)
        return bytes(inv[(b - base[i % n]) & 255] for i, b in enumerate(data))

    def _dispatch(self, pt):
        if pt[:1] != b"J":
            if pt[:1] == b"F" and self.accepted:
                fid, seq = struct.unpack(">II", pt[1:9])
                info = self.infiles.get(fid)
                if info and seq == info["seq"]:
                    info["f"].write(pt[9:])
                    info["seq"] += 1
                    info["got"] += len(pt) - 9
                    if info["got"] - info["last"] >= 1048576:
                        info["f"].flush()
                    self._prog(info, False)
            return
        o = json.loads(pt[1:])
        t = o.get("t")
        if t == "ping":
            self._send_ctrl({"t": "pong"})
        elif t == "pong":
            pass
        elif t == "id":
            self.pname = o.get("n") or "对方"
            self.puid = o.get("id") or "UNKNOWN"
            self.pport = o.get("p")
            if self.outbound:
                self.app.upsert_contact(self.puid, self.pname, self.host, self.pport)
                self.accepted = True
            elif self.app.find_contact_by_id(self.puid):
                self.app.upsert_contact(self.puid, self.pname, self.host, self.pport)
                self.accepted = True
            self._check_ready()
            if self.accepted is None:
                self.app.event(("pair", self))
        elif t == "tab":
            self.perm, self.inv, self.base = merge_tables(
                self.my_pub, self.my_perm, self.my_base,
                self.peer_pub, b64d(o["pm"]), b64d(o["bs"]))
            self._check_ready()
        elif t == "bye":
            self.alive = False
        elif t == "fres":
            w = self.fwait.get(int(o["id"]))
            if w:
                w[1] = int(o["q"])
                w[0].set()
        elif t == "ack":
            tid = self.out_keys.pop(o.get("k"), None)
            if tid:
                self._del_outrec(tid)
            self.app.event(("ack", self, o.get("k")))
        elif t == "text" and self.accepted and self.ready_evt.is_set():
            raw = self._haomi_dec(b64d(o["d"]))
            self.app.event(("msg", self, raw.decode("utf-8", "replace")))
            self._send_ctrl({"t": "ack", "k": o.get("k")})
        elif t == "fbegin" and self.accepted:
            self._begin_recv(int(o["id"]), o.get("tid"), o["n"], int(o["s"]),
                             o.get("k"))
        elif t == "fend" and self.accepted:
            self._end_recv(int(o["id"]))

    def _safe_path(self, name):
        name = os.path.basename(name.replace("\\", "/")).strip() or "file"
        RECV_DIR.mkdir(parents=True, exist_ok=True)
        stem, suf = os.path.splitext(name)
        p, k = RECV_DIR / name, 1
        while p.exists():
            p = RECV_DIR / f"{stem}({k}){suf}"
            k += 1
        return p

    def _begin_recv(self, fid, tid, name, size, key):
        wd = APP_DIR / "传输中" / "incoming" / (tid or "") if tid else None
        data = wd / "data.bin" if wd else None
        f, seq0, resume = None, 0, False
        if wd and data.exists() and (wd/"meta.json").exists():
            try:
                m = json.loads((wd/"meta.json").read_text("utf-8"))
                if m.get("name") == name and int(m.get("size")) == size:
                    f = open(data, "r+b")
                    full = f.seek(0, 2) // CHUNK
                    f.truncate(full*CHUNK)
                    f.seek(full*CHUNK)
                    seq0, resume = full, True
            except Exception:
                f = None
        if not resume:
            if wd:
                shutil.rmtree(wd, ignore_errors=True)
                wd.mkdir(parents=True, exist_ok=True)
                f = open(data, "wb")
                (wd/"meta.json").write_text(
                    json.dumps({"name": name, "size": size, "key": key},
                               ensure_ascii=False), "utf-8")
            else:
                path = self._safe_path(name)
                f = open(path, "wb")
        got0 = seq0*CHUNK
        self.infiles[fid] = {"f": f, "wd": str(wd) if wd else "",
                             "path": "" if wd else str(path),
                             "name": name, "size": size, "got": got0, "seq": seq0,
                             "last": got0, "key": key}
        self._send_ctrl({"t": "fres", "id": fid, "q": seq0})
        self.app.event(("fbegin", self, name, size, seq0))

    def _prog(self, info, sending):
        if info["got"] - info["last"] >= 262144 or info["got"] >= info["size"]:
            info["last"] = info["got"]
            self.app.event(("prog", self, info["name"], info["got"], info["size"], sending))

    def _end_recv(self, fid):
        info = self.infiles.pop(fid, None)
        if not info:
            return
        info["f"].close()
        ok = info["got"] == info["size"]
        path = ""
        if ok:
            if info["wd"]:
                target = self._safe_path(info["name"])
                try:
                    shutil.move(str(Path(info["wd"])/"data.bin"), str(target))
                    shutil.rmtree(info["wd"], ignore_errors=True)
                    path = str(target)
                except Exception:
                    pass
            else:
                path = info.get("path", "")
        self.app.event(("fdone", self, info["name"], path, info["got"],
                        info["size"], info["key"]))
        if ok:
            self._send_ctrl({"t": "ack", "k": info["key"]})

    @staticmethod
    def _out_dir():
        return APP_DIR / "传输中" / "outgoing"

    def _save_outrec(self, rec):
        d = self._out_dir()
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{rec['tid']}.json").write_text(
            json.dumps(rec, ensure_ascii=False), "utf-8")

    def _del_outrec(self, tid):
        try:
            (self._out_dir() / f"{tid}.json").unlink()
        except Exception:
            pass

    def _writer(self):
        while self.alive:
            job = self.sendq.get()
            if job is None:
                return
            try:
                if job[0] in ("text", "file", "resume"):
                    while self.alive and not self.ready_evt.is_set():
                        self.ready_evt.wait(1)
                    if not self.alive:
                        return
                if job[0] == "text":
                    _, s, key = job
                    raw = self._haomi_enc(s.encode("utf-8"))
                    self._send_ctrl({"t": "text", "d": b64e(raw), "k": key})
                    self.app.event(("sent", self, key))
                elif job[0] == "file":
                    _, path, disp, cleanup, key = job
                    self._new_file(path, disp, cleanup, key)
                elif job[0] == "resume":
                    self._resume_file(job[1])
            except Exception as e:
                self.app.event(("ferr", self, job[-1] if job else None, str(e)))
                self.alive = False
                try:
                    self.sock.close()
                except Exception:
                    pass

    def _new_file(self, path, disp, cleanup, key):
        tid = secrets.token_hex(8)
        size = os.path.getsize(path)
        rec = {"tid": tid, "peer": self.puid, "path": path, "name": disp,
               "size": size, "key": key}
        self._save_outrec(rec)
        self.out_keys[key] = tid
        self._stream_file(rec, 0, cleanup)

    def _resume_file(self, rec):
        path = rec.get("path")
        try:
            if not path or not os.path.isfile(path) or \
                    os.path.getsize(path) != int(rec.get("size")):
                raise OSError("源文件不存在或已改变")
        except Exception as e:
            self._del_outrec(rec.get("tid"))
            self.app.event(("log", f"[系统] 断点续传失败（{rec.get('name')}）：{e}"))
            return
        self.out_keys[rec["key"]] = rec["tid"]
        self.app.event(("log", f"[系统] 断点续传：继续发送 {rec['name']} → {self.pname} #{self.puid}"))
        self._stream_file(rec, 1, False)

    def _stream_file(self, rec, resume, cleanup):
        tid, disp, size = rec["tid"], rec["name"], int(rec["size"])
        fid = int(tid[:8], 16)
        self._send_ctrl({"t": "fbegin", "id": fid, "tid": tid, "n": disp,
                         "s": size, "k": rec["key"], "r": resume})
        ev = threading.Event()
        self.fwait[fid] = [ev, 0]
        if not ev.wait(15):
            raise OSError("等待续传位置超时")
        seq0 = self.fwait.pop(fid)[1]
        seq, last, sent = seq0, seq0*CHUNK, seq0*CHUNK
        with open(rec["path"], "rb") as f:
            f.seek(seq0*CHUNK)
            while True:
                chunk = f.read(CHUNK)
                if not chunk:
                    break
                pt = b"F" + struct.pack(">II", fid, seq) + chunk
                with self.wlock:
                    send_frame(self.sock, self._seal(pt))
                seq += 1
                sent += len(chunk)
                if sent - last >= 262144 or sent >= size:
                    last = sent
                    self.app.event(("prog", self, disp, sent, size, True))
        self._send_ctrl({"t": "fend", "id": fid})
        self.app.event(("fsent", self, disp, size, rec["key"]))
        if cleanup:
            try:
                os.remove(rec["path"])
            except Exception:
                pass

    def enqueue_resume(self):
        d = self._out_dir()
        if not d.exists():
            return
        for jf in d.glob("*.json"):
            try:
                rec = json.loads(jf.read_text("utf-8"))
            except Exception:
                continue
            if rec.get("peer") == self.puid:
                self.sendq.put(("resume", rec))

    def send_text(self, s, key):
        if s:
            self.sendq.put(("text", s, key))

    def send_file_job(self, path, disp, key, cleanup=False):
        self.sendq.put(("file", path, disp, cleanup, key))

    def reject(self):
        self.accepted = False
        try:
            self._send_ctrl({"t": "bye"})
        except Exception:
            pass
        self.alive = False
        try:
            self.sock.close()
        except Exception:
            pass

    def _close(self):
        self.alive = False
        for v in self.infiles.values():
            try:
                v["f"].close()
            except Exception:
                pass
        try:
            self.sock.close()
        except Exception:
            pass
        self.sendq.put(None)
        self.app.event(("dead", self))


class Glass:
    MARGIN = 30

    def __init__(self, app):
        self.app = app
        self.hwnd = None
        self._last = None
        self._follow = False
        if sys.platform != "win32":
            return
        u = ctypes.windll.user32
        self._hinst = ctypes.windll.kernel32.GetModuleHandleW(None)

        class WNDCLASS(ctypes.Structure):
            _fields_ = [("style", ctypes.wintypes.UINT),
                        ("lpfnWndProc", ctypes.c_void_p),
                        ("cbClsExtra", ctypes.c_int),
                        ("cbWndExtra", ctypes.c_int),
                        ("hInstance", ctypes.wintypes.HINSTANCE),
                        ("hIcon", ctypes.wintypes.HICON),
                        ("hCursor", ctypes.c_void_p),
                        ("hbrBackground", ctypes.c_void_p),
                        ("lpszMenuName", ctypes.c_wchar_p),
                        ("lpszClassName", ctypes.c_wchar_p)]
        self._cn = "StGlass%d" % id(self)
        wc = WNDCLASS()
        wc.lpfnWndProc = ctypes.cast(u.DefWindowProcW, ctypes.c_void_p)
        wc.hInstance = self._hinst
        wc.lpszClassName = self._cn
        wc.hCursor = u.LoadCursorW(0, 32512)
        u.RegisterClassW(ctypes.byref(wc))
        ex = 0x00080000 | 0x00000020 | 0x00000080
        self.hwnd = u.CreateWindowExW(
            ex, self._cn, "glass", 0x80000000,
            0, 0, 0, 0, app.hwnd, None, self._hinst, None)

    def _rect(self):
        rc = ctypes.wintypes.RECT()
        ctypes.windll.user32.GetWindowRect(self.app.hwnd, ctypes.byref(rc))
        return rc.left, rc.top, rc.right-rc.left, rc.bottom-rc.top

    def hide(self):
        if self.hwnd:
            ctypes.windll.user32.ShowWindow(self.hwnd, 0)
            self._last = "hidden"

    def render(self, light=False):
        if not self.hwnd:
            return
        u = ctypes.windll.user32
        if u.IsIconic(self.app.hwnd) or u.IsZoomed(self.app.hwnd):
            u.SetWindowRgn(self.app.hwnd, 0, True)
            self.hide()
            return
        x, y, w, h = self._rect()
        if not light and (x, y, w, h) == self._last:
            return
        self._last = None if light else (x, y, w, h)
        M = sp(self.MARGIN)
        ss = 1 if light else ss_factor(w+2*M, h+2*M, cap=10_000_000)
        WM, HM = (w+2*M)*ss, (h+2*M)*ss
        box = (M*ss, M*ss, (M+w)*ss, (M+h)*ss)
        r = sp(20)*ss
        pts = sq_path(box, r, EXP_WIN, max(60, r))
        mask = Image.new("L", (WM, HM), 0)
        ImageDraw.Draw(mask).polygon(pts, fill=255)
        bgc = self.app.pal()["bg"]
        body = Image.composite(
            Image.new("RGBA", (WM, HM), bgc+(255,)),
            Image.new("RGBA", (WM, HM), (0, 0, 0, 0)), mask)
        if not light:
            rim = Image.new("RGBA", (WM, HM), (0, 0, 0, 0))
            rimc = self.app.pal().get("rim")
            ImageDraw.Draw(rim).line(
                pts+[pts[0]],
                fill=(rimc+(205,) if rimc
                      else mix(bgc, (255, 255, 255), .75)+(140,)),
                width=max(1, ss*(2 if rimc else 1)), joint="curve")
            body = Image.alpha_composite(body, rim)
        if ss != 1:
            body.putalpha(body.getchannel("A").filter(
                ImageFilter.GaussianBlur(max(1, int(ss*.7)))))
            body = body.resize((w+2*M, h+2*M), Image.LANCZOS)
        img = Image.new("RGBA", body.size, (0, 0, 0, 0))
        p1 = [(x/ss, y/ss) for x, y in pts]
        if not light:
            shl = Image.new("RGBA", body.size, (0, 0, 0, 0))
            ImageDraw.Draw(shl).polygon(
                [(a-sp(7), b-sp(7)) for a, b in p1],
                fill=mix(bgc, (255, 255, 255), .95)+(120,))
            shl = shl.filter(ImageFilter.GaussianBlur(max(1, sp(11)//2)))
            img = Image.alpha_composite(img, shl)
        sh = Image.new("RGBA", body.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).polygon(
            [(a+sp(7), b+sp(7)) for a, b in p1],
            fill=self.app.pal().get("shadow", (15, 20, 35, 80)))
        br = sp(3) if light else sp(11)
        sh = sh.filter(ImageFilter.GaussianBlur(max(1, br//2)))
        img = Image.alpha_composite(img, sh)
        img = Image.alpha_composite(img, body)
        rimc = self.app.pal().get("rim")
        if rimc and not light:
            halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
            hp = [(M+a, M+b) for a, b in p1]
            hc = mix(rimc, self.app.pal()["accent"], .45)
            ImageDraw.Draw(halo).line(
                hp+[hp[0]], fill=hc+(135,), width=sp(5), joint="curve")
            halo = halo.filter(ImageFilter.GaussianBlur(max(1, sp(7)//2)))
            img = Image.alpha_composite(img, halo)
        clear = Image.new("L", img.size, 0)
        ImageDraw.Draw(clear).rectangle(
            (M, M, M+w, M+h), fill=255)
        img.putalpha(Image.composite(
            Image.new("L", img.size, 0), img.getchannel("A"), clear))
        self._push(img, x-M, y-M)
        u.ShowWindow(self.hwnd, 5)
        self._update_region(w, h)

    def _update_region(self, w, h):
        pts = squircle_rect_pts(w, h, sp(20), EXP_WIN)
        n = len(pts)
        arr = (ctypes.wintypes.POINT*n)(
            *[ctypes.wintypes.POINT(int(a), int(b)) for a, b in pts])
        hrgn = ctypes.windll.gdi32.CreatePolygonRgn(arr, n, 2)
        ctypes.windll.user32.SetWindowRgn(self.app.hwnd, hrgn, True)

    def _push(self, img, x, y):
        r0, g0, b0, a0 = img.split()
        ar = Image.merge("RGB", (a0, a0, a0))
        pr = ImageChops.multiply(Image.merge("RGB", (r0, g0, b0)), ar)
        pm = pr.convert("RGBA")
        pm.putalpha(a0)
        self._push_raw(pm, x, y)

    def _push_raw(self, img, x, y):
        u, g = ctypes.windll.user32, ctypes.windll.gdi32
        W, H = img.size
        bmi = BMIH()
        bmi.biSize = ctypes.sizeof(BMIH)
        bmi.biWidth, bmi.biHeight = W, -H
        bmi.biPlanes, bmi.biBitCount = 1, 32
        bits = ctypes.c_void_p()
        hdc = u.GetDC(0)
        hbm = g.CreateDIBSection(hdc, ctypes.byref(bmi), 0,
                                 ctypes.byref(bits), None, 0)
        ctypes.memmove(bits, img.tobytes("raw", "BGRA"), W*H*4)
        mdc = g.CreateCompatibleDC(hdc)
        old = g.SelectObject(mdc, hbm)
        u.UpdateLayeredWindow(
            self.hwnd, hdc, ctypes.byref(LPT(x, y)),
            ctypes.byref(LPT(W, H)), mdc, ctypes.byref(LPT(0, 0)), 0,
            ctypes.byref(BLEND(0, 0, 255, 1)), 2)
        g.SelectObject(mdc, old)
        g.DeleteDC(mdc)
        g.DeleteObject(hbm)
        u.ReleaseDC(0, hdc)

    def sync(self):
        if not self.hwnd:
            return
        u = ctypes.windll.user32
        if u.IsIconic(self.app.hwnd) or u.IsZoomed(self.app.hwnd):
            if self._last != "hidden":
                self.render()
            return
        x, y, w, h = self._rect()
        if (x, y, w, h) != self._last:
            self.render()


class App:
    def __init__(self):
        global SCALE, P
        self.settings = self._load("settings.json", {"name": socket.gethostname(), "port": 50090})
        if not self.settings.get("uid"):
            self.settings["uid"] = gen_id()
            self._save("settings.json", self.settings)
        P = THEMES.get(self.settings.get("theme"), THEMES["macaron"])
        self.contacts = self._load("contacts.json", [])
        for c in self.contacts:
            c["session"] = None
        self.events = queue.Queue()
        self.sessions = []
        self.lsock = None
        self.listening = False
        self.out_seq = 0
        self.status_at = {}
        self.registry = []
        self.entries = []
        self.redrawers = []
        self._build_ui()
        self.root.update_idletasks()
        sc = self.root.winfo_fpixels("1i") / 96.0
        if sys.platform == "win32":
            try:
                u32 = ctypes.windll.user32
                u32.GetDpiForWindow.argtypes = [ctypes.wintypes.HWND]
                u32.GetDpiForWindow.restype = ctypes.c_uint
                dpi = u32.GetDpiForWindow(self.root.winfo_id())
                sc = max(sc, dpi / 96.0)
            except Exception:
                pass
            global UI_FONT, MONO_FONT
            fams = set(self.root.tk.call("font", "families"))
            for f in ("Microsoft YaHei UI", "Microsoft YaHei", "Segoe UI"):
                if f in fams:
                    UI_FONT = f
                    break
            MONO_FONT = "Consolas" if "Consolas" in fams else "Courier New"
        SCALE = max(1.0, sc)
        self._build_layout()
        self.hwnd = self._strip_border()
        self._dpi_pending = None
        if self.hwnd:
            self._install_dpi_hook()
            ctypes.windll.user32.SetLayeredWindowAttributes(self.hwnd, 0, 255, 2)
            ctypes.windll.user32.SetWindowPos(
                self.hwnd, 0, 0, 0, sp(1040), sp(740), 0x0002 | 0x0004)
        self._apply_window_shape()
        self.glass = None
        self._lift_edges()
        self.root.bind("<Configure>", self._on_configure)
        def _on_map(_e):
            self._apply_window_shape()
            self._lift_edges()
            if self.glass is None:
                self.glass = Glass(self)
            self.glass.render()
        self.root.bind("<Map>", _on_map)
        self._apply_listen()
        self.root.after(100, self._drain)
        self.root.after(250, self._dpi_poll)
        self.root.after(2000, self._tick)
        self.root.protocol("WM_DELETE_WINDOW", self._quit)

    def pal(self):
        return P

    @property
    def uid(self):
        return self.settings.get("uid")

    def _load(self, fn, default):
        try:
            return json.loads((APP_DIR/fn).read_text(encoding="utf-8"))
        except Exception:
            return default

    def _save(self, fn, obj):
        try:
            (APP_DIR/fn).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    def event(self, ev):
        self.events.put(ev)

    def R(self, w, bg=None, fg=None):
        self.registry.append((w, bg, fg))
        return w

    def _build_ui(self):
        root_cls = TkinterDnD.Tk if HAS_DND else tk.Tk
        self.root = root_cls()
        self.root.title(f"安全传输 {VERSION}")
        self.root.configure(bg=hx(P["bg"]))
        if HAS_DND:
            self.root.drop_target_register(DND_FILES)
            self.root.dnd_bind("<<Drop>>", lambda e: self._send_paths(self.root.tk.splitlist(e.data)))
        self._style_ttk()

    def _style_ttk(self):
        style = ttk.Style()
        try:
            style.theme_use("clam")
        except Exception:
            pass
        style.configure("TScrollbar", background=hx(P["fill"]), troughcolor=hx(P["fill"]),
                        bordercolor=hx(P["fill"]), arrowcolor=hx(P["muted"]))
        style.configure("Horizontal.TProgressbar", background=hx(P["accent"]),
                        troughcolor=hx(mix(P["fill"], (0, 0, 0), .06)),
                        bordercolor=hx(P["fill"]),
                        lightcolor=hx(P["accent"]), darkcolor=hx(P["accent"]))

    def _entry_style(self, w):
        if w not in self.entries:
            self.entries.append(w)
        w.configure(bg=hx(mix(P["fill"], (0, 0, 0), .035)), fg=hx(P["ink"]),
                    highlightthickness=1,
                    highlightbackground=hx(mix(P["fill"], (0, 0, 0), .13)),
                    highlightcolor=hx(P["accent"]),
                    insertbackground=hx(P["ink"]))

    def _card(self, parent, fill_role="fill", pad=13):
        holder = self.R(tk.Frame(parent, bg=hx(P["bg"])), "bg")
        cv = self.R(tk.Canvas(holder, highlightthickness=0, bg=hx(P["bg"]), bd=0), "bg")
        cv.place(x=0, y=0, relwidth=1, relheight=1)
        inner = self.R(tk.Frame(holder, bg=hx(P[fill_role])), fill_role)
        pp = sp(pad)
        inner.pack(fill="both", expand=True, padx=pp, pady=pp)

        state = {"photo": None}

        def redraw():
            w, h = holder.winfo_width(), holder.winfo_height()
            if w < 8 or h < 8:
                return
            cw, ch = w-2*pp, h-2*pp
            if cw < 4 or ch < 4:
                return
            img = glass_shape(cw, ch, sp(12), P[fill_role], P["bg"], EXP_UI,
                              flat=True)
            state["photo"] = ImageTk.PhotoImage(img, master=cv)
            cv.delete("card")
            cv.create_image(pp, pp, anchor="nw", image=state["photo"],
                            tags="card")
            cv.tag_lower("card")
        cjob = [None]
        def kick(_e):
            if cjob[0]:
                holder.after_cancel(cjob[0])
            cjob[0] = holder.after(25, redraw)
        holder.bind("<Configure>", kick)
        self.redrawers.append(type("X", (), {"redraw": redraw})())
        return holder, inner

    def _build_layout(self):
        S = SCALE
        self.root.geometry(f"{sp(1040)}x{sp(740)}")
        self.root.minsize(sp(900), sp(640))

        titlebar = self.R(tk.Frame(self.root, bg=hx(P["bg"]), height=sp(42)), "bg")
        titlebar.pack(fill="x", side="top")
        titlebar.pack_propagate(False)
        tleft = self.R(tk.Frame(titlebar, bg=hx(P["bg"])), "bg")
        tleft.pack(side="left", padx=sp(12))
        self.title_avatar = Avatar(tleft, self, sp(24))
        self.title_avatar.cv.pack(side="left")
        self.R(tk.Label(tleft, text=f"安全传输 {VERSION}", bg=hx(P["bg"]),
                        fg=hx(P["ink"]), font=(UI_FONT, sp(10), "bold")),
               "bg", "ink").pack(side="left", padx=sp(8))
        tright = self.R(tk.Frame(titlebar, bg=hx(P["bg"])), "bg")
        tright.pack(side="right", padx=sp(10))
        bw, bh, bf = sp(34), sp(20), sp(9)
        NeuButton(tright, self, "—", self._minimize, "tlight", bw, bh, bf,
                  tint="t_green").cv.pack(side="left")
        NeuButton(tright, self, "□", self._toggle_max, "tlight", bw, bh, bf,
                  tint="t_yellow").cv.pack(side="left", padx=sp(5))
        NeuButton(tright, self, "×", self._quit, "tlight", bw, bh, bf,
                  tint="t_pink").cv.pack(side="left")
        for w in (titlebar, tleft):
            w.bind("<ButtonPress-1>", self._begin_move)
            w.bind("<ButtonRelease-1>", self._end_move)
            w.bind("<Double-Button-1>", lambda _e: self._toggle_max())
        self._moving = self._resizing = False
        self._shape_last = (0, 0)

        outer = self.R(tk.Frame(self.root, bg=hx(P["bg"])), "bg")
        outer.pack(fill="both", expand=True, padx=sp(14), pady=(0, sp(12)))

        side_holder, side = self._card(outer)
        side_holder.pack(side="left", fill="y")

        prof = self.R(tk.Frame(side, bg=hx(P["fill"])), "fill")
        prof.pack(fill="x")
        self.avatar = Avatar(prof, self, sp(52))
        self.avatar.cv.pack(side="left")
        meta = self.R(tk.Frame(prof, bg=hx(P["fill"])), "fill")
        meta.pack(side="left", padx=sp(10))
        self.prof_name = self.R(tk.Label(meta, text="", bg=hx(P["fill"]), fg=hx(P["ink"]),
                                         font=(UI_FONT, sp(12), "bold"), anchor="w",
                                         width=22),
                                "fill", "ink")
        self.prof_name.pack(anchor="w")
        self.id_lbl = self.R(tk.Label(meta, text=f"ID {self.uid}", bg=hx(P["fill"]),
                                      fg=hx(P["accent_d"]), font=(MONO_FONT, sp(9)), anchor="w"),
                             "fill")
        self.id_lbl.pack(anchor="w")

        self.R(tk.Label(side, text="显示名称（可改、可重名）", bg=hx(P["fill"]), fg=hx(P["muted"]),
                        font=(UI_FONT, sp(8))), "fill", "muted").pack(anchor="w", pady=(sp(10), 1))
        self.name_var = tk.StringVar(value=self.settings.get("name", socket.gethostname()))
        ne = tk.Entry(side, textvariable=self.name_var, relief="flat")
        self._entry_style(ne)
        ne.pack(fill="x", ipady=sp(3))
        ne.bind("<Return>", lambda _e: (self._save_settings(), self._refresh_profile()))
        ne.bind("<FocusOut>", lambda _e: (self._save_settings(), self._refresh_profile()))

        self.R(tk.Frame(side, bg=hx(mix(P["fill"], (0, 0, 0), .08)), height=1),
               None).pack(fill="x", pady=sp(10))

        addrs = " / ".join(local_addrs()) or "无网络地址"
        self.R(tk.Label(side, text=f"本机地址：{addrs}", bg=hx(P["fill"]), fg=hx(P["muted"]),
                        font=(UI_FONT, sp(8)), wraplength=sp(224), justify="left"),
               "fill", "muted").pack(anchor="w")
        prow = self.R(tk.Frame(side, bg=hx(P["fill"])), "fill")
        prow.pack(fill="x", pady=(sp(4), 0))
        self.R(tk.Label(prow, text="监听端口", bg=hx(P["fill"]), fg=hx(P["muted"]),
                        font=(UI_FONT, sp(9))), "fill", "muted").pack(side="left")
        self.port_var = tk.StringVar(value=str(self.settings.get("port", 50090)))
        pe = tk.Entry(prow, textvariable=self.port_var, width=7, relief="flat")
        self._entry_style(pe)
        pe.pack(side="left", padx=sp(5), ipady=sp(2))
        NeuButton(prow, self, "应用", self._apply_listen, "pastel", sp(52), sp(28), sp(9),
                  tint="t_purple").cv.pack(side="left")

        self.R(tk.Label(side, text="配 色", bg=hx(P["fill"]), fg=hx(P["ink"]),
                        font=(UI_FONT, sp(9), "bold")), "fill", "ink").pack(anchor="w", pady=(sp(12), 3))
        trow = self.R(tk.Frame(side, bg=hx(P["fill"])), "fill")
        trow.pack(fill="x")
        self.theme_btns = []
        for key, label in (("macaron", "马卡龙"), ("mono", "极简"),
                           ("vivid", "鲜艳"), ("lux", "轻奢")):
            b = NeuButton(trow, self, label, lambda k=key: self._set_theme(k),
                          "primary" if self.settings.get("theme", "macaron") == key else "ghost",
                          sp(60), sp(26), sp(9))
            b.cv.pack(side="left", padx=(0, sp(4)))
            self.theme_btns.append((b, key))

        self.R(tk.Label(side, text="好 友", bg=hx(P["fill"]), fg=hx(P["ink"]),
                        font=(UI_FONT, sp(10), "bold")), "fill", "ink").pack(anchor="w", pady=(sp(12), 3))
        lst_wrap = self.R(tk.Frame(side, bg=hx(P["fill"])), "fill")
        lst_wrap.pack(fill="both", expand=True)
        self.lst = tk.Listbox(lst_wrap, relief="flat", borderwidth=0, highlightthickness=0,
                              bg=hx(P["fill"]), fg=hx(P["ink"]),
                              selectbackground=hx(mix(P["fill"], P["accent"], .25)),
                              selectforeground=hx(P["ink"]), activestyle="none",
                              font=(UI_FONT, sp(9)), height=14)
        self.lst.pack(side="left", fill="both", expand=True)
        sb = ttk.Scrollbar(lst_wrap, command=self.lst.yview)
        sb.pack(side="right", fill="y")
        self.lst.configure(yscrollcommand=sb.set)
        self.lst.bind("<<ListboxSelect>>", lambda _e: self._refresh_header())

        NeuButton(side, self, "＋ 添加 / 配对好友", self._add_pair, "primary",
                  sp(236), sp(38)).cv.pack(fill="x", pady=(sp(10), sp(5)))
        brow = self.R(tk.Frame(side, bg=hx(P["fill"])), "fill")
        brow.pack(fill="x")
        NeuButton(brow, self, "连接", self._connect_selected, "pastel",
                  sp(110), sp(30), sp(9), tint="t_green").cv.pack(side="left")
        NeuButton(brow, self, "删除好友", self._del_contact, "pastel",
                  sp(110), sp(30), sp(9), tint="t_pink").cv.pack(side="left", padx=sp(8))

        main = self.R(tk.Frame(outer, bg=hx(P["bg"])), "bg")
        main.pack(side="left", fill="both", expand=True, padx=(sp(12), 0))

        hdr_holder, hdr = self._card(main)
        hdr_holder.pack(fill="x")
        self.hdr_name = self.R(tk.Label(hdr, text="未选择好友", bg=hx(P["fill"]),
                                        fg=hx(P["ink"]), font=(UI_FONT, sp(13), "bold"),
                                        anchor="w"), "fill", "ink")
        self.hdr_name.pack(side="left")
        self.status_pill = self.R(tk.Label(hdr, text="○ 离线", bg=hx(P["fill"]),
                                           fg=hx(P["muted"]),
                                           font=(UI_FONT, sp(9))), "fill")
        self.status_pill.pack(side="left", padx=sp(12))
        self.R(tk.Label(hdr, text=VERSION, bg=hx(P["fill"]), fg=hx(P["muted"]),
                        font=(UI_FONT, sp(9))), "fill", "muted").pack(side="right")

        chat_holder, chat_in = self._card(main, fill_role="chat")
        chat_holder.pack(fill="both", expand=True, pady=sp(12))
        self.chat = scrolledtext.ScrolledText(chat_in, wrap="word", height=12,
                                              relief="flat", borderwidth=0,
                                              highlightthickness=0, bg=hx(P["chat"]),
                                              fg=hx(P["ink"]), font=(UI_FONT, sp(10)),
                                              insertbackground=hx(P["ink"]))
        self.chat.tag_configure("mine", foreground=hx(mix(P["accent"], (0, 0, 0), .15)))
        self.chat.tag_configure("peer", foreground=hx(P["ink"]))
        self.chat.tag_configure("st_ing", font=(UI_FONT, sp(8)),
                                foreground=hx(P["muted"]))
        self.chat.tag_configure("st_ok", font=(UI_FONT, sp(8)),
                                foreground=hx(mix(P["green"], (0, 0, 0), .2)))
        self.chat.tag_configure("st_read", font=(UI_FONT, sp(8)),
                                foreground=hx(P["accent_d"]))
        self.chat.tag_configure("fail", font=(UI_FONT, sp(10), "bold"),
                                foreground=hx(mix(P["danger"], (0, 0, 0), .25)),
                                background=hx(mix(P["danger"], (255, 255, 255), .62)),
                                lmargin1=sp(6), lmargin2=sp(6),
                                spacing1=sp(3), spacing3=sp(3),
                                borderwidth=1, relief="solid")
        self.chat.pack(fill="both", expand=True, padx=sp(6), pady=sp(4))
        csb = ttk.Scrollbar(chat_in, command=self.chat.yview)
        self.chat.configure(yscrollcommand=csb.set)
        csb.place(relx=1, rely=0, relheight=1, anchor="ne")

        comp_holder, comp = self._card(main)
        comp_holder.pack(fill="x")
        irow = self.R(tk.Frame(comp, bg=hx(P["fill"])), "fill")
        irow.pack(fill="x")
        self.inp = tk.Entry(irow, relief="flat", font=(UI_FONT, sp(10)))
        self._entry_style(self.inp)
        self.inp.pack(side="left", fill="x", expand=True, ipady=sp(5))
        self.inp.bind("<Return>", lambda _e: self._send_text())
        NeuButton(irow, self, "发 送", self._send_text, "primary",
                  sp(72), sp(38)).cv.pack(side="left", padx=(sp(8), 0))

        self.pb = ttk.Progressbar(comp, maximum=1, style="Horizontal.TProgressbar")
        self.pb.pack(fill="x", pady=(sp(8), sp(2)))
        self.pbl = self.R(tk.Label(comp, text="", bg=hx(P["fill"]), fg=hx(P["muted"]),
                                   font=(UI_FONT, sp(8)), anchor="w"), "fill", "muted")
        self.pbl.pack(fill="x")

        frow = self.R(tk.Frame(comp, bg=hx(P["fill"])), "fill")
        frow.pack(fill="x", pady=(sp(6), 0))
        NeuButton(frow, self, "发送文件", self._pick_files, "pastel",
                  sp(92), sp(30), sp(9), tint="t_purple").cv.pack(side="left")
        self.path_inp = tk.Entry(frow, relief="flat", font=(UI_FONT, sp(9)))
        self._entry_style(self.path_inp)
        self.path_inp.pack(side="left", fill="x", expand=True, padx=sp(8))
        self.path_inp.bind("<Return>",
                           lambda _e: (self._send_paths([self.path_inp.get()]),
                                       self.path_inp.delete(0, "end")))
        self.R(tk.Label(comp,
                        text="可拖文件进窗口 / 点“发送文件” / 输入本地路径或 http(s) 网址回车；对方 ● 在线才能送达",
                        bg=hx(P["fill"]), fg=hx(P["muted"]),
                        font=(UI_FONT, sp(8)), anchor="w"),
               "fill", "muted").pack(anchor="w", pady=(sp(4), 0))
        if not HAS_DND:
            self._log("未检测到 tkinterdnd2，拖放关闭，其余功能正常")
        self._refresh_profile()
        self._add_resize_edges()

    def _add_resize_edges(self):
        r = sp(7)
        edges = (
            ("top", dict(x=r, y=0, relwidth=1, width=-2*r, height=r), 12,
             "sb_v_double_arrow"),
            ("bottom", dict(x=r, rely=1, anchor="sw", relwidth=1, width=-2*r,
                            height=r), 15, "sb_v_double_arrow"),
            ("left", dict(x=0, y=r, relheight=1, height=-2*r, width=r), 10,
             "sb_h_double_arrow"),
            ("right", dict(relx=1, y=r, anchor="ne", relheight=1, height=-2*r,
                           width=r), 11, "sb_h_double_arrow"),
            ("nw", dict(x=0, y=0, width=r, height=r), 13, "size_nw_se"),
            ("se", dict(relx=1, rely=1, anchor="se", width=r, height=r), 17,
             "size_nw_se"),
            ("ne", dict(relx=1, y=0, anchor="ne", width=r, height=r), 14,
             "size_ne_sw"),
            ("sw", dict(x=0, rely=1, anchor="sw", width=r, height=r), 16,
             "size_ne_sw"))
        self._edge_frames = []
        for _n, kw, hit, cur in edges:
            f = tk.Frame(self.root, bg=hx(P["bg"]), cursor=cur)
            f.place(**kw)
            f.bind("<ButtonPress-1>",
                   lambda _e, h=hit: self._begin_resize(_e, h))
            f.bind("<ButtonRelease-1>", self._end_resize)
            self.R(f, "bg")
            self._edge_frames.append(f)
        self._lift_edges()

    def _lift_edges(self):
        for f in getattr(self, "_edge_frames", []):
            f.lift()

    def _cursor_rect(self):
        u = ctypes.windll.user32
        q = ctypes.wintypes.POINT()
        u.GetCursorPos(ctypes.byref(q))
        rc = ctypes.wintypes.RECT()
        u.GetWindowRect(self.hwnd, ctypes.byref(rc))
        return u, q, rc

    def _begin_move(self, _e):
        if not self.hwnd:
            return
        u, q, rc = self._cursor_rect()
        self._mv = (q.x, q.y, rc.left, rc.top)
        self._moving = True
        threading.Thread(target=self._move_worker, daemon=True).start()

    def _move_worker(self):
        u = ctypes.windll.user32
        M = sp(Glass.MARGIN)
        ax, ay, l0, t0 = self._mv
        while self._moving:
            q = ctypes.wintypes.POINT()
            u.GetCursorPos(ctypes.byref(q))
            x, y = l0+q.x-ax, t0+q.y-ay
            u.SetWindowPos(self.hwnd, 0, x, y, 0, 0,
                           0x0001 | 0x0004 | 0x0010)
            if self.glass:
                u.SetWindowPos(self.glass.hwnd, 0, x-M, y-M, 0, 0,
                               0x0001 | 0x0004 | 0x0010)
            time.sleep(.008)

    def _end_move(self, _e=None):
        if not getattr(self, "_moving", False):
            return
        self._moving = False
        time.sleep(.02)
        if self.glass:
            self.glass.render()

    def _begin_resize(self, _e, hit):
        if not self.hwnd:
            return
        u, q, rc = self._cursor_rect()
        self._rz = (q.x, q.y, rc.left, rc.top,
                    rc.right-rc.left, rc.bottom-rc.top)
        self._resizing = True
        threading.Thread(target=self._resize_worker, args=(hit,),
                         daemon=True).start()

    def _resize_worker(self, hit):
        u = ctypes.windll.user32
        ax, ay, l0, t0, w0, h0 = self._rz
        minw, minh = sp(900), sp(640)
        last = 0.0
        while self._resizing:
            q = ctypes.wintypes.POINT()
            u.GetCursorPos(ctypes.byref(q))
            dx, dy = q.x-ax, q.y-ay
            l, t, w, h = l0, t0, w0, h0
            if hit in (10, 13, 16):
                l = min(l0+dx, l0+w0-minw)
                w = w0+l0-l
            if hit in (12, 13, 14):
                t = min(t0+dy, t0+h0-minh)
                h = h0+t0-t
            if hit in (11, 14, 17):
                w = max(minw, w0+dx)
            if hit in (15, 16, 17):
                h = max(minh, h0+dy)
            u.SetWindowPos(self.hwnd, 0, l, t, w, h, 0x0004 | 0x0010)
            now = time.monotonic()
            if self.glass and now-last >= .03:
                last = now
                self.glass.render(light=True)
            time.sleep(.01)

    def _end_resize(self, _e=None):
        if not getattr(self, "_resizing", False):
            return
        self._resizing = False
        time.sleep(.03)
        if self.glass:
            self.glass.render()

    def _toggle_max(self):
        if sys.platform != "win32" or not self.hwnd:
            return
        u = ctypes.windll.user32
        u.ShowWindow(self.hwnd, 9 if u.IsZoomed(self.hwnd) else 3)

    def _on_configure(self, e):
        if getattr(self, "_moving", False):
            return
        if (e.width, e.height) != self._shape_last:
            self._shape_last = (e.width, e.height)
            self._apply_window_shape(e.width, e.height)
        if self.glass and not getattr(self, "_resizing", False):
            if getattr(self, "_sync_job", None):
                self.root.after_cancel(self._sync_job)
            self._sync_job = self.root.after(60, self._do_sync)

    def _do_sync(self):
        self._sync_job = None
        if self.glass:
            self.glass.sync()

    def _apply_window_shape(self, w=None, h=None):
        if not self.hwnd:
            return
        u = ctypes.windll.user32
        if w is None or h is None:
            rc = ctypes.wintypes.RECT()
            u.GetWindowRect(self.hwnd, ctypes.byref(rc))
            w, h = rc.right-rc.left, rc.bottom-rc.top
        self._shape_last = (w, h)
        if u.IsZoomed(self.hwnd):
            u.SetWindowRgn(self.hwnd, 0, True)
            return
        pts = squircle_rect_pts(w, h, sp(20), EXP_WIN)
        n = len(pts)
        arr = (ctypes.wintypes.POINT * n)(
            *[ctypes.wintypes.POINT(int(x), int(y)) for x, y in pts])
        hrgn = ctypes.windll.gdi32.CreatePolygonRgn(arr, n, 2)
        u.SetWindowRgn(self.hwnd, hrgn, True)

    def _minimize(self):
        if sys.platform != "win32" or not self.hwnd:
            self.root.iconify()
            return
        ctypes.windll.user32.ShowWindow(self.hwnd, 6)
        if self.glass:
            self.glass.hide()

    def _install_dpi_hook(self):
        u = ctypes.windll.user32
        u.GetWindowLongPtrW.argtypes = [ctypes.wintypes.HWND, ctypes.c_int]
        u.GetWindowLongPtrW.restype = ctypes.c_void_p
        u.SetWindowLongPtrW.argtypes = [
            ctypes.wintypes.HWND, ctypes.c_int, ctypes.c_void_p]
        u.SetWindowLongPtrW.restype = ctypes.c_void_p
        u.CallWindowProcW.argtypes = [
            ctypes.c_void_p, ctypes.wintypes.HWND, ctypes.wintypes.UINT,
            ctypes.wintypes.WPARAM, ctypes.wintypes.LPARAM]
        u.CallWindowProcW.restype = ctypes.c_long
        old = u.GetWindowLongPtrW(self.hwnd, -4)
        proto = ctypes.WINFUNCTYPE(
            ctypes.c_long, ctypes.wintypes.HWND, ctypes.wintypes.UINT,
            ctypes.wintypes.WPARAM, ctypes.wintypes.LPARAM)

        def wndproc(hwnd, msg, wp, lp):
            if msg == 0x02E0:
                rc = ctypes.cast(lp, ctypes.POINTER(ctypes.wintypes.RECT))[0]
                self._dpi_pending = (
                    wp & 0xFFFF,
                    (rc.left, rc.top, rc.right-rc.left, rc.bottom-rc.top))
                return 0
            return u.CallWindowProcW(old, hwnd, msg, wp, lp)

        self._wndproc_cb = proto(wndproc)
        u.SetWindowLongPtrW(
            self.hwnd, -4, ctypes.cast(self._wndproc_cb, ctypes.c_void_p))

    def _dpi_poll(self):
        pend = self._dpi_pending
        if pend:
            self._rebuild_for_dpi(*pend)
        self.root.after(250, self._dpi_poll)

    def _rebuild_for_dpi(self, ndpi, geo):
        global SCALE
        self._dpi_pending = None
        SCALE = max(1.0, ndpi / 96.0)
        self.registry.clear()
        self.entries.clear()
        self.redrawers.clear()
        for w in self.root.winfo_children():
            w.destroy()
        self._build_layout()
        l, t, w, h = geo
        ctypes.windll.user32.SetWindowPos(self.hwnd, 0, l, t, w, h, 0x14)
        self._apply_window_shape()
        self._lift_edges()
        if self.glass:
            self.glass.render()
        self._refresh_contacts()

    def _strip_border(self):
        if sys.platform != "win32":
            return None
        try:
            self.root.update_idletasks()
            hwnd = self.root.winfo_id()
            parent = ctypes.windll.user32.GetParent(hwnd)
            if parent:
                hwnd = parent
            user32 = ctypes.windll.user32
            style = user32.GetWindowLongW(hwnd, -16)
            style &= ~(0x00C00000 | 0x00800000 | 0x00400000 | 0x00080000 |
                       0x00040000 | 0x00100000)
            user32.SetWindowLongW(hwnd, -16, style)
            exstyle = user32.GetWindowLongW(hwnd, -20)
            exstyle |= 0x00080000
            exstyle &= ~(0x00000001 | 0x00000100 | 0x00000200 | 0x00020000)
            user32.SetWindowLongW(hwnd, -20, exstyle)
            class MARGINS(ctypes.Structure):
                _fields_ = [("l", ctypes.c_int), ("r", ctypes.c_int),
                            ("t", ctypes.c_int), ("b", ctypes.c_int)]
            try:
                ctypes.windll.dwmapi.DwmExtendFrameIntoClientArea(
                    hwnd, ctypes.byref(MARGINS(0, 0, 0, 0)))
            except Exception:
                pass
            user32.SetWindowPos(hwnd, 0, 0, 0, 0, 0,
                                0x0002 | 0x0001 | 0x0004 | 0x0020)
            return hwnd
        except Exception:
            return None

    def _set_theme(self, key):
        global P
        P = THEMES[key]
        self.settings["theme"] = key
        self._save("settings.json", self.settings)
        self.root.configure(bg=hx(P["bg"]))
        for w, b, f in self.registry:
            try:
                if b:
                    w.configure(bg=hx(P[b]))
                if f:
                    w.configure(fg=hx(P[f]))
            except Exception:
                pass
        for w in self.entries:
            self._entry_style(w)
        for r in self.redrawers:
            try:
                r.redraw()
            except Exception:
                pass
        self._style_ttk()
        self.chat.configure(bg=hx(P["chat"]), fg=hx(P["ink"]))
        self.chat.tag_configure("mine", foreground=hx(mix(P["accent"], (0, 0, 0), .15)))
        self.chat.tag_configure("peer", foreground=hx(P["ink"]))
        self.chat.tag_configure("st_ing", foreground=hx(P["muted"]))
        self.chat.tag_configure("st_ok", foreground=hx(mix(P["green"], (0, 0, 0), .2)))
        self.chat.tag_configure("st_read", foreground=hx(P["accent_d"]))
        self.id_lbl.configure(fg=hx(P["accent_d"]))
        self.chat.tag_configure("fail", foreground=hx(mix(P["danger"], (0, 0, 0), .25)),
                                background=hx(mix(P["danger"], (255, 255, 255), .62)))
        self.lst.configure(bg=hx(P["fill"]), fg=hx(P["ink"]),
                           selectbackground=hx(mix(P["fill"], P["accent"], .25)))
        for b, k in getattr(self, "theme_btns", []):
            b.kind = "primary" if k == key else "ghost"
            b.redraw()
        self._refresh_contacts()
        self._refresh_profile()
        if self.glass:
            self.glass.render()

    def _refresh_profile(self):
        n = self.name_var.get().strip() or socket.gethostname()
        if len(n) > 20:
            n = n[:19] + "…"
        self.prof_name.configure(text=n)
        self.avatar.draw(n[0].upper())
        self.title_avatar.draw(n[0].upper())

    def _chat_add(self, text, tag=None):
        self.chat.configure(state="normal")
        if self.chat.index("end-1c") != "1.0":
            self.chat.insert("end-1c", "\n")
        self.chat.insert("end-1c", text, tag if tag else ())
        self.chat.configure(state="disabled")
        self.chat.see("end")

    def _log(self, text, tag=None):
        self._chat_add(text, tag)

    def _fail_box(self, text):
        self._log(text, "fail")

    def _save_settings(self):
        self.settings["name"] = self.name_var.get().strip() or socket.gethostname()
        try:
            self.settings["port"] = int(self.port_var.get())
        except Exception:
            pass
        self._save("settings.json", self.settings)

    def _apply_listen(self):
        try:
            port = int(self.port_var.get())
            if not (1 <= port <= 65535):
                raise ValueError
        except Exception:
            messagebox.showerror("错误", "端口须为 1-65535 的数字")
            return
        if self.lsock:
            self.listening = False
            try:
                self.lsock.close()
            except Exception:
                pass
        try:
            self.lsock = make_listener(port)
        except Exception as e:
            messagebox.showerror("监听失败", f"端口 {port} 无法监听：{e}")
            return
        self.listening = True
        self._save_settings()
        threading.Thread(target=self._accept_loop, daemon=True).start()
        self._log(f"[系统] 正在监听端口 {port}，IPv4/IPv6 双栈")

    def _accept_loop(self):
        while self.listening:
            try:
                sock, _ = self.lsock.accept()
            except Exception:
                return
            s = Session(self, sock, False)
            self.sessions.append(s)
            s.start()

    def find_contact_by_id(self, uid):
        for c in self.contacts:
            if c["id"] == uid:
                return c
        return None

    def find_contact_by_host(self, host):
        for c in self.contacts:
            if c["host"] == host:
                return c
        return None

    def upsert_contact(self, uid, name, host, port):
        c = self.find_contact_by_id(uid)
        if c:
            c["name"], c["host"], c["port"] = name, host, port or c.get("port")
        else:
            c = {"id": uid, "name": name, "host": host, "port": port or 0, "session": None}
            self.contacts.append(c)
        self._persist_contacts()
        self.event(("contacts",))

    def _persist_contacts(self):
        self._save("contacts.json",
                   [{k: v for k, v in x.items() if k != "session"} for x in self.contacts])

    @staticmethod
    def _online(c):
        s = c.get("session")
        return bool(s and s.alive and s.ready_evt.is_set())

    def _refresh_contacts(self):
        sel = self.lst.curselection()
        self.lst.delete(0, "end")
        for c in self.contacts:
            dot = "●" if self._online(c) else "○"
            self.lst.insert("end", f"{dot} {c['name']} #{c['id']}  {c['host']}:{c['port']}")
        if sel:
            try:
                self.lst.selection_set(sel[0])
            except Exception:
                pass
        self._refresh_header()

    def _refresh_header(self):
        c = self._selected()
        if not c:
            self.hdr_name.configure(text="未选择好友")
            self.status_pill.configure(text="○ 离线", fg=hx(P["muted"]))
            return
        on = self._online(c)
        self.hdr_name.configure(text=f"{c['name']} #{c['id']}")
        self.status_pill.configure(text=("● 在线" if on else "○ 离线"),
                                   fg=hx(P["green"] if on else P["muted"]))

    def _selected(self):
        i = self.lst.curselection()
        return self.contacts[i[0]] if i else None

    def _add_pair(self):
        v = simpledialog.askstring("配对好友", "输入对方地址：IP:端口\n例：192.168.1.8:50090 或 [2001:db8::2]:50090")
        if not v:
            return
        v = v.strip()
        try:
            if v.startswith("["):
                host, tail = v[1:].split("]", 1)
                port = int(tail.lstrip(":"))
            else:
                host, port = v.rsplit(":", 1)
                port = int(port)
        except Exception:
            messagebox.showerror("错误", "地址格式应为 IP:端口")
            return
        host = host.strip()
        self._connect(host, port)
        self._log(f"[系统] 正在向 {host}:{port} 发起配对，等待对方确认")

    def _connect_selected(self):
        c = self._selected()
        if c:
            self._connect(c["host"], c["port"])
            self._log(f"[系统] 正在连接 {c['name']} #{c['id']} …")

    def _connect(self, host, port):
        def work():
            try:
                sock = socket.create_connection((host, port), timeout=8)
                s = Session(self, sock, True)
                c = self.find_contact_by_host(host)
                if c:
                    c["session"] = s
                self.sessions.append(s)
                s.start()
            except Exception as e:
                self.event(("log", f"[系统] 连接 {host}:{port} 失败：{e}"))
        threading.Thread(target=work, daemon=True).start()

    def _del_contact(self):
        c = self._selected()
        if c and messagebox.askyesno("删除", f"删除好友 {c['name']} #{c['id']}？"):
            self.contacts.remove(c)
            self._persist_contacts()
            self._refresh_contacts()

    def _target(self):
        c = self._selected()
        if not c:
            messagebox.showinfo("提示", "请先在左侧选中一位好友")
            return None, None
        s = c.get("session")
        if not self._online(c):
            live = [x for x in self.sessions if x.alive and x.puid == c["id"] and x.ready_evt.is_set()]
            if live:
                c["session"] = live[0]
                return c, live[0]
            self._fail_box(f"{c['name']} #{c['id']} 当前离线（○），内容未发出。选中好友点“连接”，状态变 ● 后重试")
            return None, None
        return c, s

    def _next_key(self):
        k = self.out_seq
        self.out_seq += 1
        return k

    def _outgoing_line(self, c, body, key):
        prefix = f"[我 → {c['name']}#{c['id']}] {body}"
        self.chat.configure(state="normal")
        if self.chat.index("end-1c") != "1.0":
            self.chat.insert("end-1c", "\n")
        self.chat.insert("end-1c", prefix, "mine")
        mark = f"mk{key}"
        self.chat.mark_set(mark, "end-1c")
        self.chat.mark_gravity(mark, "left")
        self.chat.insert("end-1c", " 〔发送中〕", "st_ing")
        self.chat.configure(state="disabled")
        self.chat.see("end")
        self.status_at[key] = mark

    def _set_status(self, key, segs):
        mark = self.status_at.get(key)
        if not mark:
            return
        self.chat.configure(state="normal")
        self.chat.delete(mark, f"{mark} lineend")
        for text, tag in reversed(segs):
            self.chat.insert(mark, text, tag)
        self.chat.configure(state="disabled")

    def _send_text(self):
        c, s = self._target()
        t = self.inp.get().strip()
        if not s or not t:
            return
        key = self._next_key()
        s.send_text(t, key)
        self.inp.delete(0, "end")
        self._outgoing_line(c, t, key)

    def _pick_files(self):
        paths = filedialog.askopenfilenames()
        if paths:
            self._send_paths(paths)

    def _send_paths(self, paths):
        c, s = self._target()
        if not s:
            return
        for raw in paths:
            p = str(raw).strip().strip('"')
            if not p:
                continue
            key = self._next_key()
            if p.lower().startswith(("http://", "https://")):
                self._outgoing_line(c, f"网址文件：{p}", key)
                threading.Thread(target=self._send_url, args=(s, p, key), daemon=True).start()
                continue
            fp = Path(p)
            if fp.is_file():
                s.send_file_job(str(fp), fp.name, key)
                self._outgoing_line(c, f"[文件] {fp.name}（{human(fp.stat().st_size)}）", key)
            elif fp.is_dir():
                for f in sorted(fp.rglob("*")):
                    if f.is_file():
                        k2 = self._next_key()
                        s.send_file_job(str(f), f.name, k2)
                        self._outgoing_line(c, f"[文件] {f.name}（{human(f.stat().st_size)}）", k2)
            else:
                self._fail_box(f"路径不存在：{p}")

    def _send_url(self, s, url, key):
        try:
            name = urllib.parse.unquote(url.split("?", 1)[0].rstrip("/").split("/")[-1]) or "download"
            tmp_dir = APP_DIR / ".tmp_dl"
            tmp_dir.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=tmp_dir)
            os.close(fd)
            total = 0
            with urllib.request.urlopen(url, timeout=30) as resp, open(tmp, "wb") as out:
                while True:
                    chunk = resp.read(CHUNK)
                    if not chunk:
                        break
                    out.write(chunk)
                    total += len(chunk)
            s.send_file_job(tmp, name, key, cleanup=True)
            self.event(("log", f"[系统] 网址文件已下载并排队：{name}（{human(total)}）"))
        except Exception as e:
            self.event(("ferr", None, key, f"网址下载失败：{e}"))

    def _drain(self):
        while True:
            try:
                ev = self.events.get_nowait()
            except queue.Empty:
                break
            try:
                self._handle(ev)
            except Exception:
                excepthook(*sys.exc_info())
        self.root.after(100, self._drain)

    def _handle(self, ev):
        t = ev[0]
        if t == "log":
            self._log(ev[1])
        elif t == "contacts":
            self._refresh_contacts()
        elif t == "ready":
            s = ev[1]
            c = self.find_contact_by_id(s.puid) or self.find_contact_by_host(s.host)
            if c:
                c["session"] = s
            self._refresh_contacts()
            self._log(f"[系统] {s.pname} #{s.puid} 已上线：AES-256-GCM 通道建立，豪密底本/乱码表交换完成")
            s.enqueue_resume()
        elif t == "pair":
            s = ev[1]
            if messagebox.askyesno("配对请求", f"{s.pname} #{s.puid}\n来自 {s.host}:{s.pport}\n是否加为好友？"):
                s.accepted = True
                self.upsert_contact(s.puid, s.pname, s.host, s.pport)
                c = self.find_contact_by_id(s.puid)
                if c:
                    c["session"] = s
                self._log(f"[系统] 已与 {s.pname} #{s.puid} 配对")
            else:
                s.reject()
                self._log("[系统] 已拒绝配对请求")
        elif t == "msg":
            s, text = ev[1], ev[2]
            self._log(f"[{s.pname} #{s.puid}] {text}", "peer")
        elif t in ("sent", "fsent"):
            self._set_status(ev[2], [(" 〔发送成功〕", "st_ok")])
        elif t == "ack":
            self._set_status(ev[2], [(" 〔发送成功〕", "st_ok"), (" 〔已读〕", "st_read")])
        elif t == "ferr":
            key, why = ev[2], ev[3]
            self._set_status(key, [(" 〔失败〕", "fail")])
            self._fail_box(f"发送未完成：{why}")
        elif t == "fbegin":
            name, size, seq0 = ev[2], ev[3], ev[4]
            if seq0:
                self._log(f"[系统] 断点续传：{name} 从 {seq0*CHUNK}/{size} 继续接收")
            else:
                self._log(f"[系统] 正在接收 {name}（{human(size)}）→ 接收文件 文件夹")
            self.pb.configure(value=(seq0*CHUNK/size if size else 0))
        elif t == "prog":
            _s, name, done, size, sending = ev[1], ev[2], ev[3], ev[4], ev[5]
            frac = done/size if size else 1
            self.pb.configure(value=frac)
            self.pbl.configure(text=f"{'发送' if sending else '接收'} {name} {frac*100:.0f}%  {human(done)}/{human(size)}")
        elif t == "fdone":
            _s, name, path, got, size = ev[1], ev[2], ev[3], ev[4], ev[5]
            self.pb.configure(value=1)
            self.pbl.configure(text="")
            self._log(f"[系统] 接收完成：{name}（{'完整无损' if got==size else '大小异常'}）→ {path}")
        elif t == "dead":
            s = ev[1]
            if s in self.sessions:
                self.sessions.remove(s)
            c = self.find_contact_by_id(s.puid) if s.puid else self.find_contact_by_host(s.host)
            if c and c.get("session") is s:
                c["session"] = None
            self._refresh_contacts()
            self._log(f"[系统] {s.pname or s.host}{' #'+s.puid if s.puid else ''} 已离线")

    def _tick(self):
        self._refresh_contacts()
        self.root.after(2000, self._tick)

    def _quit(self):
        self._save_settings()
        self._persist_contacts()
        self.listening = False
        if self.lsock:
            try:
                self.lsock.close()
            except Exception:
                pass
        for s in self.sessions:
            s.alive = False
            try:
                s.sock.close()
            except Exception:
                pass
        self.root.destroy()


if __name__ == "__main__":
    App().root.mainloop()
