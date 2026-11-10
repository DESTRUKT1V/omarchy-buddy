#!/usr/bin/env python3
# Which updates are waiting on Omarchy/Arch, from whatever tools are
# installed, and the steps that install them (bin/omarchy-buddy-update).
# Every check only reads: no root, no `pacman -Sy`. omarchy-buddy-feed runs
# them every 12 hours.
#
#   SOURCES       name → (program, command, exit codes that mean "worked")
#   count(name, code, out)   how many updates the output names, None: failed
#   summary(counts, omarchy, git)      the parts of the one news item, in order
#   steps(counts, omarchy, have, git)  the commands that update, in order
#
# git: the git clones with a new version, {"~/path": kind} (lib/gitwatch.py).
# Orca is no step: a new Orca is only a news item with a link (#258).
#
# Pure functions apart from the table, so tests/feed-test.py feeds them
# recorded output.

import json

SOURCES = {
    # checkupdates syncs a copy of the databases in /tmp, never the real ones;
    # 2 means "nothing to do". Omarchy itself is the omarchy package in it.
    "pacman": ("checkupdates", ["checkupdates", "--nocolor"], (0, 2)),
    "yay": ("yay", ["yay", "-Qua"], (0, 1)),
    "paru": ("paru", ["paru", "-Qua"], (0, 1)),
    "mise": ("mise", ["mise", "outdated", "--json"], (0,)),
    "npm": ("npm", ["npm", "outdated", "-g", "--json"], (0, 1)),
    "pnpm": ("pnpm", ["pnpm", "outdated", "-g", "--format", "json"], (0, 1)),
    "flatpak": ("flatpak", ["flatpak", "remote-ls", "--updates", "--columns=application"], (0,)),
    "rustup": ("rustup", ["rustup", "check"], (0, 100)),
}
OMARCHY_PACKAGES = ("omarchy", "omarchy-dev")
# Summary parts in this order; pacman and the AUR count together.
GIT_STEP = ["omarchy-buddy-update", "--git"]
GIT_GROUPS = [("plugins", ("plugin",)), ("omz", ("omz",)), ("git", ("zsh", "git"))]
GROUPS = [("packages", ("pacman", "yay", "paru")), ("flatpak", ("flatpak",)), ("mise", ("mise",)),
          ("npm", ("npm",)), ("pnpm", ("pnpm",)), ("rustup", ("rustup",))]


def arrow_lines(out):
    """pacman/yay/paru: "name 1.0-1 -> 1.1-1" per update."""
    return [l.split()[0] for l in out.splitlines() if "->" in l and l.split()[0] != "->"]


def json_dict(out):
    data = json.loads(out or "{}")
    if not isinstance(data, dict) or "error" in data:
        raise ValueError("no list")
    return data


def count(name, code, out):
    """Updates in the output of SOURCES[name], or None when the check failed."""
    if code not in SOURCES[name][2]:
        return None
    lines = [l for l in out.splitlines() if l.strip()]
    try:
        if name == "pacman":
            return len([n for n in arrow_lines(out) if n not in OMARCHY_PACKAGES])
        if name in ("yay", "paru"):
            return len(arrow_lines(out))
        if name == "mise":
            # Omarchy's lazy tools (/etc/mise/conf.d) are listed with "current": null until first use
            return len([v for v in json_dict(out).values() if isinstance(v, dict) and v.get("current")])
        if name in ("npm", "pnpm"):
            return len(json_dict(out))
        if name == "flatpak":
            return len(lines)
        if name == "rustup":
            if not any(" - " in l for l in lines):
                return None
            return len([l for l in lines if "Update available" in l])
    except ValueError:
        return None
    return None


def omarchy_ready(code, out):
    """The pacman output names a new Omarchy."""
    return code == 0 and any(n in OMARCHY_PACKAGES for n in arrow_lines(out))


def summary(counts, omarchy, git=None):
    """[("omarchy", 1), ("packages", 12), ("mise", 3), …,
    ("plugins", 2), ("omz", 1)]: what the news item names, only what has updates."""
    parts = [("omarchy", 1)] if omarchy else []
    for group, names in GROUPS:
        n = sum(counts.get(s) or 0 for s in names)
        if n:
            parts.append((group, n))
    for group, kinds in GIT_GROUPS:
        n = sum(1 for k in (git or {}).values() if k in kinds)
        if n:
            parts.append((group, n))
    return parts


def steps(counts, omarchy, have, git=None):
    """The commands that install the updates, in order. have(program) says
    whether it is installed. On Omarchy `omarchy-update` comes last
    (#122): it covers pacman and the AUR (with its snapshot and migrations)
    and may end with "restart now?", which would cut off anything after it."""
    todo = lambda s: (counts.get(s) or 0) > 0
    out = []
    on_omarchy = have("omarchy-update")
    if not on_omarchy:
        if todo("pacman"):
            out.append(["sudo", "pacman", "-Syu"])
        for aur in ("yay", "paru"):
            if todo(aur):
                out.append([aur, "-Sua"])
    if todo("mise"):
        out.append(["mise", "upgrade"])
    if todo("flatpak"):
        out.append(["flatpak", "update"])
    if todo("npm"):
        out.append(["npm", "update", "-g"])
    if todo("pnpm"):
        out.append(["pnpm", "update", "-g"])
    if todo("rustup"):
        out.append(["rustup", "update"])
    if git:
        out.append(GIT_STEP)
    if on_omarchy and (omarchy or todo("pacman") or todo("yay") or todo("paru")):
        out.append(["omarchy-update"])
    return out
