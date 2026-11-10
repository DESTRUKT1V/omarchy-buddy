#!/usr/bin/env python3
# omarchy-buddy-cover against a stand-in https server on 127.0.0.1 with its
# own certificate (#251): a normal cover lands as a private file and is kept;
# too big, endless, slow, silent, plain http, a redirect to http, too many
# redirects, credentials in the address, no picture or too many pixels give
# no file and no output, always with exit 0 and in bounded time.
# Nothing leaves the machine; HOME is a sandbox. Aufruf: tests/cover-test.py
import os, socket, ssl, stat, struct, subprocess, sys, tempfile, threading, time, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from testing import check, done, sandbox_env  # noqa: E402

HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "omarchy-buddy-cover")
HOME = tempfile.mkdtemp(prefix="omarchy-buddy-cover-")
COVERS = os.path.join(HOME, "run", "omarchy-buddy", "covers")
SECONDS = 2  # the helper's whole-answer limit for this run (it may only be shortened)


def png(w, h):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    raw = b"".join(b"\0" + b"\x80\x40\x20" * w for _ in range(min(h, 4)))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def jpeg(w, h):  # header up to the frame: enough for the size check
    return b"\xff\xd8" + b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + b"\xff\xc0\x00\x11\x08" + struct.pack(">HH", h, w) + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01" + b"\xff\xd9"


def webp(w, h):
    body = b"VP8X" + struct.pack("<I", 10) + b"\0\0\0\0" + (w - 1).to_bytes(3, "little") + (h - 1).to_bytes(3, "little")
    return b"RIFF" + struct.pack("<I", 4 + len(body)) + b"WEBP" + body


seen = []
http_seen = []


class Stand(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, data, kind="image/png"):
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def go(self, where):
        self.send_response(302)
        self.send_header("Location", where)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        seen.append(self.path)
        p = self.path.split("?")[0]
        try:
            if p == "/cover.png":
                self.send(png(64, 64))
            elif p == "/cover.jpg":
                self.send(jpeg(640, 640), "image/jpeg")
            elif p == "/cover.webp":
                self.send(webp(300, 300), "image/webp")
            elif p == "/huge.png":
                self.send(png(20000, 20000))
            elif p == "/huge.jpg":
                self.send(jpeg(30000, 100), "image/jpeg")
            elif p == "/page.html":
                self.send(b"<html>no picture</html>", "text/html")
            elif p == "/big.png":  # announced and sent: 5 MiB
                self.send(png(64, 64) + b"\0" * (5 * 2**20))
            elif p == "/endless.png":  # no length, never ends
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.end_headers()
                self.wfile.write(png(64, 64))
                while True:
                    self.wfile.write(b"\0" * 65536)
            elif p == "/slow.png":  # a byte now and then: each read is in time, the whole is not
                self.send_response(200)
                self.send_header("Content-Length", "100000")
                self.end_headers()
                for _ in range(100000):
                    self.wfile.write(b"\0")
                    self.wfile.flush()
                    time.sleep(0.2)
            elif p == "/silent.png":  # answers nothing at all
                time.sleep(SECONDS + 10)
            elif p == "/to-cover":
                self.go(f"https://127.0.0.1:{PORT}/cover.png")
            elif p == "/to-http":
                self.go(f"http://127.0.0.1:{HTTP_PORT}/cover.png")
            elif p == "/loop":  # always somewhere new
                self.go(f"/loop?{len(seen)}")
            elif p == "/same":  # always the same place
                self.go("/same")
            else:
                self.send_error(404)
        except (BrokenPipeError, ConnectionResetError, ssl.SSLError, OSError):
            pass


class Plain(Stand):
    def do_GET(self):
        http_seen.append(self.path)
        self.send(png(64, 64))


# A certificate for 127.0.0.1, trusted through SSL_CERT_FILE only for the helper.
cert = os.path.join(HOME, "cert.pem")
key = os.path.join(HOME, "key.pem")
subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1",
                "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], check=True, capture_output=True)
server = ThreadingHTTPServer(("127.0.0.1", 0), Stand)
server.daemon_threads = True
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(cert, key)
server.socket = ctx.wrap_socket(server.socket, server_side=True)
PORT = server.server_address[1]
threading.Thread(target=server.serve_forever, daemon=True).start()
plain = ThreadingHTTPServer(("127.0.0.1", 0), Plain)
plain.daemon_threads = True
HTTP_PORT = plain.server_address[1]
threading.Thread(target=plain.serve_forever, daemon=True).start()

ENV = sandbox_env(HOME, SSL_CERT_FILE=cert, OMARCHY_BUDDY_COVER_SECONDS=str(SECONDS), no_proxy="127.0.0.1", NO_PROXY="127.0.0.1")
os.makedirs(os.path.join(HOME, "run"), exist_ok=True)


def cover(url, env=ENV):
    start = time.monotonic()
    p = subprocess.run([HELPER], input=url, env=env, capture_output=True, text=True, timeout=SECONDS + 20)
    return p.returncode, p.stdout.strip(), time.monotonic() - start


def files():
    return sorted(os.listdir(COVERS)) if os.path.isdir(COVERS) else []


url = f"https://127.0.0.1:{PORT}"

# 1. A normal cover: a private file, its address printed, kept for the next time.
code, out, _ = cover(url + "/cover.png")
path = out[len("file://"):]
check("Cover: Datei unter XDG_RUNTIME_DIR/omarchy-buddy/covers", code == 0 and out.startswith("file://" + COVERS + "/") and out.endswith(".png") and os.path.isfile(path), out)
check("Cover: Ordner 700, Datei 600", stat.S_IMODE(os.stat(COVERS).st_mode) == 0o700 and stat.S_IMODE(os.stat(path).st_mode) == 0o600)
check("Cover: Inhalt unverändert", open(path, "rb").read() == png(64, 64))
before = len(seen)
code, again, _ = cover(url + "/cover.png")
check("Cover: zweites Mal aus der Datei, ohne Netz", again == out and len(seen) == before)
for name, ext in (("cover.jpg", ".jpg"), ("cover.webp", ".webp")):
    code, out, _ = cover(f"{url}/{name}")
    check(f"Cover: {ext[1:].upper()} erkannt", out.endswith(ext) and os.path.isfile(out[7:]), out)
code, out, _ = cover(url + "/to-cover")
check("Cover: Weiterleitung https → https", out.endswith(".png"), out)

# 2. Everything else: no output, no file, exit 0, in bounded time.
known = files()
cases = {
    "zu groß (5 MiB)": url + "/big.png",
    "endlos": url + "/endless.png",
    "zu langsam": url + "/slow.png",
    "Server schweigt": url + "/silent.png",
    "kein Bild (HTML)": url + "/page.html",
    "zu viele Pixel (PNG)": url + "/huge.png",
    "zu viele Pixel (JPEG)": url + "/huge.jpg",
    "Weiterleitung auf http": url + "/to-http",
    "zu viele Weiterleitungen": url + "/loop",
    "Weiterleitung im Kreis": url + "/same",
    "Name und Passwort in der Adresse": f"https://user:secret@127.0.0.1:{PORT}/cover.png",
    "nur http": f"http://127.0.0.1:{HTTP_PORT}/cover.png",
    "anderes Schema": f"ftp://127.0.0.1:{PORT}/cover.png",
    "nicht erreichbar": "https://127.0.0.1:1/cover.png",
    "leer": "",
}
for name, u in cases.items():
    code, out, took = cover(u)
    check(f"Kein Cover: {name}", code == 0 and out == "" and files() == known, f"code={code} out={out!r} files={files()}")
    check(f"Kein Cover: {name} – in der Zeitgrenze", took < SECONDS + 4, f"{took:.1f} s")
check("Kein Cover: http-Server nie angefragt", http_seen == [], http_seen)
for name in ("/loop", "/same"):
    check(f"Kein Cover: Weiterleitung höchstens 3-mal gefolgt ({name})", sum(p.split("?")[0] == name for p in seen) <= 4, [p for p in seen if p.split("?")[0] == name])
check("Kein Cover: keine halbe Datei", not any(f.endswith(".part") for f in files()))

# 3. A longer limit than 10 s cannot be set from outside.
src = open(HELPER).read()
check("Zeitgrenze: höchstens 10 s, auch per Umgebung", "min(10.0," in src)

# 4. Only the newest 32 files stay.
os.makedirs(COVERS, exist_ok=True)
for i in range(40):
    p = os.path.join(COVERS, f"{i:032x}.png")
    open(p, "wb").close()
    os.utime(p, (1000 + i, 1000 + i))
cover(url + "/cover.png?neu")
check("Aufräumen: höchstens 32 Dateien", len(files()) <= 32, len(files()))
check("Aufräumen: die ältesten gehen", not os.path.exists(os.path.join(COVERS, f"{0:032x}.png")))

server.shutdown()
plain.shutdown()
done()
