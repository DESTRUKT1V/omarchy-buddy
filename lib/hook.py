# Claude Code and Codex hook for the Omarchy-Buddy island. bin/omarchy-buddy-hook
# starts it: the agents call that name; here Python keeps it compiled.
#
# Every registered hook event updates one record per session in
# $XDG_RUNTIME_DIR/omarchy-buddy/state.json, which the widget watches. A
# PermissionRequest additionally waits a short while for a decision written by
# the widget (allow / always / deny / focus), also while the session's terminal
# is in view: the island can answer every request. No decision (the time ran
# out, or "focus") means no output, so Claude shows its normal prompt. It
# only waits while the island lives (its sign of life $RUN_DIR/island is
# younger than 15 s, Hyprland runs); otherwise the terminal asks at once.
#
# Two tools ask through PermissionRequest as well and get their own kind of
# request: AskUserQuestion (kind "question": the island sends the answers,
# the hook hands them to the tool as updatedInput.answers) and ExitPlanMode
# (kind "plan": approve in auto or default mode, or send it back with
# feedback). PreToolUse/PostToolUse keep the list of running tools.
#
# Subagents share their session's id and can ask at the same time, so every
# waiting hook lists its own request under the session (id, pid, deadline) and
# waits for a decision file named after that request, never the session.
#
# Codex calls it with --codex. Its events look like Claude's (its shell is
# "Bash", apply_patch edits files), plus Interrupt (Escape); it has no
# questions or plans, and a decision is allow or deny only.
#
# Further agents call it with --agent NAME (OTHER_AGENTS), Grok and Cursor
# like Claude (they run ~/.claude/settings.json's hooks too; their events
# say who they are). Their events and tools are translated to Claude's.
# None of them can be answered from the island; an approval only shows as
# "braucht dich". opencode, Pi and Oh My Pi call it
# from our plugins (agent-plugins/, #142); the island answers opencode's
# approvals, the plugin hands the decision on.
#
#   omarchy-buddy-hook            read a hook event from stdin (used by Claude, Grok, Cursor)
#   omarchy-buddy-hook --codex    the same for Codex
#   omarchy-buddy-hook --agent gemini|crush|copilot|opencode|pi-agent|omp   the same for these
#   omarchy-buddy-hook --prune    drop sessions whose claude process is gone and
#                                requests whose hook is gone
#   omarchy-buddy-hook --decide SESSION REQUEST allow|always|deny|auto
#   omarchy-buddy-hook --decide SESSION REQUEST revise TEXT   plan: keep planning
#   omarchy-buddy-hook --answer SESSION REQUEST '{"question": "answer", …}'
#   omarchy-buddy-hook --decide SESSION focus     stop all waits of the session
#   omarchy-buddy-hook --orca-goto TERMINAL PANE   show that Orca pane
#   omarchy-buddy-hook --end SESSION   end a (forgotten) session: SIGTERM to its claude (codex)
#   omarchy-buddy-hook --command STATUS SECONDS SHELL_PID COMMAND   a long terminal command ended (lib/long-commands.sh)

import fcntl
import json
import os
import re
import signal
import sys
import time

# subprocess and shutil are imported where a process starts: most events start
# none, and the two imports cost about a fifth of the hook's time.

import buddy
from texts import t, ERRORS, clock, first_name

DIR = buddy.RUN_DIR
STATE = os.path.join(DIR, "state.json")
LOCK = os.path.join(DIR, "lock")
DECIDE_DIR = os.path.join(DIR, "decide")
ISLAND = os.path.join(DIR, "island")  # the island's sign of life, written every 5 s (Buddy.qml)
ISLAND_FRESH = 15
WAIT_SECONDS = 30
WAIT_READ_SECONDS = 300  # questions and plans take longer to read
FULL_MAX = 4000  # characters of the full command shown when expanded
PLAN_MAX = 20000
DIFF_MAX = 30000  # characters of old and new text of a file change, all edits together
RUNNING_MAX = 6
PARENT = os.getppid()  # the agent's shell; a hook that goes on in the background loses it
REQUEST_ID = re.compile(r"^[0-9]+-[0-9]+$")
DONE_MIN_SECONDS = 20  # shorter runs finish while the user is still looking
STALE_AFTER = 12 * 3600  # --prune drops sessions without a hook event for this long


# The state holds commands and questions from Claude: the user's alone.
private_dir, private_open = buddy.private_dir, buddy.private_open


def locked_update(change):
    private_dir(DIR)
    with private_open(LOCK) as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        text = ""
        try:
            with open(STATE) as f:
                text = f.read()
            sessions = json.loads(text)
        except (OSError, ValueError):
            sessions = {}
        if not isinstance(sessions, dict):  # written by someone else: start over
            sessions = {}
        change(sessions)
        new = json.dumps(sessions)
        if new == text:  # unchanged (--prune every few seconds): the island need not reload
            return
        tmp = STATE + ".tmp"
        with private_open(tmp) as f:
            f.write(new)
        os.replace(tmp, STATE)


def proc_parent(pid):
    try:
        with open(f"/proc/{pid}/stat") as f:
            return int(f.read().rsplit(")", 1)[1].split()[1])
    except (OSError, ValueError, IndexError):
        return 0


def proc_name(pid):
    try:
        with open(f"/proc/{pid}/comm") as f:
            return f.read().strip()
    except OSError:
        return ""


def hypr_json(*args):
    import subprocess
    try:
        out = subprocess.run(["hyprctl", *args, "-j"], capture_output=True, text=True, timeout=2).stdout
        return json.loads(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def proc_args(pid):
    try:
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            return f.read().decode(errors="replace").split("\0")
    except OSError:
        return []


# Sessions the Claude daemon runs (claude --bg, claude agents): no terminal
# of their own; the daemon hosts each in `claude --bg-pty-host`.
DAEMON_KINDS = ("bg", "daemon", "daemon-worker")


def is_daemon_host(pid):
    args = proc_args(pid)
    return "--bg-pty-host" in args or (proc_name(pid) == "claude" and "daemon" in args[1:2])


def is_agent(pid, agent):
    """pid is the agent's own process: named like it (Grok: grok-1.0.70, or
    its "proc"), or a node running its script (Gemini, Cursor)."""
    name = proc_name(pid)
    own = OTHER_AGENTS.get(agent, {}).get("proc", agent)
    if name == own or name.startswith(own + "-"):
        return True
    script = OTHER_AGENTS.get(agent, {}).get("script")
    # (node names its main thread "node-MainThread"; Gemini restarts itself with --max-old-space-size first)
    return bool(script) and name.startswith("node") and any(script in a for a in proc_args(pid)[1:3])


def proc_env(pid):
    try:
        with open(f"/proc/{pid}/environ", "rb") as f:
            pairs = f.read().decode(errors="replace").split("\0")
    except OSError:
        return {}
    return dict(p.split("=", 1) for p in pairs if "=" in p)


# Agents whose hooks can run in a shared background server: the server's
# argument and the agent's process name. opencode 2.2 always does
# (`opencode serve --service`, its plugin calls the hook).
SERVERS = {"codex": ("app-server", "codex"), "opencode": ("serve", "opencode.exe")}


def served_start(cwd, agent):
    """Where the walk up starts for Codex (opencode), and that process's
    environment. Codex's shared background server (codex app-server) runs
    the hooks of every Codex window, with the environment and place in the
    process tree of the one that started it; then the session's own codex is
    the one working in the event's folder."""
    server, own = SERVERS[agent]
    pid = PARENT
    while pid > 1 and server not in proc_args(pid):
        pid = proc_parent(pid)
    if pid <= 1:
        return PARENT, os.environ
    # shortcut: two Codex windows in the same folder stay without a window; tell them apart by the session once Codex says which client runs it.
    real = os.path.realpath(cwd) if cwd else ""
    found = []
    for name in os.listdir("/proc"):
        if name.isdigit() and proc_name(name) == own and server not in proc_args(name):
            try:
                if os.path.realpath(f"/proc/{name}/cwd") == real:
                    found.append(int(name))
            except OSError:
                pass
    return (found[0], proc_env(found[0])) if len(found) == 1 else (0, {})


def find_agent_and_window(agent="claude", cwd=""):
    """Walk up the process tree: the claude (codex) process, the terminal
    window that hosts it, where the session comes from: "daemon" (Claude's
    background service), "orca" (an Orca terminal), "terminal" or "", and
    the session's environment."""
    pid, env = served_start(cwd, agent) if agent in SERVERS else (PARENT, os.environ)
    clients = (hypr_json("clients") or []) if pid else []
    windows = {c.get("pid"): c.get("address") for c in clients}
    daemon = env.get("CLAUDE_CODE_SESSION_KIND") in DAEMON_KINDS
    agent_pid, window, orca = 0, "", False
    while pid > 1:
        if not agent_pid and is_agent(pid, agent):
            agent_pid = pid
        daemon = daemon or (agent == "claude" and is_daemon_host(pid))
        orca = orca or proc_name(pid) == "orca-ide"
        if not window and pid in windows:
            window = windows[pid]
        pid = proc_parent(pid)
    if daemon:
        # A daemon started from a terminal can sit below it; that window is not the session's.
        return agent_pid, "", "daemon", env
    return agent_pid, window, "orca" if orca or env.get("ORCA_PANE_KEY") else "terminal" if window else "", env


def shorten(text, n):
    """text cut to at most n characters at a word end, with "…"."""
    if len(text) <= n:
        return text
    cut = text[:n - 1]
    return (cut.rsplit(" ", 1)[0] if " " in cut else cut).rstrip(" ,.;:") + "…"


def summarize(tool, tool_input):
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    if tool == "apply_patch":  # Codex: the patch is the "command"; its files say enough
        files = re.findall(r"^\*\*\* (?:Add|Update|Delete) File: (.+)$", str(tool_input.get("command") or ""), re.M)
        return ", ".join(f.strip() for f in files)[:300]
    for key in ("command", "file_path", "url", "pattern", "query", "path", "target_file", "target_directory",
                "description"):
        value = tool_input.get(key)
        if isinstance(value, str) and value.strip():
            return " ".join(value.split())[:300]
    return ""


def describe(tool_input, detail):
    """Claude's own words for a tool call (Bash's "description": "Build-Ordner
    leeren"), shown above the command (#193, B9); "" when there are none or
    they are the detail itself."""
    value = tool_input.get("description") if isinstance(tool_input, dict) else None
    value = " ".join(value.split())[:200] if isinstance(value, str) else ""
    return "" if value == detail else value


def full_text(tool_input):
    """The whole input for the expanded view: the command as written (with its
    line breaks), otherwise the input as JSON. Ends in " …" when cut."""
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    value = tool_input.get("command")
    if not isinstance(value, str) or not value.strip():
        value = json.dumps(tool_input, ensure_ascii=False, indent=1)
    value = value.strip()
    return value[:FULL_MAX] + (" …" if len(value) > FULL_MAX else "")


def patch_edits(patch, cwd):
    """Codex's apply_patch as (file, old, new, created): per hunk the lines
    with " " and "-" before, with " " and "+" after; an added file is all
    new, a deleted one all old (read from disk). Paths are relative to cwd."""
    edits, file, kind, old, new, empty_add = [], "", "", [], [], [False]

    def flush():
        if file and (old or new or empty_add[0]):  # (an added empty file is a change too)
            edits.append((file, "\n".join(old), "\n".join(new), kind == "Add"))
        old.clear()
        new.clear()
        empty_add[0] = False
    for line in str(patch or "").splitlines():
        m = re.match(r"\*\*\* (Add|Update|Delete) File: (.+)$", line)
        if m or line.startswith(("@@", "*** End Patch")):
            flush()
        if m:
            kind, file = m.group(1), os.path.join(cwd, m.group(2).strip())
            empty_add[0] = kind == "Add"
            if kind == "Delete":
                try:
                    with open(file) as f:
                        edits.append((file, f.read(DIFF_MAX + 1), "", False))
                except (OSError, ValueError):
                    edits.append((file, "", "", False))
        elif kind == "Add" and line.startswith("+"):
            new.append(line[1:])
        elif kind == "Update" and line[:1] in (" ", "-", "+"):
            (old if line[0] != "+" else new).append(line[1:])
            if line[0] == " ":
                new.append(line[1:])
    flush()
    return edits


def file_edits(tool, tool_input, cwd=""):
    """A file change as old/new text per edit for the island's diff
    (shell/DiffLogic.js): [{"file", "old", "new", "created"}], and whether
    some of it did not fit into DIFF_MAX. None for other tools."""
    i = tool_input if isinstance(tool_input, dict) else {}
    path = str(i.get("file_path") or i.get("notebook_path") or "")
    if tool == "apply_patch":  # Codex
        pairs = patch_edits(i.get("command"), cwd)
    elif tool == "Edit":
        pairs = [(i.get("old_string"), i.get("new_string"))]
    elif tool == "MultiEdit":
        pairs = [(e.get("old_string"), e.get("new_string")) for e in i.get("edits") or [] if isinstance(e, dict)]
    elif tool == "Write":
        try:
            with open(path) as f:
                pairs = [(f.read(DIFF_MAX + 1), i.get("content"))]
        except ValueError:
            return [], True  # not text: nothing to show
        except OSError:
            pairs = [(None, i.get("content"))]  # a new file
    elif tool == "NotebookEdit":
        mode = i.get("edit_mode") or "replace"
        old = notebook_cell(path, i.get("cell_id")) if mode != "insert" else ""
        pairs = [(old, "" if mode == "delete" else i.get("new_source"))]
    else:
        return None, False
    if tool != "apply_patch":
        created = tool == "Write" and not os.path.exists(path)
        pairs = [(path, old, new, created) for old, new in pairs]
    edits, room, cut = [], DIFF_MAX, False
    for path, old, new, created in pairs:
        old, new = (old if isinstance(old, str) else ""), (new if isinstance(new, str) else "")
        if len(old) + len(new) > room:
            cut = True
            if old or room <= 0:
                break  # half a before or after would show a wrong diff
            new = new[:new.rfind("\n", 0, room) + 1] or new[:room]  # a new file's start is still right
        room -= len(old) + len(new)
        edits.append({"file": path, "old": old, "new": new, "created": created})
    return edits, cut


def notebook_cell(path, cell_id):
    """The source of a notebook cell (by id, or "cell-N"), "" if not found."""
    try:
        if os.path.getsize(path) > 5_000_000:
            return ""
        with open(path) as f:
            cells = json.load(f).get("cells") or []
        m = re.fullmatch(r"cell-(\d+)", str(cell_id or ""))
        cell = next((c for c in cells if c.get("id") == cell_id), None) or \
            (cells[int(m.group(1))] if m and int(m.group(1)) < len(cells) else {})
        source = cell.get("source") or ""
        return "".join(source) if isinstance(source, list) else str(source)
    except (OSError, ValueError, AttributeError, TypeError):
        return ""


def describe_suggestions(suggestions):
    """What "Immer erlauben" would remember, in a few words."""
    parts = []
    for item in suggestions:
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        if kind in ("addRules", "replaceRules") and item.get("behavior") == "allow":
            for rule in item.get("rules") or []:
                if isinstance(rule, dict) and rule.get("toolName"):
                    content = rule.get("ruleContent")
                    parts.append(rule["toolName"] + (f"({content})" if content else ""))
        elif kind == "setMode":
            parts.append(t("rule.mode", mode=item.get("mode", "")))
        elif kind == "addDirectories":
            parts += [t("rule.folder", folder=d) for d in item.get("directories") or []]
    if not parts:
        return ""
    destination = suggestions[0].get("destination", "") if isinstance(suggestions[0], dict) else ""
    where = t("where." + destination) if destination in ("session", "localSettings", "projectSettings", "userSettings") else ""
    return ", ".join(parts) + (f" – {where}" if where else "")


def request_kind(tool):
    return {"AskUserQuestion": "question", "ExitPlanMode": "plan"}.get(tool, "permission")


def clean_questions(tool_input):
    """AskUserQuestion's questions, only the fields the island shows."""
    questions = tool_input.get("questions") if isinstance(tool_input, dict) else None
    result = []
    for q in questions if isinstance(questions, list) else []:
        if not isinstance(q, dict) or not isinstance(q.get("question"), str):
            continue
        options = [{"label": str(o.get("label", "")), "description": str(o.get("description") or "")}
                   for o in q.get("options") or [] if isinstance(o, dict) and o.get("label")]
        result.append({"question": q["question"], "header": str(q.get("header") or ""),
                       "multiSelect": q.get("multiSelect") is True, "options": options})
    return result


def plan_text(tool_input):
    """The plan as Claude wrote it (markdown); from its file if the input lacks it."""
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    plan = tool_input.get("plan")
    if not isinstance(plan, str) or not plan.strip():
        try:
            with open(str(tool_input.get("planFilePath") or "")) as f:
                plan = f.read(PLAN_MAX + 1)
        except (OSError, ValueError):
            plan = ""
    plan = plan.strip()
    return plan[:PLAN_MAX] + (" …" if len(plan) > PLAN_MAX else "")


def plan_title(plan):
    for line in plan.splitlines():
        line = line.strip().lstrip("#").strip()
        if line:
            return line[:300]
    return "Plan"


def valid_answers(questions, answers):
    """Answers keyed by question text, values as text (several options joined
    with ", ", as Claude's own dialog does). Anything else is dropped."""
    if not isinstance(answers, dict):
        return {}
    known = {q.get("question") for q in questions if isinstance(q, dict)}
    result = {}
    for question, answer in answers.items():
        if isinstance(answer, list):
            answer = ", ".join(str(a) for a in answer if str(a).strip())
        if question in known and isinstance(answer, str) and answer.strip():
            result[question] = answer.strip()
    return result


# What "Freigeben" in the island means for the mode Claude carries on in.
PLAN_MODES = {"auto": "auto", "allow": "default"}


def decision_result(kind, decision, tool_input, suggestions):
    """The PermissionRequest decision for what the user chose in the island, or
    None: the terminal asks."""
    if not isinstance(decision, dict):
        return None
    choice = decision.get("decision")
    tool_input = tool_input if isinstance(tool_input, dict) else {}
    if kind == "question":
        answers = valid_answers(tool_input.get("questions") or [], decision.get("answers"))
        if not answers:
            return None
        return {"behavior": "allow", "updatedInput": dict(tool_input, answers=answers)}
    if kind == "plan":
        if choice in PLAN_MODES:
            return {"behavior": "allow", "updatedInput": tool_input,
                    "updatedPermissions": [{"type": "setMode", "mode": PLAN_MODES[choice], "destination": "session"}]}
        if choice == "revise":
            text = " ".join(str(decision.get("text") or "").split())
            return {"behavior": "deny", "message": text or t("plan.revise", name=first_name() or "User")}
        return None
    if choice not in ("allow", "always", "deny"):
        return None
    result = {"behavior": "deny" if choice == "deny" else "allow"}
    if choice == "deny":
        result["message"] = t("denied")
    if choice == "always" and suggestions:
        result["updatedPermissions"] = suggestions
    return result


def parse_decision(text):
    """A decision file: JSON ({"decision": …} or {"answers": …}), or a bare word."""
    text = text.strip()
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except ValueError:
            return None
        return data if isinstance(data, dict) else None
    return {"decision": text} if text else None


def window_focused(window):
    return bool(window) and (hypr_json("activewindow") or {}).get("address") == window


def orca_json(*args):
    """Result of an Orca CLI call, or None. Never bare `orca`: that is the screen reader."""
    import shutil
    import subprocess
    cli = shutil.which("orca-ide") or os.path.expanduser("~/.local/bin/orca-ide")
    try:
        out = subprocess.run([cli, *args, "--json"], capture_output=True, text=True, timeout=3).stdout
        data = json.loads(out)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return data.get("result") if isinstance(data, dict) and data.get("ok") else None


def find_tab_group(node, tab_id):
    """The tab group in an Orca visual layout that holds tab_id, and the tab."""
    if isinstance(node, dict):
        for tab in node.get("tabs") or []:
            if isinstance(tab, dict) and tab.get("tabId") == tab_id:
                return node, tab
        children = node.values()
    elif isinstance(node, list):
        children = node
    else:
        return None, None
    for child in children:
        group, tab = find_tab_group(child, tab_id)
        if group:
            return group, tab
    return None, None


def orca_pane_shown(worktree, pane):
    """Orca shows this worktree and, in it, the pane (tab:leaf) as the active
    one of its tab. Anything unknown counts as not shown."""
    tab_id, _, leaf_id = pane.partition(":")
    if not worktree or not tab_id or not leaf_id:
        return False
    ps = orca_json("worktree", "ps") or {}
    if not any(w.get("worktreeId") == worktree and w.get("isActive") for w in ps.get("worktrees") or []):
        return False
    listing = orca_json("terminal", "list", "--worktree", "id:" + worktree, "--include-visual-layouts") or {}
    for layout in listing.get("visualLayouts") or []:
        if layout.get("worktreeId") != worktree:
            continue
        group, tab = find_tab_group(layout.get("root"), tab_id)
        if group:
            return group.get("activeTabId") == tab_id and tab.get("activeLeafId") == leaf_id
    return False


def session_in_view(record):
    """The user is looking at this session's terminal. All Orca panes share one
    window, so for them the window focus alone says nothing."""
    if not window_focused(record.get("window")):
        return False
    if record.get("orca"):
        return orca_pane_shown(record.get("orca_worktree", ""), record.get("orca_pane", ""))
    return True


def island_alive():
    """Only a running island can answer a request: without Hyprland (ssh, a
    tty) or without a fresh sign of life the terminal asks at once."""
    if not os.environ.get("HYPRLAND_INSTANCE_SIGNATURE"):
        return False
    try:
        return time.time() - os.path.getmtime(ISLAND) < ISLAND_FRESH
    except OSError:
        return False


def wait_for_decision(request_id, seconds):
    """Wait for a decision from the island, also while the terminal is in
    view; "focus" ("Zum Fenster") ends the wait early."""
    path = os.path.join(DECIDE_DIR, request_id)
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            with open(path) as f:
                decision = parse_decision(f.read())
            os.remove(path)
            return decision
        except OSError:
            time.sleep(0.05)  # Claude goes on at most this long after the click
    return None


# Claude's own names, for agents that send them (Grok, Copilot).
CLAUDE_EVENTS = {e: e for e in ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse",
                                "PostToolUseFailure", "Notification", "Stop", "StopFailure", "SessionEnd")}

# Agents with hooks that are neither Claude's nor Codex's: their event and
# tool names in Claude's words (an event missing here is ignored), and for a
# node program the part of its script path that tells it apart. "sync": the
# agent waits for every hook, so the hook goes on in the background.
OTHER_AGENTS = {
    # Gemini CLI (docs/hooks/reference.md of 0.66). Notification is its
    # approval dialog, which only the terminal can answer: BeforeTool can
    # deny or ask, never allow (scheduler: the policy check comes after it).
    "gemini": {
        "name": "Gemini", "script": "gemini-cli", "sync": True,
        "events": {"SessionStart": "SessionStart", "BeforeAgent": "UserPromptSubmit",
                   "BeforeTool": "PreToolUse", "AfterTool": "PostToolUse", "AfterAgent": "Stop",
                   "Notification": "Notification", "SessionEnd": "SessionEnd"},
        "tools": {"run_shell_command": "Bash", "read_file": "Read", "read_many_files": "Read",
                  "list_directory": "Read", "write_file": "Write", "replace": "Edit", "glob": "Glob",
                  "grep_search": "Grep", "search_file_content": "Grep", "web_fetch": "WebFetch",
                  "google_web_search": "WebSearch", "activate_skill": "Skill"},
    },
    # Crush (embedded docs of 0.99). PermissionRequest only says that it
    # asks; PermissionResult that the user answered. TurnStart has no prompt.
    "crush": {
        "name": "Crush", "sync": True,
        "events": {"SessionStart": "SessionStart", "TurnStart": "UserPromptSubmit", "PreToolUse": "PreToolUse",
                   "PostToolUse": "PostToolUse", "PostToolUseFailure": "PostToolUseFailure",
                   "PermissionRequest": "Asks", "PermissionResult": "Answered", "TurnEnd": "Stop",
                   "StopFailure": "StopFailure", "Interrupt": "Interrupt", "SessionEnd": "SessionEnd"},
        "tools": {"bash": "Bash", "view": "Read", "ls": "Read", "edit": "Edit", "multiedit": "MultiEdit",
                  "write": "Write", "grep": "Grep", "glob": "Glob", "fetch": "WebFetch", "agent": "Agent"},
    },
    # Grok CLI 1.0 runs Claude's hooks in Claude's words, plus its own
    # camelCase fields ("hookEventName"). Its Stop "shutdown" comes after
    # SessionEnd and would bring the session back.
    "grok": {
        "name": "Grok", "sync": True, "events": CLAUDE_EVENTS,
        "tools": {"run_terminal_command": "Bash", "read_file": "Read", "list_dir": "Read",
                  "search_replace": "Edit", "write": "Write", "grep": "Grep", "web_search": "WebSearch",
                  "spawn_subagent": "Agent"},
    },
    # Cursor CLI runs Claude's hooks with its own events (cursor_version in
    # every one); its names and Claude's are both taken. No approval event.
    # shortcut: built from Cursor's docs, not recorded (no login); record once someone uses it.
    "cursor-agent": {
        "name": "Cursor", "script": "cursor-agent", "sync": True,
        "events": {**CLAUDE_EVENTS, "sessionStart": "SessionStart", "beforeSubmitPrompt": "UserPromptSubmit",
                   "preToolUse": "PreToolUse", "postToolUse": "PostToolUse",
                   "postToolUseFailure": "PostToolUseFailure", "stop": "Stop", "sessionEnd": "SessionEnd"},
        "tools": {"Shell": "Bash", "StrReplace": "Edit"},
    },
    # GitHub Copilot CLI with its own file (~/.copilot/hooks/omarchy-buddy.json):
    # with Claude's event names it sends Claude's fields.
    # shortcut: built from GitHub's docs, not recorded (no login); record once someone uses it.
    "copilot": {
        "name": "Copilot", "sync": True, "events": CLAUDE_EVENTS,
        "tools": {"bash": "Bash", "view": "Read", "edit": "Edit", "create": "Write", "grep": "Grep",
                  "glob": "Glob", "web_fetch": "WebFetch", "task": "Agent"},
    },
    # Plugin agents (#142): our plugin (agent-plugins/) sends their events
    # under their own names in Claude's shape; nothing waits for the hook.
    # opencode 2.2: the island answers its approvals (the plugin hands the
    # decision to ctx.permission.reply); a form is a question to the user.
    "opencode": {
        "name": "opencode", "proc": "opencode.exe",
        "events": {"session.created": "SessionStart", "session.execution.started": "UserPromptSubmit",
                   "session.tool.called": "PreToolUse", "session.tool.success": "PostToolUse",
                   "session.tool.failed": "PostToolUseFailure", "permission.asked": "PermissionRequest",
                   "permission.replied": "Answered", "form.created": "Asks", "form.replied": "Answered",
                   "form.cancelled": "Answered", "session.execution.succeeded": "Stop",
                   "session.execution.failed": "StopFailure", "session.execution.interrupted": "Interrupt",
                   "session.deleted": "SessionEnd"},
        "tools": {"shell": "Bash", "read": "Read", "edit": "Edit", "write": "Write", "glob": "Glob", "grep": "Grep",
                  "webfetch": "WebFetch", "websearch": "WebSearch", "subagent": "Agent", "skill": "Skill"},
    },
    # Pi 1.4 never asks; its run is over at agent_settled (agent_end can
    # be followed by a retry).
    "pi-agent": {
        "name": "Pi", "proc": "pi",
        "events": {"session_start": "SessionStart", "before_agent_start": "UserPromptSubmit",
                   "tool_execution_start": "PreToolUse", "tool_execution_end": "PostToolUse",
                   "agent_settled": "Stop", "session_shutdown": "SessionEnd"},
        "tools": {"bash": "Bash", "read": "Read", "edit": "Edit", "write": "Write"},
    },
    # Oh My Pi 18 has no agent_settled; it says when it asks, never lets a plugin answer.
    "omp": {
        "name": "Oh My Pi",
        "events": {"session_start": "SessionStart", "before_agent_start": "UserPromptSubmit",
                   "tool_execution_start": "PreToolUse", "tool_execution_end": "PostToolUse",
                   "tool_approval_requested": "Asks", "tool_approval_resolved": "Answered",
                   "agent_end": "Stop", "session_shutdown": "SessionEnd"},
        "tools": {"bash": "Bash", "read": "Read", "edit": "Edit", "write": "Write", "glob": "Glob", "grep": "Grep",
                  "task": "Agent", "web_search": "WebSearch"},
    },
    # Omarchy 4.5's agents (#145), from their docs and Orca's hook setup;
    # none of them is installed here.
    # shortcut: built from docs, not recorded (no install, no login); record each once someone uses it.
    # Antigravity (agy, 4.5's Gemini): camelCase, without the event's name
    # (our command passes it) and without the prompt. PreInvocation comes
    # before every model call; Stop counts once it is fully idle.
    "agy": {
        "name": "Antigravity", "sync": True,
        "events": {"SessionStart": "SessionStart", "PreInvocation": "Invocation", "PreToolUse": "PreToolUse",
                   "PostToolUse": "PostToolUse", "Stop": "Stop"},
        "tools": {"run_command": "Bash", "view_file": "Read", "list_dir": "Read", "write_to_file": "Write",
                  "replace_file_content": "Edit", "multi_replace_file_content": "Edit", "grep_search": "Grep",
                  "find_by_name": "Glob", "read_url_content": "WebFetch", "search_web": "WebSearch",
                  "invoke_subagent": "Agent"},
    },
    # Qwen Code (a Gemini CLI fork) in Claude's words; Notification says when it asks.
    "qwen": {
        "name": "Qwen Code", "script": "qwen-code", "sync": True, "events": CLAUDE_EVENTS,
        "tools": {"run_shell_command": "Bash", "read_file": "Read", "write_file": "Write", "edit": "Edit",
                  "grep_search": "Grep", "glob": "Glob"},
    },
    # Kimi Code: PermissionRequest/Result only watch; TurnStarted has the prompt.
    "kimi": {
        "name": "Kimi", "script": "kimi-code", "sync": True,
        "events": {"UserPromptSubmit": "UserPromptSubmit", "TurnStarted": "UserPromptSubmit",
                   "PreToolUse": "PreToolUse", "PostToolUse": "PostToolUse", "PostToolUseFailure": "PostToolUseFailure",
                   "PermissionRequest": "Asks", "PermissionResult": "Answered", "Stop": "Stop",
                   "StopFailure": "StopFailure", "Interrupt": "Interrupt", "SessionEnd": "SessionEnd"},
        "tools": {"Shell": "Bash"},
    },
    # Devin CLI: Claude's shape without cwd; its PermissionRequest is shown, not answered.
    "devin": {
        "name": "Devin", "sync": True,
        "events": {"SessionStart": "SessionStart", "UserPromptSubmit": "UserPromptSubmit", "PreToolUse": "PreToolUse",
                   "PostToolUse": "PostToolUse", "PermissionRequest": "Asks", "Stop": "Stop", "SessionEnd": "SessionEnd"},
        "tools": {"exec": "Bash", "read": "Read", "write": "Write", "edit": "Edit", "grep": "Grep", "glob": "Glob",
                  "webfetch": "WebFetch", "run_subagent": "Agent"},
    },
    # Command Code has no prompt event: its first tool starts the round.
    "commandcode": {
        "name": "Command Code", "script": "command-code", "sync": True, "no_prompt": True,
        "events": {"SessionStart": "SessionStart", "PreToolUse": "PreToolUse", "PostToolUse": "PostToolUse",
                   "Stop": "Stop"},
        "tools": {"shell_command": "Bash", "read_file": "Read", "write_file": "Write", "edit_file": "Edit"},
    },
    # Kiro CLI (V3 hook files): the prompt comes in $USER_PROMPT; no event for asking.
    "kiro-cli": {
        "name": "Kiro", "sync": True,
        "events": {"SessionStart": "SessionStart", "AgentSpawn": "SessionStart", "UserPromptSubmit": "UserPromptSubmit",
                   "PreToolUse": "PreToolUse", "PostToolUse": "PostToolUse", "Stop": "Stop", "SessionEnd": "SessionEnd"},
        "tools": {"execute_bash": "Bash", "fs_read": "Read", "fs_write": "Write", "grep": "Grep", "glob": "Glob",
                  "web_fetch": "WebFetch", "web_search": "WebSearch", "use_subagent": "Agent"},
    },
    # Muse Code 1.4 (#144) in Claude's words, its hooks in a cleared
    # environment ("cleared_env"). PermissionRequest comes before Muse's own
    # decision, also for calls that never ask, so it is left out; Notification
    # comes once someone must answer, ToolUseStart once the tool runs.
    # shortcut: tool events from Orca's Muse parser and the binary, recorded only without them (no login); record once someone uses Muse.
    "muse": {
        "name": "Muse", "sync": True, "cleared_env": True,
        "events": {**CLAUDE_EVENTS, "ToolUseStart": "Answered"},
        "tools": {"shell_command": "Bash", "exec_command": "Bash", "read_file": "Read", "write_file": "Write",
                  "edit_file": "Edit", "web_fetch": "WebFetch", "web_search": "WebSearch"},
    },
}
# What Antigravity reads from its hooks (Orca answers the same): PreToolUse
# "ask" leaves the decision to Antigravity's own rules.
AGY_REPLY = {"PreToolUse": '{"decision":"ask"}', "Stop": '{"decision":""}'}

# Agent → its name in texts.
AGENT_NAMES = {"claude": "Claude", "codex": "Codex", **{a: o["name"] for a, o in OTHER_AGENTS.items()}}


def caller(event):
    """Who runs the Claude hook: Grok and Cursor run it too, and so may
    Devin (it reads Claude's hooks by default)."""
    if os.environ.get("GROK_HOOK_EVENT") and "hookEventName" in event:
        return "grok"
    if "cursor_version" in event:
        return "cursor-agent"
    pid = os.getppid()
    for _ in range(4):  # (sh -c, then the agent)
        if proc_name(pid) == "devin":
            return "devin"
        pid = proc_parent(pid)
    return "claude"


def translate(event, agent):
    """Another agent's event in Claude's words, None for one we do not use."""
    other = OTHER_AGENTS[agent]
    name = other["events"].get(event.get("hook_event_name"))
    if not name:
        return None
    if agent == "muse" and (event.get("turn_id") == event.get("session_id")
                            or (event.get("post_stop") is True and name != "Notification")):
        return None  # a child session (it reuses its id as turn_id), or late news from a round already over
    event = dict(event, hook_event_name=name)
    if agent == "agy":
        call = event.get("toolCall") if isinstance(event.get("toolCall"), dict) else {}
        event.update(session_id=event.get("conversationId") or "", tool_name=call.get("name"), tool_input=call.get("args"))
    # Cursor (Antigravity): not every event has cwd; Devin's never do, its hook runs where it works
    roots = event.get("workspace_roots") or event.get("workspacePaths")
    if not event.get("cwd") and isinstance(roots, list) and roots and isinstance(roots[0], str):
        event["cwd"] = roots[0]
    elif not event.get("cwd") and agent == "devin":
        event["cwd"] = os.getcwd()
    if name == "UserPromptSubmit" and agent == "kiro-cli" and not event.get("prompt"):
        event["prompt"] = os.environ.get("USER_PROMPT", "")
    tool = event.get("tool_name")
    if tool:
        event["tool_name"] = other["tools"].get(tool, tool)
    if name == "Stop" and event.get("fullyIdle") is False:  # Antigravity: background work goes on
        return None
    if name == "Stop" and event.get("terminationReason") == "error":
        return dict(event, hook_event_name="StopFailure")
    if name == "Stop" and (event.get("reason") == "shutdown" or event.get("status") not in (None, "completed")
                           or event.get("is_interrupt") is True):
        # Grok: after SessionEnd; Cursor: "aborted" (Escape) and the like; Kimi, Devin: is_interrupt
        return None if event.get("reason") == "shutdown" else dict(event, hook_event_name="Interrupt")
    if name == "PreToolUse" and tool in ("ask_permission", "ask_question"):  # Antigravity asks the user
        event.update(hook_event_name="Notification", buddy_detail="",
                     notification_type="permission_prompt" if tool == "ask_permission" else "elicitation_dialog")
    if name == "Asks":  # Crush, Kimi, Devin
        event.update(hook_event_name="Notification", notification_type="permission_prompt",
                     buddy_detail=summarize(event.get("tool_name", ""), event.get("tool_input")))
    elif name == "Notification" and agent == "gemini":
        if event.get("notification_type") != "ToolPermission":
            return None
        details = event.get("details") if isinstance(event.get("details"), dict) else {}
        what = details.get("command") or details.get("filePath") or details.get("toolName") or details.get("title")
        event.update(notification_type="permission_prompt",
                     buddy_detail=" ".join(str(what).split())[:300] if what else "")
    return event


def handle_event(event, agent="claude"):
    name = event.get("hook_event_name", "")
    session_id = event.get("session_id", "")
    if not session_id:
        return
    now = time.time()

    if name == "SessionEnd":
        locked_update(lambda s: s.pop(session_id, None))
        return

    found = {}

    def look_up(record):
        """The window etc. for a record that lacks them (once per event)."""
        if (not record.get("window") or not record.get("pid")) and record.get("origin") != "daemon" and not found:
            found["pid"], found["window"], found["origin"], found["env"] = \
                find_agent_and_window(agent, event.get("cwd") or record.get("cwd", ""))

    # The process walk and hyprctl take milliseconds: before the lock, which
    # every other hook waits for. (os.replace: a read without it is whole.)
    try:
        with open(STATE) as f:
            look_up(json.load(f).get(session_id) or {})
    except (OSError, ValueError, AttributeError):
        look_up({})

    def update(sessions, **fields):
        record = sessions.get(session_id) or {}
        if (not record.get("window") or not record.get("pid")) and record.get("origin") != "daemon":
            look_up(record)  # (only if the record changed since)
            record.update({k: found[k] for k in ("pid", "window", "origin") if found[k]})
        # Codex's (opencode's) environment is only known where its window was looked up (served_start).
        env = found.get("env", {}) if agent in SERVERS else os.environ
        # (a daemon inherits ORCA_* when it was started in an Orca terminal)
        if env.get("ORCA_PANE_KEY") and record.get("origin") != "daemon":
            # Runs in an Orca terminal: the window is all of Orca, the pane says where.
            record.update(orca=True, orca_pane=env["ORCA_PANE_KEY"],
                          orca_terminal=env.get("ORCA_TERMINAL_HANDLE", ""),
                          orca_worktree=env.get("ORCA_WORKTREE_ID", ""))
        record["agent"] = agent
        if fields.pop("start", False) or (fields.get("state") == "working" and not record.get("since")):
            record["since"] = now
        record.update(cwd=event.get("cwd", record.get("cwd", "")), updated=now, **fields)
        sessions[session_id] = record

    if name == "SessionStart":
        fresh = event.get("source") in (None, "startup", "clear")

        def start(sessions):
            record = sessions.get(session_id)
            # After a compaction (or resume) mid-round the round goes on. Codex
            # starts a session with its first prompt: async, the prompt can
            # get here first, and that round goes on too.
            keep = record is not None and (not fresh or (agent == "codex" and record.get("since")))
            update(sessions, **({} if keep else {"state": "idle", "detail": "", "running": []}))
        locked_update(start)
    elif name == "UserPromptSubmit":
        prompt = shorten(" ".join(str(event.get("prompt", "")).split()), 120)
        # Harness messages (<task-notification> …) are not what the user asked for.
        extra = {"prompt": prompt} if prompt and not prompt.startswith("<") else {}
        locked_update(lambda s: update(s, state="working", start=True, detail="", error=False,
                                       error_text="", running=[], **extra))
    elif name in ("PreToolUse", "Invocation"):
        def begin(sessions):
            # Agents without a prompt event: the first sign of work starts the round.
            if name == "Invocation" or OTHER_AGENTS.get(agent, {}).get("no_prompt"):
                if (sessions.get(session_id) or {}).get("state") in (None, "idle", "done", "interrupted"):
                    update(sessions, state="working", start=True, detail="", error=False, error_text="", running=[])
            if name == "PreToolUse":
                tool_started(sessions, event, update)
        locked_update(begin)
    elif name in ("PostToolUse", "PostToolUseFailure"):
        locked_update(lambda s: tool_ended(s, event, update))
    elif name in ("Stop", "StopFailure"):
        error = name == "StopFailure"
        text = error_text(event.get("error")) if error else ""
        newer = []

        def stop(sessions):
            # Async: the next prompt's UserPromptSubmit may have got here first.
            if float((sessions.get(session_id) or {}).get("since") or 0) > now:
                newer.append(True)
            else:
                update(sessions, state="done", detail="", error=error, error_text=text, running=[])
        locked_update(stop)
        if not newer:
            report_done(session_id, text if error else "")
    elif name == "Interrupt":  # Codex: the user pressed Escape; the next prompt goes on
        locked_update(lambda s: update(s, state="interrupted", detail="", running=[]))
    elif name == "Answered":  # Crush: the user answered in the terminal
        def answered(sessions):
            if (sessions.get(session_id) or {}).get("state") == "needs":
                update(sessions, state="working", detail="")
        locked_update(answered)
    elif name == "PermissionDenied":
        report_denied(event)
    elif name == "Notification":
        kind = event.get("notification_type", "")
        message = event.get("message", "")
        if kind == "idle_prompt":
            locked_update(lambda s: update(s, state="done", detail=""))
        elif kind in ("permission_prompt", "elicitation_dialog", "agent_needs_input"):
            def ask(sessions):
                # A hook already listed what is asked; the notification only
                # says that someone asks, so it does not replace that text.
                record = sessions.get(session_id) or {}
                keep = record.get("state") == "needs" and record.get("detail")
                # (Grok says only that it asks: the tool it was about to run says what)
                running = record.get("running") or [{}]
                detail = event.get("buddy_detail") or (agent not in ("claude", "codex") and running[-1].get("detail")) \
                    or notification_detail(kind, message)
                update(sessions, state="needs", **({} if keep else {"tool": "", "detail": detail}))
            locked_update(ask)
    elif name == "PermissionRequest":
        handle_permission(event, update)


def notification_detail(kind, message):
    """What a Notification says, in a few words of the user's language.
    Claude's message is English ("Claude needs your permission to use
    Bash"); the tool name in it is all that is worth keeping."""
    if kind == "permission_prompt":
        m = re.search(r"permission to use (\S+)", message or "")
        return t("notify.permission", tool=m.group(1)) if m else t("notify.permissionAny")
    if kind == "elicitation_dialog":
        return t("notify.elicitation")
    return t("notify.input")


def tool_started(sessions, event, update):
    """PreToolUse: the tool goes on the list of running ones (the island's
    ticker). The two that ask the user show up as requests instead."""
    tool = event.get("tool_name", "")
    tool_id = str(event.get("tool_use_id") or "")
    record = sessions.get(event["session_id"]) or {}
    if tool in ("AskUserQuestion", "ExitPlanMode") or (tool_id and tool_id in (record.get("ended") or [])):
        return
    entry = {"id": tool_id, "tool": tool, "detail": summarize(tool, event.get("tool_input")),
             "at": time.time(), "agent": event.get("agent_type") or ("Subagent" if event.get("agent_id") else "")}
    timeout = tool_timeout(event.get("tool_input"))
    if timeout:
        entry["timeout"] = timeout
    running = [r for r in record.get("running") or [] if r.get("id") != tool_id] + [entry]
    update(sessions, running=running[-RUNNING_MAX:])


def tool_timeout(tool_input):
    """A tool's own timeout in seconds (Bash up to 10 min), 0 if none: the
    island waits that long before it takes a quiet session as interrupted."""
    value = tool_input.get("timeout") if isinstance(tool_input, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return 0
    return min(round(value / 1000), 3600)


def tool_ended(sessions, event, update):
    """PostToolUse(Failure): off the list. Async hooks can overtake each
    other; an id that ends before it started is remembered for a while so
    the late PreToolUse does not put it back, and one that ends after Stop
    leaves the session finished."""
    tool_id = str(event.get("tool_use_id") or "")
    record = sessions.get(event["session_id"]) or {}
    running = record.get("running") or []
    fields = {"running": [r for r in running if r.get("id") != tool_id]}
    if tool_id and not any(r.get("id") == tool_id for r in running):
        fields["ended"] = ((record.get("ended") or []) + [tool_id])[-20:]
    if record.get("state") in ("done", "idle", "interrupted"):
        update(sessions, **fields)
    else:
        update(sessions, state="working", detail="", **fields)


def handle_permission(event, update):
    session_id = event["session_id"]
    tool = event.get("tool_name", "")
    tool_input = event.get("tool_input")
    kind = request_kind(tool)
    questions = clean_questions(tool_input) if kind == "question" else []
    plan = plan_text(tool_input) if kind == "plan" else ""
    if kind == "question" and not questions:
        kind = "permission"
    detail = (questions[0]["question"] if questions else plan_title(plan) if kind == "plan"
              else summarize(tool, tool_input))
    if not island_alive():
        locked_update(lambda sessions: update(sessions, state="needs", tool=tool, detail=detail))
        return
    suggestions = event.get("permission_suggestions")
    suggestions = [x for x in suggestions if isinstance(x, dict)] if isinstance(suggestions, list) else []
    request_id = f"{os.getpid()}-{time.time_ns()}"
    wait = WAIT_SECONDS if kind == "permission" else WAIT_READ_SECONDS
    full = plan if kind == "plan" else full_text(tool_input)
    request = {"id": request_id, "pid": os.getpid(), "kind": kind, "tool": tool, "detail": detail,
               "full": full,
               "always": describe_suggestions(suggestions) if kind == "permission" else "",
               "agent": event.get("agent_type") or ("Subagent" if event.get("agent_id") else ""),
               "until": time.time() + wait, "wait": wait}
    if questions:
        request["questions"] = questions
    description = describe(tool_input, detail) if kind == "permission" else ""
    if description:
        request["description"] = description
    edits, cut = file_edits(tool, tool_input, str(event.get("cwd") or "")) if kind == "permission" else (None, False)
    if edits is not None:
        request["edits"] = edits
        if cut:
            request["edits_cut"] = True
    if len(full) > (PLAN_MAX if kind == "plan" else FULL_MAX):
        request["truncated"] = True  # the island says the rest is in the terminal

    # "needs" and the request in one write: in between, the island would
    # show "answer in the terminal" for a moment.
    def ask(sessions):
        update(sessions, state="needs", tool=tool, detail=detail)
        record = sessions[session_id]
        record["requests"] = [r for r in record.get("requests") or [] if r.get("id") != request_id] + [request]

    result = None
    # Claude ends a hook it no longer needs (Escape, its timeout) with a
    # signal; the finally below then still takes the request off the list.
    for sig in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(sig, lambda *_: sys.exit(0))
    try:
        locked_update(ask)
        decision = wait_for_decision(request_id, wait)
        result = decision_result(kind, decision, tool_input, suggestions)
    finally:
        def remove(sessions):
            record = sessions.get(session_id)
            if record is None:
                return
            record["requests"] = [r for r in record.get("requests") or [] if r.get("id") != request_id]
            if not record["requests"]:
                del record["requests"]
                if result:
                    record.update(state="working", detail="")
            # Without a decision the terminal asks from now on; the island
            # counts its quiet time from here.
            record["updated"] = time.time()
        locked_update(remove)
        try:
            os.remove(os.path.join(DECIDE_DIR, request_id))
        except OSError:
            pass

    if result:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": result}}))


# StopFailure's "error": what went wrong (texts "error.…"), and what the
# user can do about it ("hint.…", none for a full limit: the hook says
# when it is free again).
def error_text(kind):
    kind = str(kind or "")
    return t("error." + kind) if kind in ERRORS else t("error.other")


def error_hint(text):
    for kind in ERRORS:
        if t("error." + kind) == text:
            return "" if kind == "rate_limit" else t("hint." + kind)
    return ""


def limit_free_at():
    """When a full rate limit window of this session's account resets, from
    the status line's usage.json."""
    try:
        with open(os.path.join(DIR, "usage.json")) as f:
            limits = buddy.account_limits(json.load(f), buddy.claude_account())
    except (OSError, ValueError):
        return ""
    full = [w for w in limits.values() if isinstance(w, dict) and float(w.get("used") or 0) >= 99
            and float(w.get("resets") or 0) > time.time()]
    if not full:
        return ""
    return clock(max(float(w["resets"]) for w in full))


def report_denied(event):
    """The auto mode refused an action: into the history, no pop-up."""
    name = os.path.basename(str(event.get("cwd", "")).rstrip("/")) or "Claude"
    tool = event.get("tool_name", "")
    detail = summarize(tool, event.get("tool_input"))
    reason = " ".join(str(event.get("reason") or "").split())[:200]
    if buddy.history_mode() == "noText":  # "Verlauf: ohne Text" keeps no command
        detail = reason = ""
    body = (f"{tool}: {detail}" if detail else tool) + (f" – {reason}" if reason else "")
    private = ["--private"] if detail or reason else []
    import subprocess
    subprocess.run([buddy.SAY, "--source", "claude", "--level", "warn", "--quiet", *private,
                    t("blocked", name=name), body], timeout=5)


def report_done(session_id, error):
    """Hand a finished run to the island: a normal end only as a pop-up (#173,
    the agent's card says "fertig"), an error into the news (history +
    unread dot). The island itself decides whether a pop-up is worth it.
    error: the short text of an API error, empty for a normal end."""
    try:
        with open(STATE) as f:
            record = json.load(f).get(session_id, {})
    except (OSError, ValueError):
        return
    since = record.get("since") or 0
    worked = time.time() - since if since else 0
    if not error and worked < DONE_MIN_SECONDS:
        return
    agent = record.get("agent") if record.get("agent") in AGENT_NAMES else "claude"
    name = os.path.basename(str(record.get("cwd", "")).rstrip("/")) or AGENT_NAMES[agent]
    prompt = record.get("prompt", "") if buddy.history_mode() != "noText" else ""  # "Verlauf: ohne Text"
    minutes = round(worked / 60)
    took = t("done.after", minutes=minutes) if minutes >= 1 else ""
    args = [buddy.SAY, "--source", agent, "--level", "error" if error else "good",
            "--key", f"done-{session_id}-{int(since)}"] + ([] if error else ["--popup-only"])
    if record.get("window"):
        args += ["--window", record["window"]]
    if record.get("orca"):
        args += ["--orca", "--orca-terminal", record.get("orca_terminal", ""),
                 "--orca-pane", record.get("orca_pane", "")]
        # Only the hook can ask Orca which pane is showing; the island cannot.
        if session_in_view(record):
            args.append("--watched")
    quoted = t("quote", text=prompt) if prompt else ""
    if quoted:
        args.append("--private")
    title = f"{name}: {error}" if error else t("done.title", name=name, took=took)
    body = quoted or t("done.waiting", agent=AGENT_NAMES[agent])
    if error:
        free = limit_free_at() if error == t("error.rate_limit") else ""
        hint = t("free.at", time=free) if free else error_hint(error)
        body = " ".join(x for x in (hint, quoted) if x) or body
    import subprocess
    subprocess.run(args + [title, body], timeout=5)


# Programs whose runs their own hooks report already (#168): a terminal
# command that starts one of them is not reported again when it ends.
AGENT_COMMANDS = set(AGENT_NAMES) | {o["proc"] for o in OTHER_AGENTS.values() if o.get("proc")}
COMMAND_PREFIXES = ("sudo", "env", "exec", "command", "nohup", "time", "nice")


def command_program(command):
    """The program a command line starts: its first word without a path,
    after VAR=value and sudo, env, exec … in front."""
    for word in str(command or "").split():
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", word) and word not in COMMAND_PREFIXES and not word.startswith("-"):
            return os.path.basename(word)
    return ""


def report_command(status, seconds, shell_pid, command):
    """A terminal command that ran a minute or longer ended (lib/long-commands.sh,
    "longCommands" in config.json): into the news, if its terminal is not in front.
    A click brings that terminal up. Terminals without a window of their own
    (tmux, ssh on the far side) are left out: nobody can say if they are in front."""
    if buddy.config().get("longCommands") is not True or command_program(command) in AGENT_COMMANDS:
        return
    windows = {c.get("pid"): c.get("address") for c in hypr_json("clients") or []}
    pid = int(shell_pid)
    while pid > 1 and pid not in windows:
        pid = proc_parent(pid)
    window = windows.get(pid, "")
    if not window or window_focused(window):
        return
    command = shorten(" ".join(command.split()), 200) if buddy.history_mode() != "noText" else ""
    ok = status == "0"
    quoted, exit_code = t("quote", text=command) if command else "", "" if ok else t("command.exit", status=status)
    body = t("command.body", command=quoted, exit=exit_code) if quoted and exit_code else quoted or exit_code
    buddy.say(t("command.title" if ok else "command.failed", minutes=max(1, round(int(seconds) / 60))), body,
              source="terminal", level="good" if ok else "error", window=window, private=bool(command))


def alive(pid):
    return bool(pid) and os.path.exists(f"/proc/{pid}")


def prune():
    """Drop sessions whose claude is gone, and requests whose hook died
    without cleaning up (killed hard) or overran its deadline. A session
    without a hook event for 12 hours goes too: its claude could not be
    found (no pid) or the pid was taken over by another process."""
    now = time.time()

    def drop_dead(sessions):
        for sid in list(sessions):
            record = sessions[sid]
            try:
                dead = record.get("pid") and not alive(record["pid"])
                if dead or now - float(record.get("updated") or 0) > STALE_AFTER:
                    del sessions[sid]
                    continue
                requests = [r for r in record.get("requests") or []
                            if alive(r.get("pid")) and float(r.get("until") or 0) > now - 5]
            except (TypeError, ValueError, AttributeError):  # written by someone else: drop it
                del sessions[sid]
                continue
            if requests:
                record["requests"] = requests
            else:
                record.pop("requests", None)
            record.pop("decidable", None)  # written by older versions
    locked_update(drop_dead)
    # Decisions nobody picked up (the hook had already given up).
    try:
        for name in os.listdir(DECIDE_DIR):
            path = os.path.join(DECIDE_DIR, name)
            if now - os.path.getmtime(path) > 120:
                os.remove(path)
    except OSError:
        pass


def end_session(session_id):
    """The user ends a forgotten session from the island: SIGTERM to its claude
    or codex (only if that pid still is one), then drop what is gone."""
    try:
        with open(STATE) as f:
            record = json.load(f).get(session_id) or {}
        pid = int(record.get("pid") or 0)
    except (OSError, ValueError, TypeError, AttributeError):
        return
    if pid <= 1 or not is_agent(pid, record.get("agent") if record.get("agent") in AGENT_NAMES else "claude"):
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return
    for _ in range(50):
        if not alive(pid):
            break
        time.sleep(0.1)
    prune()


def orca_goto(terminal, pane):
    """Show the pane in Orca. The handle can be stale after an Orca restart;
    then look the pane up again. Without either, at least bring Orca up."""
    if terminal and orca_json("terminal", "switch", "--terminal", terminal) is not None:
        return
    tab_id, _, leaf_id = pane.partition(":")
    listing = orca_json("terminal", "list") or {}
    for t in listing.get("terminals") or []:
        if tab_id and t.get("tabId") == tab_id and t.get("leafId") == leaf_id:
            if orca_json("terminal", "switch", "--terminal", t.get("handle", "")) is not None:
                return
    orca_json("open")


def write_decision(request_id, decision):
    if not REQUEST_ID.match(request_id):
        return
    private_dir(DECIDE_DIR)
    tmp = os.path.join(DECIDE_DIR, "." + request_id)
    with private_open(tmp) as f:
        json.dump(decision, f, ensure_ascii=False)
    os.replace(tmp, os.path.join(DECIDE_DIR, request_id))


def decide(session_id, request_id, decision):
    """Answer exactly the request the user saw; it must still be one of the
    session's open requests. "focus" (request "*") ends all waits of the
    session, so its terminal shows the prompts. decision: {"decision": …}
    or {"answers": …}."""
    try:
        with open(STATE) as f:
            record = json.load(f).get(session_id) or {}
    except (OSError, ValueError):
        return
    if request_id == "*" and decision != {"decision": "focus"}:
        return
    for request in record.get("requests") or []:
        if request_id in ("*", request.get("id")):
            write_decision(str(request.get("id")), decision)


def main():
    args = sys.argv[1:]
    if args[:1] == ["--prune"]:
        prune()
    elif args[:1] == ["--decide"] and len(args) == 4 and args[3] in ("allow", "always", "deny", "auto"):
        decide(args[1], args[2], {"decision": args[3]})
    elif args[:1] == ["--decide"] and len(args) == 5 and args[3] == "revise":
        decide(args[1], args[2], {"decision": "revise", "text": args[4][:4000]})
    elif args[:1] == ["--decide"] and len(args) == 3 and args[2] == "focus":
        decide(args[1], "*", {"decision": "focus"})
    elif args[:1] == ["--answer"] and len(args) == 4:
        answers = json.loads(args[3])
        if isinstance(answers, dict):
            decide(args[1], args[2], {"answers": answers})
    elif args[:1] == ["--end"] and len(args) == 2:
        end_session(args[1])
    elif args[:1] == ["--orca-goto"] and len(args) == 3:
        orca_goto(args[1], args[2])
    elif args[:1] == ["--command"] and len(args) == 5:
        report_command(*args[1:])
    elif args and args != ["--codex"] and not (args[:1] == ["--agent"] and len(args) in (2, 3) and args[1] in OTHER_AGENTS):
        # A call from the island that does not fit (an empty request id
        # can get lost on the way) must not wait for stdin forever.
        print(f"omarchy-buddy-hook: unknown call {args}", file=sys.stderr)
    else:
        if args[:2] == ["--agent", "agy"]:  # Antigravity reads an answer, whatever comes after
            print(AGY_REPLY.get(args[2] if len(args) == 3 else "", "{}"), flush=True)
        try:
            event = json.load(sys.stdin)
        except ValueError:
            return
        agent = args[1] if args[:1] == ["--agent"] else caller(event) if not args and isinstance(event, dict) else ""
        if agent == "devin" and not args:
            return  # Devin running Claude's hooks: its own (--agent devin) report it
        if (agent or ("codex" if args else "claude")) != "claude" and buddy.agent_off(agent or "codex"):
            return  # switched off (#158): Grok and Cursor still run Claude's hooks, a file the setup left
        if len(args) == 3 and isinstance(event, dict):
            event.setdefault("hook_event_name", args[2])  # Antigravity's events carry no name
        if agent in OTHER_AGENTS:
            event = translate(event, agent) if isinstance(event, dict) else None
            if not event:
                return
            # (OMARCHY_BUDDY_HOOK_WAIT: tests/golden-test.py reads the files right after)
            if OTHER_AGENTS[agent].get("sync") and not os.environ.get("OMARCHY_BUDDY_HOOK_WAIT"):
                background()
            if OTHER_AGENTS[agent].get("cleared_env"):
                agent_env(agent)
            handle_event(event, agent)
            return
        handle_event(event, "codex" if args else "claude")


def agent_env(agent):
    """The agent's own environment under ours, for an agent that clears it
    for its hooks (Muse): without it hyprctl finds no Hyprland (no window)
    and the Orca pane stays unknown."""
    pid = PARENT
    while pid > 1 and not is_agent(pid, agent):
        pid = proc_parent(pid)
    for key, value in (proc_env(pid) if pid > 1 else {}).items():
        os.environ.setdefault(key, value)


def background():
    """Go on in a child the agent does not wait for (stdout closed), so the
    agent goes on at once."""
    sys.stdout.flush()
    if os.fork():
        os._exit(0)
    os.setsid()
    null = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(null, fd)


def run():
    try:
        main()
    except Exception as e:  # a broken widget must never break Claude
        print(f"omarchy-buddy-hook: {e}", file=sys.stderr)
    sys.exit(0)
