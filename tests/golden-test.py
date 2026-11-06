#!/usr/bin/env python3
# Golden-Test: was omarchy-buddy-hook und omarchy-buddy-setup schreiben,
# byte-genau gegen tests/fixtures/golden/*.txt. Der Hook bekommt die
# aufgenommenen Ereignisse (tests/fixtures/hook-events*, codex-events) und ein paar
# gebaute für die übrigen Zweige; festgehalten werden Ausgabe, Exit-Code,
# state.json, news.json, Entscheidungsdateien. Das Setup läuft in
# Sandbox-HOMEs mit festem Omarchy (OMARCHY_PATH); festgehalten werden
# Ausgabe, settings.json, shell.json, setup.json, statusline.json,
# ~/.codex/hooks.json und config.toml, Links,
# Rechte und Sicherungen. Zeiten, pids, Anfrage-ids und Pfade werden durch
# Platzhalter ersetzt, sonst bleibt jedes Byte.
#
#   tests/golden-test.py            vergleichen (Teil von tests/run)
#   tests/golden-test.py --update   neu schreiben (nur wenn sich etwas ändern soll)
import difflib, json, os, re, shutil, subprocess, sys, tempfile, time, tomllib

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
HOOK = os.path.join(REPO, "bin", "omarchy-buddy-hook")
SETUP = os.path.join(REPO, "bin", "omarchy-buddy-setup")
FIXTURES = os.path.join(HERE, "fixtures")
GOLDEN = os.path.join(FIXTURES, "golden")
sys.path.insert(0, os.path.join(REPO, "lib"))
from texts import first_name  # noqa: E402
sys.path.insert(0, os.path.join(HERE, "lib"))
from testing import sandbox_env  # noqa: E402

TMP = tempfile.mkdtemp(prefix="omarchy-buddy-golden-")
NAME = first_name()


def normalize(text):
    text = text.replace(TMP, "$SB").replace(REPO, "$REPO")
    text = re.sub(r'("(?:updated|since|at|until|time|resets)": )-?[0-9.e+]+', r"\1T", text)
    text = re.sub(r'("pid": )\d+', r"\1P", text)
    text = re.sub(r"\b\d+-\d{15,}\b", "R", text)  # request ids
    text = re.sub(r"(done-[^\"]*-)\d+", r"\1T", text)
    text = re.sub(r"\d{8}-\d{6}", "DATUM", text)  # backups
    text = re.sub(r"\b\d\d:\d\d\b", "HH:MM", text)
    text = re.sub(r'(trusted_hash = "sha256:)[0-9a-f]{64}', r"\1H", text)  # of paths in $SB; checked in Setup.run
    return text.replace(NAME, "$NAME") if NAME else text


def slurp(path):
    try:
        with open(path, encoding="utf-8", errors="surrogateescape") as f:
            return f.read()
    except FileNotFoundError:
        return "(fehlt)"


def fakes():
    """hyprctl without windows: no window is found and none is in focus,
    wherever the test runs."""
    bin_dir = os.path.join(TMP, "fake-bin")
    os.makedirs(bin_dir, exist_ok=True)
    with open(os.path.join(bin_dir, "hyprctl"), "w") as f:
        f.write('#!/bin/sh\ncase "$1" in clients) echo "[]";; *) echo "{}";; esac\n')
    os.chmod(os.path.join(bin_dir, "hyprctl"), 0o755)
    return bin_dir


FAKE_BIN = fakes()

# The hook runs in a PID namespace of its own below a plain sh (pid 1): it
# sees no Orca, Claude or terminal above the test, wherever the test runs.
# pid 1 stands for "a process that lives".
ALONE = ["unshare", "--user", "--map-current-user", "--pid", "--fork", "--kill-child", "--mount-proc",
         "sh", "-c", '"$@"; exit $?', "sh"]
if subprocess.run([*ALONE, "true"], capture_output=True).returncode:
    sys.exit("golden-test: needs unshare with user and pid namespaces (util-linux)")


# ------------------------------------------------------------------ hook

class Hook:
    def __init__(self, name, **extra):
        self.root = os.path.join(TMP, name)
        os.makedirs(self.root)
        self.env = dict(os.environ, LC_ALL="", LC_MESSAGES="", LANG="de_DE.UTF-8", HOME=self.root,
                        XDG_RUNTIME_DIR=self.root, XDG_STATE_HOME=os.path.join(self.root, "state"),
                        XDG_CONFIG_HOME=os.path.join(self.root, "config"),
                        XDG_DATA_HOME=os.path.join(self.root, "data"), XDG_CACHE_HOME=os.path.join(self.root, "cache"),
                        PATH=FAKE_BIN + os.pathsep + os.environ.get("PATH", ""), HYPRLAND_INSTANCE_SIGNATURE="test",
                        **extra)
        for k in ("CLAUDE_CODE_SESSION_KIND", "ORCA_PANE_KEY", "ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_ID", "CLAUDE_CONFIG_DIR"):
            if k not in extra:
                self.env.pop(k, None)
        self.out = []

    def path(self, *p):
        return os.path.join(self.root, "omarchy-buddy", *p)

    def state(self):
        try:
            with open(self.path("state.json")) as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def seed(self, name, data):
        os.makedirs(self.path(), exist_ok=True)
        with open(self.path(name), "w") as f:
            json.dump(data, f)

    def files(self, title):
        self.out.append(f"== {title}")
        self.out.append("-- state.json\n" + slurp(self.path("state.json")))
        news = os.path.join(self.root, "state", "omarchy-buddy", "news.json")
        self.out.append("-- news.json\n" + slurp(news))
        decide = self.path("decide")
        for n in sorted(os.listdir(decide)) if os.path.isdir(decide) else []:
            self.out.append(f"-- decide/{n}\n" + slurp(os.path.join(decide, n)))

    def run(self, title, *args, event=None, text=""):
        r = subprocess.run([*ALONE, HOOK, *args], input=json.dumps(event) if event is not None else text,
                           env=self.env, capture_output=True, text=True, timeout=60, cwd=REPO)
        self.out.append(f"== {title}: exit {r.returncode}\n-- stdout\n{r.stdout}-- stderr\n{r.stderr}")
        self.files(title)

    def ask(self, title, event, answer, *args):
        """A PermissionRequest; answer(request, sid) gives the island's call:
        its arguments, or (arguments, stdin)."""
        sid = event["session_id"]
        os.makedirs(self.path(), exist_ok=True)
        open(self.path("island"), "w").close()  # the island lives: the hook waits for it
        p = subprocess.Popen([*ALONE, HOOK, *args], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env=self.env, text=True)
        p.stdin.write(json.dumps(event))
        p.stdin.close()
        request = None
        for _ in range(100):
            requests = (self.state().get(sid) or {}).get("requests") or []
            if requests:
                request = requests[-1]
                break
            time.sleep(0.05)
        self.files(title + " (wartet)")
        if request:
            call = answer(request, sid)
            argv, text = call if isinstance(call, tuple) else (call, "")
            subprocess.run([*ALONE, HOOK, *argv], input=text, text=True, env=self.env, capture_output=True, timeout=10)
        try:
            out, err = p.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            p.kill()
            out, err = p.communicate()
        self.out.append(f"== {title}: exit {p.returncode}\n-- stdout\n{out}-- stderr\n{err}")
        self.files(title)

    def text(self):
        return normalize("\n".join(self.out) + "\n")


def island(request, sid):
    """As tests/hook-fixtures.test.js: first options, plans in auto, else allow."""
    if request["kind"] == "question":
        answers = {q["question"]: [o["label"] for o in q["options"][:2 if q["multiSelect"] else 1]]
                   for q in request["questions"]}
        return ["--answer", sid, request["id"]], json.dumps(answers)
    return ["--decide", sid, request["id"], "auto" if request["kind"] == "plan" else "allow"]


def decide(word, text=None):
    """text: the plan feedback, on stdin."""
    def call(request, sid):
        argv = ["--decide", sid, request["id"], word]
        return argv if text is None else (argv, text)
    return call


def recorded_other(hook, folder, *args):
    """A further agent's recording (#141): nothing waits, every event just runs."""
    for f in sorted(x for x in os.listdir(os.path.join(FIXTURES, folder)) if x.endswith(".json")):
        with open(os.path.join(FIXTURES, folder, f)) as fh:
            hook.run(f"{folder}/{f}", *args, event=json.load(fh))


def built_others(hook):
    """Copilot and Cursor, built from their docs (no recordings without a
    login), and what the other agents' translation leaves out."""
    copilot = lambda name, **kw: dict(session_id="p1", cwd="/home/user/projekt", hook_event_name=name, **kw)
    hook.run("Copilot SessionStart", "--agent", "copilot", event=copilot("SessionStart", source="new"))
    hook.run("Copilot UserPromptSubmit", "--agent", "copilot", event=copilot("UserPromptSubmit", prompt="Mach was"))
    hook.run("Copilot PreToolUse bash", "--agent", "copilot",
             event=copilot("PreToolUse", tool_name="bash", tool_input={"command": "npm test"}))
    hook.run("Copilot Notification permission_prompt", "--agent", "copilot",
             event=copilot("Notification", notification_type="permission_prompt", message="Permission needed"))
    hook.run("Copilot PermissionRequest tut nichts", "--agent", "copilot",
             event=copilot("PermissionRequest", tool_name="bash", tool_input={"command": "npm test"}))
    hook.run("Copilot PostToolUse", "--agent", "copilot", event=copilot("PostToolUse", tool_name="bash", tool_input={}))
    hook.run("Copilot Stop", "--agent", "copilot", event=copilot("Stop", stop_reason="end_turn"))
    hook.run("Copilot SessionEnd", "--agent", "copilot", event=copilot("SessionEnd", reason="user_exit"))
    cursor = lambda name, **kw: dict(session_id="u1", conversation_id="u1", cursor_version="2026.10.22",
                                     workspace_roots=["/home/user/projekt"], hook_event_name=name, **kw)
    hook.run("Cursor sessionStart", event=cursor("sessionStart"))
    hook.run("Cursor beforeSubmitPrompt", event=cursor("beforeSubmitPrompt", prompt="Mach was"))
    hook.run("Cursor preToolUse Shell", event=cursor("preToolUse", tool_name="Shell", tool_use_id="x1",
                                                     tool_input={"command": "ls"}, cwd="/home/user/projekt"))
    hook.run("Cursor postToolUse", event=cursor("postToolUse", tool_name="Shell", tool_use_id="x1", tool_input={}))
    hook.run("Cursor stop aborted", event=cursor("stop", status="aborted"))
    hook.run("Cursor beforeSubmitPrompt nochmal", event=cursor("beforeSubmitPrompt", prompt="Weiter"))
    hook.run("Cursor stop completed", event=cursor("stop", status="completed"))
    hook.run("Cursor afterAgentResponse tut nichts", event=cursor("afterAgentResponse", text="x"))
    hook.run("Cursor sessionEnd", event=cursor("sessionEnd"))
    gemini = lambda name, **kw: dict(session_id="g1", cwd="/home/user/projekt", hook_event_name=name, **kw)
    hook.run("Gemini Notification anderer Art", "--agent", "gemini", event=gemini("Notification", notification_type="Other"))
    hook.run("Gemini BeforeModel tut nichts", "--agent", "gemini", event=gemini("BeforeModel"))
    hook.run("Gemini kein JSON-Objekt", "--agent", "gemini", event=[1])
    hook.run("Gemini BeforeAgent", "--agent", "gemini", event=gemini("BeforeAgent", prompt="Lange Arbeit"))
    started(hook, "g1", 125)
    hook.run("Gemini AfterAgent nach 2 min: Neuigkeit", "--agent", "gemini", event=gemini("AfterAgent", prompt_response="ok"))
    hook.run("Gemini SessionEnd", "--agent", "gemini", event=gemini("SessionEnd", reason="exit"))
    hook.run("--agent unbekannt", "--agent", "amp", event=gemini("SessionStart"))
    hook.run("Grok ohne GROK_HOOK_EVENT ist Claude", event={"hookEventName": "session_start", "session_id": "k1",
                                                           "hook_event_name": "SessionStart", "cwd": "/x"})
    hook.run("SessionEnd dazu", event={"session_id": "k1", "hook_event_name": "SessionEnd"})


def recorded(hook, folder, *args):
    for f in sorted(os.listdir(os.path.join(FIXTURES, folder))):
        if not f.endswith(".json"):
            continue
        with open(os.path.join(FIXTURES, folder, f)) as fh:
            event = json.load(fh)
        if event["hook_event_name"] == "PermissionRequest":
            hook.ask(f"{folder}/{f}", event, island, *args)
        else:
            hook.run(f"{folder}/{f}", *args, event=event)


def started(hook, sid, seconds_ago):
    s = hook.state()
    s[sid]["since"] = time.time() - seconds_ago
    hook.seed("state.json", s)


def built_45(hook):
    """Omarchy 4.5's agents (#145), built from their docs and Orca's parsers
    (none installed here)."""
    agy = lambda **kw: dict(conversationId="a1", workspacePaths=["/home/user/projekt"],
                            transcriptPath="/home/user/.gemini/a1.jsonl", modelName="gemini-3", **kw)
    hook.run("Antigravity SessionStart", "--agent", "agy", "SessionStart", event=agy())
    hook.run("Antigravity PreInvocation", "--agent", "agy", "PreInvocation", event=agy())
    hook.run("Antigravity PreToolUse run_command", "--agent", "agy", "PreToolUse",
             event=agy(toolCall={"name": "run_command", "args": {"CommandLine": "npm test"}}))
    hook.run("Antigravity PreToolUse ask_permission", "--agent", "agy", "PreToolUse",
             event=agy(toolCall={"name": "ask_permission", "args": {}}))
    hook.run("Antigravity PostToolUse ask_permission", "--agent", "agy", "PostToolUse",
             event=agy(toolCall={"name": "ask_permission", "args": {}}))
    hook.run("Antigravity PostToolUse run_command", "--agent", "agy", "PostToolUse",
             event=agy(toolCall={"name": "run_command", "args": {"CommandLine": "npm test"}}))
    hook.run("Antigravity PreInvocation läuft schon", "--agent", "agy", "PreInvocation", event=agy())
    hook.run("Antigravity Stop nicht fertig", "--agent", "agy", "Stop", event=agy(terminationReason="model_stop", fullyIdle=False))
    hook.run("Antigravity Stop", "--agent", "agy", "Stop", event=agy(terminationReason="model_stop", fullyIdle=True))
    hook.run("Antigravity neue Runde", "--agent", "agy", "PreInvocation", event=agy())
    hook.run("Antigravity Stop mit Fehler", "--agent", "agy", "Stop",
             event=agy(terminationReason="error", error="quota exceeded", fullyIdle=True))
    hook.run("Antigravity ohne Ereignisnamen tut nichts", "--agent", "agy", event=agy())
    qwen = lambda name, **kw: dict(session_id="q1", cwd="/home/user/projekt", hook_event_name=name, **kw)
    hook.run("Qwen SessionStart", "--agent", "qwen", event=qwen("SessionStart", source="startup"))
    hook.run("Qwen UserPromptSubmit", "--agent", "qwen", event=qwen("UserPromptSubmit", prompt="Mach was"))
    hook.run("Qwen PreToolUse", "--agent", "qwen",
             event=qwen("PreToolUse", tool_name="run_shell_command", tool_input={"command": "npm test"}))
    hook.run("Qwen Notification permission_prompt", "--agent", "qwen",
             event=qwen("Notification", notification_type="permission_prompt", message="Qwen Code needs your permission"))
    hook.run("Qwen PermissionRequest tut nichts", "--agent", "qwen",
             event=qwen("PermissionRequest", tool_name="run_shell_command", tool_input={"command": "npm test"}))
    hook.run("Qwen PostToolUse", "--agent", "qwen", event=qwen("PostToolUse", tool_name="run_shell_command", tool_input={}))
    hook.run("Qwen Stop", "--agent", "qwen", event=qwen("Stop", stop_hook_active=False))
    hook.run("Qwen SessionEnd", "--agent", "qwen", event=qwen("SessionEnd", reason="exit"))
    kimi = lambda name, **kw: dict(session_id="m1", cwd="/home/user/projekt", hook_event_name=name, **kw)
    hook.run("Kimi UserPromptSubmit ohne Text", "--agent", "kimi", event=kimi("UserPromptSubmit"))
    hook.run("Kimi TurnStarted", "--agent", "kimi", event=kimi("TurnStarted", prompt="Räum auf"))
    hook.run("Kimi PreToolUse", "--agent", "kimi", event=kimi("PreToolUse", tool_name="Shell", tool_input={"command": "rm -rf alt"}))
    hook.run("Kimi PermissionRequest", "--agent", "kimi",
             event=kimi("PermissionRequest", tool_name="Shell", tool_input={"command": "rm -rf alt"}))
    hook.run("Kimi PermissionResult", "--agent", "kimi", event=kimi("PermissionResult", tool_name="Shell"))
    hook.run("Kimi Stop is_interrupt", "--agent", "kimi", event=kimi("Stop", is_interrupt=True))
    hook.run("Kimi SessionEnd", "--agent", "kimi", event=kimi("SessionEnd"))
    devin = lambda name, **kw: dict(session_id="d1", hook_event_name=name, **kw)
    hook.run("Devin SessionStart ohne cwd", "--agent", "devin", event=devin("SessionStart", source="startup"))
    hook.run("Devin UserPromptSubmit", "--agent", "devin", event=devin("UserPromptSubmit", prompt="Bau es", prompt_id="p"))
    hook.run("Devin PreToolUse exec", "--agent", "devin", event=devin("PreToolUse", tool_name="exec", tool_input={"command": "cargo build"}))
    hook.run("Devin PermissionRequest", "--agent", "devin",
             event=devin("PermissionRequest", tool_name="exec", tool_input={"command": "cargo build"}))
    hook.run("Devin PostToolUse", "--agent", "devin",
             event=devin("PostToolUse", tool_name="exec", tool_input={}, tool_response={"success": True}))
    # (a shell named devin in place of Devin, which runs Claude's hooks too)
    os.makedirs(os.path.join(TMP, "devin"), exist_ok=True)
    fake_devin = os.path.join(TMP, "devin", "devin")
    if not os.path.exists(fake_devin):
        os.symlink(shutil.which("sh"), fake_devin)
    r = subprocess.run([*ALONE, fake_devin, "-c", f"{HOOK}; true"], env=hook.env, cwd=REPO, text=True,
                       input=json.dumps(devin("Stop", cwd="/x")), capture_output=True, timeout=60)
    hook.out.append(f"== Devin über Claudes Hook wird übergangen: exit {r.returncode}\n-- stdout\n{r.stdout}-- stderr\n{r.stderr}")
    hook.files("Devin über Claudes Hook")
    hook.run("Devin Stop", "--agent", "devin", event=devin("Stop", stop_hook_active=False))
    hook.run("Devin SessionEnd", "--agent", "devin", event=devin("SessionEnd", reason="exit"))
    cc = lambda name, **kw: dict(session_id="c1", cwd="/home/user/projekt", hook_event_name=name, **kw)
    hook.run("Command Code SessionStart", "--agent", "commandcode", event=cc("SessionStart", source="startup"))
    hook.run("Command Code PreToolUse beginnt die Runde", "--agent", "commandcode",
             event=cc("PreToolUse", tool_name="shell_command", tool_display_name="Shell", tool_input={"command": "make"}))
    hook.run("Command Code PostToolUse", "--agent", "commandcode", event=cc("PostToolUse", tool_name="shell_command", tool_input={}))
    hook.run("Command Code Stop", "--agent", "commandcode", event=cc("Stop", stop_hook_active=False))
    kiro = lambda name, **kw: dict(session_id="i1", cwd="/home/user/projekt", hook_event_name=name, **kw)
    hook.run("Kiro SessionStart", "--agent", "kiro-cli", event=kiro("SessionStart"))
    hook.env["USER_PROMPT"] = "Schreib Tests"
    hook.run("Kiro UserPromptSubmit mit USER_PROMPT", "--agent", "kiro-cli", event=kiro("UserPromptSubmit"))
    del hook.env["USER_PROMPT"]
    hook.run("Kiro PreToolUse", "--agent", "kiro-cli", event=kiro("PreToolUse", tool_name="execute_bash", tool_input={"command": "ls"}))
    hook.run("Kiro PostToolUse", "--agent", "kiro-cli", event=kiro("PostToolUse", tool_name="execute_bash", tool_input={}))
    hook.run("Kiro Stop", "--agent", "kiro-cli", event=kiro("Stop", assistant_response="fertig"))
    hook.run("Kiro SessionEnd", "--agent", "kiro-cli", event=kiro("SessionEnd"))
    # Muse 1.4.14: fields as recorded with its echo provider; tool events after Orca's parser
    muse = lambda name, **kw: {"cwd": "/home/user/projekt", "hook_event_name": name, "model": "unknown",
                               "permission_mode": "default", "session_id": "u1", "transcript_path": None, **kw}
    hook.run("Muse SessionStart", "--agent", "muse", event=muse("SessionStart", source="startup"))
    hook.run("Muse UserPromptSubmit", "--agent", "muse", event=muse("UserPromptSubmit", prompt="Bau den Export", turn_id="t1"))
    hook.run("Muse PreToolUse", "--agent", "muse",
             event=muse("PreToolUse", turn_id="t1", tool_name="shell_command", tool_input={"command": "make dist"}, tool_use_id="x1"))
    hook.run("Muse PermissionRequest tut nichts", "--agent", "muse",
             event=muse("PermissionRequest", turn_id="t1", tool_name="shell_command", tool_input={"command": "make dist"}))
    hook.run("Muse Notification permission_prompt", "--agent", "muse",
             event=muse("Notification", turn_id="t1", notification_type="permission_prompt", message="Muse needs your approval"))
    hook.run("Muse ToolUseStart nach der Antwort", "--agent", "muse",
             event=muse("ToolUseStart", turn_id="t1", tool_name="shell_command", tool_input={"command": "make dist"}, tool_use_id="x1"))
    hook.run("Muse Unter-Sitzung wird übergangen", "--agent", "muse",
             event=dict(muse("UserPromptSubmit", prompt="Teilaufgabe"), session_id="k1", turn_id="k1"))
    hook.run("Muse PostToolUse", "--agent", "muse",
             event=muse("PostToolUse", turn_id="t1", tool_name="shell_command", tool_input={}, tool_use_id="x1"))
    hook.run("Muse Stop", "--agent", "muse",
             event=muse("Stop", turn_id="t1", last_assistant_message="Fertig.", stop_hook_active=False))
    hook.run("Muse PostToolUse nach Stop wird übergangen", "--agent", "muse",
             event=muse("PostToolUse", turn_id="t1", tool_name="shell_command", tool_input={}, post_stop=True))
    # (a shell named muse in place of Muse, which clears the environment for its hooks)
    os.makedirs(os.path.join(TMP, "muse"), exist_ok=True)
    fake_muse = os.path.join(TMP, "muse", "muse")
    if not os.path.exists(fake_muse):
        os.symlink(shutil.which("sh"), fake_muse)
    r = subprocess.run([*ALONE, fake_muse, "-c", f"unset ORCA_PANE_KEY; {HOOK} --agent muse; true"],
                       env={**hook.env, "ORCA_PANE_KEY": "pane-7"}, cwd=REPO, text=True,
                       input=json.dumps(muse("UserPromptSubmit", session_id="u2", prompt="Im Orca-Terminal", turn_id="t2")),
                       capture_output=True, timeout=60)
    hook.out.append(f"== Muse holt seine Umgebung aus dem Muse-Prozess: exit {r.returncode}\n-- stdout\n{r.stdout}-- stderr\n{r.stderr}")
    hook.files("Muse holt seine Umgebung")
    hook.run("Muse SessionEnd", "--agent", "muse", event=muse("SessionEnd", reason="other"))
    hook.run("Muse SessionEnd (Orca)", "--agent", "muse", event=muse("SessionEnd", session_id="u2", reason="other"))


def built(hook):
    """The branches the recordings do not reach."""
    sid = "s1"
    ev = lambda name, **kw: dict(session_id=sid, cwd="/home/user/projekt", hook_event_name=name, **kw)
    bash = {"command": "ls -la\n  /tmp", "description": "Liste"}
    suggestions = [{"type": "addRules", "rules": [{"toolName": "Bash", "ruleContent": "ls:*"}], "behavior": "allow",
                    "destination": "projectSettings"},
                   {"type": "setMode", "mode": "acceptEdits", "destination": "session"},
                   {"type": "addDirectories", "directories": ["/tmp/a"], "destination": "session"}, "kaputt"]
    hook.run("kein session_id", event={"hook_event_name": "Stop"})
    hook.run("kein JSON", event=None)
    hook.run("SessionStart", event=ev("SessionStart", source="startup"))
    hook.run("Prompt einer Benachrichtigung", event=ev("UserPromptSubmit", prompt="<task-notification> x"))
    hook.run("langer Prompt", event=ev("UserPromptSubmit", prompt="Wort, " * 40 + "\n Ende"))
    hook.run("PreToolUse mit timeout", event=ev("PreToolUse", tool_name="Bash", tool_use_id="t1", tool_input=dict(bash, timeout=125000)))
    hook.run("PreToolUse Subagent", event=ev("PreToolUse", tool_name="Read", tool_use_id="t2", agent_id="a1",
                                             tool_input={"file_path": "/etc/hosts"}))
    hook.run("PreToolUse Frage zählt nicht", event=ev("PreToolUse", tool_name="AskUserQuestion", tool_use_id="t3", tool_input={}))
    hook.run("PostToolUse vor PreToolUse", event=ev("PostToolUse", tool_name="Grep", tool_use_id="t9", tool_input={}))
    hook.run("PreToolUse nach PostToolUse", event=ev("PreToolUse", tool_name="Grep", tool_use_id="t9", tool_input={"pattern": "x"}))
    hook.run("PostToolUseFailure", event=ev("PostToolUseFailure", tool_name="Bash", tool_use_id="t1", tool_input=bash))
    for i, kind in enumerate(("permission_prompt", "elicitation_dialog", "agent_needs_input")):
        hook.run(f"Notification {kind}", event=ev("Notification", notification_type=kind,
                                                   message="Claude needs your permission to use Bash"))
        hook.run("PostToolUse danach", event=ev("PostToolUse", tool_name="Read", tool_use_id="t2", tool_input={}))
    hook.ask("Freigabe abgelehnt", ev("PermissionRequest", tool_name="Bash", tool_input=bash,
                                      permission_suggestions=suggestions), decide("deny"))
    hook.ask("Freigabe immer", ev("PermissionRequest", tool_name="Bash", tool_input=bash,
                                  permission_suggestions=suggestions), decide("always"))
    hook.ask("Freigabe Zum Fenster", ev("PermissionRequest", tool_name="WebFetch", tool_input={"url": "https://x.y", "prompt": "p"},
                                        permission_suggestions=[]), lambda r, s: ["--decide", s, "focus"])
    # A path that is never there: Write reads the file it replaces (diff).
    hook.ask("Freigabe lange Eingabe", ev("PermissionRequest", tool_name="Write",
                                          tool_input={"file_path": "/nonexistent/omarchy-buddy/f", "content": "ä" * 5000},
                                          permission_suggestions=[{"type": "addRules", "rules": [{"toolName": "Write"}],
                                                                   "behavior": "allow", "destination": "userSettings"}]),
             decide("allow"))
    plan = {"plan": "\n\n## Mein Plan\n\nSchritt 1\n" + "x" * 21000}
    hook.ask("Plan überarbeiten", ev("PermissionRequest", tool_name="ExitPlanMode", tool_input=plan),
             decide("revise", "  bitte   kürzer "))
    hook.ask("Plan überarbeiten ohne Text", ev("PermissionRequest", tool_name="ExitPlanMode", tool_input=plan), decide("revise", ""))
    hook.ask("Plan freigeben", ev("PermissionRequest", tool_name="ExitPlanMode", tool_input={"plan": "# Kurz"}), decide("allow"))
    question = {"questions": [{"question": "Farbe?", "header": "F", "multiSelect": False,
                               "options": [{"label": "Rot"}, {"label": "Blau", "description": "kühl"}, {"x": 1}]},
                              {"question": "Tiere?", "multiSelect": True, "options": [{"label": "Hund"}, {"label": "Katze"}]}, "kaputt"]}
    hook.ask("Frage mit falscher Antwort", ev("PermissionRequest", tool_name="AskUserQuestion", tool_input=question),
             lambda r, s: (["--answer", s, r["id"]], json.dumps({"Andere?": "x", "Farbe?": "  "})))
    hook.ask("Frage beantwortet", ev("PermissionRequest", tool_name="AskUserQuestion", tool_input=question),
             lambda r, s: (["--answer", s, r["id"]], json.dumps({"Farbe?": "Blau", "Tiere?": ["Hund", " ", "Katze"]})))
    hook.ask("Frage ohne Fragen", ev("PermissionRequest", tool_name="AskUserQuestion", tool_input={"questions": []}), decide("allow"))
    hook.run("Stop kurz", event=ev("Stop"))
    hook.run("PermissionDenied", event=ev("PermissionDenied", tool_name="Bash", tool_input=bash, reason="  zu\n gefährlich "))
    hook.run("UserPromptSubmit lang her", event=ev("UserPromptSubmit", prompt="Bau die Insel"))
    started(hook, sid, 125)
    hook.run("Stop nach 2 min", event=ev("Stop"))
    hook.run("Stop nach 2 min noch mal (gleicher Schlüssel)", event=ev("Stop"))
    hook.seed("usage.json", {"limits": {"five_hour": {"used": 100, "resets": time.time() + 3600},
                                        "seven_day": {"used": 50, "resets": time.time() + 7200}}})
    for error in ("rate_limit", "overloaded", "gibtsnicht", None):
        hook.run("UserPromptSubmit", event=ev("UserPromptSubmit", prompt="Weiter"))
        started(hook, sid, 1000 + 10 * len(hook.out))  # its own news key (done-SESSION-SINCE)
        hook.run(f"StopFailure {error}", event=ev("StopFailure", error=error))
    hook.run("Notification idle_prompt", event=ev("Notification", notification_type="idle_prompt"))
    os.makedirs(os.path.join(hook.root, "config", "omarchy-buddy"), exist_ok=True)
    with open(os.path.join(hook.root, "config", "omarchy-buddy", "config.json"), "w") as f:
        json.dump({"history": "noText"}, f)
    hook.run("PermissionDenied ohne Text", event=ev("PermissionDenied", tool_name="Bash", tool_input=bash, reason="nein"))
    hook.run("UserPromptSubmit ohne Text", event=ev("UserPromptSubmit", prompt="Geheim"))
    started(hook, sid, 5000)
    hook.run("StopFailure ohne Text", event=ev("StopFailure", error="overloaded"))
    hook.run("SessionStart compact", event=ev("SessionStart", source="compact"))
    hook.run("SessionEnd", event=ev("SessionEnd"))


def built_codex(hook):
    """Codex: allow/deny only, Interrupt, apply_patch, its done news."""
    sid = "c1"
    ev = lambda name, **kw: dict(session_id=sid, turn_id="t", cwd="/home/user/projekt", hook_event_name=name,
                                 model="m", permission_mode="default", **kw)
    patch = {"command": "*** Begin Patch\n*** Update File: a.txt\n@@\n-x\n+y\n*** Add File: neu/b.txt\n+z\n*** End Patch"}
    hook.run("SessionStart", "--codex", event=ev("SessionStart", source="startup"))
    hook.run("UserPromptSubmit", "--codex", event=ev("UserPromptSubmit", prompt="Mach was"))
    hook.run("PreToolUse apply_patch", "--codex", event=ev("PreToolUse", tool_name="apply_patch", tool_use_id="c-1", tool_input=patch))
    for word in ("deny", "always"):
        hook.ask(f"Freigabe {word}", ev("PermissionRequest", tool_name="apply_patch", tool_input=patch), decide(word), "--codex")
    hook.ask("Freigabe Zum Fenster", ev("PermissionRequest", tool_name="Bash", tool_input={"command": "rm x"}),
             lambda r, s: ["--decide", s, "focus"], "--codex")
    hook.run("Interrupt", "--codex", event=ev("Interrupt"))
    hook.run("UserPromptSubmit", "--codex", event=ev("UserPromptSubmit", prompt="Weiter"))
    started(hook, sid, 125)
    hook.run("Stop nach 2 min", "--codex", event=ev("Stop", stop_hook_active=False, last_assistant_message="Fertig."))
    hook.run("--end codex läuft nicht", "--end", sid)
    hook.run("SessionEnd", "--codex", event=ev("SessionEnd", reason="other"))
    hook.run("unbekannter Aufruf mit --codex", "--codex", "x")


def cli(hook):
    """The island's calls (--decide, --answer, --prune, --end, unknown)."""
    now = time.time()
    hook.seed("state.json", {
        "s1": {"pid": 1, "updated": now, "requests": [
            {"id": "1-1000000000000000001", "pid": 1, "until": now + 60},
            {"id": "2-1000000000000000002", "pid": 999999999, "until": now + 60},
            {"id": "3-1000000000000000003", "pid": 1, "until": now - 60}], "decidable": True},
        "tot": {"pid": 999999999, "updated": now},
        "alt": {"updated": now - 13 * 3600},
        "kaputt": {"updated": "gestern"},
        "ohne": {"updated": now, "requests": []}})
    for word in ("allow", "always", "deny", "auto"):
        hook.run(f"--decide {word}", "--decide", "s1", "1-1000000000000000001", word)
    hook.run("--decide revise", "--decide", "s1", "1-1000000000000000001", "revise", text="  so nicht ")
    hook.run("--answer", "--answer", "s1", "1-1000000000000000001", text='{"Farbe?": ["Rot"]}')
    hook.run("--answer keine Liste", "--answer", "s1", "1-1000000000000000001", text='["x"]')
    hook.run("--decide fremde Anfrage", "--decide", "s1", "9-1000000000000000009", "allow")
    hook.run("--decide fremde Sitzung", "--decide", "s9", "1-1000000000000000001", "allow")
    hook.run("--decide falsches Wort", "--decide", "s1", "1-1000000000000000001", "vielleicht")
    hook.run("--decide focus", "--decide", "s1", "focus")
    hook.run("--end nicht claude", "--end", "s1")
    hook.run("--end unbekannt", "--end", "s9")
    hook.run("unbekannter Aufruf", "--decide", "s1", "")
    hook.run("--prune", "--prune")
    say = os.path.join(REPO, "bin", "omarchy-buddy-say")
    for args in (["--source", "coding", "--level", "good", "--url", "https://x", "--key", "k1", "--window", "0xa",
                  "--orca", "--orca-terminal", "term", "--orca-pane", "t:l", "--watched", "--quiet", "--private",
                  "--action", "updates", "Titel", "Text"],
                 ["--key", "k1", "doppelt"], ["nur Titel"]):
        r = subprocess.run([say, *args], env=hook.env, capture_output=True, text=True, timeout=10)
        hook.out.append(f"== say {args[-1]}: exit {r.returncode}\n-- stderr\n{r.stderr}")
        hook.files(f"say {args[-1]}")


def built_plugins(hook):
    """Plugin agents (#142): what the recordings do not reach, built from
    our plugins (agent-plugins/) and opencode's event types."""
    oc = lambda name, **kw: dict(session_id="o1", cwd="/home/user/projekt", hook_event_name=name, **kw)
    a = ("--agent", "opencode")
    hook.run("opencode session.execution.started", *a, event=oc("session.execution.started", prompt="Mach was"))
    hook.run("opencode Werkzeug eines Subagenten", *a, event=oc("session.tool.called", agent_id="o2", tool_name="read",
                                                                 tool_use_id="t1", tool_input={"file_path": "/home/user/projekt/a.txt"}))
    hook.run("opencode form.created (Rückfrage)", *a, event=oc("form.created", tool_name="question",
                                                                tool_input={"description": "Welche Farbe?"}))
    hook.run("opencode form.replied", *a, event=oc("form.replied"))
    # (as recorded from opencode 2.2.1 with "edit": "ask")
    hook.ask("opencode Datei ändern: Diff, abgelehnt", oc("permission.asked", tool_name="edit", permission_suggestions=[
        {"type": "addRules", "behavior": "allow", "destination": "projectSettings", "rules": [{"toolName": "edit", "ruleContent": "*"}]}],
        tool_input={"old_string": "alt", "new_string": "neu", "file_path": "/home/user/projekt/a.txt"}), decide("deny"), *a)
    hook.run("opencode session.execution.failed", *a, event=oc("session.execution.failed"))
    hook.run("opencode noch ein Prompt", *a, event=oc("session.execution.started", prompt="Weiter"))
    hook.run("opencode session.execution.interrupted", *a, event=oc("session.execution.interrupted"))
    hook.run("opencode session.deleted", *a, event=oc("session.deleted"))
    pi = lambda name, **kw: dict(session_id="p2", cwd="/home/user/projekt", hook_event_name=name, **kw)
    hook.run("Pi before_agent_start", "--agent", "pi-agent", event=pi("before_agent_start", prompt="Lange Arbeit"))
    started(hook, "p2", 125)
    hook.run("Pi agent_settled nach 2 min: Neuigkeit", "--agent", "pi-agent", event=pi("agent_settled"))
    hook.run("Pi noch ein Prompt", "--agent", "pi-agent", event=pi("before_agent_start", prompt="Weiter"))
    hook.run("Pi agent_settled abgebrochen (Escape)", "--agent", "pi-agent", event=pi("agent_settled", status="aborted"))
    hook.run("Pi session_shutdown", "--agent", "pi-agent", event=pi("session_shutdown"))


def hook_golden():
    parts = []
    for name, extra in (("orca", {"ORCA_PANE_KEY": "tab:leaf", "ORCA_TERMINAL_HANDLE": "term-1", "ORCA_WORKTREE_ID": "wt"}),
                        ("daemon", {"CLAUDE_CODE_SESSION_KIND": "bg", "ORCA_PANE_KEY": "tab:leaf"})):
        for folder in ("hook-events", "hook-events-interactive"):
            hook = Hook(f"{name}-{folder}", **extra)
            recorded(hook, folder)
            parts.append(f"######## {name} {folder}\n" + hook.text())
    hook = Hook("orca-codex-events", ORCA_PANE_KEY="tab:leaf", ORCA_TERMINAL_HANDLE="term-1", ORCA_WORKTREE_ID="wt")
    recorded(hook, "codex-events", "--codex")
    parts.append("######## codex codex-events\n" + hook.text())
    for agent, args, extra in (("gemini", ["--agent", "gemini"], {}), ("crush", ["--agent", "crush"], {}),
                               ("grok", [], {"GROK_HOOK_EVENT": "x"})):
        hook = Hook(f"{agent}-events", ORCA_PANE_KEY="tab:leaf", OMARCHY_BUDDY_HOOK_WAIT="1", **extra)
        recorded_other(hook, f"{agent}-events", *args)
        parts.append(f"######## {agent} {agent}-events\n" + hook.text())
    for agent, folder in (("pi-agent", "pi-events"), ("omp", "omp-events")):
        hook = Hook(folder, ORCA_PANE_KEY="tab:leaf")
        recorded_other(hook, folder, "--agent", agent)
        parts.append(f"######## {agent} {folder}\n" + hook.text())
    hook = Hook("gebaut-plugins")
    built_plugins(hook)
    parts.append("######## gebaut plugins\n" + hook.text())
    hook = Hook("gebaut-andere", OMARCHY_BUDDY_HOOK_WAIT="1")
    built_others(hook)
    parts.append("######## gebaut andere\n" + hook.text())
    hook = Hook("gebaut-45", OMARCHY_BUDDY_HOOK_WAIT="1")
    built_45(hook)
    parts.append("######## gebaut 4.5\n" + hook.text())
    hook = Hook("gebaut")
    built(hook)
    parts.append("######## gebaut\n" + hook.text())
    hook = Hook("gebaut-codex")
    built_codex(hook)
    parts.append("######## gebaut codex\n" + hook.text())
    hook = Hook("cli")
    cli(hook)
    parts.append("######## cli\n" + hook.text())
    return "".join(parts)


# ----------------------------------------------------------------- setup

INDICATORS_QML = 'readonly property var defaultIndicatorEntries: [ "Dictation", "ScreenRecording", "Reminder", "NightLight", "Dnd", "StayAwake" ]\n'
# Omarchy 4.5 (om45/shell/plugins/bar/widgets/Indicators.qml:11)
INDICATORS_QML_45 = 'readonly property var defaultIndicatorEntries: [ "PasswordlessSudo", "ScreenRecording", "RemoteSession", "Reminder", "NightLight", "Dnd", "StayAwake" ]\n'
DEFAULT_SHELL = {"version": 1, "bar": {"position": "top", "layout": {
    "left": [{"id": "omarchy.menu"}], "center": [{"id": "omarchy.indicators"}, {"id": "omarchy.clock", "format": "HH\n\u2014\nmm"}],
    "right": [{"id": "omarchy.tray"}]}}, "plugins": [{"id": "omarchy.weather", "city": "Köln"}]}
SETTINGS = {"model": "opus", "statusLine": {"type": "command", "command": "my-statusline --x 'ä'"},
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "other-hook"}]}]}}


CODEX_HOOKS = {"hooks": {
    "SessionStart": [{"hooks": [{"command": "bash '/x/herdr.sh' session", "timeout": 10, "type": "command"}]},
                     {"hooks": [{"type": "command", "command": ": orca; cat >/dev/null", "timeout": 10}]}],
    "Stop": [{"hooks": [{"type": "command", "command": ": orca; cat >/dev/null", "timeout": 10}]}],
    "Interrupt": [{"hooks": [{"type": "command", "command": ": orca; cat >/dev/null", "timeout": 3}]}]}}


def codex_toml(home, hooks, first=0):
    """Trust for hooks as Codex writes it (codex-rs/core config edit, 0.165),
    hashes computed independently of the setup."""
    import hashlib
    out = "" if first else "[features]\nhooks = true\n"
    for event, groups in hooks["hooks"].items():
        label = re.sub(r"(?<!^)(?=[A-Z])", "_", event).lower()
        for gi, g in enumerate(groups, first):
            for hi, h in enumerate(g["hooks"]):
                timeout = h.get("timeout") or (1 if label == "interrupt" else 600)
                identity = {"event_name": label, "hooks": [{"type": "command", "command": h["command"],
                                                            "timeout": timeout, "async": h.get("async", False)}]}
                digest = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                out += f'\n[hooks.state."{home}/.codex/hooks.json:{label}:{gi}:{hi}"]\nenabled = true\ntrusted_hash = "sha256:{digest}"\n'
    return out


def fake_omarchy(name="omarchy", indicators=INDICATORS_QML):
    root = os.path.join(TMP, name)
    for rel, content in (("shell/plugins/bar/widgets/Indicators.qml", indicators),
                         ("config/omarchy/shell.json", json.dumps(DEFAULT_SHELL, indent=2))):
        os.makedirs(os.path.dirname(os.path.join(root, rel)), exist_ok=True)
        with open(os.path.join(root, rel), "w") as f:
            f.write(content)
    return root


OMARCHY = fake_omarchy()
OMARCHY_45 = fake_omarchy("omarchy-45", INDICATORS_QML_45)


class Setup:
    def __init__(self, name, settings=None, shell=None, claude_dir=True):
        self.home = os.path.join(TMP, "setup-" + name)
        os.makedirs(self.home)
        self.env = sandbox_env(self.home, OMARCHY_PATH=OMARCHY)
        if claude_dir:
            os.makedirs(os.path.join(self.home, ".claude"))
        if settings is not None:
            self.write(".claude/settings.json", settings)
        if shell is not None:
            self.write(".config/omarchy/shell.json", shell)
        self.out = [f"######## {name}"]

    def write(self, rel, data):
        path = os.path.join(self.home, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            f.write(data if isinstance(data, str) else json.dumps(data, indent=4))

    def run(self, *args, typed=None):
        """typed: run in a terminal (#208) and type that in."""
        stdin = subprocess.DEVNULL
        if typed is not None:
            master, stdin = os.openpty()
            os.write(master, typed.encode())
        r = subprocess.run([SETUP, "--files-only", *args], env=self.env, stdin=stdin, capture_output=True, text=True, timeout=60)
        if typed is not None:
            os.close(stdin); os.close(master)
        where = "" if typed is None else f" (Terminal, getippt {typed!r})"
        self.out.append(f"== setup {' '.join(args)}{where}: exit {r.returncode}\n-- stdout\n{r.stdout}-- stderr\n{r.stderr}")
        for rel in (".claude/settings.json", ".config/omarchy/shell.json", ".local/state/omarchy-buddy/setup.json",
                    ".local/state/omarchy-buddy/statusline.json", ".codex/hooks.json", ".codex/config.toml"):
            path = os.path.join(self.home, rel)
            mode = oct(os.stat(path).st_mode & 0o777) if os.path.exists(path) else "-"
            self.out.append(f"-- {rel} {mode}\n{slurp(path)}")
        hooks = os.path.join(self.home, ".codex/hooks.json")
        try:
            with open(os.path.join(self.home, ".codex/config.toml"), "rb") as f:
                state = (tomllib.load(f).get("hooks") or {}).get("state") or {}
            with open(hooks) as f:
                want = tomllib.loads(codex_toml(self.home, json.load(f))).get("hooks", {}).get("state", {})
            ok = all(want[k]["trusted_hash"] == v["trusted_hash"] for k, v in state.items() if k in want)
            self.out.append(f"-- Hashes wie Codex: {'ja' if ok else 'NEIN'}")
        except (OSError, ValueError, AttributeError, KeyError, TypeError):  # missing or broken on purpose
            pass
        entries = []
        for dirpath, dirs, files in os.walk(self.home):
            dirs.sort()
            for n in sorted(files + [d for d in dirs if os.path.islink(os.path.join(dirpath, d))]):
                p = os.path.join(dirpath, n)
                if os.path.islink(p):
                    entries.append(f"{p} -> {os.readlink(p)}")
                elif ".bak-" in n or ".vor-" in n:
                    entries.append(f"{p} {oct(os.stat(p).st_mode & 0o777)}")
        self.out.append("-- Links und Sicherungen\n" + "\n".join(sorted(set(normalize(e) for e in entries))))

    def text(self):
        return normalize("\n".join(self.out) + "\n")


def setup_golden():
    cases = []
    s = Setup("neu", SETTINGS, DEFAULT_SHELL)
    s.run(); s.run(); s.run("--remove"); s.run("--remove")
    cases.append(s)
    # #208: in a terminal it lists what it changes and asks once (here
    # without gum: the plain line); No changes nothing, --yes does not ask.
    s = Setup("frage", {}, DEFAULT_SHELL)
    os.makedirs(os.path.join(s.home, ".codex"))
    os.makedirs(os.path.join(s.home, ".gemini"))
    no_gum = os.path.join(TMP, "ohne-gum")
    os.makedirs(no_gum)
    os.symlink(sys.executable, os.path.join(no_gum, "python3"))
    s.env["PATH"] = no_gum
    s.run(typed="n\n"); s.run(typed="\n"); s.run("--yes", typed=""); s.run("--remove", typed="")
    cases.append(s)
    s = Setup("ohne-shell-json", {"model": "opus"})
    s.run(); s.run("--remove")
    cases.append(s)
    s = Setup("ohne-claude", shell=DEFAULT_SHELL, claude_dir=False)
    s.run(); s.run("--remove")
    cases.append(s)
    shell = json.loads(json.dumps(DEFAULT_SHELL))
    shell["bar"]["layout"]["left"].append({"id": "omarchy.indicators", "items": ["Dictation", "Dnd"]})
    s = Setup("zwei-indikatoren", {"statusLine": {"type": "command", "command": ""}}, shell)
    s.run()
    os.remove(os.path.join(s.home, ".local/bin/omarchy-buddy-say"))  # a link into this checkout
    s.write(".local/bin/omarchy-buddy-say", "echo eigene Datei\n")
    s.run(); s.run("--remove")
    cases.append(s)
    for name, settings, shell in (("settings-kaputt", "{kaputt", DEFAULT_SHELL), ("shell-kaputt", {}, "[1,"),
                                  ("settings-ungewohnt", {"hooks": []}, DEFAULT_SHELL),
                                  ("shell-version-2", {}, {"version": 2})):
        s = Setup(name, settings, shell)
        s.run()
        cases.append(s)
    s = Setup("omarchy-45", shell=DEFAULT_SHELL, claude_dir=False)
    s.env["OMARCHY_PATH"] = OMARCHY_45
    s.run(); s.run("--remove")
    cases.append(s)
    # Set up on 4.0, then Omarchy updates: the derived list follows, one by hand stays.
    shell = json.loads(json.dumps(DEFAULT_SHELL))
    shell["bar"]["layout"]["left"].append({"id": "omarchy.indicators", "items": ["Dnd", "NightLight"]})
    s = Setup("update-auf-45", shell=shell, claude_dir=False)
    s.run()
    s.env["OMARCHY_PATH"] = OMARCHY_45
    s.run("--indicators"); s.run("--indicators"); s.run("--remove")
    cases.append(s)
    s = Setup("update-ohne-setup", shell=DEFAULT_SHELL, claude_dir=False)
    s.run("--indicators")
    cases.append(s)
    # Codex: hooks of others (one before ours, one after, Orca-like), their
    # trust, a further account (Omarchy 4.5) that shares hooks.json.
    s = Setup("codex", {}, DEFAULT_SHELL)
    s.write(".codex/hooks.json", CODEX_HOOKS)
    s.write(".codex/config.toml", codex_toml(s.home, CODEX_HOOKS))
    s.run(); s.run()
    hooks = json.loads(slurp(os.path.join(s.home, ".codex/hooks.json")))
    hooks["hooks"]["Stop"].append({"hooks": [{"type": "command", "command": "danach-hook", "timeout": 10}]})
    s.write(".codex/hooks.json", hooks)
    with open(os.path.join(s.home, ".codex/config.toml"), "a") as f:
        f.write(codex_toml(s.home, {"hooks": {"Stop": hooks["hooks"]["Stop"][2:]}}, first=2))
    account = os.path.join(s.home, ".local/state/omarchy/agents/accounts/codex/zwei")
    os.makedirs(account)
    os.symlink(os.path.join(s.home, ".codex/hooks.json"), os.path.join(account, "hooks.json"))
    s.write(".local/state/omarchy/agents/accounts/codex.json",
            {"active": "zwei", "accounts": [{"id": "main", "primary": True, "home": ""}, {"id": "zwei", "home": account},
                                             {"id": "fremd", "home": "/nirgends"}]})
    s.run(); s.run("--remove"); s.run("--remove")
    cases.append(s)
    s = Setup("codex-neu", {}, DEFAULT_SHELL)
    os.makedirs(os.path.join(s.home, ".codex"))
    s.run(); s.run("--remove")
    cases.append(s)
    for name, hooks, toml in (("codex-hooks-kaputt", "{kaputt", ""), ("codex-hooks-ungewohnt", {"hooks": []}, ""),
                              ("codex-toml-kaputt", {}, "[kaputt"),
                              ("codex-toml-inline", {}, 'hooks = { state = { "x" = { enabled = true } } }\n')):
        s = Setup(name, {}, DEFAULT_SHELL)
        s.write(".codex/hooks.json", hooks)
        s.write(".codex/config.toml", toml)
        s.run()
        cases.append(s)
    # Our trust written inline by someone else: left alone, nothing changes.
    s = Setup("codex-trust-inline", {}, DEFAULT_SHELL)
    os.makedirs(os.path.join(s.home, ".codex"))
    s.run()
    text = slurp(os.path.join(s.home, ".codex/config.toml"))
    s.write(".codex/config.toml", "[hooks]\nstate = { " + ", ".join(
        f'"{k}" = {{ enabled = true, trusted_hash = "{h}" }}'
        for k, h in re.findall(r'\[hooks\.state\."([^"]+)"\]\nenabled = true\ntrusted_hash = "([^"]+)"', text)) + " }\n")
    s.run("--remove")
    cases.append(s)
    # #154: a hook of someone else in a group of ours stays there; our old
    # status line comes back from the guard without statusline.json.
    home = os.path.join(TMP, "setup-fremd-in-gruppe")
    q = lambda p: f"if [ -x {p} ]; then exec {p}"
    foreign = {"type": "command", "command": "eigener-hook", "timeout": 7}
    settings = {"statusLine": {"type": "command", "command": q(f"{home}/.local/bin/omarchy-buddy-statusline")
                               + "; else exec sh -c 'my-statusline --x '\"'\"'ä'\"'\"''; fi"},
                "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [
                    {"type": "command", "command": q(f"{home}/.local/bin/omarchy-buddy-hook") + "; fi"}, foreign]}]}}
    codex = {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": q(f"{home}/.local/bin/omarchy-buddy-hook")
                                            + " --codex; fi", "timeout": 30}, foreign]}]}}
    s = Setup("fremd-in-gruppe", settings, DEFAULT_SHELL)
    s.write(".codex/hooks.json", codex)
    s.write(".codex/config.toml", codex_toml(s.home, codex))
    s.run(); s.run()
    os.remove(os.path.join(s.home, ".local/state/omarchy-buddy/statusline.json"))
    s.run("--remove")
    cases.append(s)
    s = Setup("aufrufe", {}, DEFAULT_SHELL)
    s.run("--help"); s.run("--quatsch")
    cases.append(s)
    return "".join(c.text() for c in cases)


# ------------------------------------------------------------------ main

def main():
    update = "--update" in sys.argv
    fails = 0
    try:
        for name, make in (("hook.txt", hook_golden), ("setup.txt", setup_golden)):
            text = make()
            path = os.path.join(GOLDEN, name)
            if update:
                os.makedirs(GOLDEN, exist_ok=True)
                with open(path, "w", encoding="utf-8", errors="surrogateescape") as f:
                    f.write(text)
                print(f"geschrieben {path}")
                continue
            want = slurp(path)
            if text == want:
                print(f"ok   golden {name}")
            else:
                fails += 1
                print(f"FAIL golden {name}")
                sys.stdout.writelines(list(difflib.unified_diff(want.splitlines(True), text.splitlines(True),
                                                                "erwartet", "jetzt", n=2))[:80])
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
