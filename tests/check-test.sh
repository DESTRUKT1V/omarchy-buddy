#!/usr/bin/env bash
# omarchy-buddy-check in a sandbox HOME (B24, B41), with stand-ins instead
# of the real commands: nothing real changes, no notification goes out.
#   1. Rückfall: the shell answers, but nobody holds the notification bus →
#      omarchy-buddy-setup --remove: shell.json and settings.json as before
#      the setup (rights kept, backups), our links gone, a restart and a
#      critical notification with the reason and the way back.
#   2. --remove fails (broken settings.json): shell.json still goes back
#      (Omarchy's plugin on, ours out), the notification says the hooks stay.
#   3. The shell does not answer: nothing is touched.
#   4. --rueckfall (the feed, every 15 min): the same Rückfall; while the bus
#      is held or no shell runs it writes nothing, not even the log.
#   5. Live test failed after an update only while something real was on the
#      island (tests/live exit 3, a stand-in): no news item, check.gestoert counts; --rueckfall
#      runs it again (in the background); ok → the file goes; the third
#      disturbed run reports; a real failure and a run by hand report at once.
# `sleep` is a stand-in too, so the waiting loops take no time.
# Aufruf: tests/check-test.sh
set -uo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
sb=$(mktemp -d)
trap 'rm -rf "$sb"' EXIT
fails=0
check() {  # name, then the test command
  local name=$1; shift
  if "$@"; then echo "ok   $name"; else echo "FAIL $name"; fails=$((fails + 1)); fi
}

sandbox() {  # $1: what "omarchy-shell shell ping" answers, $2=kaputt: settings.json breaks after the setup,
            # $3: what busctl exits with (1: nobody holds the bus), $4: argument for omarchy-buddy-check,
            # $5: what tests/live exits with (then the check runs from a copy with a stand-in);
            # $gestoert: check.gestoert before the run, $extra_env: one more VAR=value
  rm -rf "$sb/home" "$sb/omarchy" "$sb/run" "$sb/aufrufe" "$sb/repo"
  stub=$sb/omarchy/bin
  mkdir -p "$sb/home/.config/omarchy" "$sb/home/.claude" "$stub" "$sb/run/quickshell/by-id/x"
  printf '{"version":1,"disabledPlugins":["x.y"],"plugins":[{"id":"other"}]}\n' >"$sb/home/.config/omarchy/shell.json"
  printf '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"mine"}]}]}}\n' >"$sb/home/.claude/settings.json"
  chmod 644 "$sb/home/.config/omarchy/shell.json"
  printf '  WARN qmlscanner: omarchy-buddy egal\n  WARN scene: omarchy-buddy/Buddy.qml:3: Type Island unavailable\n' \
    >"$sb/run/quickshell/by-id/x/log.log"
  printf '#!/bin/sh\nexit %s\n' "${3:-1}" >"$stub/busctl"
  printf '#!/bin/sh\nexit 0\n' >"$stub/sleep"
  printf '#!/bin/sh\nexit 0\n' >"$stub/node"  # the contract tests pass
  printf '#!/bin/sh\necho %s\n' "$1" >"$stub/omarchy-shell"
  for c in omarchy omarchy-restart-shell notify-send systemctl setsid; do
    printf '#!/bin/sh\necho "%s $*" >>%s/aufrufe\n' "$c" "$sb" >"$stub/$c"
  done
  chmod +x "$stub"/*
  local env=(HOME=$sb/home XDG_STATE_HOME=$sb/home/.local/state XDG_CONFIG_HOME=$sb/home/.config
             XDG_RUNTIME_DIR=$sb/run OMARCHY_PATH=$sb/omarchy LC_ALL= LC_MESSAGES= LANG=de_DE.UTF-8)
  # Set up first; omarchy-buddy-check puts $OMARCHY_PATH/bin (the stand-ins) in its PATH.
  env "${env[@]}" PATH=$stub:$PATH "$repo/bin/omarchy-buddy-setup" --files-only </dev/null >/dev/null
  cp -p "$sb/home/.config/omarchy/shell.json" "$sb/eingerichtet.json"
  : >"$sb/aufrufe"
  [[ ${2-} == kaputt ]] && printf '{kaputt' >"$sb/home/.claude/settings.json"
  local check=$repo/bin/omarchy-buddy-check
  if [[ -n ${5-} ]]; then
    mkdir -p "$sb/repo/tests"
    cp -r "$repo/bin" "$repo/lib" "$sb/repo/"
    printf '#!/bin/sh\necho "live $*" >>%s/aufrufe\necho "✗ Pop-ups: weg (dabei: ein echtes Pop-up)"\necho "3 ok, 1 Fehler, 0 übersprungen"\nexit %s\n' \
      "$sb" "$5" >"$sb/repo/tests/live"
    chmod +x "$sb/repo/tests/live"
    check=$sb/repo/bin/omarchy-buddy-check
  fi
  mkdir -p "$sb/home/.local/state/omarchy-buddy" "$sb/home/.config/omarchy-buddy"
  echo '{"updateCheck": true}' >"$sb/home/.config/omarchy-buddy/config.json"
  [[ -n ${gestoert-} ]] && echo "$gestoert" >"$sb/home/.local/state/omarchy-buddy/check.gestoert"
  env "${env[@]}" ${extra_env:+"$extra_env"} timeout 60 "$check" ${4:+"$4"}
  echo $? >"$sb/exit"
}

json=$sb/home/.config/omarchy/shell.json
calls() { cat "$sb/aufrufe" 2>/dev/null; }

# 1. Rückfall
sandbox ok
check "Rückfall: Exit 0" test "$(cat "$sb/exit")" = 0
check "Rückfall: shell.json wie vor dem Einrichten" \
  test "$(jq -c . "$json")" = '{"version":1,"disabledPlugins":["x.y"],"plugins":[{"id":"other"}]}'
check "Rückfall: shell.json behält ihre Rechte (B41)" test "$(stat -c %a "$json")" = 644
check "Rückfall: Sicherung der eingerichteten shell.json" \
  cmp -s "$(ls -t "$json".bak-omarchy-buddy-* | head -1)" "$sb/eingerichtet.json"
check "Rückfall: Claude-Hooks raus, eigene bleiben" \
  test "$(jq -c . "$sb/home/.claude/settings.json")" = '{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"mine"}]}]}}'
check "Rückfall: unsere Links weg" test ! -e "$sb/home/.local/bin/omarchy-buddy-hook" -a \
  ! -e "$sb/home/.config/omarchy/hooks/post-update.d/omarchy-buddy-check"
check "Rückfall: Timer aus" grep -q '^systemctl --user disable --now omarchy-buddy-feed.timer' <(calls)
check "Rückfall: Shell neu gestartet" grep -qx 'omarchy restart shell' <(calls)
check "Rückfall: kritische Meldung mit Grund und Weg zurück" \
  grep -q "^notify-send -u critical -a Omarchy-Buddy .*Type Island unavailable.*$repo/bin/omarchy-buddy-setup" <(calls)
check "Rückfall: Grund im check.log" grep -q '^Reason: .*Type Island unavailable' "$sb/home/.local/state/omarchy-buddy/check.log"

# 2. --remove fails
sandbox ok kaputt
check "Rückfall ohne --remove: Exit 0" test "$(cat "$sb/exit")" = 0
check "Rückfall ohne --remove: Omarchys Plugin an, unseres raus" \
  test "$(jq -c '[.disabledPlugins, [.plugins[].id]]' "$json")" = '[["x.y"],["other"]]'
check "Rückfall ohne --remove: Rechte und Sicherung" test "$(stat -c %a "$json")" = 644 -a \
  -n "$(ls "$sb/home/.config/omarchy/" | grep '^shell.json.before-fallback-')"
check "Rückfall ohne --remove: Shell neu gestartet" grep -qx 'omarchy-restart-shell ' <(calls)
check "Rückfall ohne --remove: Meldung sagt, dass die Hooks noch drin sind" \
  grep -q '^notify-send -u critical .*Hooks von Claude und Codex sind noch drin.*Type Island unavailable' <(calls)

# 3. No shell: nothing changes.
sandbox ""
check "ohne Shell: Exit 0" test "$(cat "$sb/exit")" = 0
check "ohne Shell: shell.json unverändert" cmp -s "$json" "$sb/eingerichtet.json"
check "ohne Shell: kein Neustart, keine Meldung" test -z "$(calls)"

# 4. Every 15 minutes from the feed
sandbox ok "" 1 --rueckfall
check "--rueckfall ohne Bus: Exit 0" test "$(cat "$sb/exit")" = 0
check "--rueckfall ohne Bus: Rückfall wie nach dem Update" \
  test "$(jq -c . "$json")" = '{"version":1,"disabledPlugins":["x.y"],"plugins":[{"id":"other"}]}'
check "--rueckfall ohne Bus: kritische Meldung" grep -q '^notify-send -u critical -a Omarchy-Buddy ' <(calls)
for what in "Bus gehalten" "ohne Shell"; do
  if [[ $what == "Bus gehalten" ]]; then sandbox ok "" 0 --rueckfall; else sandbox "" "" 1 --rueckfall; fi
  check "--rueckfall, $what: Exit 0" test "$(cat "$sb/exit")" = 0
  check "--rueckfall, $what: nichts geändert, kein Aufruf" test -z "$(calls)" -a "$(jq -c . "$json")" = "$(jq -c . "$sb/eingerichtet.json")"
  check "--rueckfall, $what: kein check.log" test ! -e "$sb/home/.local/state/omarchy-buddy/check.log"
done

# 5. Live test disturbed by something real
state=$sb/home/.local/state/omarchy-buddy
news() { jq -r '.[] | "\(.level) \(.title) \(.body)"' "$state/news.json" 2>/dev/null; }
gestoert= sandbox ok "" 0 --nach-update 3
check "gestört: Exit 0" test "$(cat "$sb/exit")" = 0
check "gestört: Live-Test mit --warten gelaufen" grep -qx 'live --warten' <(calls)
check "gestört: keine Meldung" test -z "$(news)"
check "gestört: Merkdatei zählt 1" test "$(cat "$state/check.gestoert" 2>/dev/null)" = 1
gestoert=1 sandbox ok "" 0 --nach-update 3
check "zweimal gestört: keine Meldung, Merkdatei zählt 2" test -z "$(news)" -a "$(cat "$state/check.gestoert" 2>/dev/null)" = 2
gestoert=2 sandbox ok "" 0 --nach-update 3
check "dreimal gestört: Fehlermeldung mit Hinweis auf die Störung" \
  grep -q '^error Update-Check: etwas hakt Pop-ups (dreimal hintereinander gestört' <(news)
check "dreimal gestört: Merkdatei weg" test ! -e "$state/check.gestoert"
gestoert= sandbox ok "" 0 --nach-update 1
check "echter Fehler: Meldung sofort" grep -q '^error Update-Check: etwas hakt Pop-ups\.' <(news)
check "echter Fehler: keine Merkdatei" test ! -e "$state/check.gestoert"
gestoert=1 sandbox ok "" 0 --rueckfall 0
check "--rueckfall mit Merkdatei: startet die Prüfung im Hintergrund" \
  grep -q "^setsid -f .*/omarchy-buddy-check --rueckfall" <(calls)
check "--rueckfall mit Merkdatei: wartet nicht selbst auf den Live-Test" test -z "$(news)" -a ! -e "$state/check.log"
extra_env=OMARCHY_BUDDY_CHECK_DETACHED=1 gestoert=1 sandbox ok "" 0 --rueckfall 0
check "Wiederholung ok: Live-Test gelaufen" grep -qx 'live --warten' <(calls)
check "Wiederholung ok: Merkdatei weg" test ! -e "$state/check.gestoert"
check "Wiederholung ok: gute Meldung" grep -q '^good Update-Check: Insel läuft 3 ok' <(news)
extra_env=OMARCHY_BUDDY_CHECK_DETACHED=1 gestoert=1 sandbox ok "" 0 --rueckfall 3
check "Wiederholung gestört: keine Meldung, Merkdatei zählt 2" test -z "$(news)" -a "$(cat "$state/check.gestoert" 2>/dev/null)" = 2
gestoert= sandbox ok "" 0 --rueckfall 3
check "--rueckfall ohne Merkdatei, Bus gehalten: kein Live-Test" test -z "$(calls)"
gestoert= sandbox ok "" 0 "" 3
check "von Hand gestört: Meldung sofort, keine Merkdatei" \
  test "$(news | grep -c '^error Update-Check: etwas hakt Pop-ups\.')" = 1 -a ! -e "$state/check.gestoert"

echo "FEHLER: $( ((fails)) && echo "$fails" || echo keine)"
exit $((fails > 0))
