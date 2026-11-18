import os
import sys
import json
import time
import socket
import struct
import secrets
import threading
import queue
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

if getattr(sys, "frozen", False):
    APP_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "安全传输"
else:
    APP_DIR = Path(__file__).resolve().parent
APP_DIR.mkdir(parents=True, exist_ok=True)
RECV_DIR = APP_DIR / "接收文件"
CHUNK = 65536
ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
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


def human(n):
    for u in ("B", "KB", "MB", "GB"):
        if n < 1024 or u == "GB":
            return f"{n:.1f}{u}" if u != "B" else f"{n}B"
        n /= 1024


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
        self.fid = 0
        self.infiles = {}
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
            send_frame(self.sock, b"H" + hello)
            raw = recv_frame(self.sock)
        else:
            raw = recv_frame(self.sock)
            send_frame(self.sock, b"H" + hello)
        if raw[:1] != b"H":
            raise ConnectionError("握手失败")
        peer_pub = b64d(json.loads(raw[1:])["pub"])
        shared = self.priv.exchange(x25519.X25519PublicKey.from_public_bytes(peer_pub))
        lo, hi = sorted([self.my_pub, peer_pub])
        key = HKDF(algorithm=hashes.SHA256(), length=32,
                   salt=hashlib.sha256(lo + hi).digest(), info=b"ht-v1").derive(shared)
        self.gcm = AESGCM(key)
        self.peer_pub = peer_pub

    def _send_ctrl(self, obj):
        pt = b"J" + json.dumps(obj, separators=(",", ":")).encode()
        with self.wlock:
            send_frame(self.sock, self._seal(pt))

    def run(self):
        try:
            self._handshake()
            self._send_ctrl({"t": "id", "n": self.app.name, "p": self.app.port, "id": self.app.uid})
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
                return

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
            known = self.app.find_contact_by_id(self.puid)
            if self.outbound:
                self.app.upsert_contact(self.puid, self.pname, self.host, self.pport)
                self.accepted = True
            elif known:
                known["name"] = self.pname
                known["host"] = self.host
                if self.pport:
                    known["port"] = self.pport
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
        elif t == "ack":
            self.app.event(("ack", self, o.get("k")))
        elif t == "text" and self.accepted and self.ready_evt.is_set():
            raw = self._haomi_dec(b64d(o["d"]))
            self.app.event(("msg", self, raw.decode("utf-8", "replace")))
            self._send_ctrl({"t": "ack", "k": o.get("k")})
        elif t == "fbegin" and self.accepted:
            self._begin_recv(int(o["id"]), o["n"], int(o["s"]), o.get("k"))
        elif t == "fend" and self.accepted:
            self._end_recv(int(o["id"]))

    def _safe_path(self, name):
        name = os.path.basename(name.replace("\\", "/")).strip() or "file"
        RECV_DIR.mkdir(exist_ok=True)
        stem, suf = os.path.splitext(name)
        p, k = RECV_DIR / name, 1
        while p.exists():
            p = RECV_DIR / f"{stem}({k}){suf}"
            k += 1
        return p

    def _begin_recv(self, fid, name, size, key):
        path = self._safe_path(name)
        self.infiles[fid] = {"f": open(path, "wb"), "path": str(path), "name": name,
                             "size": size, "got": 0, "seq": 0, "last": 0, "key": key}
        self.app.event(("fbegin", self, name, size))

    def _prog(self, info, sending):
        if info["got"] - info["last"] >= 262144 or info["got"] >= info["size"]:
            info["last"] = info["got"]
            self.app.event(("prog", self, info["name"], info["got"], info["size"], sending))

    def _end_recv(self, fid):
        info = self.infiles.pop(fid, None)
        if not info:
            return
        info["f"].close()
        self.app.event(("fdone", self, info["name"], info["path"], info["got"], info["size"], info["key"]))
        if info["got"] == info["size"]:
            self._send_ctrl({"t": "ack", "k": info["key"]})

    def _writer(self):
        while self.alive:
            job = self.sendq.get()
            if job is None:
                return
            try:
                if job[0] in ("text", "file"):
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
                    self._send_file(path, disp, cleanup, key)
            except Exception as e:
                self.app.event(("ferr", self, job[-1] if job else None, str(e)))
                self.alive = False
                try:
                    self.sock.close()
                except Exception:
                    pass

    def _send_file(self, path, disp, cleanup, key):
        fid = self.fid
        self.fid += 1
        size = os.path.getsize(path)
        self._send_ctrl({"t": "fbegin", "id": fid, "n": disp, "s": size, "k": key})
        sent = seq = last = 0
        with open(path, "rb") as f:
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
        self.app.event(("fsent", self, disp, size, key))
        if cleanup:
            try:
                os.remove(path)
            except Exception:
                pass

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


class App:
    def __init__(self):
        self.settings = self._load("settings.json", {"name": socket.gethostname(), "port": 50090})
        if not self.settings.get("uid"):
            self.settings["uid"] = gen_id()
            self._save("settings.json", self.settings)
        self.contacts = self._load("contacts.json", [])
        for c in self.contacts:
            c["session"] = None
        self.events = queue.Queue()
        self.sessions = []
        self.lsock = None
        self.listening = False
        self.out_seq = 0
        self.status_at = {}
        self._build_ui()
        self._refresh_contacts()
        self._apply_listen()
        self.root.after(100, self._drain)
        self.root.after(2000, self._tick)
        self.root.protocol("WM_DELETE_WINDOW", self._quit)

    @property
    def name(self):
        return self.name_var.get().strip() or socket.gethostname()

    @property
    def uid(self):
        return self.settings.get("uid")

    @property
    def port(self):
        try:
            return int(self.port_var.get())
        except Exception:
            return self.settings.get("port", 50090)

    def _load(self, fn, default):
        try:
            return json.loads((APP_DIR / fn).read_text(encoding="utf-8"))
        except Exception:
            return default

    def _save(self, fn, obj):
        try:
            (APP_DIR / fn).write_text(json.dumps(obj, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass

    def event(self, ev):
        self.events.put(ev)

    def _build_ui(self):
        root_cls = TkinterDnD.Tk if HAS_DND else tk.Tk
        self.root = root_cls()
        self.root.title("安全传输 · AES-256-GCM + 豪密")
        self.root.geometry("980x660")
        self.root.minsize(840, 560)
        if HAS_DND:
            self.root.drop_target_register(DND_FILES)
            self.root.dnd_bind("<<Drop>>", lambda e: self._send_paths(self.root.tk.splitlist(e.data)))

        left = ttk.Frame(self.root, padding=8)
        left.pack(side="left", fill="y")
        ttk.Label(left, text="本机名称（可重复、可随时改）").pack(anchor="w")
        self.name_var = tk.StringVar(value=self.settings.get("name", socket.gethostname()))
        ne = ttk.Entry(left, textvariable=self.name_var, width=30)
        ne.pack(fill="x")
        ne.bind("<Return>", lambda _e: self._save_settings())
        ne.bind("<FocusOut>", lambda _e: self._save_settings())
        ttk.Label(left, text=f"我的ID：{self.uid}（固定不变，加好友靠它认人）",
                  foreground="#1565c0").pack(anchor="w", pady=(4, 0))
        addrs = " / ".join(local_addrs()) or "未检测到网络地址"
        ttk.Label(left, text=f"本机地址：{addrs}", wraplength=220, foreground="#555").pack(anchor="w", pady=(2, 0))
        prow = ttk.Frame(left)
        prow.pack(fill="x", pady=2)
        ttk.Label(prow, text="端口").pack(side="left")
        self.port_var = tk.StringVar(value=str(self.settings.get("port", 50090)))
        ttk.Entry(prow, textvariable=self.port_var, width=8).pack(side="left", padx=4)
        ttk.Button(prow, text="应用", width=5, command=self._apply_listen).pack(side="left")

        ttk.Label(left, text="好友（●在线 ○离线）").pack(anchor="w", pady=(8, 2))
        self.lst = tk.Listbox(left, height=18, width=36, exportselection=False, activestyle="none")
        self.lst.pack(fill="y")
        ttk.Button(left, text="添加 / 配对好友", command=self._add_pair).pack(fill="x", pady=(6, 2))
        brow = ttk.Frame(left)
        brow.pack(fill="x")
        ttk.Button(brow, text="连接", width=9, command=self._connect_selected).pack(side="left")
        ttk.Button(brow, text="删除", width=9, command=self._del_contact).pack(side="left", padx=4)

        ttk.Separator(left, orient="horizontal").pack(fill="x", pady=(10, 4))
        ttk.Label(left, text="开源协议 MIT").pack(anchor="w")
        ttk.Label(left, text="允许商用与修改，再分发时请保留版权声明",
                  wraplength=220, foreground="#666",
                  font=("Microsoft YaHei UI", 8)).pack(anchor="w")

        right = ttk.Frame(self.root, padding=8)
        right.pack(side="left", fill="both", expand=True)
        self.chat = scrolledtext.ScrolledText(right, wrap="word", state="disabled", font=("Microsoft YaHei UI", 10))
        self.chat.tag_configure("mine", foreground="#0b5cad")
        self.chat.tag_configure("st_ing", font=("Microsoft YaHei UI", 8), foreground="#8a8a8a")
        self.chat.tag_configure("st_ok", font=("Microsoft YaHei UI", 8), foreground="#2e7d32")
        self.chat.tag_configure("st_read", font=("Microsoft YaHei UI", 8), foreground="#1565c0")
        self.chat.tag_configure("fail", font=("Microsoft YaHei UI", 10, "bold"), foreground="#b00020",
                                background="#ffd6d6", lmargin1=6, lmargin2=6, spacing1=3, spacing3=3,
                                borderwidth=1, relief="solid")
        self.chat.delete("1.0", "end")
        self.chat.pack(fill="both", expand=True)

        pframe = ttk.Frame(right)
        pframe.pack(fill="x", pady=4)
        self.pb = ttk.Progressbar(pframe, maximum=1)
        self.pb.pack(side="left", fill="x", expand=True)
        self.pbl = ttk.Label(pframe, text="", width=42)
        self.pbl.pack(side="left", padx=6)

        irow = ttk.Frame(right)
        irow.pack(fill="x")
        self.inp = ttk.Entry(irow)
        self.inp.pack(side="left", fill="x", expand=True)
        self.inp.bind("<Return>", lambda _e: self._send_text())
        ttk.Button(irow, text="发送消息", command=self._send_text).pack(side="left", padx=4)

        frow = ttk.Frame(right)
        frow.pack(fill="x", pady=(4, 0))
        ttk.Button(frow, text="发送文件", command=self._pick_files).pack(side="left")
        self.path_inp = ttk.Entry(frow)
        self.path_inp.pack(side="left", fill="x", expand=True, padx=4)
        self.path_inp.bind("<Return>", lambda _e: (self._send_paths([self.path_inp.get()]), self.path_inp.delete(0, "end")))
        ttk.Label(right, text="可拖文件进窗口 / 点“发送文件” / 输入本地路径或 http(s) 网址后回车；对方 ● 在线才能送达",
                  foreground="#888").pack(anchor="w", pady=(2, 0))
        if not HAS_DND:
            self._log("未检测到 tkinterdnd2，拖放关闭，其余正常（pip install tkinterdnd2）")

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
        self._log(f"［发送失败］{text}", "fail")

    def _save_settings(self):
        self.settings["name"] = self.name
        self.settings["port"] = self.port
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
        self._save("contacts.json", [{k: v for k, v in x.items() if k != "session"} for x in self.contacts])

    @staticmethod
    def _online(c):
        s = c.get("session")
        return bool(s and s.alive and s.ready_evt.is_set())

    def _refresh_contacts(self):
        sel = self.lst.curselection()
        self.lst.delete(0, "end")
        for c in self.contacts:
            mark = "●" if self._online(c) else "○"
            self.lst.insert("end", f"{mark} {c['name']} #{c['id']}  {c['host']}:{c['port']}")
        if sel:
            try:
                self.lst.selection_set(sel[0])
            except Exception:
                pass

    def _selected(self):
        i = self.lst.curselection()
        return self.contacts[i[0]] if i else None

    def _add_pair(self):
        v = simpledialog.askstring("配对好友", "输入对方地址：IP:端口\n例：192.168.1.8:50090 或 2001:db8::2:50090\n对方的 ID 和名称会在握手后自动记录")
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
        self._connect(host.strip(), port)
        self._log(f"[系统] 正在向 {host.strip()}:{port} 发起配对，等待对方确认")

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
            self._fail_box(f"{c['name']} #{c['id']} 当前离线（○），内容未发出。选中该好友点左侧“连接”，等状态变 ● 在线后重试")
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
        for text, tag in segs:
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
            tmp_dir.mkdir(exist_ok=True)
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
        elif t == "pair":
            s = ev[1]
            if messagebox.askyesno("配对请求", f"{s.pname} #{s.puid}\n来自 {s.host}:{s.pport}\n是否加为好友？（同名不会冲突，以 ID 区分）"):
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
            self._log(f"[{s.pname} #{s.puid}] {text}")
        elif t == "sent" or t == "fsent":
            self._set_status(ev[2], [(" 〔发送成功〕", "st_ok")])
        elif t == "ack":
            self._set_status(ev[2], [(" 〔发送成功〕", "st_ok"), ("〔已读〕", "st_read")])
        elif t == "ferr":
            key, why = ev[2], ev[3]
            self._set_status(key, [(" 〔失败〕", "fail")])
            self._fail_box(f"发送未完成：{why}")
        elif t == "fbegin":
            self._log(f"[系统] 正在接收 {ev[2]}（{human(ev[3])}）→ 接收文件 文件夹")
            self.pb.configure(value=0)
        elif t == "prog":
            _s, name, done, size, sending = ev[1], ev[2], ev[3], ev[4], ev[5]
            frac = done / size if size else 1
            self.pb.configure(value=frac)
            self.pbl.configure(text=f"{'发送' if sending else '接收'} {name} {frac*100:.0f}%  {human(done)}/{human(size)}")
        elif t == "fdone":
            _s, name, path, got, size, key = ev[1], ev[2], ev[3], ev[4], ev[5], ev[6]
            self.pb.configure(value=1)
            self.pbl.configure(text="")
            note = "完整无损" if got == size else "大小异常"
            self._log(f"[系统] 接收完成：{name}（{note}）→ {path}")
        elif t == "dead":
            s = ev[1]
            if s in self.sessions:
                self.sessions.remove(s)
            c = self.find_contact_by_id(s.puid) if s.puid else self.find_contact_by_host(s.host)
            if c and c.get("session") is s:
                c["session"] = None
            self._refresh_contacts()
            self._log(f"[系统] {s.pname or s.host} {'#'+s.puid if s.puid else ''} 已离线")

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
    if "--diag" in sys.argv:
        msg = f"DnD={HAS_DND}\nAPP_DIR={APP_DIR}"
        if getattr(sys, "frozen", False):
            (APP_DIR / "diag.txt").write_text(msg, encoding="utf-8")
        else:
            print(msg)
        sys.exit(0)
    App().root.mainloop()
