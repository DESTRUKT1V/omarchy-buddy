#!/usr/bin/env python3
# Orca (github.com/stablyai/orca) as an update source, when its official
# AppImage is extracted to ~/.local/opt/orca (no package manager knows it).
#
#   version(root)        the installed version, from resources/app.asar
#   release(text)        version, file and sha512 from latest-linux.yml
#   running(root)        whether a program from root runs
#   install(root)        the newest AppImage extracted in place of root
#                        (omarchy-buddy-update --orca)

import base64
import hashlib
import json
import os
import platform
import re
import shutil
import struct
import subprocess
import tempfile

import buddy
from texts import t

DIR = os.path.join(buddy.HOME, ".local/opt/orca")
REPO = "stablyai/orca"
RELEASES = f"https://github.com/{REPO}/releases"
MAX_IMAGE = 2**30  # bytes: Orca's AppImage is ~200 MB; more is no Orca (and would fill the disk)


def version(root=DIR):
    """The "version" of the package.json inside root/resources/app.asar,
    None when there is none. An asar starts with four uint32 (4, header
    size, two pickle lengths) and the JSON index of its files, which follow
    from 8 + header size on; package.json sits ~7 MB in (#223)."""
    try:
        with open(os.path.join(root, "resources/app.asar"), "rb") as f:
            _, size, _, n = struct.unpack("<4I", f.read(16))
            entry = json.loads(f.read(n))["files"]["package.json"]
            f.seek(8 + size + int(entry["offset"]))
            v = json.loads(f.read(int(entry["size"])))["version"]
            return v if isinstance(v, str) and re.fullmatch(r"\d+(\.\d+)*", v) else None
    except (OSError, ValueError, KeyError, TypeError, struct.error):
        return None


def newer(a, b):
    """Version a is newer than b."""
    return [int(x) for x in a.split(".")] > [int(x) for x in b.split(".")]


def latest_url(base=RELEASES):
    arch = "-arm64" if platform.machine() in ("aarch64", "arm64") else ""
    return f"{base}/latest/download/latest-linux{arch}.yml"


def release(text):
    """(version, AppImage file name, sha512 in base64) from the top level of
    electron-builder's latest-linux.yml; ValueError when they are not there
    or look wrong (the name goes into a URL and a path)."""
    top = {}
    for line in text.splitlines():
        m = re.match(r"(\w+):\s*(.*)$", line)
        if m:
            top[m.group(1)] = m.group(2).strip().strip("'\"")
    v, name, sha = top.get("version", ""), top.get("path", ""), top.get("sha512", "")
    if not (re.fullmatch(r"\d+(\.\d+)*", v) and re.fullmatch(r"[\w.-]+\.AppImage", name)
            and re.fullmatch(r"[A-Za-z0-9+/]{86}==", sha)):
        raise ValueError("latest-linux.yml: no version, AppImage or sha512")
    return v, name, sha


def running(root=DIR, proc="/proc"):
    """A process runs a program from root (Orca's window, its zygotes, its
    terminal host …): replacing the folder under it would break it."""
    for pid in os.listdir(proc):
        try:
            if pid.isdigit() and os.readlink(os.path.join(proc, pid, "exe")).startswith(root + "/"):
                return True
        except OSError:
            pass
    return False


def _open(url, timeout):
    return buddy.urlopen(url, timeout, "omarchy-buddy-update")


def install(root=DIR, base=RELEASES, proc="/proc"):
    """Downloads the newest AppImage, checks its SHA512 against
    latest-linux.yml, extracts it (--appimage-extract, no FUSE needed) next
    to root and swaps the folders; the old one goes only after that worked.
    Paths stay the same, so ~/.local/bin/orca-ide (→ resources/bin/orca-ide)
    and the .desktop file (→ orca-ide) keep working. 0: done or current."""
    have = version(root)
    if not have:
        print(t("updates.orca.missing", path=root))
        return 1
    if running(root, proc):
        print(t("updates.orca.running"))
        return 1
    work = None
    try:
        with _open(latest_url(base), 30) as r:
            new, name, sha = release(r.read(65536).decode("utf-8", "replace"))
        if not newer(new, have):
            print(t("updates.orca.current", version=have))
            return 0
        work = tempfile.mkdtemp(prefix=".orca-update-", dir=os.path.dirname(root))  # same disk: rename works
        image = os.path.join(work, name)
        digest = hashlib.sha512()
        with _open(f"{base}/download/v{new}/{name}", 60) as r, open(image, "wb") as f:
            total, got = int(r.headers.get("Content-Length") or 0), 0
            print(t("updates.orca.download", version=new, mb=total // 2**20), flush=True)
            while chunk := r.read(2**20):
                digest.update(chunk)
                f.write(chunk)
                got += len(chunk)
                if got > MAX_IMAGE:
                    raise ValueError(f"{name} larger than {MAX_IMAGE // 2**20} MB")
                if total:
                    print(f"\r{got * 100 // total} %", end="", flush=True)
        print()
        if base64.b64encode(digest.digest()).decode() != sha:
            print(t("updates.orca.badsum"))
            return 1
        os.chmod(image, 0o755)
        subprocess.run([image, "--appimage-extract"], cwd=work, check=True, stdout=subprocess.DEVNULL)
        fresh = os.path.join(work, "squashfs-root")
        if version(fresh) != new or not all(os.path.isfile(os.path.join(fresh, p)) for p in ("orca-ide", "resources/bin/orca-ide")):
            raise ValueError("the AppImage holds no Orca " + new)
        for d, dirs, files in os.walk(fresh):  # the AppImage's files come out writable for everyone (0777)
            for p in [d] + [os.path.join(d, n) for n in dirs + files]:
                if not os.path.islink(p):
                    os.chmod(p, os.stat(p).st_mode & ~0o022)
        if running(root, proc):  # started during the download
            print(t("updates.orca.running"))
            return 1
        old = os.path.join(work, "old")
        os.rename(root, old)
        try:
            os.rename(fresh, root)
        except OSError:
            os.rename(old, root)
            raise
        print(t("updates.orca.done", version=new))
        return 0
    except (OSError, ValueError, subprocess.CalledProcessError) as e:
        print(t("updates.orca.failed", error=e))
        return 1
    finally:
        if work:
            shutil.rmtree(work, ignore_errors=True)
