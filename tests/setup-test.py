#!/usr/bin/env python3
# omarchy-buddy-setup in a sandbox HOME (nothing real is touched, no
# systemctl, no shell restart): set up and take back out must leave
# settings.json and shell.json as they were, also without a shell.json of
# one's own. Aufruf: tests/setup-test.py
import re
import json, os, shlex, shutil, subprocess, sys, tempfile, tomllib
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from testing import check, done, sandbox_env  # noqa: E402

SETUP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "omarchy-buddy-setup")
REAL_OMARCHY = os.environ.get("OMARCHY_PATH") or "/usr/share/omarchy"
FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "omarchy-shell")
ID = "io.github.destrukt1v.omarchy-buddy"


def fake_omarchy(layout):
    """Omarchy with a frozen default shell.json (tests/fixtures/omarchy-shell:
    old.json the bar before Omarchy split its centre, reconstructed from the
    tests of that time; new.json the split one of 07.11.2026), the rest real."""
    root = tempfile.mkdtemp(prefix="omarchy-buddy-omarchy-")
    os.makedirs(os.path.join(root, "config/omarchy"))
    shutil.copy(os.path.join(FIXTURES, layout + ".json"), os.path.join(root, "config/omarchy/shell.json"))
    os.symlink(os.path.join(REAL_OMARCHY, "shell"), os.path.join(root, "shell"))
    return root


OMARCHY = fake_omarchy("old")


def sandbox(settings=None, shell=None):
    home = tempfile.mkdtemp(prefix="omarchy-buddy-setup-")
    env = sandbox_env(home, OMARCHY_PATH=OMARCHY)
    if settings is not None:
        write(os.path.join(home, ".claude/settings.json"), settings)
    if shell is not None:
        write(os.path.join(home, ".config/omarchy/shell.json"), shell)
    return home, env


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)


def read(path):
    with open(path) as f:
        return json.load(f)


def in_bar(shell):
    return any(e.get("id") == ID for s in shell["bar"]["layout"].values() for e in s)


def setup(env, *args):
    return subprocess.run([SETUP, "--files-only", *args], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True)


def guarded(path, fallback=""):
    q = shlex.quote(path)
    return f"if [ -x {q} ]; then exec {q}; else exec sh -c {shlex.quote(fallback)}; fi" if fallback \
        else f"if [ -x {q} ]; then exec {q}; fi"


with open(os.path.join(OMARCHY, "config/omarchy/shell.json")) as f:
    DEFAULT_SHELL = json.load(f)
SETTINGS = {"model": "opus", "statusLine": {"type": "command", "command": "my-statusline"},
            "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "other-hook"}]}]}}

# 1. A new user: Omarchy's default shell.json, a status line, another hook.
home, env = sandbox(SETTINGS, DEFAULT_SHELL)
r = setup(env)
check("Einrichten läuft", r.returncode == 0)
s = read(os.path.join(home, ".claude/settings.json"))
hook = os.path.join(home, ".local/bin/omarchy-buddy-hook")
check("Hook für jedes Ereignis", all(any(h["command"] == guarded(hook) for g in s["hooks"][e] for h in g["hooks"])
                                     for e in ("SessionStart", "PermissionRequest", "Stop")))
check("fremder Hook bleibt", any(h["command"] == "other-hook" for g in s["hooks"]["Stop"] for h in g["hooks"]))
check("Statuszeile davor", s["statusLine"]["command"] == guarded(os.path.join(home, ".local/bin/omarchy-buddy-statusline"),
                                                                  "my-statusline"))
check("PermissionRequest wartet länger als die 300 s der Insel",
      s["hooks"]["PermissionRequest"][0]["hooks"][0]["timeout"] == 310)
check("alte Statuszeile gemerkt",
      read(os.path.join(home, ".local/state/omarchy-buddy/statusline.json"))["command"] == "my-statusline")
sh = read(os.path.join(home, ".config/omarchy/shell.json"))
check("Omarchys Benachrichtigungen aus", "omarchy.notifications" in sh["disabledPlugins"])
center = [e["id"] for e in sh["bar"]["layout"]["center"]]
check("Plugin an: Widget gleich rechts neben der Uhr, nicht mehr in plugins[]",
      center[center.index("omarchy.clock") + 1] == ID and center.count(ID) == 1
      and {"id": ID} not in sh["plugins"])
ind = [e for e in sh["bar"]["layout"]["center"] if e["id"] == "omarchy.indicators"][0]
check("Dnd aus der Leiste, Rest wie Omarchy", "Dnd" not in ind["items"] and "NightLight" in ind["items"])
check("Sicherungen", any(".bak-omarchy-buddy-" in n for n in os.listdir(os.path.join(home, ".claude"))))
check("Skripte verlinkt", os.path.realpath(hook) == os.path.realpath(SETUP).replace("buddy-setup", "buddy-hook"))
check("Timer-Units verlinkt", os.path.islink(os.path.join(home, ".config/systemd/user/omarchy-buddy-feed.timer")))
check("Akku-Hook in Omarchys battery-low.d", os.path.realpath(os.path.join(home, ".config/omarchy/hooks/battery-low.d/omarchy-buddy"))
      == os.path.join(os.path.dirname(os.path.realpath(SETUP)), "..", "hooks", "battery-low").replace("/bin/..", ""))
battery = os.path.join(home, ".config/omarchy/hooks/battery-low.d/omarchy-buddy")
subprocess.run(["bash", battery, "kaputt"], env=env)  # omarchy-hook runs each file with bash
subprocess.run(["bash", battery, "9"], env=env)
news = read(os.path.join(home, ".local/state/omarchy-buddy/news.json"))
check("Akku-Hook: Warnung mit Prozent, nur in den Verlauf (Omarchy zeigt sein Pop-up selbst)",
      [(n["title"], n["body"], n["level"], n["source"], n.get("quiet")) for n in news]
      == [("Akku nur noch bei 9 %", "Schließ das Ladekabel an.", "warn", "system", True)])
r = setup(env)
check("zweimal: nichts zu ändern", "schon" in r.stdout and "nichts zu ändern" in r.stdout)
r = setup(env, "--remove")
check("Entfernen läuft", r.returncode == 0)
check("settings.json wie vorher", read(os.path.join(home, ".claude/settings.json")) == SETTINGS)
check("shell.json wie vorher", read(os.path.join(home, ".config/omarchy/shell.json")) == DEFAULT_SHELL)
check("Verknüpfungen weg", not os.path.lexists(hook)
      and not os.path.lexists(os.path.join(home, ".config/systemd/user/omarchy-buddy-feed.timer"))
      and not os.path.lexists(os.path.join(home, ".config/omarchy/hooks/battery-low.d/omarchy-buddy")))
shutil.rmtree(home)

# 1b. #182: the plugin as a service in plugins[] (before) moves into the bar
#     beside the clock; where the user moved the widget, it stays; a
#     shell.json without a layout gets Omarchy's.
before = json.loads(json.dumps(DEFAULT_SHELL))
before["plugins"] = [{"id": "someone.dock"}, {"id": ID}]
before["bar"]["layout"]["center"].insert(0, {"id": "omarchy.clock", "format": "HH:mm"})
del before["bar"]["layout"]["center"][2]
home, env = sandbox(SETTINGS, before)
setup(env)
sh = read(os.path.join(home, ".config/omarchy/shell.json"))
check("vorher in plugins[]: in die Leiste neben die Uhr, fremde Plugins bleiben",
      [e["id"] for e in sh["bar"]["layout"]["center"]][:2] == ["omarchy.clock", ID]
      and sh["plugins"] == [{"id": "someone.dock"}])
sh["bar"]["layout"]["center"] = [e for e in sh["bar"]["layout"]["center"] if e["id"] != ID]
sh["bar"]["layout"]["right"].append({"id": ID, "x": 1})
write(os.path.join(home, ".config/omarchy/shell.json"), sh)
setup(env)
sh2 = read(os.path.join(home, ".config/omarchy/shell.json"))
check("vom Nutzer verschoben: bleibt, wo es ist", sh2["bar"] == sh["bar"])
setup(env, "--remove")
sh = read(os.path.join(home, ".config/omarchy/shell.json"))
check("Entfernen: aus der Leiste", not in_bar(sh) and sh["plugins"] == [{"id": "someone.dock"}])
shutil.rmtree(home)
home, env = sandbox(SETTINGS, {"version": 1, "plugins": []})
setup(env)
sh = read(os.path.join(home, ".config/omarchy/shell.json"))
check("ohne Layout: Omarchys Leiste mit dem Widget neben der Uhr",
      [e["id"] for e in sh["bar"]["layout"]["center"]] == ["omarchy.indicators", "omarchy.clock", ID,
                                                           "omarchy.keyboard-layout", "omarchy.weather", "omarchy.system-update"])
setup(env, "--remove")
check("ohne Layout: Entfernen nimmt Omarchys Layout wieder heraus",
      read(os.path.join(home, ".config/omarchy/shell.json")) == {"version": 1, "plugins": []})
shutil.rmtree(home)

# 1c. #209: the id before 1.2.0 ("omarchy-buddy") becomes the new one in
#     shell.json and the setup's record; the bar entry keeps its place and
#     settings, and where the bar has both, the old place wins.
home, env = sandbox(SETTINGS, DEFAULT_SHELL)
setup(env)
shell_path = os.path.join(home, ".config/omarchy/shell.json")
record_path = os.path.join(home, ".local/state/omarchy-buddy/setup.json")
sh = read(shell_path)
center = sh["bar"]["layout"]["center"]
sh["bar"]["layout"]["right"][1:1] = [{"id": ID, "x": 1}, {"id": "omarchy.weather"}]
center[:] = [e for e in center if e["id"] not in (ID, "omarchy.weather")]
sh["plugins"] = [{"id": "someone.dock"}]
sh["disabledPlugins"].append(ID)
write(shell_path, sh)
write(os.path.join(home, ".config/omarchy-buddy/config.json"), {"weather": True})
setup(env)  # the record keeps the weather's place: right after O-Morchy
want = read(shell_path)
old = lambda path: write(path, json.loads(json.dumps(read(path)).replace(f'"{ID}"', '"omarchy-buddy"')))
old(shell_path)
old(record_path)
check("Probe: alte ID in shell.json und im Merkzettel", '"omarchy-buddy"' in open(shell_path).read()
      and read(record_path)["weather"]["after"] == "omarchy-buddy")
r = setup(env)
check("alte ID: Widget an seiner Stelle mit seinen Einstellungen, alte ID nirgends mehr",
      r.returncode == 0 and read(shell_path) == want and read(record_path)["weather"]["after"] == ID)
old(shell_path)
sh = read(shell_path)
sh["bar"]["layout"]["center"].append({"id": ID})
sh["plugins"].append({"id": ID})
write(shell_path, sh)
setup(env)
check("alte und neue ID: einmal, an der alten Stelle", read(shell_path) == want)
old(shell_path)
old(record_path)
setup(env, "--remove")
sh = read(shell_path)
check("alte ID: Entfernen nimmt sie heraus, Wetter zurück",
      not in_bar(sh) and '"omarchy-buddy"' not in json.dumps(sh)
      and [e["id"] for e in sh["bar"]["layout"]["right"]][:2] == ["omarchy.tray", "omarchy.weather"])
shutil.rmtree(home)

# 2. Backups: the newest 3 per file stay, other files' and foreign ones are left.
home, env = sandbox(SETTINGS, DEFAULT_SHELL)
claude = os.path.join(home, ".claude")
for n in ("20200101-000001", "20200101-000002", "20200101-000003", "20200101-000004"):
    write(os.path.join(claude, f"settings.json.bak-omarchy-buddy-{n}"), {})
write(os.path.join(claude, "settings.json.bak-eigene"), {})
setup(env)
backups = sorted(n for n in os.listdir(claude) if n.startswith("settings.json.bak-omarchy-buddy-"))
check("Sicherungen: die 3 neuesten bleiben", len(backups) == 3 and backups[:2] == [
      "settings.json.bak-omarchy-buddy-20200101-000003", "settings.json.bak-omarchy-buddy-20200101-000004"]
      and os.path.exists(os.path.join(claude, "settings.json.bak-eigene"))
      and any(".bak-omarchy-buddy-" in n for n in os.listdir(os.path.join(home, ".config/omarchy"))))
shutil.rmtree(home)

# 3. No shell.json and no Claude: the defaults become the user's file.
home, env = sandbox()
r = setup(env)
sh = read(os.path.join(home, ".config/omarchy/shell.json"))
check("ohne shell.json: aus Omarchys Vorgabe", r.returncode == 0 and sh["bar"] == {**DEFAULT_SHELL["bar"], "layout": sh["bar"]["layout"]}
      and in_bar(sh))
check("ohne Claude: übersprungen", "nicht gefunden" in r.stdout and not os.path.exists(os.path.join(home, ".claude")))
setup(env, "--remove")
sh = read(os.path.join(home, ".config/omarchy/shell.json"))
check("ohne shell.json: zurück auf die Vorgabe", {k: v for k, v in sh.items() if k != "disabledPlugins"} == DEFAULT_SHELL)
shutil.rmtree(home)

# 4. HOME with a space; the scripts gone (`omarchy plugin remove` without --remove):
#    the hooks do nothing, the status line runs the old one.
home, env = sandbox()
spaced = os.path.join(home, "mit leer")
os.makedirs(spaced)
env = sandbox_env(spaced, XDG_RUNTIME_DIR=env["XDG_RUNTIME_DIR"], OMARCHY_PATH=OMARCHY)
write(os.path.join(spaced, ".claude/settings.json"), {"statusLine": {"type": "command", "command": "cat >/dev/null; echo alte  Zeile"}})
r = setup(env)
s = read(os.path.join(spaced, ".claude/settings.json"))
hook_cmd = s["hooks"]["SessionStart"][0]["hooks"][0]["command"]
event = json.dumps({"hook_event_name": "SessionStart", "session_id": "leer", "cwd": "/x"})
r = subprocess.run(["sh", "-c", hook_cmd], input=event, env=env, capture_output=True, text=True)
check("HOME mit Leerzeichen: Hook läuft", r.returncode == 0 and r.stderr == ""
      and "leer" in read(os.path.join(home, "run/omarchy-buddy/state.json")))
r = subprocess.run(["sh", "-c", s["statusLine"]["command"]], input="{}", env=env, capture_output=True, text=True)
check("HOME mit Leerzeichen: Statuszeile läuft", r.returncode == 0 and r.stdout == "alte Zeile\n")
for name in ("omarchy-buddy-hook", "omarchy-buddy-statusline"):
    os.remove(os.path.join(spaced, ".local/bin", name))
r = subprocess.run(["sh", "-c", hook_cmd], input=event, env=env, capture_output=True, text=True)
check("ohne Skript: Hook tut nichts", r.returncode == 0 and r.stdout == r.stderr == "")
r = subprocess.run(["sh", "-c", s["statusLine"]["command"]], input="{}", env=env, capture_output=True, text=True)
check("ohne Skript: alte Statuszeile", r.returncode == 0 and r.stdout == "alte Zeile\n")
r = setup(env)
s2 = read(os.path.join(spaced, ".claude/settings.json"))
check("geschützte Form wird erkannt (kein zweiter Eintrag)", s2 == s and len(s2["hooks"]["Stop"]) == 1)
setup(env, "--remove")
check("geschützte Form: Entfernen", read(os.path.join(spaced, ".claude/settings.json"))
      == {"statusLine": {"type": "command", "command": "cat >/dev/null; echo alte  Zeile"}})
shutil.rmtree(home)

# 5. settings.json in an unusual shape stays untouched; a broken one stops before anything changes.
for name, odd in [("hooks als Liste", {"hooks": []}), ("Ereignis als Objekt", {"hooks": {"Stop": {"x": 1}}}),
                  ("Statuszeile als Text", {"statusLine": "x"}), ("Liste als Wurzel", [1])]:
    home, env = sandbox(odd, DEFAULT_SHELL)
    r = setup(env)
    check(f"ungewöhnlich ({name}): unverändert, Rest eingerichtet", r.returncode == 0 and "Traceback" not in r.stderr
          and read(os.path.join(home, ".claude/settings.json")) == odd
          and in_bar(read(os.path.join(home, ".config/omarchy/shell.json"))))
    shutil.rmtree(home)
group = {"hooks": [{"type": "command", "command": "other"}]}
home, env = sandbox({"hooks": {"Stop": ["text", {"x": 1}, group]}}, DEFAULT_SHELL)
setup(env)
check("fremde Einträge ohne Objekt bleiben", read(os.path.join(home, ".claude/settings.json"))["hooks"]["Stop"][:3]
      == ["text", {"x": 1}, group])
shutil.rmtree(home)
for name, odd in [("andere Version", {**DEFAULT_SHELL, "version": 2}), ("Liste als Wurzel", [1])]:
    home, env = sandbox(SETTINGS, odd)
    r = setup(env)
    check(f"ungewöhnliche shell.json ({name}): unverändert, genannt", r.returncode == 0 and "Traceback" not in r.stderr
          and read(os.path.join(home, ".config/omarchy/shell.json")) == odd and "ungewöhnliche Form" in r.stdout)
    shutil.rmtree(home)
# Dotfiles: settings.json and shell.json as symlinks stay symlinks, the targets change.
home, env = sandbox()
for rel, data in [(".claude/settings.json", SETTINGS), (".config/omarchy/shell.json", DEFAULT_SHELL)]:
    target = os.path.join(home, "dotfiles", os.path.basename(rel))
    write(target, data)
    os.makedirs(os.path.dirname(os.path.join(home, rel)), exist_ok=True)
    os.symlink(target, os.path.join(home, rel))
setup(env)
check("Symlinks bleiben, Ziel eingerichtet", os.path.islink(os.path.join(home, ".claude/settings.json"))
      and os.path.islink(os.path.join(home, ".config/omarchy/shell.json"))
      and "hooks" in read(os.path.join(home, "dotfiles/settings.json")) and read(os.path.join(home, "dotfiles/settings.json")) != SETTINGS
      and "omarchy.notifications" in read(os.path.join(home, "dotfiles/shell.json"))["disabledPlugins"])
setup(env, "--remove")
check("Symlinks: Entfernen stellt die Ziele wieder her", read(os.path.join(home, "dotfiles/settings.json")) == SETTINGS
      and read(os.path.join(home, "dotfiles/shell.json")) == DEFAULT_SHELL and os.path.islink(os.path.join(home, ".claude/settings.json")))
shutil.rmtree(home)
home, env = sandbox(None, DEFAULT_SHELL)
os.makedirs(os.path.join(home, ".claude"))
with open(os.path.join(home, ".claude/settings.json"), "w") as f:
    f.write("{kaputt")
r = setup(env)
check("kaputte settings.json: Abbruch vor allem anderen", r.returncode != 0 and "Traceback" not in r.stderr
      and not os.path.lexists(os.path.join(home, ".local/bin/omarchy-buddy-hook"))
      and read(os.path.join(home, ".config/omarchy/shell.json")) == DEFAULT_SHELL)
shutil.rmtree(home)

# 6. --uninstall: everything of --remove, then `omarchy plugin remove`, then the shell restart.
home, env = sandbox(SETTINGS, DEFAULT_SHELL)
fake = os.path.join(home, "fake-bin")
os.makedirs(fake)
for tool in ("omarchy", "systemctl"):
    with open(os.path.join(fake, tool), "w") as f:
        f.write(f'#!/bin/sh\necho "{tool} $*" >> "$HOME/calls"\n')
    os.chmod(os.path.join(fake, tool), 0o755)
env = dict(env, PATH=fake + os.pathsep + env["PATH"])
subprocess.run([SETUP], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True)
restarts = lambda: open(os.path.join(home, "calls")).read().splitlines().count("omarchy restart shell")
check("Einrichten: Shell neu gestartet", restarts() == 1)
subprocess.run([SETUP], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True)
check("zweites Einrichten ohne Änderung: kein Neustart (Frage 11)", restarts() == 1)
r = subprocess.run([SETUP, "--uninstall"], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True)
calls = open(os.path.join(home, "calls")).read().splitlines()
check("--uninstall: zurück wie vorher", r.returncode == 0 and read(os.path.join(home, ".claude/settings.json")) == SETTINGS
      and read(os.path.join(home, ".config/omarchy/shell.json")) == DEFAULT_SHELL)
check("--uninstall: Plugin entfernen, dann Shell neu", calls[-2:] == [f"omarchy plugin remove {ID} --yes",
                                                                      "omarchy restart shell"])
with open(os.path.join(fake, "omarchy"), "w") as f:
    f.write('#!/bin/sh\necho "omarchy $*" >> "$HOME/calls"\n[ "$1" = plugin ] && { echo "nicht installiert" >&2; exit 1; }\nexit 0\n')
subprocess.run([SETUP], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True)
r = subprocess.run([SETUP, "--uninstall"], env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True)
calls = open(os.path.join(home, "calls")).read().splitlines()
check("--uninstall scheitert: Exit 1, Fehler genannt, Shell trotzdem neu", r.returncode == 1
      and "nicht installiert" in r.stdout and calls[-1] == "omarchy restart shell")
shutil.rmtree(home)

# 9. Codex (#130): hooks.json kept in dotfiles (a link), trust in config.toml;
#    set up twice, then --remove: hooks.json as before, config.toml byte for byte.
home, env = sandbox({}, DEFAULT_SHELL)
dots = os.path.join(home, "dotfiles")
orca = ": orca; cat >/dev/null"
codex_hooks = {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": orca, "timeout": 10}]}]}}
write(os.path.join(dots, "hooks.json"), codex_hooks)
os.makedirs(os.path.join(home, ".codex"))
os.symlink(os.path.join(dots, "hooks.json"), os.path.join(home, ".codex/hooks.json"))
toml = '[features]\nhooks = true\n\n[hooks.state."%s/.codex/hooks.json:stop:0:0"]\nenabled = true\ntrusted_hash = "sha256:x"\n' % home
with open(os.path.join(home, ".codex/config.toml"), "w") as f:
    f.write(toml)
before = open(os.path.join(dots, "hooks.json")).read()
setup(env); setup(env)
h = read(os.path.join(home, ".codex/hooks.json"))
ours = guarded(hook := os.path.join(home, ".local/bin/omarchy-buddy-hook")).replace("; fi", " --codex; fi")
check("Codex: Hook mit --codex für jedes Ereignis", all(h["hooks"][e][-1]["hooks"][0]["command"] == ours
                                                         for e in ("SessionStart", "PermissionRequest", "Stop", "Interrupt")))
check("Codex: fremder Hook zuerst, einmal eingetragen", h["hooks"]["Stop"][0]["hooks"][0]["command"] == orca and len(h["hooks"]["Stop"]) == 2)
check("Codex: Link bleibt Link", os.path.islink(os.path.join(home, ".codex/hooks.json")))
text = open(os.path.join(home, ".codex/config.toml")).read()
check("Codex: vertraut, fremder Eintrag unverändert", text.startswith(toml) and f'hooks.json:stop:1:0"]' in text
      and text.count("[hooks.state.") == 1 + 8)
setup(env, "--remove")
check("Codex: --remove, hooks.json wie vorher", json.loads(open(os.path.join(dots, "hooks.json")).read()) == json.loads(before))
check("Codex: --remove, config.toml wie vorher", open(os.path.join(home, ".codex/config.toml")).read() == toml)
shutil.rmtree(home)

# 10. #138: ours stay where they are among Orca's and herdr's hooks, outdated
#     ones of ours are replaced in place, a second run writes the same bytes.
home, env = sandbox()
hook = os.path.join(home, ".local/bin/omarchy-buddy-hook")
herdr = "bash '/x/herdr.sh' session"
other = lambda c: {"hooks": [{"type": "command", "command": c, "timeout": 10}]}
mine = lambda c, **o: {"hooks": [{"type": "command", "command": c, **o}]}
write(os.path.join(home, ".claude/settings.json"), {"hooks": {
    "Stop": [mine(guarded(hook), **{"async": True}), other(orca)],
    "PreToolUse": [other(orca), mine(hook), other(herdr)],
    "SessionEnd": [mine(guarded(hook), timeout=1), other(orca), mine(guarded(hook), timeout=5)]}})
setup(env)
path = os.path.join(home, ".claude/settings.json")
s = read(path)
check("Reihenfolge: eigener Hook bleibt vor Orca", s["hooks"]["Stop"] == [mine(guarded(hook), **{"async": True}), other(orca)])
check("Reihenfolge: alter Eintrag an seiner Stelle ersetzt",
      s["hooks"]["PreToolUse"] == [other(orca), mine(guarded(hook), **{"async": True}), other(herdr)])
check("Reihenfolge: veralteter ersetzt, doppelter weg", s["hooks"]["SessionEnd"] == [mine(guarded(hook), timeout=5), other(orca)])
check("Reihenfolge: fehlende angehängt", s["hooks"]["PermissionRequest"] == [mine(guarded(hook), timeout=310)])
first = open(path, "rb").read()
os.makedirs(os.path.join(home, ".codex"))
write(os.path.join(home, ".codex/hooks.json"), {"hooks": {"Stop": [other(orca)]}})
setup(env)
codex_path = os.path.join(home, ".codex/hooks.json")
h = read(codex_path)
h["hooks"]["Stop"].append(other(herdr))  # added after ours by another tool
write(codex_path, h)
setup(env)
files = (path, codex_path, os.path.join(home, ".codex/config.toml"))
second = [open(p, "rb").read() for p in files]
r = setup(env)
check("Reihenfolge: zweiter Lauf byte-gleich", [open(p, "rb").read() for p in files] == second and second[0] == first)
check("Reihenfolge: Codex-Hook bleibt vor herdr",
      [g["hooks"][0]["command"] for g in read(codex_path)["hooks"]["Stop"]]
      == [orca, guarded(hook).replace("; fi", " --codex; fi"), herdr])
check("Reihenfolge: nichts zu tun gemeldet", "Sicherung" not in r.stdout)
shutil.rmtree(home)

# 11. Further agents (#141): Gemini (Claude's form, among Orca's hooks),
#     Crush (flat entries, its own providers stay), Copilot (an own file
#     next to Orca's); twice, then --remove: every file byte for byte as
#     before, files the setup wrote are gone. A file with comments (JSONC)
#     is left alone and stops nothing else.
home, env = sandbox({}, DEFAULT_SHELL)
hook = os.path.join(home, ".local/bin/omarchy-buddy-hook")
ours = lambda agent: guarded(hook).replace("; fi", f" --agent {agent}; fi")
gemini = os.path.join(home, ".gemini/settings.json")
crush = os.path.join(home, ".config/crush/crush.json")
copilot_dir = os.path.join(home, ".copilot/hooks")
write(gemini, {"hooks": {"BeforeTool": [other(orca)], "AfterAgent": [other(orca)]}, "context": {"fileName": ["AGENTS.md"]}})
write(crush, {"providers": {"x": {"type": "openai-compat"}}, "hooks": {"PreToolUse": [{"command": orca, "timeout": 3}]}})
write(os.path.join(copilot_dir, "orca.json"), {"version": 1, "hooks": {"Stop": [{"type": "command", "bash": orca}]}})
before = {p: open(p, "rb").read() for p in (gemini, crush, os.path.join(copilot_dir, "orca.json"))}
setup(env)
r = setup(env)
g, c = read(gemini), read(crush)
check("Gemini: eigener Hook hinter Orcas, jedes Ereignis",
      [x["hooks"][0]["command"] for x in g["hooks"]["BeforeTool"]] == [orca, ours("gemini")]
      and all(g["hooks"][e][-1]["hooks"][0]["command"] == ours("gemini") for e in ("SessionStart", "BeforeAgent", "Notification", "SessionEnd"))
      and g["context"] == {"fileName": ["AGENTS.md"]})
check("Gemini: Zeitlimit in ms", g["hooks"]["BeforeTool"][-1]["hooks"][0]["timeout"] == 5000)
check("Crush: flache Einträge, fremder zuerst, Anbieter bleiben",
      [x["command"] for x in c["hooks"]["PreToolUse"]] == [orca, ours("crush")] and c["providers"] == {"x": {"type": "openai-compat"}}
      and "TurnEnd" in c["hooks"] and "UserPromptSubmit" not in c["hooks"])
cp = read(os.path.join(copilot_dir, "omarchy-buddy.json"))
check("Copilot: eigene Datei neben Orcas", cp["version"] == 1 and cp["hooks"]["Notification"] == [
      {"type": "command", "bash": ours("copilot"), "timeoutSec": 5}])
check("Weitere Agents: zweiter Lauf ändert nichts", all(f"{a}: Hooks stehen schon." in r.stdout for a in ("Gemini", "Crush", "Copilot")))
setup(env, "--remove")
check("Weitere Agents: --remove, alles wie vorher", all(json.loads(open(p, "rb").read()) == json.loads(b) for p, b in before.items())
      and not os.path.exists(os.path.join(copilot_dir, "omarchy-buddy.json")))
for p in (gemini, crush):
    os.remove(p)
setup(env)
setup(env, "--remove")
check("Weitere Agents: selbst geschriebene Dateien wieder weg", not os.path.exists(gemini) and not os.path.exists(crush))
with open(gemini, "w") as f:
    f.write('{\n  // Kommentar\n  "hooks": {}\n}\n')
jsonc = open(gemini).read()
write(os.path.join(copilot_dir, "omarchy-buddy.json"), {"version": 1, "hooks": {"Stop": [{"type": "command", "bash": orca}]}})
r = setup(env)
check("Weitere Agents: JSONC und fremde Datei bleiben, Rest läuft",
      r.returncode == 0 and open(gemini).read() == jsonc and "Gemini: " in r.stdout and "ungewöhnliche Form" in r.stdout
      and read(os.path.join(copilot_dir, "omarchy-buddy.json"))["hooks"]["Stop"][0]["bash"] == orca and os.path.exists(crush))
shutil.rmtree(home)

# 12. Plugin agents (#142): our stub next to Orca's plugins in opencode's,
#     Pi's and omp's folders, twice, then --remove: only ours is gone. The
#     stub loads the plugin from the checkout and does nothing without it.
#     A file of ours by name but not by content stays.
home, env = sandbox({}, DEFAULT_SHELL)
repo = os.path.dirname(os.path.dirname(os.path.abspath(SETUP)))
plugins = {"opencode": os.path.join(home, ".config/opencode/plugins"), "pi-agent": os.path.join(home, ".pi/agent/extensions"),
           "omp": os.path.join(home, ".omp/agent/extensions")}
orca_files = {os.path.join(plugins["opencode"], "orca-opencode-status.js"): "export default {}\n",
              os.path.join(plugins["pi-agent"], "orca-agent-status.ts"): "export default function () {}\n"}
for p, text in orca_files.items():
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w") as f:
        f.write(text)
os.makedirs(os.path.join(home, ".omp/logs"))  # omp before its first session: no agent/ yet
setup(env)
r = setup(env)
stubs = {a: os.path.join(d, "omarchy-buddy.js") for a, d in plugins.items()}
texts = {a: open(p).read() if os.path.exists(p) else "" for a, p in stubs.items()}
check("Plugin-Agents: Datei je Agent, lädt das Plugin aus dem Checkout",
      all(json.dumps(os.path.join(repo, "agent-plugins", f)) in texts[a]
          for a, f in (("opencode", "opencode.js"), ("pi-agent", "pi.js"), ("omp", "pi.js")))
      and '(pi, "omp")' in texts["omp"] and '(pi, "pi-agent")' in texts["pi-agent"])
check("Plugin-Agents: zweiter Lauf ändert nichts",
      all(f"{a}: Plugin ist schon da." in r.stdout for a in ("opencode", "Pi", "Oh My Pi")))
# What the agent does with the stub: the plugin missing (removed without --remove) is no error.
gone = os.path.join(home, "gone.mjs")
with open(gone, "w") as f:
    f.write(texts["omp"].replace(os.path.join(repo, "agent-plugins"), "/nirgends"))
oc_gone = os.path.join(home, "oc-gone.mjs")
with open(oc_gone, "w") as f:
    f.write(texts["opencode"].replace(os.path.join(repo, "agent-plugins"), "/nirgends"))
node = subprocess.run(["node", "-e", f"""
  const on = []
  Promise.all([import({json.dumps(stubs['omp'])}), import({json.dumps(gone)}), import({json.dumps(oc_gone)})])
    .then(async ([real, missing, oc]) => {{
      await real.default({{ on: (name) => on.push(name) }})
      await missing.default({{ on: () => {{ throw new Error("geladen") }} }})
      await oc.default.setup({{}})
      console.log(on.includes("tool_approval_requested") ? "ok" : "fehlt")
    }})"""], capture_output=True, text=True)
check("Plugin-Agents: Datei lädt das Plugin, ohne Plugin passiert nichts", node.stdout.strip() == "ok")
setup(env, "--remove")
check("Plugin-Agents: --remove nimmt nur unsere Dateien, Orcas bleiben",
      not any(os.path.exists(p) for p in stubs.values())
      and all(open(p).read() == text for p, text in orca_files.items()))
with open(stubs["opencode"], "w") as f:
    f.write("// jemand anderes\n")
r = setup(env)
check("Plugin-Agents: fremde Datei unter unserem Namen bleibt, Rest läuft",
      r.returncode == 0 and open(stubs["opencode"]).read() == "// jemand anderes\n" and "ungewöhnliche Form" in r.stdout
      and os.path.exists(stubs["pi-agent"]))
setup(env, "--remove")
check("Plugin-Agents: --remove lässt die fremde Datei stehen", open(stubs["opencode"]).read() == "// jemand anderes\n")
shutil.rmtree(home)

# 13. Omarchy 4.5's agents (#145): Antigravity (our named group next to
#     Orca's), Qwen, Devin and Command Code (Claude's form), Kimi (a marked
#     TOML block after Orca's), Kiro (an own file next to Orca's); twice,
#     then --remove: every file as before. Without the folder nothing is
#     written; an inline `hooks = [...]` in Kimi's file is left alone.
home, env = sandbox({}, DEFAULT_SHELL)
hook = os.path.join(home, ".local/bin/omarchy-buddy-hook")
ours = lambda arg: guarded(hook).replace("; fi", f" --agent {arg}; fi")
agy = os.path.join(home, ".gemini/config/hooks.json")
qwen = os.path.join(home, ".qwen/settings.json")
kimi = os.path.join(home, ".kimi-code/config.toml")
kiro_orca = os.path.join(home, ".kiro/hooks/orca-agent-status.json")
write(agy, {"orca-status": {"Stop": [{"type": "command", "command": orca, "timeout": 10}]}})
write(qwen, {"hooks": {"PreToolUse": [other(orca)]}, "model": {"name": "qwen3-coder"}})
write(kiro_orca, {"version": "v1", "hooks": [{"name": "orca", "trigger": "Stop", "action": {"type": "command", "command": orca}}]})
kimi_text = 'default_model = "k2"\n\n[[hooks]]\nevent = "Stop"\ncommand = "orca"\n\n[ui]\ntheme = "dark"\n'
os.makedirs(os.path.dirname(kimi))
with open(kimi, "w") as f:
    f.write(kimi_text)
os.makedirs(os.path.join(home, ".config/devin"))
before = {p: open(p, "rb").read() for p in (agy, qwen, kimi, kiro_orca)}
setup(env)
first = {p: open(p, "rb").read() for p in (agy, qwen, kimi)}
r = setup(env)
a, q = read(agy), read(qwen)
check("Antigravity: eigene Gruppe neben Orcas, Ereignis im Befehl",
      a["orca-status"] == {"Stop": [{"type": "command", "command": orca, "timeout": 10}]}
      and a["omarchy-buddy"]["Stop"] == [{"type": "command", "command": ours("agy Stop"), "timeout": 5}]
      and a["omarchy-buddy"]["PreToolUse"] == [{"matcher": "*", "hooks": [{"type": "command", "command": ours("agy PreToolUse"), "timeout": 5}]}])
check("Qwen: Hook hinter Orcas, Einstellungen bleiben",
      [x["hooks"][0]["command"] for x in q["hooks"]["PreToolUse"]] == [orca, ours("qwen")] and q["model"] == {"name": "qwen3-coder"}
      and "Notification" in q["hooks"] and "PermissionRequest" not in q["hooks"])
d = read(os.path.join(home, ".config/devin/config.json"))
check("Devin: Claudes Form in einer neuen Datei", d == {"hooks": {e: [{"hooks": [{"type": "command", "command": ours("devin"), "timeout": 5}]}]
      for e in ("SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest", "Stop", "SessionEnd")}})
k = tomllib.loads(open(kimi).read())
check("Kimi: Block hinter Orcas Hooks, Datei bleibt gültig",
      open(kimi).read().startswith(kimi_text) and k["ui"] == {"theme": "dark"} and k["hooks"][0]["command"] == "orca"
      and [h["event"] for h in k["hooks"][1:]][:2] == ["UserPromptSubmit", "TurnStarted"]
      and all(h["command"] == ours("kimi") and h["timeout"] == 5 for h in k["hooks"][1:]))
kiro = read(os.path.join(home, ".kiro/hooks/omarchy-buddy.json"))
check("Kiro: eigene Datei neben Orcas", kiro["version"] == "v1" and kiro["hooks"][2] == {
      "name": "omarchy-buddy-PreToolUse", "trigger": "PreToolUse", "action": {"type": "command", "command": ours("kiro-cli")}, "timeout": 5})
check("4.5-Agents: ohne Ordner nichts geschrieben", re.search(r"Nicht installiert, übersprungen: .*Command Code", r.stdout)
      and not os.path.exists(os.path.join(home, ".commandcode")))
check("4.5-Agents: zweiter Lauf ändert nichts",
      all(f"{n}: Hooks stehen schon." in r.stdout for n in ("Antigravity", "Qwen Code", "Kimi", "Devin", "Kiro"))
      and {p: open(p, "rb").read() for p in first} == first)
setup(env, "--remove")
check("4.5-Agents: --remove, alles wie vorher", open(kimi, "rb").read() == before[kimi]
      and all(json.loads(open(p, "rb").read()) == json.loads(before[p]) for p in (agy, qwen, kiro_orca))
      and not os.path.exists(os.path.join(home, ".kiro/hooks/omarchy-buddy.json"))
      and not os.path.exists(os.path.join(home, ".config/devin/config.json")))
with open(kimi, "w") as f:
    f.write('hooks = [{event = "Stop", command = "orca"}]\n')
r = setup(env)
check("Kimi: hooks = [...] in einer Zeile bleibt, Rest läuft",
      r.returncode == 0 and open(kimi).read() == 'hooks = [{event = "Stop", command = "orca"}]\n'
      and "ungewöhnliche Form" in r.stdout and os.path.exists(os.path.join(home, ".kiro/hooks/omarchy-buddy.json")))
shutil.rmtree(home)

# 14. Muse (#144): our hooks next to Orca's managed_hooks_path in the
#     settings.json Orca writes; Orca's keys keep their bytes and place,
#     --remove restores the file byte for byte. Without a file one with
#     schema_version (Muse does not start without it), which --remove deletes.
home, env = sandbox({}, DEFAULT_SHELL)
hook = os.path.join(home, ".local/bin/omarchy-buddy-hook")
muse = os.path.join(home, ".config/muse/settings.json")
os.makedirs(os.path.dirname(muse))
r = setup(env)
m = read(muse)
check("Muse: neue Datei mit schema_version und unseren Hooks", m["schema_version"] == 1
      and m["hooks"]["Stop"] == [{"hooks": [{"type": "command", "command": guarded(hook).replace("; fi", " --agent muse; fi"), "timeout": 5}]}]
      and m["hooks"]["ToolUseStart"][0]["hooks"][0]["async"] is True and "PermissionRequest" not in m["hooks"])
setup(env, "--remove")
check("Muse: --remove löscht die eigene Datei", not os.path.exists(muse) and os.path.isdir(os.path.dirname(muse)))
orca_text = json.dumps({"schema_version": 1, "managed_hooks_path": "/home/user/.orca/agent-hooks/muse-hooks.json",
                        "managed_hooks_env_vars": ["ORCA_AGENT_HOOK_PORT", "ORCA_PANE_KEY", "USERPROFILE"]}, indent=2) + "\n"
with open(muse, "w") as f:
    f.write(orca_text)
setup(env)
first = open(muse, "rb").read()
r = setup(env)
check("Muse: Orcas Schlüssel bleiben byte-gleich vorn, unsere Hooks dahinter",
      first.decode().startswith(orca_text.rstrip()[:-1].rstrip() + ',\n  "hooks": {') and len(read(muse)["hooks"]) == 10)
check("Muse: zweiter Lauf ändert nichts", "Muse: Hooks stehen schon." in r.stdout and open(muse, "rb").read() == first)
setup(env, "--remove")
check("Muse: --remove, Orcas Datei byte-gleich wie vorher", open(muse).read() == orca_text)
shutil.rmtree(os.path.dirname(muse))
r = setup(env)
check("Muse: ohne Ordner nichts geschrieben", re.search(r"Nicht installiert, übersprungen: .*Muse", r.stdout)
      and not os.path.exists(os.path.dirname(muse)))
shutil.rmtree(home)

# 7z. Long terminal commands (#168): the island's switch puts one marked line
# into ~/.bashrc and the .zshrc (here ~/.config/zsh) and takes exactly that out
# again; a file chezmoi manages stays as it is, the setup names the line.
home, env = sandbox()
bashrc, zshrc = os.path.join(home, ".bashrc"), os.path.join(home, ".config/zsh/.zshrc")
os.makedirs(os.path.dirname(zshrc))
for path, text in ((bashrc, "# Omarchy\nalias ll='ls -la'\n"), (zshrc, "setopt autocd")):
    with open(path, "w") as f:
        f.write(text)
before = {p: open(p).read() for p in (bashrc, zshrc)}
r = setup(env, "--commands", "on")
line = '[ -r "$HOME/.config/omarchy/plugins/io.github.destrukt1v.omarchy-buddy/lib/long-commands.sh" ] && . "$HOME/.config/omarchy/plugins/io.github.destrukt1v.omarchy-buddy/lib/long-commands.sh"'
check("lange Befehle: an trägt in beide Dateien ein", r.returncode == 0
      and all(open(p).read().count(line) == 1 for p in (bashrc, zshrc)) and "omarchy-buddy" in open(bashrc).read().splitlines()[-3])
short = "In ~/.bashrc und ~/.config/zsh/.zshrc eingetragen. Gilt für neue Terminals.\n"
check("lange Befehle: kurze Rückmeldung für den Schalter (#169)", r.stdout == short)
check("lange Befehle: zweimal an ändert nichts", setup(env, "--commands", "on").stdout == short
      and all(open(p).read().count(line) == 1 for p in (bashrc, zshrc)))
r = setup(env, "--commands", "off")
check("lange Befehle: aus nimmt genau das heraus", open(bashrc).read() == before[bashrc] and line not in open(zshrc).read()
      and open(zshrc).read().rstrip("\n") == before[zshrc] and r.stdout == "Ausgetragen.\n")
write(os.path.join(home, ".config/omarchy-buddy/config.json"), {"longCommands": True})
setup(env)
check("lange Befehle: Einrichten folgt config.json", line in open(bashrc).read())
setup(env, "--remove")
check("lange Befehle: --remove nimmt sie heraus", open(bashrc).read() == before[bashrc])
fake = os.path.join(home, "fakebin")
os.makedirs(fake)
with open(os.path.join(fake, "chezmoi"), "w") as f:
    f.write('#!/bin/sh\ncase $2 in *.zshrc) exit 0 ;; esac\nexit 1\n')
os.chmod(os.path.join(fake, "chezmoi"), 0o755)
zsh_before = open(zshrc).read()
r = setup(dict(env, PATH=fake + ":" + env["PATH"]), "--commands", "on")
check("lange Befehle: chezmoi-Datei bleibt, Zeile zuletzt genannt, Exit 2", r.returncode == 2 and open(zshrc).read() == zsh_before
      and "chezmoi" in r.stdout and r.stdout.strip().splitlines()[-1] == line and line in open(bashrc).read())
setup(env, "--commands", "off")
shutil.rmtree(home)

# 15. #154: a hook of someone else in the same group as ours (added there by
#     hand) stays, in its group with its matcher; only an empty group goes.
#     Claude, Codex (its trust moves along), Gemini (Claude's form), Crush
#     (flat). The old status line survives a missing statusline.json.
home, env = sandbox()
hook = os.path.join(home, ".local/bin/omarchy-buddy-hook")
statusline = os.path.join(home, ".local/bin/omarchy-buddy-statusline")
ours = lambda arg="": guarded(hook).replace("; fi", f" {arg}; fi") if arg else guarded(hook)
foreign = {"type": "command", "command": "eigener-hook", "timeout": 7}
mixed = lambda c: [{"matcher": "Bash", "hooks": [{"type": "command", "command": c, "async": True}, foreign]}]
path = os.path.join(home, ".claude/settings.json")
write(path, {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": ours()}, foreign]}],
                       "PreToolUse": mixed(ours())},
             "statusLine": {"type": "command", "command": guarded(statusline, "my-statusline")}})
gemini = os.path.join(home, ".gemini/settings.json")
write(gemini, {"hooks": {"BeforeTool": mixed(ours("--agent gemini"))}})
crush = os.path.join(home, ".config/crush/crush.json")
write(crush, {"hooks": {"PreToolUse": [{"command": ours("--agent crush"), "timeout": 5}, {"command": "eigener-hook"}]}})
codex_path = os.path.join(home, ".codex/hooks.json")
write(codex_path, {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": ours("--codex"), "timeout": 30}, foreign]}]}})
codex_toml = os.path.join(home, ".codex/config.toml")
with open(codex_toml, "w") as f:
    f.write(f'[hooks.state."{codex_path}:stop:0:0"]\nenabled = true\ntrusted_hash = "sha256:alt"\n\n'
            f'[hooks.state."{codex_path}:stop:0:1"]\nenabled = true\ntrusted_hash = "sha256:fremd"\n')
setup(env)
s = read(path)
check("fremd in Gruppe: Einrichten behält den fremden Hook in seiner Gruppe",
      s["hooks"]["Stop"] == [{"hooks": [foreign]}, mine(ours(), **{"async": True})]
      and s["hooks"]["PreToolUse"] == [{"matcher": "Bash", "hooks": [foreign]}, mine(ours(), **{"async": True})])
check("fremd in Gruppe: Statuszeile ohne statusline.json behalten",
      s["statusLine"]["command"] == guarded(statusline, "my-statusline"))
check("fremd in Gruppe: Codex-Vertrauen des fremden Hooks wandert mit", tomllib.loads(open(codex_toml).read())["hooks"]["state"]
      .get(f"{codex_path}:stop:0:0", {}).get("trusted_hash") == "sha256:fremd")
first = [open(p, "rb").read() for p in (path, codex_path, codex_toml, gemini, crush)]
setup(env)
check("fremd in Gruppe: zweiter Lauf byte-gleich", [open(p, "rb").read() for p in (path, codex_path, codex_toml, gemini, crush)] == first)
inner = os.path.join(home, ".local/state/omarchy-buddy/statusline.json")
check("fremd in Gruppe: statusline.json aus dem Wächter neu geschrieben", read(inner) == {"command": "my-statusline"})
os.remove(inner)  # e.g. „Verlauf zurücksetzen“
setup(env, "--remove")
s = read(path)
check("fremd in Gruppe: --remove lässt fremde Hooks stehen",
      s["hooks"] == {"Stop": [{"hooks": [foreign]}], "PreToolUse": [{"matcher": "Bash", "hooks": [foreign]}]})
check("fremd in Gruppe: --remove ohne statusline.json, alte Statuszeile zurück",
      s["statusLine"] == {"type": "command", "command": "my-statusline"})
check("fremd in Gruppe: Gemini und Crush behalten fremde Hooks",
      read(gemini) == {"hooks": {"BeforeTool": [{"matcher": "Bash", "hooks": [foreign]}]}}
      and read(crush) == {"hooks": {"PreToolUse": [{"command": "eigener-hook"}]}})
check("fremd in Gruppe: Codex behält fremden Hook und sein Vertrauen",
      read(codex_path) == {"hooks": {"Stop": [{"hooks": [foreign]}]}}
      and open(codex_toml).read() == f'[hooks.state."{codex_path}:stop:0:0"]\nenabled = true\ntrusted_hash = "sha256:fremd"\n')
shutil.rmtree(home)

# 16. #158: the island's agent switches. --agents names the installed ones
#     (their folder is there), --agent NAME on|off puts one agent's hooks or
#     plugin in or out and says nothing unless a file stopped it (exit 2);
#     a normal setup leaves the ones off in config.json out.
home, env = sandbox({}, DEFAULT_SHELL)
for d in (".gemini", ".codex", ".config/opencode", ".cursor"):
    os.makedirs(os.path.join(home, d))
gemini, codex = os.path.join(home, ".gemini/settings.json"), os.path.join(home, ".codex/hooks.json")
stub = os.path.join(home, ".config/opencode/plugins/omarchy-buddy.js")
r = setup(env, "--agents")
check("Agents: --agents nennt die installierten", r.returncode == 0 and r.stdout.split() == ["claude", "codex", "gemini", "opencode", "cursor-agent"])
write(os.path.join(home, ".config/omarchy-buddy/config.json"), {"agents": {"gemini": False, "opencode": False, "cursor-agent": False}})
r = setup(env)
check("Agents: Einrichten lässt abgeschaltete aus", not os.path.exists(gemini) and not os.path.exists(stub) and os.path.exists(codex)
      and "abgeschaltet, ohne Hooks: Gemini, opencode, Cursor." in r.stdout)
r = setup(env, "--agent", "gemini", "on")
check("Agents: Schalter an trägt ein, still", r.returncode == 0 and r.stdout == "" and "hooks" in read(gemini))
r = setup(env, "--agent", "opencode", "on")
check("Agents: Schalter an legt das Plugin an", r.returncode == 0 and os.path.exists(stub))
setup(env)
check("Agents: Einrichten nimmt Abgeschaltete wieder heraus", not os.path.exists(gemini) and not os.path.exists(stub))
r = setup(env, "--agent", "codex", "off")
check("Agents: Codex abschaltbar", r.returncode == 0 and not os.path.exists(codex))
check("Agents: Cursor-Schalter ändert keine Datei", setup(env, "--agent", "cursor-agent", "off").returncode == 0)
with open(gemini, "w") as f:
    f.write('{\n  // Kommentar\n}\n')
r = setup(env, "--agent", "gemini", "on")
check("Agents: fremde Form, Exit 2 mit Grund", r.returncode == 2 and "ungewöhnliche Form" in r.stdout and "// Kommentar" in open(gemini).read())
check("Agents: Claude und Unbekannte sind kein Schalter",
      setup(env, "--agent", "claude", "off").returncode == 1 and setup(env, "--agent", "gemini", "aus").returncode == 1)
setup(env, "--remove")
check("Agents: --remove nimmt auch Eingeschaltete heraus", not os.path.exists(codex) and not os.path.exists(stub))
shutil.rmtree(home)

# 9. #184: "Omarchy-Wetter ersetzen" and "Leiste ordnen" from the island's
#    settings: only that change, back where it was, also on --remove.
home, env = sandbox(SETTINGS, DEFAULT_SHELL)
setup(env)
shell_path = os.path.join(home, ".config/omarchy/shell.json")
ids = lambda: [e["id"] for e in read(shell_path)["bar"]["layout"]["center"]]
installed = ids()
r = setup(env, "--weather", "on")
check("Wetter: Schalter an nimmt Omarchys Wetter aus der Leiste, still",
      r.returncode == 0 and r.stdout == "" and "omarchy.weather" not in ids())
setup(env, "--weather", "on")
check("Wetter: zweimal an ändert nichts", "omarchy.weather" not in ids())
setup(env, "--weather", "off")
check("Wetter: aus bringt es an seinen Platz zurück", ids() == installed)
sh = read(shell_path)
sh["bar"]["layout"]["center"] = [e for e in sh["bar"]["layout"]["center"] if e["id"] != "omarchy.weather"]
write(shell_path, sh)
setup(env, "--weather", "on")
setup(env, "--weather", "off")
check("Wetter: von Hand entfernt bleibt weg", "omarchy.weather" not in ids())
shutil.rmtree(home)

home, env = sandbox(SETTINGS, DEFAULT_SHELL)
shell_path = os.path.join(home, ".config/omarchy/shell.json")
write(os.path.join(home, ".config/omarchy-buddy/config.json"), {"weather": True})
setup(env)
check("Wetter: Einrichten folgt config.json", "omarchy.weather" not in ids())
sh = read(shell_path)
sh["bar"]["layout"]["center"].remove({"id": "omarchy.keyboard-layout"})
write(shell_path, sh)
r = setup(env, "--bar")
check("Leiste: Angebot, solange die Anzeigen links der Uhr stehen", r.returncode == 0 and r.stdout == "offer\n")
r = setup(env, "--bar", "on")
check("Leiste ordnen: Uhr, O-Morchy, Anzeigen", r.stdout == "undo\n"
      and ids() == ["omarchy.clock", ID, "omarchy.indicators", "omarchy.system-update"])
check("Leiste ordnen: Einstellungen der Einträge bleiben",
      read(shell_path)["bar"]["layout"]["center"][0].get("format") == "dddd HH:mm")
r = setup(env, "--bar", "off")
check("Leiste: Rückgängig", r.stdout == "offer\n"
      and ids() == ["omarchy.indicators", "omarchy.clock", ID, "omarchy.system-update"])
setup(env, "--bar", "on")
sh = read(shell_path)
sh["bar"]["layout"]["center"].append({"id": "someone.vpn"})
write(shell_path, sh)
check("Leiste: seitdem geändert, kein Rückgängig mehr", setup(env, "--bar").stdout == "\n")
sh["bar"]["layout"]["center"].pop()
write(shell_path, sh)
setup(env, "--remove")
check("Entfernen: Wetter und Reihenfolge wie vorher", read(shell_path)["bar"]["layout"]["center"]
      == [e for e in DEFAULT_SHELL["bar"]["layout"]["center"] if e["id"] != "omarchy.keyboard-layout"])
shutil.rmtree(home)

home, env = sandbox(SETTINGS, {"version": 2})
r = setup(env, "--weather", "on")
check("Wetter: fremde shell.json, Exit 2 mit Grund", r.returncode == 2 and "ungewöhnliche Form" in r.stdout
      and read(os.path.join(home, ".config/omarchy/shell.json")) == {"version": 2})
shutil.rmtree(home)

# 17. #192: setup.json is the island's sign that the setup ran: the first
#     setup puts "since" in it (the island greets once), a second keeps it,
#     a setup with nothing to change in shell.json still writes it.
home, env = sandbox(SETTINGS, DEFAULT_SHELL)
record = os.path.join(home, ".local/state/omarchy-buddy/setup.json")
setup(env)
since = read(record).get("since", 0)
check("Erste Minuten: erstes Einrichten schreibt since", since > 0)
setup(env)
check("Erste Minuten: zweites Einrichten behält since", read(record).get("since") == since)
os.remove(record)
r = setup(env)
check("Erste Minuten: ohne Änderung an shell.json trotzdem setup.json", "Omarchy: nichts zu ändern." in r.stdout
      and read(record).get("since", 0) > 0 and "rechts neben der Uhr" in r.stdout)
setup(env, "--remove")
check("Erste Minuten: Entfernen nimmt setup.json mit", not os.path.exists(record))
shutil.rmtree(home)

# 18. #208: in a terminal the full setup lists what it changes and asks once
#     (gum as Omarchy asks, Yes preselected); No changes nothing (exit 1).
#     Without a terminal, with --yes and for --remove it does not ask.
def in_terminal(env, *args, typed=""):
    master, slave = os.openpty()
    os.write(master, typed.encode())
    r = subprocess.run([SETUP, "--files-only", *args], env=env, stdin=slave, capture_output=True, text=True, timeout=60)
    os.close(slave); os.close(master)
    return r


home, env = sandbox(SETTINGS, DEFAULT_SHELL)
fake = os.path.join(home, "fake-bin")
os.makedirs(fake)
with open(os.path.join(fake, "gum"), "w") as f:
    f.write('#!/bin/sh\nprintf "%s|" "$@" > "$HOME/gum"\nexit "$GUM_EXIT"\n')
os.chmod(os.path.join(fake, "gum"), 0o755)
gum_env = dict(env, PATH=fake + os.pathsep + env["PATH"])
shell_json = os.path.join(home, ".config/omarchy/shell.json")
r = in_terminal(dict(gum_env, GUM_EXIT="1"))
check("Frage: Nein ändert nichts, Exit 1", r.returncode == 1 and "Abgebrochen, nichts geändert" in r.stdout
      and read(shell_json) == DEFAULT_SHELL and not os.path.exists(os.path.join(home, ".local/bin")))
check("Frage: nennt nur, was es gibt", "~/.claude/settings.json" in r.stdout and "~/.config/omarchy/shell.json" in r.stdout
      and ".codex" not in r.stdout and ".gemini" not in r.stdout)
check("Frage: gum confirm, Ja/Nein", open(os.path.join(home, "gum")).read()
      == "confirm|Weiter?|--affirmative|Ja|--negative|Nein|")
r = in_terminal(dict(gum_env, GUM_EXIT="0"))
check("Frage: Ja richtet ein", r.returncode == 0 and "Weiter?" not in r.stdout and in_bar(read(shell_json)))
os.remove(os.path.join(home, "gum"))
r = in_terminal(gum_env, "--yes")
check("Frage: --yes fragt nicht", r.returncode == 0 and not os.path.exists(os.path.join(home, "gum"))
      and "ändert dafür" not in r.stdout)
r = setup(gum_env)
check("Frage: ohne Terminal keine Frage", r.returncode == 0 and "ändert dafür" not in r.stdout)
r = in_terminal(gum_env, "--remove")
check("Frage: --remove fragt nicht", r.returncode == 0 and not os.path.exists(os.path.join(home, "gum")))
no_gum = os.path.join(home, "no-gum")  # PATH without gum: the plain line
os.makedirs(no_gum)
os.symlink(sys.executable, os.path.join(no_gum, "python3"))
plain = dict(env, PATH=no_gum)
for typed, code in (("nein\n", 1), ("x\n", 1), ("\x04", 1), ("j\n", 0), ("\n", 0)):  # (\x04: Ctrl-D)
    r = in_terminal(plain, typed=typed)
    check(f"Frage ohne gum: {typed!r} → Exit {code}", r.returncode == code and "Weiter? [J/n]" in r.stdout)
r = in_terminal(dict(plain, LANG="en_US.UTF-8"), typed="y\n")
check("Frage ohne gum, englisch: y", r.returncode == 0 and "Continue? [Y/n]" in r.stdout)
shutil.rmtree(home)

# 8. `omarchy plugin add` takes the repo as it is: manifest, entry point, no symlinks.
if shutil.which("omarchy-plugin-validate"):
    r = subprocess.run(["omarchy-plugin-validate", os.path.dirname(os.path.dirname(os.path.abspath(SETUP)))],
                       capture_output=True, text=True)
    check("omarchy plugin validate", r.returncode == 0)

# 20. #220: Omarchy's bar since 07.11.2026 (left, centerBegin with the
#     indicators, center with only the clock, centerEnd, right).
OLD_OMARCHY, OMARCHY = OMARCHY, fake_omarchy("new")
NEW_SHELL = read(os.path.join(OMARCHY, "config/omarchy/shell.json"))
ids = lambda sh, name: [e["id"] for e in sh["bar"]["layout"].get(name, [])]
home, env = sandbox(SETTINGS, NEW_SHELL)
shell_path = os.path.join(home, ".config/omarchy/shell.json")
setup(env)
sh = read(shell_path)
check("neue Leiste: Widget gleich nach der Uhr am Anfang von centerEnd, die Uhr bleibt allein in der Mitte",
      ids(sh, "center") == ["omarchy.clock"] and ids(sh, "centerEnd") == [ID] + ids(NEW_SHELL, "centerEnd"))
ind = sh["bar"]["layout"]["centerBegin"][0]
check("neue Leiste: Dnd aus den Anzeigen in centerBegin", "Dnd" not in ind.get("items", ["Dnd"]) and "NightLight" in ind["items"])
setup(env, "--weather", "on")
check("neue Leiste: Wetter aus centerEnd", "omarchy.weather" not in ids(read(shell_path), "centerEnd"))
setup(env, "--weather", "off")
check("neue Leiste: Wetter zurück an seinen Platz", ids(read(shell_path), "centerEnd") == [ID] + ids(NEW_SHELL, "centerEnd"))
r = setup(env, "--bar")
check("neue Leiste: „Leiste ordnen“ bietet nichts an", r.returncode == 0 and r.stdout == "\n")
setup(env, "--weather", "on")
setup(env, "--remove")
check("neue Leiste: Entfernen, shell.json wie vorher", read(shell_path) == NEW_SHELL)
shutil.rmtree(home)

home, env = sandbox(SETTINGS, {"version": 1, "plugins": []})
shell_path = os.path.join(home, ".config/omarchy/shell.json")
setup(env)
sh = read(shell_path)
check("neue Leiste ohne Layout: Omarchys mit dem Widget am Anfang von centerEnd",
      ids(sh, "centerEnd") == [ID] + ids(NEW_SHELL, "centerEnd") and ids(sh, "center") == ["omarchy.clock"])
setup(env, "--remove")
check("neue Leiste ohne Layout: Entfernen nimmt sie wieder heraus", read(shell_path) == {"version": 1, "plugins": []})
shutil.rmtree(home)

# The old id (#209) in the new bar keeps its place.
home, env = sandbox(SETTINGS, NEW_SHELL)
shell_path = os.path.join(home, ".config/omarchy/shell.json")
setup(env)
want = read(shell_path)
write(shell_path, json.loads(json.dumps(want).replace(f'"{ID}"', '"omarchy-buddy"')))
setup(env)
check("neue Leiste: alte ID bleibt an ihrem Platz in centerEnd", read(shell_path) == want)
shutil.rmtree(home)

# Set up on the old bar (weather out), then Omarchy's migration splits the
# user's centre at the clock: the switches and --remove still find their way.
home, env = sandbox(SETTINGS, DEFAULT_SHELL)
env["OMARCHY_PATH"] = OLD_OMARCHY
shell_path = os.path.join(home, ".config/omarchy/shell.json")
write(os.path.join(home, ".config/omarchy-buddy/config.json"), {"weather": True})
setup(env)
sh = read(shell_path)
center = sh["bar"]["layout"]["center"]
at = ids(sh, "center").index("omarchy.clock")
sh["bar"]["layout"] = {"left": sh["bar"]["layout"]["left"], "centerBegin": center[:at], "center": [center[at]],
                       "centerEnd": center[at + 1:], "right": sh["bar"]["layout"]["right"]}
write(shell_path, sh)
env["OMARCHY_PATH"] = OMARCHY
setup(env, "--weather", "off")
check("alte Einrichtung, neu aufgeteilt: Wetter zurück zu seinen Nachbarn in centerEnd",
      ids(read(shell_path), "centerEnd") == [ID, "omarchy.keyboard-layout", "omarchy.weather", "omarchy.system-update"]
      and ids(read(shell_path), "center") == ["omarchy.clock"])
setup(env, "--remove")
sh = read(shell_path)
check("alte Einrichtung, neu aufgeteilt: Entfernen bringt Dnd zurück, Widget weg",
      not in_bar(sh) and "items" not in sh["bar"]["layout"]["centerBegin"][0])
shutil.rmtree(home)

shutil.rmtree(OLD_OMARCHY)
shutil.rmtree(OMARCHY)
done()
