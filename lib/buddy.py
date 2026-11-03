#!/usr/bin/env python3
# What the scripts in bin/ share: where Omarchy-Buddy keeps its files and
# private files (the state holds commands, questions and messages: only the
# user may read it).
#
#   python3 lib/buddy.py news MODE  move news.json where "Verlauf speichern"
#                                   (full, noText, off) wants it (the island
#                                   runs this when the setting changes)

import fcntl
import json
import os
import sys
import time

HOME = os.path.expanduser("~")
STATE_HOME = os.environ.get("XDG_STATE_HOME") or os.path.join(HOME, ".local/state")
CONFIG_HOME = os.environ.get("XDG_CONFIG_HOME") or os.path.join(HOME, ".config")
RUNTIME = os.environ.get("XDG_RUNTIME_DIR") or f"/run/user/{os.getuid()}"

STATE_DIR = os.path.join(STATE_HOME, "omarchy-buddy")
RUN_DIR = os.path.join(RUNTIME, "omarchy-buddy")
CONFIG_DIR = os.path.join(CONFIG_HOME, "omarchy-buddy")
CONFIG = os.path.join(CONFIG_DIR, "config.json")

NEWS = os.path.join(STATE_DIR, "news.json")
NEWS_RAM = os.path.join(RUN_DIR, "news.json")  # "Verlauf: gar nicht": only in memory (tmpfs)
NEWS_KEEP = 100
POPUP_ONLY_SECONDS = 60  # say --popup-only: long enough for the island to read it
TEST_KEY = "buddy-test-"  # tests/gallery's items; they do not count against NEWS_KEEP
SAY = os.path.join(os.path.dirname(os.path.dirname(os.path.realpath(__file__))), "bin", "omarchy-buddy-say")


def claude_account():
    """The Claude account this process runs as: "" for the main one
    (~/.claude), else its home. Omarchy 4.5 gives each further subscription
    its own CLAUDE_CONFIG_DIR (omarchy agent account)."""
    home = os.environ.get("CLAUDE_CONFIG_DIR") or ""
    home = os.path.normpath(os.path.expanduser(home)) if home else ""
    return "" if home in ("", os.path.join(HOME, ".claude")) else home


def account_limits(usage, account):
    """The rate limits usage.json holds for this account (omarchy-buddy-statusline)."""
    if not isinstance(usage, dict):
        return {}
    if account:
        usage = (usage.get("accounts") or {}).get(account)
    limits = usage.get("limits") if isinstance(usage, dict) else None
    return limits if isinstance(limits, dict) else {}


def private_dir(path):
    os.makedirs(path, mode=0o700, exist_ok=True)
    os.chmod(path, 0o700)


def private_open(path):
    """open(path, "w"), readable by the user only (an existing file too)."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    return os.fdopen(fd, "w")


def config():
    """config.json as a dict; {} when it is missing, broken or no object."""
    try:
        with open(CONFIG) as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def agent_off(agent):
    """agents.NAME false in config.json (the island's switch, #158): the setup
    leaves its hooks out, the hook drops what still comes from it."""
    agents = config().get("agents")
    return isinstance(agents, dict) and agents.get(agent) is False


def history_mode():
    """ "Verlauf speichern" from config.json (NoteLogic.historyModes)."""
    mode = config().get("history")
    return mode if mode in ("full", "noText", "off") else "full"


def read_news(path):
    try:
        with open(path) as f:
            items = json.load(f)
        return [i for i in items if isinstance(i, dict)] if isinstance(items, list) else []
    except (OSError, ValueError):
        return []


def save_json(path, data, **dump):
    """data as JSON into path, at once (path.tmp, then replaced), the user's alone."""
    private_dir(os.path.dirname(path))
    tmp = path + ".tmp"
    with private_open(tmp) as f:
        json.dump(data, f, **dump)
    os.replace(tmp, path)


def news_lock():
    private_dir(STATE_DIR)
    return private_open(os.path.join(STATE_DIR, "lock"))


def popup_only(item):
    """An item meant only for a pop-up (say --popup-only). Finished agent runs
    written before #173 carry no flag: done-… keys at level good."""
    return bool(item.get("popup_only")) or (str(item.get("key", "")).startswith("done-") and item.get("level") == "good")


def place_news(mode, add=None):
    """Under the lock: the news from both places (disk and memory) into the
    one the mode wants, the other emptied; "noText" drops the private text
    (prompt, command) of older items. add: one more item. Times are unique,
    so an item in both places counts once. Pop-up-only items go after a minute."""
    old = time.time() - POPUP_ONLY_SECONDS
    items = {i.get("time", 0): i for i in read_news(NEWS) + read_news(NEWS_RAM)
             if not (popup_only(i) and float(i.get("time") or 0) < old)}
    if add:
        items[add["time"]] = add
    items = sorted(items.values(), key=lambda i: i.get("time", 0))
    test = [i for i in items if str(i.get("key", "")).startswith(TEST_KEY)]
    items = sorted([i for i in items if i not in test][-NEWS_KEEP:] + test, key=lambda i: i.get("time", 0))
    if mode == "noText":
        for i in items:
            if i.pop("private", False):
                i["body"] = ""
    if mode == "off":
        save_json(NEWS_RAM, items, ensure_ascii=False)
        if os.path.exists(NEWS):
            save_json(NEWS, [], ensure_ascii=False)
    else:
        save_json(NEWS, items, ensure_ascii=False)
        if os.path.exists(NEWS_RAM):
            os.remove(NEWS_RAM)


def say(title, body="", source="buddy", level="info", url="", key="", window="", orca=False,
        orca_terminal="", orca_pane="", watched=False, quiet=False, private=False, action="",
        popup_only=False):
    """A news item into news.json (see bin/omarchy-buddy-say). False if one
    with the same key is listed already. private: the body holds the user's
    text (prompt, command), which "Verlauf: ohne Text" drops. action: what a
    click does inside the island ("updates": bin/omarchy-buddy-update)."""
    mode = history_mode()
    with news_lock() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        items = read_news(NEWS) + read_news(NEWS_RAM)
        if key and any(i.get("key") == key for i in items):
            return False
        now = time.time()
        # Keep times unique so the island can tell items apart by time.
        if items and max(i.get("time", 0) for i in items) >= now:
            now = max(i.get("time", 0) for i in items) + 0.001
        item = {"time": now, "source": source, "level": level, "title": title, "body": body}
        # Only the fields that are set, flags as true.
        optional = {"url": url, "key": key, "window": window, "orca": bool(orca), "orca_terminal": orca_terminal,
                    "orca_pane": orca_pane, "watched": bool(watched), "quiet": bool(quiet), "private": bool(private),
                    "action": action, "popup_only": bool(popup_only)}
        item.update({k: v for k, v in optional.items() if v})
        place_news(mode, item)
    return True


def unsay(key):
    """Takes the items with this key out of the news again (a state that is
    over, like pending updates)."""
    with news_lock() as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        for path in (NEWS, NEWS_RAM):
            items = read_news(path)
            kept = [i for i in items if i.get("key") != key]
            if len(kept) != len(items):
                save_json(path, kept, ensure_ascii=False)


if __name__ == "__main__":
    if sys.argv[1:2] == ["news"] and sys.argv[2:] in (["full"], ["noText"], ["off"]):
        with news_lock() as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            place_news(sys.argv[2])
    else:
        print("usage: buddy.py news full|noText|off", file=sys.stderr)
