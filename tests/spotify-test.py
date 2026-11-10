#!/usr/bin/env python3
# omarchy-buddy-spotify against a stand-in for Spotify (#121): the sign-in
# with PKCE (a fake xdg-open plays the browser and the user), the tokens'
# file (600, never printed), refreshing, checking, saving and removing a
# track, and each error the island shows; a refresh answered late after
# disconnecting or connecting again (#253). Nothing reaches Spotify; HOME is a sandbox.
# Aufruf: tests/spotify-test.py
import base64, hashlib, json, os, socket, stat, subprocess, sys, tempfile, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from testing import check, done, sandbox_env  # noqa: E402

HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "omarchy-buddy-spotify")
HOME = tempfile.mkdtemp(prefix="omarchy-buddy-spotify-")
FILE = os.path.join(HOME, ".local/state/omarchy-buddy/spotify.json")
TRACK = "spotify:track:4uLU6hMCjMI75M1A2tKUQC"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# What the stand-in does: how the user answers in the browser, which
# answers the API gives, and what it has seen.
spot = {"deny": False, "api": 200, "revoked": False, "saved": set(), "challenge": "", "issued": [], "refreshes": 0, "bad": [],
        "hold": None, "real": False, "late": []}
arrived = threading.Event()  # a held refresh reached the stand-in


class Spotify(BaseHTTPRequestHandler):
    def reply(self, status, body=None, location=None):
        self.send_response(status)
        if location:
            self.send_header("Location", location)
        data = json.dumps(body).encode() if body is not None else b""
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def token(self):
        n = len(spot["issued"])
        access, refresh = f"ACCESS-{n}-secret", f"REFRESH-{n}-secret"
        spot["issued"] += [access, refresh]
        return {"access_token": access, "token_type": "Bearer", "expires_in": 3600, "refresh_token": refresh,
                "scope": "user-library-read user-library-modify"}

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        if url.path == "/authorize":
            if q.get("code_challenge_method") != "S256" or "user-library-modify" not in q.get("scope", "") \
                    or not q.get("redirect_uri", "").startswith("http://127.0.0.1:"):
                spot["bad"].append("authorize " + url.query)
            spot["challenge"] = q.get("code_challenge", "")
            answer = {"error": "access_denied"} if spot["deny"] else {"code": "CODE-1"}
            self.reply(302, location=q["redirect_uri"] + "?" + urllib.parse.urlencode(dict(answer, state=q.get("state", ""))))
        elif url.path == "/v1/me/library/contains":
            self.api(lambda: [q.get("uris") in spot["saved"]])
        else:
            self.reply(404)

    def do_PUT(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        self.api(lambda: spot["saved"].add(q.get("uris")))

    def do_DELETE(self):
        q = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query))
        if not self.path.startswith("/v1/me/library?"):
            return self.reply(404)
        self.api(lambda: spot["saved"].discard(q.get("uris")))

    def api(self, act):
        if self.headers.get("Authorization") != "Bearer " + (spot["issued"][-2] if spot["issued"] else "-"):
            return self.reply(401, {"error": {"status": 401, "message": "The access token expired"}})
        if spot["api"] != 200:
            return self.reply(spot["api"], {"error": {"status": spot["api"]}})
        result = act()
        self.reply(200, result)

    def do_POST(self):
        form = dict(urllib.parse.parse_qsl(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()))
        if self.path != "/api/token" or form.get("client_id") != "abc123":
            return self.reply(400, {"error": "invalid_client"})
        if form.get("grant_type") == "authorization_code":
            want = base64.urlsafe_b64encode(hashlib.sha256(form.get("code_verifier", "").encode()).digest()).rstrip(b"=").decode()
            if form.get("code") != "CODE-1" or want != spot["challenge"] or "client_secret" in form:
                return self.reply(400, {"error": "invalid_grant"})
            return self.reply(200, self.token())
        if form.get("grant_type") == "refresh_token":
            spot["refreshes"] += 1
            if spot["revoked"] or form.get("refresh_token") != spot["issued"][-1]:
                return self.reply(400, {"error": "invalid_grant", "error_description": "Refresh token revoked"})
            if spot["hold"]:  # answers only once the test lets go: a late reply for the old tokens
                release, spot["hold"] = spot["hold"], None
                arrived.set()
                release.wait(20)
                if spot["real"]:
                    return self.reply(200, self.token())
                n = len(spot["late"])
                late = {"access_token": f"LATE-ACCESS-{n}-secret", "token_type": "Bearer", "expires_in": 3600,
                        "refresh_token": f"LATE-REFRESH-{n}-secret"}
                spot["late"] += [late["access_token"], late["refresh_token"]]
                return self.reply(200, late)
            return self.reply(200, self.token())
        self.reply(400, {"error": "unsupported_grant_type"})

    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(("127.0.0.1", 0), Spotify)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f"http://127.0.0.1:{server.server_address[1]}"

# The browser: follows Spotify's redirect to the helper's callback.
bindir = os.path.join(HOME, "bin")
os.makedirs(bindir)
with open(os.path.join(bindir, "xdg-open"), "w") as f:
    f.write(f"#!{sys.executable}\nimport sys, urllib.request\nurllib.request.urlopen(sys.argv[1], timeout=10).read()\n")
os.chmod(os.path.join(bindir, "xdg-open"), 0o755)

ENV = sandbox_env(HOME, PATH=bindir + os.pathsep + os.environ["PATH"], OMARCHY_BUDDY_SPOTIFY_ACCOUNTS=base,
                  OMARCHY_BUDDY_SPOTIFY_API=base + "/v1", OMARCHY_BUDDY_SPOTIFY_PORT=str(free_port()))
REDIRECT = f"http://127.0.0.1:{ENV['OMARCHY_BUDDY_SPOTIFY_PORT']}/callback"
printed = []


def run(*args):
    r = subprocess.run([sys.executable, HELPER, *args], env=ENV, capture_output=True, text=True, timeout=30)
    printed.append(r.stdout + r.stderr)
    try:
        return r.returncode, json.loads(r.stdout)
    except ValueError:
        return r.returncode, {"raw": r.stdout, "stderr": r.stderr}


def stored():
    with open(FILE) as f:
        return json.load(f)


check("ohne Verbindung: nicht verbunden", run("status") == (0, {"connected": False, "clientId": "", "redirect": REDIRECT}))
check("ohne Verbindung: check sagt unconnected", run("check", TRACK)[1] == {"error": "unconnected", "uri": TRACK})
check("Client-ID wird geprüft", run("connect", "abc/../x")[1] == {"error": "clientid"})

spot["deny"] = True
check("im Browser abgelehnt: cancelled", run("connect", "abc123")[1] == {"error": "cancelled"})
check("abgelehnt: keine Datei", not os.path.exists(FILE))
spot["deny"] = False

code, r = run("connect", "abc123")
check("verbinden mit PKCE", (code, r) == (0, {"connected": True}), r)
check("Spotify bekam eine richtige Anfrage", not spot["bad"], spot["bad"])
check("Tokens in spotify.json (600)", stat.S_IMODE(os.stat(FILE).st_mode) == 0o600 and stored().get("refresh_token") == "REFRESH-0-secret")
check("Status: verbunden mit Client-ID", run("status")[1] == {"connected": True, "clientId": "abc123", "redirect": REDIRECT})

check("noch nicht gespeichert", run("check", TRACK)[1] == {"uri": TRACK, "saved": False})
check("speichern", run("save", TRACK)[1] == {"uri": TRACK, "saved": True})
check("danach gespeichert", run("check", TRACK)[1] == {"uri": TRACK, "saved": True})
check("entfernen (#163)", run("remove", TRACK)[1] == {"uri": TRACK, "saved": False})
check("danach nicht mehr gespeichert", run("check", TRACK)[1] == {"uri": TRACK, "saved": False})
check("wieder speichern", run("save", TRACK)[1] == {"uri": TRACK, "saved": True})
check("entfernen nur Titel", run("remove", "spotify:album:x")[1] == {"error": "failed", "uri": "spotify:album:x"})
check("nur Titel, keine anderen URIs", run("save", "spotify:playlist:x")[1].get("error") == "failed")

data = stored()
data["expires_at"] = 0
with open(FILE, "w") as f:
    json.dump(data, f)
before = spot["refreshes"]
check("abgelaufenes Token wird erneuert", run("check", TRACK)[1] == {"uri": TRACK, "saved": True} and spot["refreshes"] == before + 1)
check("neues Refresh-Token gespeichert", stored().get("refresh_token") == spot["issued"][-1])

spot["issued"].append("ACCESS-x")  # Spotify revoked the access token early
spot["issued"].append(stored()["refresh_token"])
check("früh widerrufenes Token: einmal erneuert", run("check", TRACK)[1] == {"uri": TRACK, "saved": True})

for status, error in ((403, "forbidden"), (429, "limit"), (500, "failed")):
    spot["api"] = status
    check(f"API {status} → {error}", run("save", TRACK)[1] == {"error": error, "uri": TRACK})
    check(f"entfernen: API {status} → {error}", run("remove", TRACK)[1] == {"error": error, "uri": TRACK})
spot["api"] = 200

spot["revoked"] = True
data = stored()
data["expires_at"] = 0
with open(FILE, "w") as f:
    json.dump(data, f)
check("Zugriff widerrufen → expired", run("check", TRACK)[1] == {"error": "expired", "uri": TRACK})
spot["revoked"] = False

ENV["OMARCHY_BUDDY_SPOTIFY_API"] = f"http://127.0.0.1:{free_port()}/v1"
data = stored()
data["expires_at"] = 9e9
with open(FILE, "w") as f:
    json.dump(data, f)
check("ohne Netz → offline", run("check", TRACK)[1] == {"error": "offline", "uri": TRACK})
ENV["OMARCHY_BUDDY_SPOTIFY_API"] = base + "/v1"

busy = socket.socket()
busy.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
busy.bind(("127.0.0.1", int(ENV["OMARCHY_BUDDY_SPOTIFY_PORT"])))
busy.listen()
check("Port belegt → port", run("connect")[1] == {"error": "port"})
busy.close()

check("trennen", run("disconnect")[1] == {"connected": False})
check("getrennt: Client-ID bleibt, Tokens weg", set(stored()) == {"client_id", "generation"} and stored()["client_id"] == "abc123" and run("status")[1] == {"connected": False, "clientId": "abc123", "redirect": REDIRECT})
check("neu verbinden ohne ID nimmt die alte", run("connect")[1] == {"connected": True})


def late_refresh(meanwhile):
    """A check whose token refresh Spotify answers only after meanwhile() ran; its reply."""
    data = stored()
    data["expires_at"] = 0
    with open(FILE, "w") as f:
        json.dump(data, f)
    release = threading.Event()
    arrived.clear()
    spot["hold"] = release
    slow = subprocess.Popen([sys.executable, HELPER, "check", TRACK], env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    check("späte Erneuerung: Anfrage unterwegs", arrived.wait(10))
    meanwhile()
    release.set()
    outs, errs = slow.communicate(timeout=30)
    printed.append(outs + errs)
    return json.loads(outs)


# Refresh, then "Trennen" before Spotify answers (#253): the old tokens stay gone.
r = late_refresh(lambda: check("späte Erneuerung: trennen", run("disconnect")[1] == {"connected": False}))
check("Erneuern nach Trennen: Antwort verworfen", r == {"error": "unconnected", "uri": TRACK}, r)
data = stored()
check("Erneuern nach Trennen: keine Tokens zurück", set(data) == {"client_id", "generation"} and data["client_id"] == "abc123", sorted(data))
check("Erneuern nach Trennen: Status getrennt", run("status")[1]["connected"] is False)
check("Erneuern nach Trennen: Prüfen sagt unconnected", run("check", TRACK)[1] == {"error": "unconnected", "uri": TRACK})

# Refresh for account A, account B connects before Spotify answers: B stays.
check("Konto A verbinden", run("connect")[1] == {"connected": True})
a = stored()
b = {}


def connect_b():
    check("Konto B verbinden, während A erneuert", run("connect")[1] == {"connected": True})
    b.update(stored())


r = late_refresh(connect_b)
check("Erneuern A nach Verbinden B: Antwort verworfen", r == {"error": "unconnected", "uri": TRACK}, r)
check("Erneuern A nach Verbinden B: B bleibt gespeichert", stored() == b and b["refresh_token"] != a["refresh_token"]
      and b["generation"] != a["generation"], sorted(stored()))
check("nirgends ein spätes Token", not any(s in json.dumps(stored()) for s in spot["late"]))
check("Konto B: Prüfen geht", run("check", TRACK)[1] == {"uri": TRACK, "saved": True})
check("Konto B: Speichern geht", run("save", TRACK)[1] == {"uri": TRACK, "saved": True})

# Answered late with nothing in between: an ordinary refresh, stored.
spot["real"] = True
r = late_refresh(lambda: None)
spot["real"] = False
check("späte Erneuerung ohne Wechsel: geht", r == {"uri": TRACK, "saved": True}, r)
check("späte Erneuerung ohne Wechsel: gespeichert", stored()["refresh_token"] == spot["issued"][-1] and stored()["generation"] == b["generation"])

leaked = [s for s in spot["issued"] + spot["late"] if any(s in p for p in printed)]
check("kein Token in der Ausgabe", not leaked, leaked)
check("Ausgabe immer eine JSON-Zeile", all(p.count("\n") == 1 for p in printed), [p for p in printed if p.count("\n") != 1])

server.shutdown()
done()
