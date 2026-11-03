#!/usr/bin/env python3
# Freigaben im Hook mit simulierten Hook-Eingaben prüfen, in eigenen
# XDG_RUNTIME_DIR/XDG_STATE_HOME/XDG_CONFIG_HOME (die echte Insel sieht
# nichts davon). Aufruf: tests/hook-test.py
import json, os, re, shutil, signal, subprocess, sys, tempfile, threading, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from testing import check, done, sandbox_env  # noqa: E402

HOOK = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "omarchy-buddy-hook")
RT = tempfile.mkdtemp(prefix="omarchy-buddy-test-")
# German texts, whatever the system says (case 18 checks English).
ENV = dict(os.environ, LC_ALL="", LC_MESSAGES="", LANG="de_DE.UTF-8", XDG_RUNTIME_DIR=RT, XDG_STATE_HOME=os.path.join(RT, "state"), XDG_CONFIG_HOME=os.path.join(RT, "config"),
           ORCA_PANE_KEY="fake:pane", ORCA_WORKTREE_ID="fake", HYPRLAND_INSTANCE_SIGNATURE="test")
ENV.pop("CLAUDE_CONFIG_DIR", None)  # the main Claude account (case 13 tests a further one)
STATE = os.path.join(RT, "omarchy-buddy", "state.json")


def island_alive():
    """The island's sign of life: without it the hook does not wait."""
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    open(os.path.join(RT, "omarchy-buddy", "island"), "w").close()


def start(event):
    island_alive()
    p = subprocess.Popen([HOOK], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV, text=True)
    p.stdin.write(json.dumps(event)); p.stdin.close()
    return p


def run(*args, event=None):
    return subprocess.run([HOOK, *args], input=json.dumps(event) if event else "", env=ENV, capture_output=True, text=True)


def state():
    with open(STATE) as f:
        return json.load(f)


def requests(sid="s1"):
    return state().get(sid, {}).get("requests", [])


def wait_requests(n, sid="s1"):
    for _ in range(50):
        try:
            if len(requests(sid)) == n:
                return True
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    return False


def perm(cmd, agent=None, suggestions=None, sid="s1", description=None):
    e = {"hook_event_name": "PermissionRequest", "session_id": sid, "cwd": "/x/proj",
         "tool_name": "Bash", "tool_input": {"command": cmd}}
    if description is not None:
        e["tool_input"]["description"] = description
    if agent:
        e.update(agent_id="id-" + agent, agent_type=agent)
    if suggestions:
        e["permission_suggestions"] = suggestions
    return e


SUG = [{"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "rm -rf build:*"}],
        "behavior": "allow", "destination": "localSettings"}]

# 1. Two subagents ask in the same session; each decision reaches only its hook.
a = start(perm("rm -rf build\necho fertig", "Explore", SUG))
wait_requests(1)
b = start(perm("git push", "general-purpose", description="  Änderungen\n hochladen "))
check("zwei offene Anfragen", wait_requests(2))
ra, rb = requests()
check("Reihenfolge und Text", ra["detail"] == "rm -rf build echo fertig" and rb["detail"] == "git push")
check("voller Befehl mit Zeilenumbruch", ra["full"] == "rm -rf build\necho fertig")
check("Regeltext", ra["always"] == "Bash(rm -rf build:*) – dieses Projekt (nur bei dir)")
check("Agent", ra["agent"] == "Explore")
check("Claudes Beschreibung über dem Befehl (#193)", rb.get("description") == "Änderungen hochladen" and "description" not in ra)
run("--decide", "s1", rb["id"], "deny")
out_b = b.communicate(timeout=3)[0]
dec_b = json.loads(out_b)["hookSpecificOutput"]["decision"]
check("b abgelehnt", dec_b["behavior"] == "deny" and dec_b["message"] == "Abgelehnt über O-Morchy.")
check("a wartet weiter", a.poll() is None and [r["id"] for r in requests()] == [ra["id"]])
check("Sitzung bleibt needs", state()["s1"]["state"] == "needs")
run("--decide", "s1", ra["id"], "always")
out_a = json.loads(a.communicate(timeout=3)[0])["hookSpecificOutput"]["decision"]
check("a immer erlaubt", out_a["behavior"] == "allow" and out_a["updatedPermissions"] == SUG)
check("danach working, keine Anfragen", state()["s1"]["state"] == "working" and "requests" not in state()["s1"])
check("decide leer", os.listdir(os.path.join(RT, "omarchy-buddy", "decide")) == [])

# 2. Unknown request id is ignored (no decision for a request the user did not see).
c = start(perm("ls"))
wait_requests(1)
run("--decide", "s1", "999-1", "allow")
run("--decide", "s1", "../state.json", "allow")
time.sleep(0.5)
check("fremde ID ignoriert", c.poll() is None)
rc = requests()[0]
run("--decide", "s1", rc["id"], "allow")
out_c = json.loads(c.communicate(timeout=3)[0])["hookSpecificOutput"]["decision"]
check("allow ohne updatedPermissions", out_c == {"behavior": "allow"})

# 3. Focus ends all waits of the session without output.
d = start(perm("one", "x")); wait_requests(1)
e = start(perm("two", "y")); wait_requests(2)
run("--decide", "s1", "focus")
check("focus: keine Ausgabe", d.communicate(timeout=3)[0] == "" and e.communicate(timeout=3)[0] == "")
check("focus: Anfragen weg, needs bleibt", "requests" not in state()["s1"] and state()["s1"]["state"] == "needs")

# 4. Claude kills the hook (Escape): SIGTERM cleans up, exit 0.
f = start(perm("sleep")); wait_requests(1)
f.send_signal(signal.SIGTERM)
f.wait(timeout=3)
check("SIGTERM: Exit 0", f.returncode == 0)
check("SIGTERM: Anfrage weg", "requests" not in state()["s1"])
f = start(perm("sleep")); wait_requests(1)
f.send_signal(signal.SIGINT)
check("SIGINT: Exit 0, kein Traceback", f.wait(timeout=3) == 0 and f.stderr.read() == "")
check("SIGINT: Anfrage weg", "requests" not in state()["s1"])

# 4a. "needs" and the request come in one write: never "needs" without the request,
#     even with a slow hyprctl (the hook looks for the window first).
stub = os.path.join(RT, "stub")
os.makedirs(stub)
with open(os.path.join(stub, "hyprctl"), "w") as f:
    f.write('#!/bin/sh\ncase "$1" in activewindow) sleep 1; echo \'{"address": "0xother"}\';; *) echo "[]";; esac\n')
os.chmod(os.path.join(stub, "hyprctl"), 0o755)
with open(STATE) as f:
    s0 = json.load(f)
s0["view"] = {"window": "0xabc", "pid": os.getpid(), "state": "working", "updated": time.time()}
with open(STATE, "w") as f:
    json.dump(s0, f)
island_alive()
p = subprocess.Popen([HOOK], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                     env=dict(ENV, PATH=stub + os.pathsep + ENV["PATH"]))
p.stdin.write(json.dumps(perm("ls", sid="view"))); p.stdin.close()
gap, end = False, time.time() + 2.5
while time.time() < end and not requests("view"):
    try:
        r = state().get("view", {})
        gap = gap or (r.get("state") == "needs" and not r.get("requests"))
    except (OSError, ValueError):
        pass
    time.sleep(0.02)
check("needs und Anfrage in einem Schritt", requests("view") and not gap)
p.send_signal(signal.SIGTERM); p.wait(timeout=3)

# 4a2. The terminal is in view (its window has the focus): the island still
#      gets the request, the hook keeps waiting and takes the island's answer.
with open(os.path.join(stub, "hyprctl"), "w") as f:
    f.write('#!/bin/sh\ncase "$1" in activewindow) echo \'{"address": "0xabc"}\';; *) echo "[]";; esac\n')
plain = {k: v for k, v in ENV.items() if not k.startswith("ORCA_")}
s0 = state()
s0["view"] = {"window": "0xabc", "pid": os.getpid(), "state": "working", "updated": time.time()}
with open(STATE, "w") as f:
    json.dump(s0, f)
island_alive()
p = subprocess.Popen([HOOK], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                     env=dict(plain, PATH=stub + os.pathsep + ENV["PATH"]))
p.stdin.write(json.dumps(perm("ls", sid="view"))); p.stdin.close()
check("im Blick: Anfrage steht in der Insel", wait_requests(1, "view"))
time.sleep(2)
check("im Blick: Hook wartet weiter", p.poll() is None and len(requests("view")) == 1)
run("--decide", "view", requests("view")[0]["id"], "allow")
out_v = json.loads(p.communicate(timeout=3)[0])["hookSpecificOutput"]["decision"]
check("im Blick: Antwort aus der Insel", out_v == {"behavior": "allow"} and "requests" not in state()["view"])

# 4a3. Only a living island gets to wait (#149): without its sign of life,
#      with an old one or without Hyprland the terminal asks at once.
island_file = os.path.join(RT, "omarchy-buddy", "island")
for what, env, age in (("ohne Lebenszeichen", ENV, None), ("altes Lebenszeichen", ENV, 20),
                       ("ohne Hyprland", {k: v for k, v in ENV.items() if k != "HYPRLAND_INSTANCE_SIGNATURE"}, 0)):
    island_alive()
    if age is None:
        os.remove(island_file)
    else:
        os.utime(island_file, (time.time() - age,) * 2)
    began = time.time()
    r = subprocess.run([HOOK], input=json.dumps(perm("ls", sid="dead")), env=env, capture_output=True, text=True, timeout=10)
    rec = state().get("dead", {})
    check(f"{what}: sofort zurück, Terminal fragt", time.time() - began < 3 and r.returncode == 0 and r.stdout == "")
    check(f"{what}: braucht dich, ohne Anfrage", rec.get("state") == "needs" and rec.get("detail") == "ls" and "requests" not in rec)

# 4b. A command too long for the island says so; a short one does not.
f = start(perm("echo " + "x" * 5000)); wait_requests(1)
rf = requests()[0]
check("langer Befehl: gekürzt markiert", rf.get("truncated") is True and rf["full"].endswith(" …") and len(rf["full"]) == 4002)
f.send_signal(signal.SIGTERM); f.wait(timeout=3)
f = start(perm("echo " + "x" * 3995)); wait_requests(1)
check("Befehl genau an der Grenze: nicht markiert", "truncated" not in requests()[0])
f.send_signal(signal.SIGTERM); f.wait(timeout=3)

# 5. SIGKILL leaves the request; --prune removes it.
g = start(perm("kill")); wait_requests(1)
g.kill(); g.wait()
check("SIGKILL: Anfrage bleibt erst", len(requests()) == 1)
run("--prune")
check("prune: Anfrage weg", "requests" not in state().get("s1", {}))

# 6. Notification after the hook keeps the specific text.
run(event={"hook_event_name": "Notification", "session_id": "s1", "cwd": "/x/proj",
           "notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash"})
check("Notification überschreibt Text nicht", state()["s1"]["detail"] == "kill")
# Without a hook before it: a German text, and no tool left over from earlier.
run(event={"hook_event_name": "PreToolUse", "session_id": "s7", "cwd": "/x/proj", "tool_name": "Read",
           "tool_use_id": "t7", "tool_input": {"file_path": "/x/a"}})
run(event={"hook_event_name": "Notification", "session_id": "s7", "cwd": "/x/proj",
           "notification_type": "permission_prompt", "message": "Claude needs your permission to use Bash"})
check("Notification: deutsch, tool leer", state()["s7"]["detail"] == "Freigabe für Bash im Terminal"
      and state()["s7"]["tool"] == "" and state()["s7"]["state"] == "needs")
run(event={"hook_event_name": "Notification", "session_id": "s8", "cwd": "/x/proj",
           "notification_type": "elicitation_dialog", "message": "MCP server needs input"})
check("Notification: Eingabe für MCP", state()["s8"]["detail"] == "Eingabe für einen MCP-Server im Terminal")

# 6b. --prune: a session without a hook event for 12 hours goes (no pid to check).
def age(sid, seconds):
    data = state()
    data[sid]["updated"] = time.time() - seconds
    data[sid].pop("pid", None)
    with open(STATE, "w") as f:
        json.dump(data, f)
age("s7", 12 * 3600 + 60); age("s8", 11 * 3600)
run("--prune")
check("prune: 12 h alt weg, 11 h bleibt", "s7" not in state() and "s8" in state())
before = os.stat(STATE).st_ino  # (every write is a new file: os.replace)
run("--prune")
check("prune: nichts zu tun, nichts geschrieben", os.stat(STATE).st_ino == before)
run(event={"hook_event_name": "SessionEnd", "session_id": "s8"})

# 7. Broken input never fails.
r = subprocess.run([HOOK], input="{kaputt", env=ENV, capture_output=True, text=True)
check("kaputte Eingabe: Exit 0", r.returncode == 0)
r = run("--decide", "nix", "focus")
check("decide ohne Sitzung: Exit 0", r.returncode == 0)
# The starter (bin/) with a broken lib/hook.py: still exit 0, the error on stderr.
broken = os.path.join(RT, "kaputt-plugin")
os.makedirs(os.path.join(broken, "bin")); os.makedirs(os.path.join(broken, "lib"))
shutil.copy(HOOK, os.path.join(broken, "bin"))
open(os.path.join(broken, "lib", "hook.py"), "w").write("def (\n")
r = subprocess.run([os.path.join(broken, "bin", "omarchy-buddy-hook")], input="{}", env=ENV, capture_output=True, text=True)
check("kaputtes lib/hook.py: Exit 0 mit Meldung", r.returncode == 0 and r.stderr.startswith("omarchy-buddy-hook: "))

# 8. Privacy: folders 700, files 600, an old 644 file is fixed on the next write.
mode = lambda p: os.stat(p).st_mode & 0o777
DIR = os.path.dirname(STATE)
os.chmod(STATE, 0o644); os.chmod(DIR, 0o755)
run(event={"hook_event_name": "UserPromptSubmit", "session_id": "s2", "cwd": "/x/proj"})
check("Rechte: Ordner 700", mode(DIR) == 0o700)
check("Rechte: state.json 600", mode(STATE) == 0o600)
check("Rechte: lock 600", mode(os.path.join(DIR, "lock")) == 0o600)
h = start(perm("rechte", sid="s3")); wait_requests(1, "s3")
run("--decide", "s3", str(requests("s3")[0]["id"]), "deny"); h.wait(timeout=5)
check("Rechte: decide 700", mode(os.path.join(DIR, "decide")) == 0o700)

# omarchy-buddy-say: news.json and its folder (own XDG_STATE_HOME).
SAY = os.path.join(os.path.dirname(HOOK), "omarchy-buddy-say")
news_dir = os.path.join(RT, "state", "omarchy-buddy")
os.makedirs(news_dir); os.chmod(news_dir, 0o755)
with open(os.path.join(news_dir, "news.json"), "w") as f:
    f.write("[]")
os.chmod(os.path.join(news_dir, "news.json"), 0o644)
subprocess.run([SAY, "Test"], env=dict(ENV, XDG_STATE_HOME=os.path.join(RT, "state")), check=True)
check("omarchy-buddy-say: Ordner 700", mode(news_dir) == 0o700)
check("omarchy-buddy-say: news.json 600", mode(os.path.join(news_dir, "news.json")) == 0o600)
check("omarchy-buddy-say: lock 600", mode(os.path.join(news_dir, "lock")) == 0o600)
# A gallery's test items (key buddy-test-…) push no real item out of the 100 (#126).
with open(os.path.join(news_dir, "news.json"), "w") as f:
    json.dump([{"time": i, "title": f"echt{i}"} for i in range(1, 100)], f)
for k in range(3):
    subprocess.run([SAY, "--key", f"buddy-test-{k}", "Galerie"], env=dict(ENV, XDG_STATE_HOME=os.path.join(RT, "state")), check=True)
titles = [i["title"] for i in json.load(open(os.path.join(news_dir, "news.json")))]
check("omarchy-buddy-say: Test-Neuigkeiten drücken keine echten hinaus", len(titles) == 102 and "echt1" in titles)
subprocess.run([SAY, "echt100"], env=dict(ENV, XDG_STATE_HOME=os.path.join(RT, "state")), check=True)
subprocess.run([SAY, "echt101"], env=dict(ENV, XDG_STATE_HOME=os.path.join(RT, "state")), check=True)
titles = [i["title"] for i in json.load(open(os.path.join(news_dir, "news.json")))]
check("omarchy-buddy-say: echte Grenze bleibt 100", len(titles) == 103 and "echt1" not in titles and "echt2" in titles)
# --popup-only (#173): only for the island's pop-up; after a minute it leaves news.json,
# as do finished runs from before #173 (done-… at level good), errors stay.
with open(os.path.join(news_dir, "news.json"), "w") as f:
    json.dump([{"time": 1, "title": "alt fertig", "level": "good", "key": "done-a-1"},
               {"time": 2, "title": "alt Fehler", "level": "error", "key": "done-b-2"},
               {"time": 3, "title": "alt nur Pop-up", "popup_only": True}], f)
subprocess.run([SAY, "--popup-only", "fertig"], env=dict(ENV, XDG_STATE_HOME=os.path.join(RT, "state")), check=True)
news = json.load(open(os.path.join(news_dir, "news.json")))
check("omarchy-buddy-say --popup-only: markiert, alte Fertigmeldungen weg",
      [(i["title"], i.get("popup_only")) for i in news] == [("alt Fehler", None), ("fertig", True)])
with open(os.path.join(news_dir, "news.json"), "w") as f:
    f.write("[]")

# 9. AskUserQuestion: the island's answers reach the tool as updatedInput.answers.
QUESTIONS = [{"question": "Welche Farbe?", "header": "Farbe", "multiSelect": False,
              "options": [{"label": "Rot", "description": "warm"}, {"label": "Blau", "description": "kalt"}]},
             {"question": "Welche Tiere?", "header": "Tiere", "multiSelect": True,
              "options": [{"label": "Hund", "description": ""}, {"label": "Katze", "description": ""}]}]


def ask(tool, tool_input, sid="s2"):
    return {"hook_event_name": "PermissionRequest", "session_id": sid, "cwd": "/x/proj",
            "tool_name": tool, "tool_input": tool_input}


q = start(ask("AskUserQuestion", {"questions": QUESTIONS})); wait_requests(1, "s2")
rq = requests("s2")[0]
check("Frage: Art, Fragen, Kurztext, 300 s", rq["kind"] == "question" and rq["questions"] == QUESTIONS
      and rq["detail"] == "Welche Farbe?" and rq["wait"] == 300 and rq["always"] == "")
run("--answer", "s2", rq["id"], json.dumps({"Welche Farbe?": "Blau", "Welche Tiere?": ["Hund", "Katze"], "Fremd?": "x"}))
out_q = json.loads(q.communicate(timeout=3)[0])["hookSpecificOutput"]["decision"]
check("Frage: Antworten als updatedInput", out_q == {"behavior": "allow", "updatedInput": {
    "questions": QUESTIONS, "answers": {"Welche Farbe?": "Blau", "Welche Tiere?": "Hund, Katze"}}})
check("Frage: danach working", state()["s2"]["state"] == "working" and "requests" not in state()["s2"])

q = start(ask("AskUserQuestion", {"questions": QUESTIONS})); wait_requests(1, "s2")
run("--decide", "s2", requests("s2")[0]["id"], "allow")
check("Frage: allow ohne Antworten → Terminal", q.communicate(timeout=3)[0] == "")

# 10. ExitPlanMode: approve (auto / default mode) or send back with feedback.
PLAN = {"plan": "# Farben anlegen\n\n1. Datei schreiben", "planFilePath": "/x/plan.md"}
for choice, extra, expect in [
        ("auto", [], {"behavior": "allow", "updatedInput": PLAN, "updatedPermissions": [
            {"type": "setMode", "mode": "auto", "destination": "session"}]}),
        ("allow", [], {"behavior": "allow", "updatedInput": PLAN, "updatedPermissions": [
            {"type": "setMode", "mode": "default", "destination": "session"}]}),
        ("revise", ["Bitte  auch\nBlau"], {"behavior": "deny", "message": "Bitte auch Blau"})]:
    p = start(ask("ExitPlanMode", PLAN)); wait_requests(1, "s2")
    rp = requests("s2")[0]
    if choice == "auto":
        check("Plan: Art, Titel, ganzer Plan", rp["kind"] == "plan" and rp["detail"] == "Farben anlegen"
              and rp["full"] == PLAN["plan"] and rp["wait"] == 300 and "truncated" not in rp)
    run("--decide", "s2", rp["id"], choice, *extra)
    check("Plan: " + choice, json.loads(p.communicate(timeout=3)[0])["hookSpecificOutput"]["decision"] == expect)
p = start(ask("ExitPlanMode", PLAN)); wait_requests(1, "s2")
run("--decide", "s2", requests("s2")[0]["id"], "always")
check("Plan: always gilt nicht", p.communicate(timeout=3)[0] == "")

# 10b. File changes carry old and new text for the island's diff.
old_file = os.path.join(RT, "alt.txt")
with open(old_file, "w") as f:
    f.write("a\nb\n")
for tool, tool_input, expect, cut in [
        ("Edit", {"file_path": "/x/a.py", "old_string": "x = 1", "new_string": "x = 2"},
         [{"file": "/x/a.py", "old": "x = 1", "new": "x = 2", "created": False}], False),
        ("Write", {"file_path": old_file, "content": "a\nc\n"},
         [{"file": old_file, "old": "a\nb\n", "new": "a\nc\n", "created": False}], False),
        ("Write", {"file_path": os.path.join(RT, "neu.txt"), "content": "z\n" * 20000}, None, True),
        ("Write", {"file_path": old_file, "content": "y" * 40000}, [], True)]:
    p = start(ask(tool, tool_input)); wait_requests(1, "s2")
    r = requests("s2")[0]
    if expect is None:  # a new file's start, cut at a line end
        ok = r["edits"][0]["created"] and len(r["edits"][0]["new"]) == 30000 and r["edits"][0]["new"].endswith("\n")
    else:
        ok = r["edits"] == expect
    check(f"Diff: {tool} {'gekürzt' if cut else ''}", ok and r.get("edits_cut", False) == cut)
    p.send_signal(signal.SIGTERM); p.wait(timeout=3)
p = start(perm("ls", sid="s2")); wait_requests(1, "s2")
check("Diff: Bash ohne edits", "edits" not in requests("s2")[0])
p.send_signal(signal.SIGTERM); p.wait(timeout=3)


# 11. Running tools: PreToolUse adds, PostToolUse removes, also when it overtakes.
def tool(name, tid, sid="s3", **extra):
    return dict({"session_id": sid, "cwd": "/x/proj", "hook_event_name": name, "tool_name": "Bash",
                 "tool_input": {"command": "npm test"}, "tool_use_id": tid}, **extra)


run(event=tool("PreToolUse", "t1"))
run(event=tool("PreToolUse", "t2", agent_id="a1", agent_type="Explore"))
running = state()["s3"]["running"]
check("Laufband: zwei Werkzeuge", [r["id"] for r in running] == ["t1", "t2"] and running[0]["detail"] == "npm test"
      and running[1]["agent"] == "Explore")
run(event=tool("PostToolUse", "t1"))
check("Laufband: t1 fertig", [r["id"] for r in state()["s3"]["running"]] == ["t2"])
run(event=tool("PostToolUseFailure", "t3"))
run(event=tool("PreToolUse", "t3"))
check("Laufband: überholtes Pre kommt nicht zurück", [r["id"] for r in state()["s3"]["running"]] == ["t2"])
run(event=tool("PreToolUse", "q1", tool_name="AskUserQuestion"))
check("Laufband: Fragen nicht", [r["id"] for r in state()["s3"]["running"]] == ["t2"])
run(event=tool("PreToolUse", "t4", tool_input={"command": "npm run build", "timeout": 600000}))
check("Laufband: eigener Timeout in Sekunden", state()["s3"]["running"][-1]["timeout"] == 600
      and "timeout" not in state()["s3"]["running"][0])
run(event={"session_id": "s3", "cwd": "/x/proj", "hook_event_name": "Stop"})
check("Laufband: Stop leert", state()["s3"]["running"] == [])
run(event=tool("PostToolUse", "t2"))
check("spätes PostToolUse nach Stop: bleibt fertig", state()["s3"]["state"] == "done")
run(event={"session_id": "s3", "cwd": "/x/proj", "hook_event_name": "UserPromptSubmit", "prompt": "weiter"})
run(event=tool("PostToolUse", "t5"))
check("PostToolUse im nächsten Lauf: working", state()["s3"]["state"] == "working")

# 11b. Async overtaking: a Stop that arrives after the next prompt started leaves the new round
#      alone (since lies after the Stop's start); a compaction mid-round keeps it working.
run(event={"session_id": "s3", "cwd": "/x/proj", "hook_event_name": "UserPromptSubmit", "prompt": "runde zwei"})
st = state()
st["s3"]["since"] = time.time() + 60  # as if UserPromptSubmit came after this Stop started
with open(STATE, "w") as f:
    json.dump(st, f)
run(event={"session_id": "s3", "cwd": "/x/proj", "hook_event_name": "Stop"})
check("spätes Stop nach neuem Prompt: Runde arbeitet weiter", state()["s3"]["state"] == "working")
run(event={"session_id": "s3", "cwd": "/x/proj", "hook_event_name": "SessionStart", "source": "compact"})
check("SessionStart nach Kompaktierung: bleibt working", state()["s3"]["state"] == "working")
run(event={"session_id": "s3", "cwd": "/x/proj", "hook_event_name": "SessionStart", "source": "clear"})
check("SessionStart nach /clear: bereit", state()["s3"]["state"] == "idle")

# 12. API errors and the auto mode's refusals end up as news with a clear text.
NEWS = os.path.join(RT, "state", "omarchy-buddy", "news.json")
run(event={"session_id": "s4", "cwd": "/x/proj", "hook_event_name": "UserPromptSubmit", "prompt": "mach was"})
run(event={"session_id": "s4", "cwd": "/x/proj", "hook_event_name": "StopFailure", "error": "authentication_failed"})
s4 = state()["s4"]
check("StopFailure: Text im Zustand", s4["error"] is True and s4["error_text"] == "Anmeldung abgelaufen")
news = json.load(open(NEWS))
check("StopFailure: Meldung", news[-1]["level"] == "error" and news[-1]["title"] == "proj: Anmeldung abgelaufen"
      and news[-1]["body"] == "Im Terminal /login ausführen. „mach was“")
os.makedirs(os.path.join(RT, "omarchy-buddy"), exist_ok=True)
resets = time.time() + 600  # once: computed twice, the minute could change in between
with open(os.path.join(RT, "omarchy-buddy", "usage.json"), "w") as f:
    json.dump({"limits": {"five_hour": {"used": 100, "resets": resets}}}, f)
time.sleep(1.1)  # a news item per run: its key holds the run's start second
run(event={"session_id": "s4", "cwd": "/x/proj", "hook_event_name": "UserPromptSubmit", "prompt": "weiter"})
run(event={"session_id": "s4", "cwd": "/x/proj", "hook_event_name": "StopFailure", "error": "rate_limit"})
news = json.load(open(NEWS))
check("Limit: ab wann frei", news[-1]["title"] == "proj: Limit erreicht"
      and news[-1]["body"] == "Wieder frei ab " + time.strftime("%H:%M", time.localtime(resets)) + ". „weiter“")
run(event={"session_id": "s4", "cwd": "/x/proj", "hook_event_name": "PermissionDenied", "tool_name": "Bash",
           "tool_input": {"command": "rm -rf /"}, "reason": "[Irreversible Local Destruction]"})
news = json.load(open(NEWS))
check("Auto-Modus: still in den Verlauf", news[-1]["quiet"] is True and news[-1]["level"] == "warn"
      and news[-1]["body"] == "Bash: rm -rf / – [Irreversible Local Destruction]")

# 12b. "Verlauf speichern" (Frage 9): "ohne Text" keeps no prompt and no command,
# "gar nicht" keeps news.json in memory ($XDG_RUNTIME_DIR); switching moves it.
CONFIG = os.path.join(RT, "config", "omarchy-buddy", "config.json")
NEWS_RAM = os.path.join(RT, "omarchy-buddy", "news.json")
BUDDY = os.path.join(os.path.dirname(HOOK), "..", "lib", "buddy.py")
def history(mode):
    os.makedirs(os.path.dirname(CONFIG), exist_ok=True)
    with open(CONFIG, "w") as f:
        json.dump({"history": mode}, f)
    subprocess.run([sys.executable, BUDDY, "news", mode], env=ENV, check=True)
history("noText")
news = json.load(open(NEWS))
check("ohne Text: alte Prompts und Befehle aus news.json",
      [n["body"] for n in news[-3:]] == ["", "", ""] and not any("private" in n for n in news))
run(event={"session_id": "s4", "cwd": "/x/proj", "hook_event_name": "PermissionDenied", "tool_name": "Bash",
           "tool_input": {"command": "rm -rf /"}, "reason": "geheim"})
time.sleep(1.1)
run(event={"session_id": "s4", "cwd": "/x/proj", "hook_event_name": "UserPromptSubmit", "prompt": "geheim"})
run(event={"session_id": "s4", "cwd": "/x/proj", "hook_event_name": "StopFailure", "error": "authentication_failed"})
news = json.load(open(NEWS))
check("ohne Text: Sperre nur mit Werkzeug", news[-2]["body"] == "Bash")
check("ohne Text: Fehler ohne Prompt", news[-1]["body"] == "Im Terminal /login ausführen.")
count = len(news)
history("off")
check("gar nicht: news.json auf der Platte leer, alles im Speicher",
      json.load(open(NEWS)) == [] and len(json.load(open(NEWS_RAM))) == count and mode(NEWS_RAM) == 0o600)
subprocess.run([SAY, "im Speicher"], env=ENV, check=True)
check("gar nicht: Neues nur in den Speicher",
      json.load(open(NEWS)) == [] and json.load(open(NEWS_RAM))[-1]["title"] == "im Speicher")
history("full")
news = json.load(open(NEWS))
check("zurück auf voll: alles wieder auf der Platte, nichts doppelt, Speicherdatei weg",
      len(news) == count + 1 and len({n["time"] for n in news}) == len(news) and not os.path.exists(NEWS_RAM))
os.remove(CONFIG)

# 13. Status line: usage.json, one warning per window, the old status line runs.
STATUS = os.path.join(os.path.dirname(HOOK), "omarchy-buddy-statusline")
os.makedirs(os.path.join(RT, "state", "omarchy-buddy"), exist_ok=True)
with open(os.path.join(RT, "state", "omarchy-buddy", "statusline.json"), "w") as f:
    json.dump({"command": "cat >/dev/null; echo alte Zeile"}, f)
resets = int(time.time()) + 3600
line = {"session_id": "s5", "context_window": {"used_percentage": 71.6},
        "rate_limits": {"five_hour": {"used_percentage": 81, "resets_at": resets},
                        "seven_day": {"used_percentage": 12.34, "resets_at": resets + 86400}}}
before = len(json.load(open(NEWS)))
r = subprocess.run([STATUS], input=json.dumps(line), env=ENV, capture_output=True, text=True)
check("Statuszeile: alte Zeile läuft", r.stdout == "alte Zeile\n" and r.returncode == 0)
usage = json.load(open(os.path.join(RT, "omarchy-buddy", "usage.json")))
check("Statuszeile: usage.json", usage["limits"] == {"five_hour": {"used": 81, "resets": resets},
                                                      "seven_day": {"used": 12.3, "resets": resets + 86400}}
      and usage["sessions"]["s5"]["context"] == 72)
line["rate_limits"]["five_hour"]["used_percentage"] = 90
line["rate_limits"]["five_hour"]["resets_at"] = resets + 2
subprocess.run([STATUS], input=json.dumps(line), env=ENV, capture_output=True, text=True)
time.sleep(0.5)
news = json.load(open(NEWS))
check("Statuszeile: eine Warnung pro Fenster", len(news) == before + 1
      and news[-1]["title"] == "Claude: 5-Stunden-Limit zu 81 % verbraucht")
# limitWarn from config.json (0: never), before that from ui.json
os.makedirs(os.path.join(RT, "config", "omarchy-buddy"), exist_ok=True)
with open(os.path.join(RT, "config", "omarchy-buddy", "config.json"), "w") as f:
    json.dump({"limitWarn": 0}, f)
line["rate_limits"]["seven_day"]["used_percentage"] = 95
before = len(json.load(open(NEWS)))
subprocess.run([STATUS], input=json.dumps(line), env=ENV, capture_output=True, text=True)
time.sleep(0.5)
check("Statuszeile: limitWarn 0 in config.json warnt nie", len(json.load(open(NEWS))) == before)
# A reset at hh:30 that wobbles by a second is still the same window.
with open(os.path.join(RT, "config", "omarchy-buddy", "config.json"), "w") as f:
    json.dump({"limitWarn": 80}, f)
half = (int(time.time()) // 3600 + 5) * 3600 + 1800
line["rate_limits"]["seven_day"]["used_percentage"] = 12
before = len(json.load(open(NEWS)))
for wobble in (0, -1, 1):
    line["rate_limits"]["five_hour"] = {"used_percentage": 85, "resets_at": half + wobble}
    subprocess.run([STATUS], input=json.dumps(line), env=ENV, capture_output=True, text=True)
time.sleep(0.5)
check("Statuszeile: Reset um hh:30 wackelt, eine Warnung", len(json.load(open(NEWS))) == before + 1)
r = subprocess.run([STATUS], input="{kaputt", env=ENV, capture_output=True, text=True)
check("Statuszeile: kaputte Eingabe", r.returncode == 0 and r.stdout == "alte Zeile\n")
# A further Claude account (Omarchy 4.5: its own CLAUDE_CONFIG_DIR) keeps its
# limits apart; the main account's stay, the hook reads its session's own.
second = dict(ENV, CLAUDE_CONFIG_DIR="/x/accounts/claude/zweit/")
main_limits = json.load(open(os.path.join(RT, "omarchy-buddy", "usage.json")))["limits"]
line = {"session_id": "s6", "rate_limits": {"five_hour": {"used_percentage": 100, "resets_at": resets + 600}}}
subprocess.run([STATUS], input=json.dumps(line), env=second, capture_output=True, text=True)
usage = json.load(open(os.path.join(RT, "omarchy-buddy", "usage.json")))
check("Zweites Konto: eigene Limits, Hauptkonto unberührt", usage["limits"] == main_limits
      and usage["accounts"] == {"/x/accounts/claude/zweit": {"limits": {"five_hour": {"used": 100, "resets": resets + 600}}}})
time.sleep(0.5)
news = json.load(open(NEWS))
check("Zweites Konto: eigene Warnung, obwohl das Hauptkonto im selben Fenster schon gewarnt hat",
      news[-1]["title"] == "Claude: 5-Stunden-Limit zu 100 % verbraucht")
time.sleep(1.1)
subprocess.run([HOOK], input=json.dumps({"session_id": "s6", "cwd": "/x/proj", "hook_event_name": "StopFailure", "error": "rate_limit"}),
               env=second, capture_output=True, text=True)
check("Zweites Konto: „frei ab“ nach seinem Limit", json.load(open(NEWS))[-1]["body"]
      .startswith("Wieder frei ab " + time.strftime("%H:%M", time.localtime(resets + 600))))
same = dict(ENV, CLAUDE_CONFIG_DIR=os.path.expanduser("~/.claude"))
subprocess.run([STATUS], input=json.dumps(line), env=same, capture_output=True, text=True)
usage = json.load(open(os.path.join(RT, "omarchy-buddy", "usage.json")))
check("CLAUDE_CONFIG_DIR=~/.claude ist das Hauptkonto", usage["limits"]["five_hour"]["used"] == 100
      and list(usage["accounts"]) == ["/x/accounts/claude/zweit"])

# 14. Herkunft: eine Sitzung des Claude-Dienstes (claude --bg) liegt im
# Hintergrund, auch wenn ORCA_* aus dem Terminal geerbt ist, das den Dienst startete.
bg = dict(ENV, CLAUDE_CODE_SESSION_KIND="bg")
subprocess.run([HOOK], input=json.dumps({"hook_event_name": "SessionStart", "session_id": "bg1", "cwd": "/x/bg"}),
               env=bg, capture_output=True, text=True)
rec = state()["bg1"]
check("Herkunft: Claude-Dienst", rec.get("origin") == "daemon" and not rec.get("orca") and not rec.get("window"))
run(event={"hook_event_name": "SessionStart", "session_id": "or1", "cwd": "/x/or"})
# The hook walks the real process tree: run from a session of Claude's service, it is "daemon".
def under_daemon(pid=os.getpid()):
    while pid > 1:
        args = open(f"/proc/{pid}/cmdline", "rb").read().split(b"\0")
        if b"--bg-pty-host" in args or (os.path.basename(args[0]) == b"claude" and args[1:2] == [b"daemon"]):
            return True
        pid = int(open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[1])
    return False
if under_daemon():
    print("skip Herkunft: Orca (läuft unter Claudes Hintergrunddienst)")
else:
    check("Herkunft: Orca", state()["or1"].get("origin") == "orca" and state()["or1"].get("orca") is True)
# The window is looked up before the lock: hyprctl runs while every other hook may write.
lock_log = os.path.join(RT, "lock-log")
with open(os.path.join(stub, "hyprctl"), "w") as f:
    f.write(f'#!/bin/sh\nflock -n {os.path.join(RT, "omarchy-buddy", "lock")} true && echo frei >> {lock_log} || echo gesperrt >> {lock_log}\necho "[]"\n')
subprocess.run([HOOK], input=json.dumps({"hook_event_name": "UserPromptSubmit", "session_id": "lk1", "cwd": "/x/lk", "prompt": "x"}),
               env=dict(ENV, PATH=stub + os.pathsep + ENV["PATH"]), capture_output=True, text=True)
check("Fenster vor dem Lock gesucht", open(lock_log).read() == "frei\n" and state()["lk1"]["state"] == "working")

# 15. Beenden: SIGTERM nur an einen claude-Prozess, danach ist die Sitzung weg.
fake = os.path.join(RT, "claude")
shutil.copy(shutil.which("sleep"), fake)
victim = subprocess.Popen([fake, "60"])
other = subprocess.Popen(["sleep", "60"])
with open(STATE) as f:
    data = json.load(f)
data["end1"] = {"state": "idle", "pid": victim.pid, "updated": time.time()}
data["end2"] = {"state": "idle", "pid": other.pid, "updated": time.time()}
with open(STATE, "w") as f:
    json.dump(data, f)
threading.Thread(target=victim.wait, daemon=True).start()  # reap, as claude's parent would
run("--end", "end1")
run("--end", "end2")
check("Beenden: claude beendet, Sitzung weg", victim.wait(timeout=2) == -signal.SIGTERM and "end1" not in state())
check("Beenden: fremder Prozess bleibt", other.poll() is None and "end2" in state())
other.kill()
check("Beenden: unbekannte Sitzung", run("--end", "gibtsnicht").returncode == 0)

# 16. A call from the island that does not fit (--decide whose empty
# request id got lost) returns at once instead of waiting for stdin.
p = subprocess.Popen([HOOK, "--decide", "s1", "allow"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE, env=ENV)
try:
    code = p.wait(timeout=5)
except subprocess.TimeoutExpired:
    p.kill()
    code = None
p.stdin.close()
check("--decide ohne Anfrage-ID hängt nicht", code == 0)

# 18. English after the system (and "language" in config.json wins).
en_env = dict(ENV, LANG="en_US.UTF-8", XDG_CONFIG_HOME=os.path.join(RT, "config-en"))
r = subprocess.run([HOOK], input=json.dumps({"hook_event_name": "Notification", "session_id": "s4", "cwd": "/x",
                                            "notification_type": "permission_prompt",
                                            "message": "Claude needs your permission to use Bash"}),
                   env=en_env, capture_output=True, text=True)
check("Englisch: Notification", state()["s4"]["detail"] == "Permission for Bash in the terminal")
os.makedirs(os.path.join(RT, "config-en", "omarchy-buddy"))
with open(os.path.join(RT, "config-en", "omarchy-buddy", "config.json"), "w") as f:
    json.dump({"language": "de"}, f)
subprocess.run([HOOK], input=json.dumps({"hook_event_name": "Notification", "session_id": "s5", "cwd": "/x",
                                        "notification_type": "elicitation_dialog", "message": ""}),
               env=en_env, capture_output=True, text=True)
check("config.json language gewinnt", state()["s5"]["detail"] == "Eingabe für einen MCP-Server im Terminal")

# 18b. state.json in a shape the hook did not write: start over instead of failing for good.
with open(STATE, "w") as f:
    json.dump([], f)
run(event={"hook_event_name": "SessionStart", "session_id": "s6", "cwd": "/x"})
check("state.json als Liste: neu angefangen", state().get("s6", {}).get("state") == "idle")
with open(STATE, "w") as f:
    json.dump({"z4": "x", "s6": {"state": "idle", "updated": time.time()}}, f)
run("--prune")
check("prune: Eintrag ohne Objekt weg", "z4" not in state() and "s6" in state())

# 18c. A long prompt is cut at a word end, with "…".
run(event={"hook_event_name": "UserPromptSubmit", "session_id": "s6", "cwd": "/x", "prompt": "wort " * 40})
check("Prompt am Wortende gekürzt", state()["s6"]["prompt"] == ("wort " * 23).strip() + "…")
run(event={"hook_event_name": "UserPromptSubmit", "session_id": "s6", "cwd": "/x", "prompt": "a" * 200})
check("Prompt ohne Leerzeichen hart gekürzt", state()["s6"]["prompt"] == "a" * 119 + "…")

# 18d. Many hooks at once (subagents, B24): the lock keeps every session.
crowd = [start({"hook_event_name": "UserPromptSubmit", "session_id": f"p{i}", "cwd": "/x", "prompt": f"Aufgabe {i}"})
         for i in range(40)]
for p in crowd:
    p.communicate(timeout=20)
check("40 Hooks gleichzeitig: alle Sitzungen da", all(state().get(f"p{i}", {}).get("prompt") == f"Aufgabe {i}" for i in range(40)))
check("40 Hooks gleichzeitig: alle mit Exit 0", all(p.returncode == 0 for p in crowd))

# 18e. A long terminal command (#168, lib/long-commands.sh → --command): into
# the news only while "longCommands" is on, its window is not in front and it
# did not start an agent; a click brings the window up.
cmd_home = os.path.join(RT, "cmd")
os.makedirs(os.path.join(cmd_home, "bin")); os.makedirs(os.path.join(cmd_home, "config", "omarchy-buddy"))
with open(os.path.join(cmd_home, "bin", "hyprctl"), "w") as f:
    f.write(f"""#!/bin/sh
case $1 in clients) echo '[{{"pid": {os.getpid()}, "address": "0xc0de"}}]' ;; activewindow) echo "{{\\"address\\": \\"$(cat {cmd_home}/front)\\"}}" ;; esac
""")
os.chmod(os.path.join(cmd_home, "bin", "hyprctl"), 0o755)
CMD_ENV = dict(ENV, PATH=os.path.join(cmd_home, "bin") + ":" + ENV["PATH"], XDG_STATE_HOME=os.path.join(cmd_home, "state"),
               XDG_CONFIG_HOME=os.path.join(cmd_home, "config"))


def command_news(command, status="0", front="0xother", config=None):
    for name, text in (("front", front), ("config/omarchy-buddy/config.json", json.dumps(config or {"longCommands": True}))):
        with open(os.path.join(cmd_home, name), "w") as f:
            f.write(text)
    shutil.rmtree(os.path.join(cmd_home, "state"), ignore_errors=True)
    subprocess.run([HOOK, "--command", status, "185", str(os.getpid()), command], env=CMD_ENV, timeout=10)
    try:
        return json.load(open(os.path.join(cmd_home, "state", "omarchy-buddy", "news.json")))
    except OSError:
        return []


n = command_news("make   build", "2")
check("langer Befehl: Meldung mit Befehl, Dauer, Exit-Code, Fenster",
      len(n) == 1 and n[0]["title"] == "Befehl fehlgeschlagen nach 3 min" and n[0]["body"] == "„make build“ (Exit-Code 2)"
      and n[0]["window"] == "0xc0de" and n[0]["level"] == "error" and n[0]["source"] == "terminal" and n[0]["private"])
ok = command_news("make build")
check("langer Befehl: Exit 0 ist gut, ohne Exit-Code",
      [(i["title"], i["body"], i["level"]) for i in ok] == [("Befehl fertig nach 3 min", "„make build“", "good")])
check("langer Befehl: Fenster vorne, keine Meldung", command_news("sleep 200", front="0xc0de") == [])
check("langer Befehl: ohne Einstellung keine Meldung", command_news("sleep 200", config={"longCommands": False}) == [])
check("langer Befehl: Agenten melden selbst",
      all(command_news(c) == [] for c in ("claude", "FOO=1 codex --yolo", "sudo -E /usr/bin/opencode", "pi")))
check("langer Befehl: Verlauf ohne Text, nur Exit-Code",
      [i["body"] for i in command_news("geheim", "1", config={"longCommands": True, "history": "noText"})] == ["Exit-Code 1"]
      and [i["body"] for i in command_news("geheim", config={"longCommands": True, "history": "noText"})] == [""])

# 19. lib/texts.py: both languages complete, same placeholders.
sys.path.insert(0, os.path.join(os.path.dirname(HOOK), "..", "lib"))
# #158: an agent switched off in config.json leaves no trace, also Cursor
# (it runs Claude's hooks) and Codex; Claude is always on.
off_env = dict(ENV, XDG_CONFIG_HOME=os.path.join(RT, "config-off"))
os.makedirs(os.path.join(RT, "config-off", "omarchy-buddy"))
with open(os.path.join(RT, "config-off", "omarchy-buddy", "config.json"), "w") as f:
    json.dump({"agents": {"cursor-agent": False, "codex": False, "gemini": False, "claude": False}}, f)
prompt = lambda sid, **extra: json.dumps({"hook_event_name": "UserPromptSubmit", "session_id": sid, "cwd": RT, "prompt": "hallo", **extra})  # noqa: E731
for args, sid, extra in (([], "off-cursor", {"cursor_version": "2026.10"}), (["--codex"], "off-codex", {}),
                         (["--agent", "gemini"], "off-gemini", {"hook_event_name": "BeforeAgent"}), ([], "on-claude", {})):
    subprocess.run([HOOK, *args], input=prompt(sid, **extra), env=dict(off_env, OMARCHY_BUDDY_HOOK_WAIT="1"), capture_output=True, text=True)
time.sleep(0.3)
got = state()
check("Agent aus (#158): Cursor, Codex, Gemini hinterlassen nichts, Claude bleibt an",
      not any(k in got for k in ("off-cursor", "off-codex", "off-gemini")) and "on-claude" in got)

import texts  # noqa: E402
check("Texte: gleiche Schlüssel", texts.TEXTS["de"].keys() == texts.TEXTS["en"].keys())
holes = lambda text: sorted(re.findall(r"{\w+}", text))  # noqa: E731
check("Texte: gleiche Platzhalter", all(holes(texts.TEXTS["de"][k]) == holes(texts.TEXTS["en"][k]) for k in texts.TEXTS["de"]))
check("Texte: jeder Fehler hat Text", all("error." + e in texts.TEXTS["de"] for e in texts.ERRORS))
check("Texte: Sprache wie die Insel", [texts.pick_language(*a) for a in (("auto", ["", "de_AT.UTF-8"]), ("auto", ["C", "de_DE"]),
                                                                         ("en", ["de_DE"]), (None, []))] == ["de", "en", "en", "en"])
check("Texte: Sprache wie Omarchy (4.5)", [texts.pick_language(*a) for a in (("auto", ["en_US"], "de\n"), ("auto", ["de_DE"], "fr"),
                                                                          ("auto", ["de_DE"], ""), ("de", [], "fr"))] == ["de", "en", "de", "de"])
lang_file = os.path.join(RT, "config-omarchy", "omarchy", "language")
os.makedirs(os.path.dirname(lang_file), exist_ok=True)
with open(lang_file, "w") as f:
    f.write("en\n")
r = subprocess.run([sys.executable, os.path.join(os.path.dirname(HOOK), "..", "lib", "texts.py"), "setup.shellSame"],
                   env=dict(ENV, XDG_CONFIG_HOME=os.path.join(RT, "config-omarchy")), capture_output=True, text=True)
check("Texte: folgen ~/.config/omarchy/language", r.stdout.strip() == "Omarchy: nothing to change.")

shutil.rmtree(RT, ignore_errors=True)
done()
