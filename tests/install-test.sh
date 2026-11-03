#!/usr/bin/env bash
# install.sh in a throwaway repo and HOME: the stable clone, a worktree tried
# live and switched back, red tests and uncommitted changes refused, the
# shell restarted once per switch. The setup, tests/run, omarchy and pgrep
# there are stand-ins; the real repo and the real shell are not touched.
set -euo pipefail
src=$(cd "$(dirname "$0")/.." && pwd)
box=$(mktemp -d "${TMPDIR:-/tmp}/omarchy-buddy-install-test-XXXXXX")
trap 'rm -rf "$box"' EXIT
export HOME=$box/home XDG_DATA_HOME=$box/home/.local/share
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t GIT_CONFIG_GLOBAL=/dev/null
repo=$box/repo stable=$XDG_DATA_HOME/omarchy-buddy-stable live=$box/home/.config/omarchy/plugins/io.github.destrukt1v.omarchy-buddy
fails=0
check() { if [[ $2 == "$3" ]]; then echo "ok   $1"; else echo "FAIL $1: '$2' statt '$3'"; fails=1; fi; }

mkdir -p "$repo/bin" "$repo/tests" "$HOME" "$box/bin"
cp "$src/install.sh" "$repo/"
# The "shell" is a number in shell-pid; a restart gives it a new one.
printf '#!/bin/sh\necho "$0" > "$HOME/setup-ran"\n[ -z "$SETUP_RESTARTS" ] || echo setup > "$HOME/shell-pid"\n' > "$repo/bin/omarchy-buddy-setup"
printf '#!/bin/sh\nexit "${TESTS_FAIL:-0}"\n' > "$repo/tests/run"
printf '#!/bin/sh\necho "$*" >> "$HOME/omarchy-calls"; echo "$$" > "$HOME/shell-pid"\n' > "$box/bin/omarchy"
printf '#!/bin/sh\ncat "$HOME/shell-pid" 2>/dev/null\n' > "$box/bin/pgrep"
chmod +x "$repo/bin/omarchy-buddy-setup" "$repo/tests/run" "$box/bin/omarchy" "$box/bin/pgrep"
export PATH=$box/bin:$PATH
restarts() { wc -l < "$HOME/omarchy-calls" 2>/dev/null || echo 0; }
git -C "$repo" init -q -b main && git -C "$repo" add -A && git -C "$repo" commit -qm eins
first=$(git -C "$repo" rev-parse HEAD)

mkdir -p "$HOME/.config/omarchy/plugins" && ln -s "$repo" "$HOME/.config/omarchy/plugins/omarchy-buddy"
"$repo/install.sh" >/dev/null
check "ohne stabilen Klon: Hauptcheckout live" "$(readlink "$live")" "$repo"
check "Link mit der ID vor 1.2.0 weg (#209)" "$(ls "$HOME/.config/omarchy/plugins")" "io.github.destrukt1v.omarchy-buddy"

"$repo/install.sh" --stable >/dev/null
check "--stable: Klon live" "$(readlink "$live")" "$stable"
check "--stable: Setup aus dem Klon" "$(cat "$HOME/setup-ran")" "$stable/bin/omarchy-buddy-setup"
check "--stable: Klon auf main" "$(git -C "$stable" rev-parse HEAD)" "$first"
check "--stable: Shell neu gestartet" "$(tail -1 "$HOME/omarchy-calls")" "restart shell"
before=$(restarts)
SETUP_RESTARTS=1 "$repo/install.sh" >/dev/null
check "kein zweiter Neustart nach dem des Setups" "$(restarts)" "$before"

git -C "$repo" commit -q --allow-empty -m zwei
"$repo/install.sh" >/dev/null
check "Merge allein geht nicht live" "$(git -C "$stable" rev-parse HEAD)" "$first"
check "Hauptcheckout schaltet auf den Klon" "$(readlink "$live")" "$stable"

git -C "$repo" worktree add -q "$box/wt" -b karte
"$box/wt/install.sh" >/dev/null
check "Worktree live testen" "$(readlink "$live")" "$box/wt"
check "--stable im Worktree abgelehnt" "$("$box/wt/install.sh" --stable 2>/dev/null; echo $?)" 1
"$repo/install.sh" >/dev/null
check "zurück auf den Klon" "$(readlink "$live")" "$stable"

check "rote Tests abgelehnt" "$(TESTS_FAIL=1 "$repo/install.sh" --stable 2>/dev/null; echo $?)" 1
check "rote Tests: Klon bleibt" "$(git -C "$stable" rev-parse HEAD)" "$first"
touch "$repo/neu"
check "nicht committet abgelehnt" "$("$repo/install.sh" --stable 2>/dev/null; echo $?)" 1
rm "$repo/neu"

"$repo/install.sh" --stable >/dev/null
check "--stable zieht nach" "$(git -C "$stable" rev-parse HEAD)" "$(git -C "$repo" rev-parse main)"
check "--status nennt den Stand" "$("$repo/install.sh" --status | tail -1 | cut -d" " -f2)" "$(git -C "$stable" rev-parse --short HEAD)"
exit $fails
