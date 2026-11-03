# What the Python tests (tests/*-test.py) share: check() prints and counts,
# done() ends the run, sandbox_env() puts HOME and every XDG folder in one place.
import os
import sys

fails = 0


def check(name, ok, detail=None):
    global fails
    print(("ok   " if ok else "FAIL ") + name + ("" if ok or detail is None else f": {detail}"))
    fails += not ok


def done():
    print("FEHLER:", fails if fails else "keine")
    sys.exit(1 if fails else 0)


def sandbox_env(home, **extra):
    """os.environ with HOME and every XDG folder in home, the texts in German."""
    return dict(os.environ, HOME=home, XDG_CONFIG_HOME=os.path.join(home, ".config"),
                XDG_DATA_HOME=os.path.join(home, ".local/share"), XDG_STATE_HOME=os.path.join(home, ".local/state"),
                XDG_CACHE_HOME=os.path.join(home, ".cache"), XDG_RUNTIME_DIR=os.path.join(home, "run"),
                LC_ALL="", LC_MESSAGES="", LANG="de_DE.UTF-8") | extra
