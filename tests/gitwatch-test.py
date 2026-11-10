#!/usr/bin/env python3
# The update watcher for git clones (#224, lib/gitwatch.py): which remotes
# it watches, where it looks and what it never touches, the rule for a new
# version, the update against a local bare repo as the remote, and what
# the feed makes of it. Everything in a sandbox HOME; nothing goes to the
# network. Aufruf: tests/gitwatch-test.py
import importlib.machinery, importlib.util, json, os, shutil, subprocess, sys, tempfile
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from testing import check, done, sandbox_env  # noqa: E402

HOME = tempfile.mkdtemp(prefix="omarchy-buddy-gitwatch-")
os.environ.update(sandbox_env(HOME))
os.environ.pop("GH_CONFIG_DIR", None)
FEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bin", "omarchy-buddy-feed")
loader = importlib.machinery.SourceFileLoader("feed", FEED)
feed = importlib.util.module_from_spec(importlib.util.spec_from_loader("feed", loader))
loader.exec_module(feed)
gw = feed.gitwatch
GIT = ["git", "-c", "user.name=Test", "-c", "user.email=test@example.org", "-c", "init.defaultBranch=main",
       "-c", "advice.detachedHead=false"]


def git(path, *args):
    return subprocess.run(GIT + list(args), cwd=path, capture_output=True, text=True, check=True).stdout.strip()


def repo(rel, url=None):
    path = os.path.join(HOME, rel)
    os.makedirs(path, exist_ok=True)
    git(path, "init", "-q")
    if url:
        git(path, "remote", "add", "origin", url)
    return path


# 1. Which remotes: someone else's public https repo, nothing of the user's own.
own = {"destrukt1v"}
cases = {
    "https://github.com/ohmyzsh/ohmyzsh.git": True,
    "https://github.com/meviusisback/omarchy-hw-monitor": True,
    "https://token:x@gitlab.com/someone/tool.git": True,
    "https://github.com/DESTRUKT1V/omarchy-buddy.git": False,   # the own GitHub account
    "forgejo:alice/dotfiles.git": False,                        # ssh alias (own Forgejo)
    "git@github.com:someone/tool.git": False,                   # ssh: a repo one pushes to
    "ssh://git@github.com/someone/tool.git": False,
    "/home/alice/Projects/buddy/.git": False,               # the buddy's own clone
    "file:///srv/git/tool.git": False,
    "http://github.com/someone/tool.git": False,
    "https://192.168.1.20:3000/alice/tool.git": False,       # own network
    "https://git.fritz.box.lan/alice/tool.git": False,
    "https://localhost/alice/tool.git": False,
    "https://forgejo/alice/tool.git": False,
    "https://github.com/someone": False,
    "": False,
}
got = {u: gw.watched(u, own) for u in cases}
check("Remotes: nur fremde öffentliche https-Repos", got == cases, {u: v for u, v in got.items() if v != cases[u]})

os.makedirs(os.path.join(HOME, ".config/gh"))
with open(os.path.join(HOME, ".config/gh/hosts.yml"), "w") as f:
    f.write("github.com:\n    git_protocol: https\n    users:\n        DESTRUKT1V:\n    user: DESTRUKT1V\n")
check("Eigene Logins aus gh (ohne Netz)", gw.own_users() == {"destrukt1v"}, gw.own_users())

# 2. Where: the software places, one level deep; never the own work.
PUB = "https://github.com/someone/{}.git"
repo(".oh-my-zsh", "https://github.com/ohmyzsh/ohmyzsh.git")
repo(".oh-my-zsh/custom/plugins/fzf-tab", PUB.format("fzf-tab"))
repo(".oh-my-zsh/custom/themes/powerlevel10k", PUB.format("powerlevel10k"))
repo(".config/omarchy/plugins/someone.dock", PUB.format("dock"))
repo(".config/omarchy/plugins/.someone.dock.bak.2026", PUB.format("dock"))   # a backup
repo(".local/share/sometool", PUB.format("sometool"))
repo(".local/opt/other", PUB.format("other"))
repo("someapp", PUB.format("someapp"))
repo("Projects", PUB.format("projects"))                                 # own work, even with a public remote
repo("orca", PUB.format("orca"))
repo("NAS", PUB.format("nas"))
repo(".local/share/chezmoi", PUB.format("dotfiles"))
repo(".local/share/omarchy", "https://github.com/basecamp/omarchy.git")  # omarchy-update's
repo(".local/share/mine", "https://github.com/destrukt1v/mine.git")
repo(".local/share/forgejo", "forgejo:alice/dotfiles.git")
repo(".local/share/buddy-clone", "/home/alice/Projects/buddy/.git")
repo(".local/share/noremote")
repo("deep/er", PUB.format("deep"))                                     # two levels down
me = repo(".local/share/omarchy-buddy", PUB.format("omarchy-buddy"))    # the buddy itself
os.symlink(os.path.join(HOME, ".local/share/sometool"), os.path.join(HOME, ".config/omarchy/plugins/link"))
want = {"~/.oh-my-zsh": "omz", "~/.config/omarchy/plugins/someone.dock": "plugin",
        "~/.oh-my-zsh/custom/plugins/fzf-tab": "zsh", "~/.oh-my-zsh/custom/themes/powerlevel10k": "zsh",
        "~/.local/share/sometool": "git", "~/.local/opt/other": "git", "~/someapp": "git"}
got = gw.find(HOME, me)
check("Finden: Software-Orte, Arten, keine eigenen Repos (Projects, orca, NAS, chezmoi, eigener Account, "
      "Forgejo, Buddy), kein Backup, jeder Ordner einmal", got == want, got)
check("Finden: in der Reihenfolge der Orte", list(got)[:2] == ["~/.oh-my-zsh", "~/.config/omarchy/plugins/someone.dock"], list(got))
check("Namen: ohne Punkt", [gw.name(p) for p in ("~/.oh-my-zsh", "~/.config/omarchy/plugins/someone.dock")]
      == ["oh-my-zsh", "someone.dock"])
mounts = os.path.join(HOME, "mounts")
with open(mounts, "w") as f:
    f.write(f"//nas/share {HOME}/Mein\\040NAS cifs rw 0 0\nproc /proc proc rw 0 0\n")
check("Einhängepunkte gelesen (\\040 = Leerzeichen)", f"{HOME}/Mein NAS" in gw.mount_points(mounts))
real_mounts = gw.mount_points
gw.mount_points = lambda: {os.path.join(HOME, "someapp")}
check("Finden: Einhängepunkte bleiben unberührt", "~/someapp" not in gw.find(HOME, me))
gw.mount_points = real_mounts

# 2b. A copied or unpacked folder brings its own .git/config (#228): nothing in it may run at a check.
def hostile(rel, *cfg):
    path = repo(rel, PUB.format(os.path.basename(rel)))
    with open(os.path.join(path, "a.txt"), "w") as f:
        f.write("x\n")
    git(path, "add", "a.txt")
    git(path, "commit", "-qm", "x")
    for k, v in cfg:
        git(path, "config", k, v)
    return path


ran = lambda: sorted(f for f in os.listdir(HOME) if f.startswith("ran-"))
hostile("fsmon", ("core.fsmonitor", f"touch {HOME}/ran-fsmonitor; false"))
filt = hostile("filt", ("filter.x.clean", f"touch {HOME}/ran-filter; cat"))
with open(os.path.join(filt, ".git/info/attributes"), "w") as f:
    f.write("* filter=x\n")
os.utime(os.path.join(filt, "a.txt"), (1, 1))  # other stat than in the index: git reads it again
hostile("ext", ("branch.main.remote", "evil"), ("branch.main.merge", "refs/heads/main"),
        ("remote.evil.url", f"ext::sh -c touch% {HOME}/ran-ext"), ("protocol.ext.allow", "always"))
hostile("insteadof", ("url.ext::sh -c touch% " + HOME + "/ran-insteadof #.insteadOf", PUB.format("insteadof")),
        ("protocol.ext.allow", "always"), ("branch.main.remote", "origin"), ("branch.main.merge", "refs/heads/main"))
inc = hostile("inc", ("include.path", "extra"))
with open(os.path.join(inc, ".git/extra"), "w") as f:
    f.write(f"[core]\n\tfsmonitor = touch {HOME}/ran-include; false\n")
hostile("omzlike", ("core.eol", "lf"), ("core.autocrlf", "false"), ("fsck.zeroPaddedFilemode", "ignore"),
        ("fetch.fsck.zeroPaddedFilemode", "ignore"), ("receive.fsck.zeroPaddedFilemode", "ignore"),
        ("rebase.autoStash", "true"), ("oh-my-zsh.remote", "origin"), ("oh-my-zsh.lastVersion", "abc"))
got = gw.find(HOME, me)
for path, kind in got.items():
    gw.check(gw.full(path, HOME), kind, timeout=5)
    gw.offline(gw.full(path, HOME), kind, False)
check("Fremde .git/config: Klone mit fsmonitor, Filter, ext::, insteadOf, include nicht beobachtet",
      not {"~/fsmon", "~/filt", "~/ext", "~/insteadof", "~/inc"} & set(got) and {"~/someapp", "~/omzlike"} <= set(got), got)
check("Fremde .git/config: nichts davon lief beim Prüfen", ran() == [], ran())
listed = {p: ok for p, _, ok in gw.clones(HOME, me)}
check("Fremde .git/config (#232): clones() nennt sie, als nicht schlicht",
      all(listed.get(p) is False for p in ("~/fsmon", "~/filt", "~/ext", "~/insteadof", "~/inc"))
      and listed.get("~/someapp") is listed.get("~/omzlike") is True, listed)
gl = feed.git_list()
check("Fremde .git/config (#232): --git-list nennt sie mit config, ohne dass darin etwas lief",
      all(f"~/{r}\tconfig\n" in gl for r in ("fsmon", "filt", "ext", "insteadof", "inc"))
      and "~/omzlike\tconfig" not in gl and ran() == [], (gl, ran()))
sub = hostile("sub")
git(sub, "config", "core.fsmonitor", f"touch {HOME}/ran-submodule; false")
top = hostile("top")
shutil.move(sub, os.path.join(top, "sub"))
git(top, "update-index", "--add", "--cacheinfo", "160000," + git(os.path.join(top, "sub"), "rev-parse", "HEAD") + ",sub")
git(top, "commit", "-qm", "sub")
gw.check(top, "git", timeout=5)
gw.offline(top, "git", False)
check("Fremde .git/config im Submodul: git status bleibt draußen", "~/top" in gw.find(HOME, me) and ran() == [], ran())
for rel in ("fsmon", "filt", "ext", "insteadof", "inc", "top", "omzlike"):
    shutil.rmtree(os.path.join(HOME, rel))
check("git spricht nur https (kein ext::, file://, ssh)", gw.ENV["GIT_ALLOW_PROTOCOL"] == "https"
      and gw.remote_sha(os.path.join(HOME, "someapp"), os.path.join(HOME, "someapp"), "refs/heads/main") is None)
check("Namen fürs Terminal ohne Steuerzeichen", gw.name("~/a\x1b]52;c;eA==\x07b") == "a?]52;c;eA==?b")

# 3. The rule.
V = gw.verdict
check("Regel: gleicher Stand / eigener Stand voraus: aktuell",
      V("git", "a", "a", False, False, True, "") == "current" and V("git", "b", "a", True, True, False, "x") == "current")
check("Regel: neu, sauber, folgt dem Remote: new", V("git", "b", "a", False, False, True, "") == "new")
check("Regel: lokale Änderungen: dirty", V("git", "b", "a", False, True, True, "") == "dirty")
check("Regel: ohne Branch, der folgt: detached", V("zsh", "b", "a", False, False, False, "") == "detached")
check("Regel: Build-Schritt nur bei git: build", V("git", "b", "a", False, False, True, "Makefile") == "build"
      and V("zsh", "b", "a", False, False, True, "Makefile") == "new" and V("plugin", "b", "a", False, False, True, "x") == "new")
check("Regel: Remote nicht erreichbar: None", V("git", None, "a", False, False, True, "") is None)

# 4. Against a local bare repo as the remote.
gw.ENV["GIT_ALLOW_PROTOCOL"] = "https:file"
bare = os.path.join(HOME, "remote.git")
subprocess.run(["git", "init", "-q", "--bare", "-b", "main", bare], check=True)
up = repo("upstream", bare)
with open(os.path.join(up, "a.txt"), "w") as f:
    f.write("eins\n")
git(up, "add", "a.txt")
git(up, "commit", "-qm", "eins")
git(up, "push", "-q", "-u", "origin", "main")
clone = os.path.join(HOME, "clone")
git(HOME, "clone", "-q", bare, clone)


def push(text):
    with open(os.path.join(up, "a.txt"), "a") as f:
        f.write(text + "\n")
    git(up, "commit", "-qam", text)
    git(up, "push", "-q")


check("Prüfen: gleich: current", gw.check(clone, "zsh") == "current", gw.check(clone, "zsh"))
check("Prüfen: ls-remote fragt nur eine Referenz", gw.remote_sha(clone, "origin", "refs/heads/main") == git(up, "rev-parse", "HEAD"))
push("zwei")
before = git(clone, "rev-parse", "HEAD")
check("Prüfen: neuer Stand: new, ohne Download", gw.check(clone, "zsh") == "new"
      and git(clone, "rev-parse", "origin/main") == before)
with open(os.path.join(clone, "a.txt"), "a") as f:
    f.write("eigene Zeile\n")
check("Prüfen: lokale Änderung: dirty", gw.check(clone, "zsh") == "dirty")
check("Einstellungen (#225, ohne Netz): lokale Änderung: dirty", gw.offline(clone, "zsh", False) == "dirty")
asked = []
code = gw.update("~/clone", "zsh", ask=lambda q: asked.append(q) or True)
check("Aktualisieren: lokale Änderung: bleibt, keine Frage", code == 0 and asked == []
      and git(clone, "rev-parse", "HEAD") == before and "eigene Zeile" in open(os.path.join(clone, "a.txt")).read())
git(clone, "checkout", "-q", "a.txt")
with open(os.path.join(clone, "neu.txt"), "w") as f:
    f.write("nicht verfolgt\n")
check("Prüfen: nicht verfolgte Dateien stören nicht", gw.check(clone, "zsh") == "new")
check("Prüfen: Build-Schritt (git): nur melden", gw.check(clone, "git") == "new")
code = gw.update("~/clone", "zsh", ask=lambda q: asked.append(q) or False)
check("Aktualisieren: Nein: bleibt", code == 0 and asked == ["clone aktualisieren?"] and git(clone, "rev-parse", "HEAD") == before, asked)
git(up, "commit", "-q", "--allow-empty", "-m", "\x1b]52;c;eA==\x07Betreff")
git(up, "push", "-q")
with open(os.path.join(clone, ".git/hooks/post-merge"), "w") as f:
    f.write(f"#!/bin/sh\ntouch {HOME}/ran-hook\n")
os.chmod(os.path.join(clone, ".git/hooks/post-merge"), 0o755)


def terminal(fn):
    """fn()'s result and everything it (and the git it starts) wrote to stdout."""
    with tempfile.TemporaryFile() as f:
        sys.stdout.flush()
        saved = os.dup(1)
        os.dup2(f.fileno(), 1)
        try:
            result = fn()
        finally:
            sys.stdout.flush()
            os.dup2(saved, 1)
            os.close(saved)
        f.seek(0)
        return result, f.read()


code, shown = terminal(lambda: gw.update("~/clone", "zsh", ask=lambda q: True))
check("Aktualisieren: Ja: vorgespult auf den Stand des Remotes",
      code == 0 and git(clone, "rev-parse", "HEAD") == git(up, "rev-parse", "HEAD"))
check("Aktualisieren: Commit-Betreff ohne Escape-Sequenz, Merge ohne Hooks (#228)",
      b"\x1b]52" not in shown and b"?]52;c;eA==?Betreff" in shown and ran() == [], (shown, ran()))
os.remove(os.path.join(clone, ".git/hooks/post-merge"))
check("Prüfen: danach current", gw.check(clone, "zsh") == "current")
with open(os.path.join(clone, "b.txt"), "w") as f:
    f.write("eigener Commit\n")
git(clone, "add", "b.txt")
git(clone, "commit", "-qm", "eigener")
check("Prüfen: eigener Commit voraus: current", gw.check(clone, "zsh") == "current")
push("drei")
check("Prüfen: auseinander: new", gw.check(clone, "zsh") == "new")
code = gw.update("~/clone", "zsh", ask=lambda q: True)
check("Aktualisieren: auseinander: keine Frage, kein Merge", code != 0 and asked == ["clone aktualisieren?"] and git(clone, "log", "-1", "--format=%s") == "eigener")
git(clone, "reset", "-q", "--hard", "origin/main")
git(clone, "pull", "-q", "--ff-only")
with open(os.path.join(clone, "Makefile"), "w") as f:
    f.write("all:\n")
git(clone, "add", "Makefile")
git(clone, "commit", "-qm", "build")
git(clone, "push", "-q")
git(up, "pull", "-q")
push("vier")
check("Prüfen: mit Makefile (git): build", gw.check(clone, "git") == "build")
check("Einstellungen: neuer Stand mit Build-Schritt: build, ohne neuen Stand nichts",
      gw.offline(clone, "git", True) == "build" and gw.offline(clone, "git", False) == ""
      and gw.offline(clone, "plugin", True) == "")
head = git(clone, "rev-parse", "HEAD")
check("Aktualisieren: mit Build-Schritt: nur gemeldet", gw.update("~/clone", "git", ask=lambda q: True) == 0
      and git(clone, "rev-parse", "HEAD") == head)
git(clone, "checkout", "-q", "--detach")
check("Prüfen: abgekoppelter HEAD: detached", gw.check(clone, "zsh") == "detached")
check("Einstellungen: abgekoppelter HEAD: detached", gw.offline(clone, "zsh", False) == "detached")
check("Aktualisieren: abgekoppelt: bleibt", gw.update("~/clone", "zsh", ask=lambda q: True) == 0
      and git(clone, "rev-parse", "HEAD") == head)
check("Prüfen: als Plugin (origin HEAD): new", gw.check(clone, "plugin") == "new")
bindir = os.path.join(HOME, "bin")
os.makedirs(bindir)
with open(os.path.join(bindir, "omarchy-plugin-update"), "w") as f:
    f.write('#!/bin/sh\necho "$@" > "$HOME/plugin-update-args"\n')
os.chmod(os.path.join(bindir, "omarchy-plugin-update"), 0o755)
real_path, gw.ENV["PATH"] = gw.ENV["PATH"], bindir + ":" + gw.ENV["PATH"]
check("Aktualisieren: Plugin über omarchy-plugin-update ID", gw.update("~/clone", "plugin") == 0
      and open(os.path.join(HOME, "plugin-update-args")).read() == "clone\n")
gw.ENV["PATH"] = real_path
check("Prüfen: Remote weg: None (bleibt, wie es war)",
      git(clone, "remote", "set-url", "origin", os.path.join(HOME, "weg.git")) == "" and gw.check(clone, "plugin") is None)
if shutil.which("zsh"):
    os.makedirs(os.path.join(up, "tools"))
    with open(os.path.join(up, "tools/upgrade.sh"), "w") as f:
        f.write('print -r -- "$ZSH $*" > "$HOME/upgrade-args"\n')
    git(up, "add", "tools")
    git(up, "commit", "-qm", "upgrade.sh")
    git(up, "push", "-q")
    omz = os.path.join(HOME, "omz")
    git(HOME, "clone", "-q", bare, omz)
    push("fünf")
    check("Aktualisieren: oh-my-zsh über sein upgrade.sh (wie omz update), nach der Frage",
          gw.update("~/omz", "omz", ask=lambda q: True) == 0
          and open(os.path.join(HOME, "upgrade-args")).read() == omz + " -i -v default -c 0\n")
check("Aktualisieren: Ordner weg: nichts", gw.update("~/gibtsnicht", "git") == 0)
check("git fragt nie und lässt den Index in Ruhe", gw.ENV["GIT_TERMINAL_PROMPT"] == "0"
      and "BatchMode=yes" in gw.ENV["GIT_SSH_COMMAND"] and gw.ENV["GIT_OPTIONAL_LOCKS"] == "0")

# 5. The feed: new clones once, the update item, offline keeps, switched off drops.
said, unsaid = [], []
feed.say = lambda title, body="", **kw: said.append(dict(kw, title=title, body=body))
feed.buddy.unsay = unsaid.append
found = {"~/.oh-my-zsh": "omz", "~/.config/omarchy/plugins/a": "plugin", "~/.config/omarchy/plugins/b": "plugin",
         "~/someapp": "git"}
states = {"~/.oh-my-zsh": "new", "~/.config/omarchy/plugins/a": "new", "~/.config/omarchy/plugins/b": "build",
          "~/someapp": "dirty"}
gw.find = lambda: dict(found)
gw.clones = lambda: [(p, k, True) for p, k in found.items()] + [("~/eigen", "git", False)]
gw.check = lambda path, kind: states[gw.tilde(path)]
st = {}
feed.check_git(st, quiet=True)
check("Feed: erster Lauf: nur gemerkt, Update-Meldung schon da",
      [s["title"] for s in said] == ["Updates: 2 Plugins, oh-my-zsh"] and st["git_repos"] == found, said)
said.clear()
found["~/.oh-my-zsh/custom/plugins/fzf-tab"] = "zsh"
states["~/.oh-my-zsh/custom/plugins/fzf-tab"] = "new"
feed.check_git(st, quiet=False)
check("Feed: neuer Klon einmal gemeldet, im Eintrag als Git-Repo",
      [s["title"] for s in said] == ["Neu im Update-Watcher: fzf-tab", "Updates: 2 Plugins, oh-my-zsh, 1 Git-Repo"], said)
said.clear()
feed.check_git(st, quiet=False)
check("Feed: gleiches Bild: nichts", said == [], said)
states["~/.config/omarchy/plugins/a"] = None
states["~/.oh-my-zsh"] = "current"
feed.check_git(st, quiet=False)
check("Feed: offline behält den Stand, aktuell fällt raus",
      [s["title"] for s in said] == ["Updates: 2 Plugins, 1 Git-Repo"], said)
said.clear()
os.makedirs(os.path.join(HOME, ".config/omarchy-buddy"), exist_ok=True)
with open(os.path.join(HOME, ".config/omarchy-buddy/config.json"), "w") as f:
    json.dump({"gitRepos": {"~/.config/omarchy/plugins/b": False, "~/weg": False}}, f)
del found["~/.oh-my-zsh/custom/plugins/fzf-tab"]
feed.check_git(st, quiet=False)
check("Feed: abgewählt und gelöscht fallen raus", [s["title"] for s in said] == ["Updates: 1 Plugin"]
      and st["git_updates"] == {"~/.config/omarchy/plugins/a": "plugin"}, (said, st.get("git_updates")))
check("Abgewählt aus config.json", gw.switched_off() == {"~/.config/omarchy/plugins/b", "~/weg"})
said.clear()
found["~/neu"] = "git"
states["~/neu"] = "new"
del found["~/.config/omarchy/plugins/b"]
found["~/.config/omarchy/plugins/b"] = "plugin"
feed.check_git(st, quiet=False)
check("Feed: abgewählte nicht als neu gemeldet", said[0]["title"] == "Neu im Update-Watcher: neu", said)

seen = []
gw.offline = lambda path, kind, pending: seen.append((gw.tilde(path), pending)) or ("build" if pending else "dirty" if kind == "git" else "")
os.makedirs(feed.STATE_DIR, exist_ok=True)
buddy_state = {"git_updates": {"~/neu": "git", "~/.config/omarchy/plugins/a": "plugin"}}
with open(feed.STATE, "w") as f:
    json.dump(buddy_state, f)
check("--git-list (#225): je Klon ~/Pfad, Status nach Tab, neuer Stand aus feed.json",
      feed.git_list() == "~/.oh-my-zsh\n~/.config/omarchy/plugins/a\tbuild\n~/someapp\tdirty\n~/neu\tbuild\n~/.config/omarchy/plugins/b\n"
      "~/eigen\tconfig\n" and ("~/someapp", False) in seen and all(p != "~/eigen" for p, _ in seen), (feed.git_list(), seen))
os.remove(feed.STATE)
check("--git-list: ohne feed.json kein neuer Stand", "build" not in feed.git_list())

up_ = feed.updates
check("Schritte: Git-Klone vor omarchy-update, nach Orca",
      up_.steps({"pacman": 1}, False, lambda p: True, "1.4.253", {"~/x": "git"})
      == [["omarchy-buddy-update", "--orca"], ["omarchy-buddy-update", "--git"], ["omarchy-update"]])
check("Schritte: nur Git-Klone", up_.steps({}, False, lambda p: True, "", {"~/x": "plugin"}) == [["omarchy-buddy-update", "--git"]])

shutil.rmtree(HOME, ignore_errors=True)
done()
