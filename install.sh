#!/usr/bin/env bash
# For a git checkout (development): link a checkout as the plugin, then let
# bin/omarchy-buddy-setup do the rest (scripts, hooks, Omarchy settings,
# timer, shell restart). Installed users take `omarchy plugin add` instead,
# see README.md.
#
# Live runs a stable clone of main (~/.local/share/omarchy-buddy-stable), not
# the main checkout, so a merge is not live until it is pulled on purpose.
#
#   ./install.sh            in a worktree: try that worktree live;
#                           in the main checkout: back to the stable clone
#                           (the main checkout itself while there is none)
#   ./install.sh --stable   main checkout, on main, committed: tests/run, then
#                           the stable clone pulls main (made the first time)
#                           and goes live
#   ./install.sh --status   show where the links currently point
#
# Each switch ends with a full shell restart: Omarchy's hot reload of a
# changed plugin keeps running the old QML from its component cache (#171).
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
plugins="$HOME/.config/omarchy/plugins"
link=$plugins/io.github.destrukt1v.omarchy-buddy  # the plugin's id (#209)
stable="${XDG_DATA_HOME:-$HOME/.local/share}/omarchy-buddy-stable"
common=$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
main_checkout=false
[[ -n $common && $common == "$(git -C "$here" rev-parse --absolute-git-dir)" ]] && main_checkout=true

if [[ ${1-} == --status ]]; then
  for l in "$link" "$HOME"/.local/bin/omarchy-buddy-* \
              "$HOME/.config/omarchy/hooks/post-update.d/omarchy-buddy-check" \
              "$HOME/.config/omarchy/hooks/battery-low.d/omarchy-buddy"; do
    printf '%-64s → %s\n' "$l" "$(readlink "$l" || echo '(keine Verknüpfung)')"
  done
  printf 'stabil: %s, main: %s\n' "$(git -C "$stable" log -1 --format='%h %s' 2>/dev/null || echo '(noch keiner)')" \
    "$(git -C "$here" log -1 --format='%h %s' main 2>/dev/null || echo '?')"
  exit 0
fi

target=$here
if [[ ${1-} == --stable ]]; then
  if ! $main_checkout || [[ $(git -C "$here" branch --show-current) != main ]]; then
    echo "--stable nur im Hauptcheckout auf main." >&2; exit 1
  fi
  if [[ -n $(git -C "$here" status --porcelain) ]]; then
    echo "Der Hauptcheckout hat Änderungen, die nicht committet sind – erst committen." >&2; exit 1
  fi
  if ! "$here/tests/run"; then
    echo "Tests rot – die stabile Installation bleibt, wo sie ist." >&2; exit 1
  fi
  if [[ -d $stable/.git ]]; then
    git -C "$stable" pull -q --ff-only origin main
  else
    git clone -q --branch main "$common" "$stable"
  fi
  target=$stable
elif $main_checkout && [[ -d $stable/.git ]]; then
  target=$stable
fi
[[ $target == "$stable" ]] && echo "Stabile Installation: $(git -C "$stable" log -1 --format='%h %s')"

mkdir -p "$plugins"
if [[ -e $link && ! -L $link ]]; then
  echo "$link ist ein installiertes Plugin (omarchy plugin add) – erst entfernen." >&2
  exit 1
fi
ln -sfn "$target" "$link"
# the link by the id before 1.2.0 would load the plugin a second time
[[ -L $plugins/omarchy-buddy ]] && rm "$plugins/omarchy-buddy"
shell=$(pgrep -nx quickshell || true)
"$target/bin/omarchy-buddy-setup" --yes  # (the developer asked for it: no question, #208)
# (the setup restarts the shell only when it changed something)
if [[ $(pgrep -nx quickshell || true) == "$shell" ]]; then
  omarchy restart shell && echo "Shell neu gestartet."
fi
