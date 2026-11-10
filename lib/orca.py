#!/usr/bin/env python3
# Orca (github.com/stablyai/orca), when its official AppImage is extracted to
# ~/.local/opt/orca (no package manager knows it). Only read: a new release
# is a news item with a link (omarchy-buddy-feed), the buddy never downloads
# or runs Orca (#258).
#
#   version(root)        the installed version, from resources/app.asar

import json
import os
import re
import struct

import buddy

DIR = os.path.join(buddy.HOME, ".local/opt/orca")
REPO = "stablyai/orca"


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
