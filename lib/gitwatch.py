#!/usr/bin/env python3
# Software installed with `git clone` (#224): found where software lives,
# checked in the feed's hourly network run with `git ls-remote` (nothing
# downloaded), updated in the update terminal (omarchy-buddy-update --git).
#
#   find()                  the clones to watch: {"~/path": kind}
#   clones()                those and the ones not watched for their own config:
#                           ("~/path", kind, plain)
#   switched_off()          those the settings switched off
#   watched(url, own)       the remote is someone else's public https repo
#   check(path, kind)       "new", "build" (only reported), "current",
#                           "dirty", "detached" or None (could not ask)
#   offline(path, kind, pending)  what the settings page says, no network
#   update(path, kind, ask) the one clone, after showing the diff and asking
#
# kind: "plugin" (~/.config/omarchy/plugins: `omarchy-plugin-update ID`),
# "omz" (~/.oh-my-zsh: its own upgrade script, as `omz update` runs it),
# "zsh" (oh-my-zsh's custom plugins and themes) and "git"; those two:
# fetch and `merge --ff-only`, only with a clean tree on a branch that
# follows its remote. A "git" clone with a build step is only reported.
#
# Never the user's own repos: ~/Projects, ~/orca, ~/NAS, chezmoi, the buddy
# itself, Omarchy's own clone, and every remote that is no public https
# address (ssh aliases like an own Forgejo, local paths) or belongs to the
# user's GitHub account (gh's hosts.yml). git never asks (no terminal
# prompt, ssh BatchMode), runs with a timeout and gets the remote's name,
# never its URL (it may hold a token).
#
# A folder copied or unpacked into such a place brings its own .git/config,
# which git obeys: core.fsmonitor, filters, credential helpers, insteadOf
# … would run commands at every hourly check, without the user ever opening
# the folder. So only clones whose own config holds nothing but what
# `git clone` writes are watched (plain()), git talks only https, `git
# status` stays out of submodules and the merge runs no hooks (#228).
# The settings page still names the others, as not watched (#232); nothing
# but reading their config ever runs in them.

import ipaddress
import os
import re
import shutil
import subprocess
import threading

import buddy
from texts import t

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
PLACES = [(".oh-my-zsh", "omz", False), (".config/omarchy/plugins", "plugin", True),
          (".oh-my-zsh/custom/plugins", "zsh", True), (".oh-my-zsh/custom/themes", "zsh", True),
          (".local/share", "git", True), (".local/opt", "git", True), ("", "git", True)]
# Own work, or updated by something else (Omarchy's clone by omarchy-update).
SKIP = ("Projects", "orca", "NAS", ".local/share/chezmoi", ".local/share/omarchy")
BUILD = ("Makefile", "CMakeLists.txt", "meson.build", "configure", "Cargo.toml", "package.json",
         "go.mod", "setup.py", "pyproject.toml", "build.sh", "PKGBUILD")
COUNTED = ("new", "build")
# The keys of a clone's own config that run nothing; anything else and it is not watched (#228).
PLAIN = re.compile(r"core\.(repositoryformatversion|filemode|bare|logallrefupdates|ignorecase|precomposeunicode"
                   r"|symlinks|autocrlf|eol)|remote\..+\.(url|fetch|tagopt)|branch\..+\.(remote|merge|rebase)"
                   r"|oh-my-zsh\.\w+|rebase\.autostash|((fetch|receive)\.)?fsck\.zeropaddedfilemode")  # + oh-my-zsh's upgrade.sh
TIMEOUT = 20      # seconds per network call in the feed
LS_MAX = 65536    # bytes: ls-remote asks for one ref; more is a broken or hostile server
# GIT_OPTIONAL_LOCKS=0: `git status` in the feed does not rewrite the index
# GIT_ALLOW_PROTOCOL: no ext::, file:// or ssh, whatever a config says (insteadOf, protocol.*.allow)
ENV = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_OPTIONAL_LOCKS="0", GIT_ALLOW_PROTOCOL="https",
           GIT_SSH_COMMAND=os.environ.get("GIT_SSH_COMMAND") or "ssh -oBatchMode=yes")


def tilde(path, home=None):
    home = home or buddy.HOME
    return "~" + path[len(home):] if path == home or path.startswith(home + "/") else path


def full(path, home=None):
    return (home or buddy.HOME) + path[1:] if path.startswith("~") else path


def clean(text):
    """Text for the terminal without control characters (escape sequences
    in a folder name or a commit subject could rewrite the screen or the
    clipboard)."""
    return re.sub(r"[\x00-\x09\x0b-\x1f\x7f-\x9f]", "?", text)


def name(path):
    """What the item and the page call it: "oh-my-zsh", "meviusisback.hw-monitor"."""
    return clean(os.path.basename(path.rstrip("/")).lstrip(".") or path)


def git(path, *args, timeout=10):
    """(exit code, stdout) of a git command in path; -1 when it did not run."""
    try:
        p = subprocess.run(["git", *args], cwd=path, env=ENV, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return -1, ""


def own_users(home=None):
    """The GitHub (and other gh) logins of the user, lower case, from gh's
    hosts.yml (no network)."""
    cfg = os.environ.get("GH_CONFIG_DIR") or os.path.join(
        os.environ.get("XDG_CONFIG_HOME") or os.path.join(home or buddy.HOME, ".config"), "gh")
    try:
        with open(os.path.join(cfg, "hosts.yml")) as f:
            return {u.lower() for u in re.findall(r"^\s+user:\s*['\"]?([\w.-]+)", f.read(), re.M)}
    except OSError:
        return set()


def watched(url, own=()):
    """True for https://HOST/OWNER/… on a public host whose OWNER is not one
    of `own`: software someone else publishes. ssh remotes, local paths and
    hosts in the own network belong to the user."""
    m = re.match(r"https://(?:[^@/]*@)?([^/:@]+)(?::\d+)?/([^/]+)/[^/]", url or "")
    if not m:
        return False
    host, owner = m.group(1).lower(), m.group(2).lower()
    try:
        if not ipaddress.ip_address(host).is_global:
            return False
    except ValueError:
        if "." not in host or host.endswith((".local", ".lan", ".home", ".internal", ".localdomain")):
            return False
    return owner not in own


def plain(path):
    """The clone's own config (and what it includes) sets only keys that
    `git clone` writes: nothing in it runs a command (#228)."""
    code, out = git(path, "config", "--list", "--show-scope", "--name-only")
    return code == 0 and all(PLAIN.fullmatch(key) for scope, _, key in (l.partition("\t") for l in out.splitlines())
                             if scope in ("local", "worktree"))


def skipped(path, home=None, me=ROOT):
    """A path that is never watched, whatever its remote."""
    home = home or buddy.HOME
    real = os.path.realpath(path)
    for p in (path, real):
        if p == me or p.startswith(me + "/"):
            return True
        if any(p == os.path.join(home, s) or p.startswith(os.path.join(home, s) + "/") for s in SKIP):
            return True
    return False


def mount_points(table="/proc/self/mounts"):
    try:
        with open(table) as f:
            return {re.sub(r"\\([0-7]{3})", lambda m: chr(int(m.group(1), 8)), l.split()[1]) for l in f if l.strip()}
    except (OSError, IndexError):
        return set()


def find(home=None, me=ROOT):
    """{"~/path": kind} for the git clones to watch: clones() with a plain config."""
    return {path: kind for path, kind, ok in clones(home, me) if ok}


def clones(home=None, me=ROOT):
    """("~/path", kind, plain(path)) for the git clones at the software places
    whose origin someone else publishes. Mount points are left alone before
    anything looks into them (a NAS would wake up for nothing), symlinks too
    (a linked working copy, like a plugin under development), each folder
    counts once."""
    home = home or buddy.HOME
    own, seen, mounts = own_users(home), set(), mount_points()
    for place, kind, children in PLACES:
        base = os.path.join(home, place) if place else home
        try:
            # hidden folders count only in the home folder (~/.oh-my-zsh); elsewhere they are backups
            # and the like, which omarchy-plugin-update skips too
            paths = [os.path.join(base, n) for n in sorted(os.listdir(base)) if not place or n[0] != "."] \
                if children else [base]
        except OSError:
            continue
        for path in paths:
            if path in mounts or os.path.islink(path) or skipped(path, home, me):
                continue
            real = os.path.realpath(path)
            if real in seen or real in mounts or not os.path.isdir(path) or not os.path.exists(os.path.join(path, ".git")):
                continue
            seen.add(real)
            if watched(git(path, "config", "--get", "remote.origin.url")[1], own):
                yield tilde(path, home), kind, plain(path)


def switched_off():
    """The clones switched off in the settings: "gitRepos": {"~/path": false}."""
    raw = buddy.config().get("gitRepos")
    return {p for p, v in raw.items() if v is False} if isinstance(raw, dict) else set()


def local(path, kind):
    """What the clone says without the network: HEAD, the remote and ref to
    compare with (a plugin: origin's HEAD, as omarchy-plugin-update does;
    else the branch's upstream, None without one), tracked files changed."""
    code, head = git(path, "rev-parse", "HEAD")
    if code:
        return None
    remote = ref = None
    if kind == "plugin":
        remote, ref = "origin", "HEAD"
    else:
        branch = git(path, "symbolic-ref", "-q", "--short", "HEAD")[1]
        if branch:
            remote = git(path, "config", "--get", f"branch.{branch}.remote")[1] or None
            ref = git(path, "config", "--get", f"branch.{branch}.merge")[1] or None
            if remote == "." or not (ref or "").startswith("refs/heads/"):
                remote = ref = None
    dirty = git(path, "status", "--porcelain", "--untracked-files=no", "--ignore-submodules=all")
    return {"head": head, "remote": remote, "ref": ref, "dirty": dirty[0] != 0 or dirty[1] != ""}


def remote_sha(path, remote, ref, timeout=TIMEOUT):
    """The commit `ref` points to on `remote` (git ls-remote: refs only, no
    download), None when it could not be asked. Killed after `timeout`
    seconds or LS_MAX bytes."""
    try:
        p = subprocess.Popen(["git", "ls-remote", "--", remote, ref], cwd=path, env=ENV,
                             stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    except OSError:
        return None
    timer = threading.Timer(timeout, p.kill)
    timer.start()
    try:
        out = p.stdout.read(LS_MAX + 1)
        if len(out) > LS_MAX:
            p.kill()
        code = p.wait()
    finally:
        timer.cancel()
        p.stdout.close()
    if code or len(out) > LS_MAX:
        return None
    for line in out.decode("utf-8", "replace").splitlines():
        sha, _, got = line.partition("\t")
        if got == ref and re.fullmatch(r"[0-9a-f]{40}([0-9a-f]{24})?", sha):
            return sha
    return None


def build_step(path):
    """The first file that says the clone is built before it is used."""
    return next((f for f in BUILD if os.path.exists(os.path.join(path, f))), "")


def verdict(kind, remote, head, ancestor, dirty, follows, build):
    """The rule: remote is the remote's commit (None: unknown), ancestor
    whether it is HEAD or behind it (own commits on top). Only a clean
    clone that follows its remote is updated, one with a build step only
    reported."""
    if remote is None:
        return None
    if remote == head or ancestor:
        return "current"
    if dirty:
        return "dirty"
    if not follows:
        return "detached"
    return "build" if kind == "git" and build else "new"


def check(path, kind, timeout=TIMEOUT):
    """verdict() for one clone (path in full); None when offline or gone."""
    loc = local(path, kind)
    if not loc:
        return None
    if not loc["remote"]:
        return verdict(kind, "", loc["head"], False, loc["dirty"], False, "")
    sha = remote_sha(path, loc["remote"], loc["ref"], timeout)
    ancestor = sha is not None and git(path, "merge-base", "--is-ancestor", sha, "HEAD")[0] == 0
    return verdict(kind, sha, loc["head"], ancestor, loc["dirty"], True, build_step(path))


def offline(path, kind, pending):
    """What the settings page says about one clone (path in full), without the
    network (#225): "dirty" or "detached" (never updated), "build" when the
    feed found a new version (`pending`) the user updates by hand, else "".
    Unlike check(), changes count even while the clone is current."""
    loc = local(path, kind)
    if not loc:
        return ""
    if loc["dirty"]:
        return "dirty"
    if not loc["remote"]:
        return "detached"
    return "build" if pending and kind == "git" and build_step(path) else ""


def confirm(question):
    """Yes or no in the terminal, with gum as Omarchy asks (else a plain line)."""
    if shutil.which("gum"):
        return subprocess.run(["gum", "confirm", question, "--affirmative", t("setup.yes"),
                               "--negative", t("setup.no")]).returncode == 0
    try:
        answer = input(f"{question} [{t('setup.yes')[0]}/{t('setup.no')[0].lower()}] ").strip().lower()
    except EOFError:
        return False
    return answer[:1] in ("", "j", "y")


def update(path, kind, ask=confirm):
    """Brings one clone (path as "~/…") up to date in the terminal: shows
    what changed and asks first. 0 also when it was left alone on purpose."""
    where = full(path)
    print("\n\033[1m" + t("git.head", name=name(path), path=clean(path)) + "\033[0m", flush=True)
    loc = local(where, kind) if os.path.isdir(where) else None
    if not loc:
        print(t("git.gone"))
        return 0
    if loc["dirty"]:
        print(t("git.dirty"))
        return 0
    if kind == "plugin":  # shows the diff and asks itself, checks the plugin afterwards
        return subprocess.call(["omarchy-plugin-update", os.path.basename(where)], env=ENV)
    if not loc["remote"]:
        print(t("git.detached"))
        return 0
    build = kind == "git" and build_step(where)
    if build:
        print(t("git.build", name=name(path), file=build))
        return 0
    code, _ = git(where, "fetch", "--quiet", "--no-tags", "--", loc["remote"], loc["ref"], timeout=300)
    if code:
        print(t("git.fetchFailed"))
        return 1
    if git(where, "merge-base", "--is-ancestor", "FETCH_HEAD", "HEAD")[0] == 0:
        print(t("git.current"))
        return 0
    if git(where, "merge-base", "--is-ancestor", "HEAD", "FETCH_HEAD")[0] != 0:  # own commits: no fast-forward
        print(t("git.notFastForward"))
        return 1
    print(clean(git(where, "log", "--oneline", "--no-decorate", "HEAD..FETCH_HEAD")[1]), flush=True)
    subprocess.call(["git", "diff", "HEAD", "FETCH_HEAD"], cwd=where, env=ENV)
    if not ask(t("git.ask", name=name(path))):
        print(t("git.skipped"))
        return 0
    if kind == "omz":  # what `omz update` runs (it then restarts zsh, which would keep this terminal)
        cmd = ["zsh", "-f", os.path.join(where, "tools/upgrade.sh"), "-i", "-v", "default", "-c", "0"]
        return subprocess.call(cmd, cwd=where, env=dict(ENV, ZSH=where))
    code = subprocess.call(["git", "-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--quiet", "FETCH_HEAD"],
                           cwd=where, env=ENV)
    print(t("git.done") if code == 0 else t("git.failed"))
    return code
