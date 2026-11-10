#!/usr/bin/env python3
# Every text the scripts in bin/ show (news, notifications, messages to
# Claude, the setup's output), in German and English; the island keeps its
# own in shell/Strings.js, with the same rule for the language: "language"
# in config.json ("auto", "de", "en"), automatic follows Omarchy's choice
# (~/.config/omarchy/language, Omarchy 4.5), without one LC_ALL,
# LC_MESSAGES, LANG (the first one set), German for de*, English for
# everything else.
#
#   t("key", name=…)               the text, {name} filled in
#   python3 lib/texts.py KEY [name=value …]   the same for shell scripts

import json
import os
import pwd
import re
import sys
import time

LANGUAGES = ("de", "en")

TEXTS = {
    "de": {
        # omarchy-buddy-hook
        "where.session": "diese Sitzung",
        "where.localSettings": "dieses Projekt (nur bei dir)",
        "where.projectSettings": "dieses Projekt",
        "where.userSettings": "überall",
        "rule.mode": "Modus {mode}",
        "rule.folder": "Ordner {folder}",
        "plan.revise": "{name} möchte den Plan so noch nicht. Bitte überarbeite ihn.",
        "denied": "Abgelehnt über O-Morchy.",
        "notify.permission": "Freigabe für {tool} im Terminal",
        "notify.permissionAny": "Freigabe im Terminal",
        "notify.elicitation": "Eingabe für einen MCP-Server im Terminal",
        "notify.input": "wartet auf deine Eingabe im Terminal",
        "error.rate_limit": "Limit erreicht",
        "error.overloaded": "Anthropic ist überlastet",
        "hint.overloaded": "Gleich noch mal versuchen.",
        "error.authentication_failed": "Anmeldung abgelaufen",
        "hint.authentication_failed": "Im Terminal /login ausführen.",
        "error.oauth_org_not_allowed": "Anmeldung nicht erlaubt",
        "hint.oauth_org_not_allowed": "Im Terminal /login mit dem richtigen Konto.",
        "error.account_on_hold": "Konto gesperrt",
        "hint.account_on_hold": "Konto bei Anthropic prüfen.",
        "error.billing_error": "Abrechnungsproblem",
        "hint.billing_error": "Abo oder Guthaben prüfen.",
        "error.invalid_request": "Anfrage abgelehnt",
        "hint.invalid_request": "Die Anfrage war ungültig, z. B. zu groß.",
        "error.model_not_found": "Modell nicht gefunden",
        "hint.model_not_found": "Mit /model ein anderes wählen.",
        "error.server_error": "Serverfehler bei Anthropic",
        "hint.server_error": "Gleich noch mal versuchen.",
        "error.max_output_tokens": "Antwort zu lang",
        "hint.max_output_tokens": "Claude hat mittendrin aufgehört.",
        "error.cloud_credential_error": "Cloud-Zugang fehlt",
        "hint.cloud_credential_error": "Zugangsdaten prüfen.",
        "error.other": "API-Fehler",
        "blocked": "{name}: Auto-Modus hat etwas blockiert",
        "done.after": " nach {minutes} min",
        "done.title": "{name} ist fertig{took}",
        "done.waiting": "{agent} wartet auf deine nächste Nachricht.",
        "free.at": "Wieder frei ab {time}.",
        "quote": "„{text}“",
        "command.title": "Befehl fertig nach {minutes} min",
        "command.failed": "Befehl fehlgeschlagen nach {minutes} min",
        "command.body": "{command} ({exit})",
        "command.exit": "Exit-Code {status}",
        "date": "%d.%m. %H:%M",
        # omarchy-buddy-feed
        "feed.updates": "Updates: {parts}",
        "feed.updates.body": "Installiert alles in einem Terminal.",
        "updates.omarchy.one": "Omarchy",
        "updates.packages": "{n} Pakete",
        "updates.packages.one": "1 Paket",
        "updates.flatpak": "{n} Flatpaks",
        "updates.flatpak.one": "1 Flatpak",
        "updates.mise": "{n} mise-Tools",
        "updates.mise.one": "1 mise-Tool",
        "updates.npm": "{n} npm",
        "updates.npm.one": "1 npm",
        "updates.pnpm": "{n} pnpm",
        "updates.pnpm.one": "1 pnpm",
        "updates.rustup": "Rust",
        "updates.rustup.one": "Rust",
        "updates.plugins": "{n} Plugins",
        "updates.plugins.one": "1 Plugin",
        "updates.omz.one": "oh-my-zsh",
        "updates.git": "{n} Git-Repos",
        "updates.git.one": "1 Git-Repo",
        "feed.git.new": "Neu im Update-Watcher: {names}",
        "feed.git.new.body": "Neue Stände kommen mit in die Update-Meldung. Abwählen kannst du sie in den Einstellungen unter Quellen.",
        "git.head": "{name} ({path})",
        "git.gone": "Nicht mehr da.",
        "git.dirty": "Hat lokale Änderungen, bleibt, wie es ist.",
        "git.detached": "Folgt keinem Branch des Remotes, bleibt, wie es ist.",
        "git.build": "Neuer Stand da. {name} wird gebaut ({file}): Aktualisiere es selbst, wie seine Anleitung es sagt.",
        "git.fetchFailed": "Abrufen hat nicht geklappt.",
        "git.current": "Schon aktuell.",
        "git.ask": "{name} aktualisieren?",
        "git.skipped": "Übersprungen.",
        "git.done": "Aktualisiert.",
        "git.notFastForward": "Hat eigene Commits, die auf dem Remote fehlen: Ohne Zusammenführen geht es nicht, bleibt, wie es ist.",
        "git.failed": "Nicht geklappt, bleibt, wie es war.",
        "updates.orca": "Orca {n}",
        "updates.orca.running": "Orca läuft noch. Schließ Orca ganz und klick dann noch mal auf die Update-Meldung.",
        "updates.orca.current": "Orca ist schon aktuell ({version}).",
        "updates.orca.missing": "Kein Orca in {path}.",
        "updates.orca.download": "Lade Orca {version} ({mb} MB) …",
        "updates.orca.badsum": "Die Prüfsumme stimmt nicht. Orca bleibt, wie es ist.",
        "updates.orca.done": "Orca {version} ist installiert.",
        "updates.orca.failed": "Orca-Update nicht geklappt, die alte Version bleibt: {error}",
        "updates.step": "→ {command}",
        "updates.failed": "Nicht geklappt: {commands}",
        "updates.done": "Fertig. Ich prüfe neu …",
        "updates.none": "Gerade steht kein Update an.",
        "updates.enter": "Enter schließt das Fenster.",
        "feed.omarchyInstalled": "Omarchy {version} installiert",
        "feed.omarchyInstalled.body": "Vorher {old}.",
        "feed.disk": "Platte {mount} zu {percent} % voll",
        "feed.disk.body": "Noch {gb} GB frei.",
        "feed.failed": "Dienst ausgefallen: {units}",
        "feed.crash": "Abgestürzt: {name}",
        "feed.crashes": "{n} Abstürze: {names}",
        "feed.crash.agent": "Dein Agent sucht die Ursache.",
        "feed.crash.agent.many": "Dein Agent sieht sich den letzten an.",
        "feed.crash.details": "Zeigt die Einzelheiten im Terminal.",
        "feed.crash.details.many": "Zeigt den letzten im Terminal.",
        # hooks/battery-low
        "battery.low": "Akku nur noch bei {percent} %",
        "battery.low.body": "Schließ das Ladekabel an.",
        "feed.claude": "Claude Code {version} ist da",
        "feed.claude.body": "Neu: {items}",
        "feed.installed": "(installiert: {version})",
        "feed.release": "{name} {version} erschienen",
        "feed.kuma.down": "{name} ist ausgefallen",
        "feed.kuma.down.body": "Seit {since}.",
        "feed.kuma.downMany": "{n} Dienste ausgefallen",
        "feed.kuma.downItem": "{name} seit {since}",
        "feed.kuma.up": "{names} ist wieder da",
        "feed.kuma.upMany": "{names} sind wieder da",
        "feed.kuma.monitor": "Monitor {id}",
        "feed.kuma.unreachable": "Uptime Kuma nicht erreichbar",
        "feed.kuma.unreachable.body": "Die Statusseite antwortet seit zwei Prüfungen nicht: {url}",
        "feed.kuma.reachable": "Uptime Kuma wieder erreichbar",
        "feed.github.review": "Review für {ref} angefragt",
        "feed.github.mention": "Du wurdest in {ref} erwähnt",
        "feed.github.ci": "Action in {ref} fehlgeschlagen",
        "feed.github.reply": "Neue Antwort in {ref}",
        "feed.github.many": "{n} Neuigkeiten auf GitHub",
        "feed.github.short.review": "Review",
        "feed.github.short.mention": "Erwähnung",
        "feed.github.short.ci": "Action fehlgeschlagen",
        "feed.github.short.reply": "Antwort",
        "feed.morning": "Guten Morgen, {name}",
        "feed.morning.later": "Hallo {name} – dein Tagesstand",
        "feed.morning.current": "System aktuell",
        # omarchy-buddy-statusline
        "limit.five_hour": "5-Stunden-Limit",
        "limit.seven_day": "Wochenlimit",
        "limit.warn": "Claude: {limit} zu {percent} % verbraucht",
        # omarchy-buddy-setup
        "setup.ask": "Omarchy-Buddy richtet sich ein und ändert dafür (geänderte Dateien werden vorher gesichert):",
        "setup.askLinks": "Verknüpfungen in {bin}, {hooks} und {units}",
        "setup.continue": "Weiter?",
        "setup.yes": "Ja",
        "setup.no": "Nein",
        "setup.cancelled": "Abgebrochen, nichts geändert. Später einrichten: {setup}",
        "setup.links": "Skripte in ~/.local/bin, Update-Hook und Timer zeigen auf {repo}.",
        "setup.noClaude": "Claude Code nicht gefunden (~/.claude fehlt) – Hooks übersprungen.",
        "setup.claudeSame": "Claude: Hooks und Statuszeile stehen schon.",
        "setup.claudeOdd": "Claude: {file} hat eine ungewöhnliche Form – nichts eingetragen, die Datei bleibt, wie sie ist.",
        "setup.claude": "Claude: Hooks und Statuszeile eingetragen (Sicherung: {backup}). Gilt für neu gestartete Sitzungen.",
        "setup.noCodex": "Codex nicht gefunden (~/.codex fehlt) – übersprungen.",
        "setup.agentsNone": "Nicht installiert, übersprungen: {agents}.",
        "setup.agentsOff": "In den Einstellungen abgeschaltet, ohne Hooks: {agents}.",
        "setup.agentSame": "{agent}: Hooks stehen schon.",
        "setup.agentOdd": "{agent}: {file} hat eine ungewöhnliche Form – nichts eingetragen, die Datei bleibt, wie sie ist.",
        "setup.agent": "{agent}: Hooks eingetragen (Sicherung: {backup}). Gilt für neu gestartete Sitzungen.",
        "setup.codexSame": "Codex: Hooks stehen schon.",
        "setup.codexOdd": "Codex: {file} hat eine ungewöhnliche Form – nichts eingetragen, die Datei bleibt, wie sie ist.",
        "setup.codex": "Codex: Hooks eingetragen und vertraut (Sicherung: {backup}). Gilt für neu gestartete Sitzungen.",
        "setup.shellSame": "Omarchy: nichts zu ändern.",
        "setup.shellOddSwitch": "{file} hat eine ungewöhnliche Form, die Leiste bleibt, wie sie ist.",
        "setup.shellOdd": "Omarchy: {file} hat eine ungewöhnliche Form – nichts geändert. Von Hand: omarchy.notifications in disabledPlugins, io.github.destrukt1v.omarchy-buddy in plugins.",
        "setup.shell": "Omarchy: eigene Benachrichtigungen aus, Ruhemodus-Knopf aus der Leiste, Omarchy-Buddy an (Sicherung: {backup}).",
        "setup.indicators": "Omarchy: Anzeigen in der Leiste auf Omarchys aktuellen Stand gebracht, ohne Ruhemodus-Knopf (Sicherung: {backup}).",
        "setup.restart": "Shell neu gestartet.",
        "setup.done": "Fertig. O-Morchy sitzt jetzt in der Leiste rechts neben der Uhr.\n"
                      "Starte laufende Claude- und Codex-Sitzungen neu: Die Hooks gelten erst für neue Sitzungen.\n"
                      "Ausprobieren: notify-send Hallo (oder „Probier’s aus“ in der Begrüßung).\n"
                      "Einstellungen: Zahnrad in der Insel oder {config}/config.json.",
        "remove.links": "Skripte, Update-Hook und Timer entfernt.",
        "remove.claude": "Claude: Hooks entfernt, alte Statuszeile zurück (Sicherung: {backup}).",
        "remove.codex": "Codex: Hooks entfernt (Sicherung: {backup}).",
        "remove.agent": "{agent}: Hooks entfernt (Sicherung: {backup}).",
        "setup.agentPlugin": "{agent}: Plugin angelegt ({file}). Gilt für neu gestartete Sitzungen.",
        "setup.agentPluginSame": "{agent}: Plugin ist schon da.",
        "remove.agentPlugin": "{agent}: Plugin entfernt.",
        "setup.commands": "Lange Befehle: Zeile in {file} eingetragen (Sicherung: {backup}). Gilt für neue Terminals.",
        "setup.commandsSame": "Lange Befehle: {file} hat die Zeile schon.",
        "setup.commandsNone": "Lange Befehle: keine ~/.bashrc oder ~/.zshrc gefunden – nichts eingetragen.",
        "setup.commandsChezmoi": "Lange Befehle: {file} verwaltet chezmoi – nichts eingetragen. Trag diese Zeile in deiner chezmoi-Quelle ein:",
        "remove.commands": "Lange Befehle: Zeile aus {file} entfernt (Sicherung: {backup}).",
        "remove.commandsChezmoi": "Lange Befehle: {file} verwaltet chezmoi – nimm die Zeile mit long-commands.sh dort selbst heraus.",
        "switch.commands": "In {files} eingetragen. Gilt für neue Terminals.",
        "switch.commandsOff": "Ausgetragen.",
        "and": "{a} und {b}",
        "remove.shell": "Omarchy: eigene Benachrichtigungen und Ruhemodus-Knopf wieder da (Sicherung: {backup}).",
        "remove.plugin": "Plugin entfernt (omarchy plugin remove).",
        "remove.done": "Deine Daten bleiben in {state} und {config}. Plugin ganz entfernen: omarchy plugin remove io.github.destrukt1v.omarchy-buddy",
        "uninstall.done": "Omarchy-Buddy ist deinstalliert. Deine Daten bleiben in {state} und {config}; löschen kannst du beide Ordner von Hand.",
        # omarchy-buddy-check
        "check.fallback.title": "O-Morchy ist ausgefallen",
        "check.fallback.body": "Die Insel lädt nicht, deshalb ist alles wie vor dem Einrichten: Omarchys Benachrichtigungen sind wieder an, Claude und Codex warten nicht mehr auf die Insel. {reason}Zurück zur Insel: {setup}, Log: {log}",
        "check.fallback.partial": "Die Insel lädt nicht, deshalb sind Omarchys Benachrichtigungen wieder an. Die Hooks von Claude und Codex sind noch drin (Aufräumen schlug fehl, siehe Log): Freigaben warten bis zu 30 s auf die Insel, Fragen und Pläne bis zu 5 Minuten. {reason}Zurück zur Insel: {setup}, Log: {log}",
        "check.fallback.reason": "Fehler: {reason}. ",
        "check.bad.title": "Update-Check: etwas hakt",
        "check.bad.body": "{problems}. Details: {log}",
        "check.good.title": "Update-Check: Insel läuft",
        "check.contract": "Vertragstests",
        "check.contractOk": "Vertragstests ok",
        "check.live": "Live-Test",
        "check.noAnswer": "Insel antwortet nicht",
        "check.disturbed": "{failed} (dreimal hintereinander gestört: echte Rückfrage, echtes Pop-up, Vollbild oder du warst weg)",
        # omarchy-buddy-spotify, the page the browser shows after signing in
        "spotify.connected": "Spotify ist verbunden. Du kannst dieses Fenster schließen.",
        "spotify.notConnected": "Spotify wurde nicht verbunden. Versuch es in den Einstellungen der Insel noch mal.",
    },
    "en": {
        "where.session": "this session",
        "where.localSettings": "this project (only for you)",
        "where.projectSettings": "this project",
        "where.userSettings": "everywhere",
        "rule.mode": "mode {mode}",
        "rule.folder": "folder {folder}",
        "plan.revise": "{name} doesn't want the plan like this yet. Please revise it.",
        "denied": "Denied via O-Morchy.",
        "notify.permission": "Permission for {tool} in the terminal",
        "notify.permissionAny": "Permission in the terminal",
        "notify.elicitation": "Input for an MCP server in the terminal",
        "notify.input": "waiting for your input in the terminal",
        "error.rate_limit": "Limit reached",
        "error.overloaded": "Anthropic is overloaded",
        "hint.overloaded": "Try again in a moment.",
        "error.authentication_failed": "Login expired",
        "hint.authentication_failed": "Run /login in the terminal.",
        "error.oauth_org_not_allowed": "Login not allowed",
        "hint.oauth_org_not_allowed": "Run /login with the right account.",
        "error.account_on_hold": "Account on hold",
        "hint.account_on_hold": "Check your account at Anthropic.",
        "error.billing_error": "Billing problem",
        "hint.billing_error": "Check your plan or credits.",
        "error.invalid_request": "Request refused",
        "hint.invalid_request": "The request was invalid, e.g. too large.",
        "error.model_not_found": "Model not found",
        "hint.model_not_found": "Pick another one with /model.",
        "error.server_error": "Server error at Anthropic",
        "hint.server_error": "Try again in a moment.",
        "error.max_output_tokens": "Answer too long",
        "hint.max_output_tokens": "Claude stopped halfway.",
        "error.cloud_credential_error": "Cloud access missing",
        "hint.cloud_credential_error": "Check your credentials.",
        "error.other": "API error",
        "blocked": "{name}: auto mode blocked something",
        "done.after": " after {minutes} min",
        "done.title": "{name} is done{took}",
        "done.waiting": "{agent} is waiting for your next message.",
        "free.at": "Free again at {time}.",
        "quote": "“{text}”",
        "command.title": "Command finished after {minutes} min",
        "command.failed": "Command failed after {minutes} min",
        "command.body": "{command} ({exit})",
        "command.exit": "exit code {status}",
        "date": "%b %d %H:%M",
        "feed.updates": "Updates: {parts}",
        "feed.updates.body": "Installs everything in a terminal.",
        "updates.omarchy.one": "Omarchy",
        "updates.packages": "{n} packages",
        "updates.packages.one": "1 package",
        "updates.flatpak": "{n} Flatpaks",
        "updates.flatpak.one": "1 Flatpak",
        "updates.mise": "{n} mise tools",
        "updates.mise.one": "1 mise tool",
        "updates.npm": "{n} npm",
        "updates.npm.one": "1 npm",
        "updates.pnpm": "{n} pnpm",
        "updates.pnpm.one": "1 pnpm",
        "updates.rustup": "Rust",
        "updates.rustup.one": "Rust",
        "updates.plugins": "{n} plugins",
        "updates.plugins.one": "1 plugin",
        "updates.omz.one": "oh-my-zsh",
        "updates.git": "{n} git repos",
        "updates.git.one": "1 git repo",
        "feed.git.new": "New in the update watcher: {names}",
        "feed.git.new.body": "New versions show up in the update item. You can turn them off in the settings under Sources.",
        "git.head": "{name} ({path})",
        "git.gone": "No longer there.",
        "git.dirty": "Has local changes, left as it is.",
        "git.detached": "Follows no branch of its remote, left as it is.",
        "git.build": "A new version is out. {name} is built ({file}): update it yourself as its instructions say.",
        "git.fetchFailed": "Fetching did not work.",
        "git.current": "Already up to date.",
        "git.ask": "Update {name}?",
        "git.skipped": "Skipped.",
        "git.done": "Updated.",
        "git.notFastForward": "Has own commits the remote lacks: it cannot be updated without a merge, left as it is.",
        "git.failed": "Did not work, left as it was.",
        "updates.orca": "Orca {n}",
        "updates.orca.running": "Orca is still running. Quit Orca completely, then click the update item again.",
        "updates.orca.current": "Orca is already up to date ({version}).",
        "updates.orca.missing": "No Orca in {path}.",
        "updates.orca.download": "Downloading Orca {version} ({mb} MB) …",
        "updates.orca.badsum": "The checksum does not match. Orca stays as it is.",
        "updates.orca.done": "Orca {version} is installed.",
        "updates.orca.failed": "Orca update did not work, the old version stays: {error}",
        "updates.step": "→ {command}",
        "updates.failed": "Did not work: {commands}",
        "updates.done": "Done. Checking again …",
        "updates.none": "No updates are waiting right now.",
        "updates.enter": "Enter closes the window.",
        "feed.omarchyInstalled": "Omarchy {version} installed",
        "feed.omarchyInstalled.body": "Before: {old}.",
        "feed.disk": "Disk {mount} {percent}% full",
        "feed.disk.body": "{gb} GB left.",
        "feed.failed": "Service failed: {units}",
        "feed.crash": "Crashed: {name}",
        "feed.crashes": "{n} crashes: {names}",
        "feed.crash.agent": "Your agent looks for the cause.",
        "feed.crash.agent.many": "Your agent looks into the latest one.",
        "feed.crash.details": "Shows the details in a terminal.",
        "feed.crash.details.many": "Shows the latest one in a terminal.",
        # hooks/battery-low
        "battery.low": "Battery down to {percent}%",
        "battery.low.body": "Plug in the charger.",
        "feed.claude": "Claude Code {version} is out",
        "feed.claude.body": "New: {items}",
        "feed.installed": "(installed: {version})",
        "feed.release": "{name} {version} released",
        "feed.kuma.down": "{name} is down",
        "feed.kuma.down.body": "Since {since}.",
        "feed.kuma.downMany": "{n} services down",
        "feed.kuma.downItem": "{name} since {since}",
        "feed.kuma.up": "{names} is back up",
        "feed.kuma.upMany": "{names} are back up",
        "feed.kuma.monitor": "Monitor {id}",
        "feed.kuma.unreachable": "Uptime Kuma unreachable",
        "feed.kuma.unreachable.body": "The status page has failed two checks in a row: {url}",
        "feed.kuma.reachable": "Uptime Kuma reachable again",
        "feed.github.review": "Review requested on {ref}",
        "feed.github.mention": "You were mentioned in {ref}",
        "feed.github.ci": "Action failed in {ref}",
        "feed.github.reply": "New reply in {ref}",
        "feed.github.many": "{n} GitHub notifications",
        "feed.github.short.review": "Review",
        "feed.github.short.mention": "Mention",
        "feed.github.short.ci": "Action failed",
        "feed.github.short.reply": "Reply",
        "feed.morning": "Good morning, {name}",
        "feed.morning.later": "Hi {name} – your day so far",
        "feed.morning.current": "System up to date",
        "limit.five_hour": "5-hour limit",
        "limit.seven_day": "weekly limit",
        "limit.warn": "Claude: {limit} {percent}% used",
        "setup.ask": "Omarchy-Buddy sets itself up and changes (changed files are backed up first):",
        "setup.askLinks": "Links in {bin}, {hooks} and {units}",
        "setup.continue": "Continue?",
        "setup.yes": "Yes",
        "setup.no": "No",
        "setup.cancelled": "Cancelled, nothing changed. Set up later: {setup}",
        "setup.links": "Scripts in ~/.local/bin, update hook and timer point to {repo}.",
        "setup.noClaude": "Claude Code not found (no ~/.claude) – hooks skipped.",
        "setup.claudeSame": "Claude: hooks and status line are in place.",
        "setup.claudeOdd": "Claude: {file} has an unusual shape – nothing added, the file stays as it is.",
        "setup.claude": "Claude: hooks and status line added (backup: {backup}). Applies to newly started sessions.",
        "setup.noCodex": "Codex not found (no ~/.codex) – skipped.",
        "setup.agentsNone": "Not installed, skipped: {agents}.",
        "setup.agentsOff": "Switched off in the settings, no hooks: {agents}.",
        "setup.agentSame": "{agent}: hooks are in place.",
        "setup.agentOdd": "{agent}: {file} has an unusual shape – nothing added, the file stays as it is.",
        "setup.agent": "{agent}: hooks added (backup: {backup}). Applies to newly started sessions.",
        "setup.codexSame": "Codex: hooks are in place.",
        "setup.codexOdd": "Codex: {file} has an unusual shape – nothing added, the file stays as it is.",
        "setup.codex": "Codex: hooks added and trusted (backup: {backup}). Applies to newly started sessions.",
        "setup.shellSame": "Omarchy: nothing to change.",
        "setup.shellOddSwitch": "{file} has an unusual shape, the bar stays as it is.",
        "setup.shellOdd": "Omarchy: {file} has an unusual shape – nothing changed. By hand: omarchy.notifications into disabledPlugins, io.github.destrukt1v.omarchy-buddy into plugins.",
        "setup.shell": "Omarchy: its own notifications off, Do-not-disturb button out of the bar, Omarchy-Buddy on (backup: {backup}).",
        "setup.indicators": "Omarchy: bar indicators brought up to Omarchy's current list, without the Do-not-disturb button (backup: {backup}).",
        "setup.restart": "Shell restarted.",
        "setup.done": "Done. O-Morchy now sits in the bar, right beside the clock.\n"
                      "Restart running Claude and Codex sessions: the hooks apply to new sessions only.\n"
                      "Try it: notify-send Hello (or “Try it” in the greeting).\n"
                      "Settings: the gear in the island or {config}/config.json.",
        "remove.links": "Scripts, update hook and timer removed.",
        "remove.claude": "Claude: hooks removed, old status line back (backup: {backup}).",
        "remove.codex": "Codex: hooks removed (backup: {backup}).",
        "remove.agent": "{agent}: hooks removed (backup: {backup}).",
        "setup.agentPlugin": "{agent}: plugin added ({file}). Applies to newly started sessions.",
        "setup.agentPluginSame": "{agent}: plugin is in place.",
        "remove.agentPlugin": "{agent}: plugin removed.",
        "setup.commands": "Long commands: line added to {file} (backup: {backup}). Applies to new terminals.",
        "setup.commandsSame": "Long commands: {file} has the line already.",
        "setup.commandsNone": "Long commands: no ~/.bashrc or ~/.zshrc found – nothing added.",
        "setup.commandsChezmoi": "Long commands: chezmoi manages {file} – nothing added. Add this line to your chezmoi source:",
        "remove.commands": "Long commands: line removed from {file} (backup: {backup}).",
        "remove.commandsChezmoi": "Long commands: chezmoi manages {file} – take the line with long-commands.sh out there yourself.",
        "switch.commands": "Added to {files}. Applies to new terminals.",
        "switch.commandsOff": "Removed.",
        "and": "{a} and {b}",
        "remove.shell": "Omarchy: its own notifications and Do-not-disturb button are back (backup: {backup}).",
        "remove.plugin": "Plugin removed (omarchy plugin remove).",
        "remove.done": "Your data stays in {state} and {config}. To remove the plugin: omarchy plugin remove io.github.destrukt1v.omarchy-buddy",
        "uninstall.done": "Omarchy-Buddy is uninstalled. Your data stays in {state} and {config}; you can delete both folders by hand.",
        "check.fallback.title": "O-Morchy is down",
        "check.fallback.body": "The island does not load, so everything is as before the setup: Omarchy's notifications are back on, Claude and Codex no longer wait for the island. {reason}Back to the island: {setup}, log: {log}",
        "check.fallback.partial": "The island does not load, so Omarchy's notifications are back on. Claude's and Codex's hooks are still in (cleaning up failed, see the log): approvals wait up to 30 s for the island, questions and plans up to 5 minutes. {reason}Back to the island: {setup}, log: {log}",
        "check.fallback.reason": "Error: {reason}. ",
        "check.bad.title": "Update check: something's off",
        "check.bad.body": "{problems}. Details: {log}",
        "check.good.title": "Update check: island runs",
        "check.contract": "Contract tests",
        "check.contractOk": "Contract tests ok",
        "check.live": "Live test",
        "check.noAnswer": "Island does not answer",
        "check.disturbed": "{failed} (disturbed three times in a row: a real request, a real pop-up, fullscreen or you were away)",
        "spotify.connected": "Spotify is connected. You can close this window.",
        "spotify.notConnected": "Spotify was not connected. Try again in the island's settings.",
    },
}

ERRORS = ("rate_limit", "overloaded", "authentication_failed", "oauth_org_not_allowed", "account_on_hold",
          "billing_error", "invalid_request", "model_not_found", "server_error", "max_output_tokens",
          "cloud_credential_error")


def pick_language(setting, env, omarchy=""):
    if setting in LANGUAGES:
        return setting
    code = (omarchy or "").strip()
    if re.match(r"^[a-z]{2,3}(-[A-Za-z]{2})?$", code):
        return "de" if re.match(r"^de(-|$)", code) else "en"
    for value in env:
        if value:
            return "de" if re.match(r"^de([_.@-]|$)", value, re.I) else "en"
    return "en"


def language():
    home = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    try:
        with open(os.path.join(home, "omarchy-buddy", "config.json")) as f:
            setting = json.load(f).get("language")
    except (OSError, ValueError, AttributeError):
        setting = None
    try:
        with open(os.environ.get("OMARCHY_LANGUAGE_FILE") or os.path.join(home, "omarchy", "language")) as f:
            omarchy = f.read()
    except OSError:
        omarchy = ""
    return pick_language(setting, [os.environ.get(v, "") for v in ("LC_ALL", "LC_MESSAGES", "LANG")], omarchy)


_lang = None


def t(key, **values):
    global _lang
    if _lang is None:
        _lang = language()
    table = TEXTS.get(_lang, TEXTS["de"])
    text = table.get(key, TEXTS["de"].get(key, key))
    return text.format(**values) if values else text


def clock(when):
    """A time as HH:MM, more than 20 hours ahead with the date."""
    return time.strftime("%H:%M" if when - time.time() < 20 * 3600 else t("date"), time.localtime(when))


def first_name():
    """The first word of the full name (GECOS), otherwise the login name
    with a capital letter (as IslandLogic.firstName)."""
    try:
        entry = pwd.getpwuid(os.getuid())
    except KeyError:
        return ""
    full = entry.pw_gecos.split(",")[0].strip()
    return full.split()[0] if full else entry.pw_name[:1].upper() + entry.pw_name[1:]


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: texts.py KEY [name=value …]", file=sys.stderr)
        sys.exit(2)
    print(t(sys.argv[1], **dict(a.split("=", 1) for a in sys.argv[2:])))
