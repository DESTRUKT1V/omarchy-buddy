# Changelog

Versions follow [Semantic Versioning](https://semver.org); the version lives in
`manifest.json`.

## 1.2.2 – 2026-11-07

- **Backups are private from their first byte** (#221, review for
  plugins.omarchy.org): before the setup changes a file (`~/.claude/settings.json`,
  Codex's files, `shell.json` …), its backup is created readable only by
  you (0600). Before, it was copied under your umask (often 0644) and
  narrowed only afterwards, so another account could have opened it in
  between.

## 1.2.1 – 2026-11-07

Fixes from the review for plugins.omarchy.org (#219), and Omarchy's new bar.

- **Private text stays out of process arguments**, which other users on
  the computer can read in `/proc/*/cmdline`: answers, plan feedback, the
  prompt in a finished run's or blocked action's news, a long terminal
  command and the place of a weather warning now go on stdin.
  `omarchy-buddy-say --stdin` reads title and body as JSON for your own
  scripts; TITLE and BODY as arguments still work.

- **Network answers are capped at 2 MiB**: a bigger answer from a status
  page (Uptime Kuma), GitHub or the weather services counts as broken,
  the Claude Code changelog is read up to there.

- **Omarchy's new bar sections** (#220): Omarchy's bar now has
  centerBegin, center and centerEnd. The setup finds Omarchy's indicators
  in any section (the do-not-disturb button leaves the bar again on new
  installs), puts O-Morchy right after the clock at the start of centerEnd
  (the clock stays centred), and puts Omarchy's weather back between its
  old neighbours in whatever section they are now.

## 1.2.0 – 2026-11-03

The first public release (github.com/DESTRUKT1V/omarchy-buddy).

- **New plugin id `io.github.destrukt1v.omarchy-buddy`** (#209): namespaced
  as plugins.omarchy.org asks, so it stays the same for good. The name
  Omarchy-Buddy, the scripts (`omarchy-buddy-*`) and the folders for
  settings and history stay. The setup moves the old id `omarchy-buddy` in
  `shell.json` to the new one; the widget keeps its place in the bar.
  Installed before 1.2.0 with `omarchy plugin add`: run
  `omarchy plugin remove omarchy-buddy`, then install anew (README).

- **The setup asks first** (#208): run in a terminal (also from "Set up"
  in the island), it lists the files it changes on this system and asks
  once, Yes preselected. No changes nothing; the "Set up" pop-up stays
  until the setup has run. `--yes` skips the question; the island's
  switches, the post-update check and `install.sh` never ask.

- **Omarchy's panel contract** (#207): `omarchy-shell shell summon/hide
  io.github.destrukt1v.omarchy-buddy` open and close the island, Tab from
  another bar panel (the clock …) reaches it, and opened by key the island
  takes Escape and Tab at once. Install with `omarchy plugin add … --enable`.

- **A calmer check after Omarchy updates** (#213, #214): the live test
  waits for what it checks instead of guessing; a run disturbed by
  something real on the island (a request, a pop-up, fullscreen, away)
  tries again at the next quiet moment instead of reporting, up to three
  times.

- **Tidier code** (#201–#204): about 250 lines less in the plugin and
  its tests, the behaviour unchanged.

## 1.1.0 – 2026-11-01

Ready for Omarchy 4.5; everything keeps working on 4.0.

- **Weather warning in the bar's colour** (#196): like "… needs you", the
  bar widget's warning text stays in the bar's colour; only its icon is
  red.

- **The greeting knows your name** (#195): after the first setup O-Morchy
  says "Hi, NAME!" with your first name from the system ("Hi!" without
  one), then "I'm O-Morchy. …".

- **No more "A · B · C" chains** (#193, #194): the island reads in plain
  rows. The summary is a sentence with commas; a session shows its name in
  bold with "Codex is working" under it; news and messages have a sender
  line with the time at the right; a subagent follows in brackets. Rows are
  flat, unread is bold, only a waiting session has a surface. The same in
  the ticker, "Always allow", the bundled pop-up and the news texts.

- **Requests say what they do first** (#193): Claude's own description of
  a command stands above it, the command below in monospace. Omarchy's
  notifications key focuses **Deny** on a waiting request ("Revise" on a
  plan, the first option on a question). The unread dot in the bar comes
  after the text.

- **Calmer settings** (#193): Display, Privacy, Apps, Agents and Bar
  first; Updates, long commands, Uptime Kuma, GitHub and Spotify under
  "Sources", folded.

- **Hours ahead in the weather tile** (#191): the next six full hours
  (hour, icon, temperature) under the rain bars, from the same Open-Meteo
  call, only where the tile has room. German 24 h, English "7 PM" when
  Omarchy's clock shows AM/PM.

- **O-Morchy sings to new songs** (#185, #188): a new track from a music
  service (Spotify, ncspot, Tidal, Deezer, YouTube Music, Amazon Music,
  SoundCloud, Bandcamp, also their sites in Firefox) makes O-Morchy sing
  for a moment, notes rising (one standing note with less motion). Pause,
  resume and other players do not. More room left and right of the bar
  widget.

- **Notifications only after the setup** (#187): the island becomes the
  notification server only once Omarchy's notifications plugin is off,
  that is after the setup; until then everything stays with Omarchy. The
  light Rosé Pine theme gets a sharper red, readable next to the secondary
  text.

- **News bundled by day** (#183): today open with at most 5 items and "N
  more today" below; older days as one folded row with the day and the
  count ("Yesterday", then weekday and date). Keyboard and screen readers can open
  and close them; closing the big view folds them again.

- **The first five minutes** (#192): installing is one command plus one
  click. Switched on without the setup, the island offers it ("One more
  step", **Set up** runs it in Omarchy's floating terminal); after the first
  setup O-Morchy waves once and "Try it" sends a test notification. Until
  the first session, "Agents" in the big view says how one comes and lists
  the agents found. The setup's last words say where O-Morchy sits, to
  restart running sessions and how to try it. In the bar, "… needs you" is
  in the bar's colour and semibold, only the agent's logo is red (readable
  over any wallpaper).

- **Weather instead of Omarchy's** (#184, optional): a switch in the
  settings takes Omarchy's weather out of the bar and puts it back where it
  was. The weather is a tile of its own beside the big view, under the music
  player and the same gap apart (in the player's place without music, #189): now, today, rain in the next two hours as
  bars, the DWD's warnings in Germany (Bright Sky, elsewhere Open-Meteo);
  the place is Omarchy's and can be searched there. The bar widget names
  rain within the hour or a warning in force, nothing otherwise. "Leiste
  ordnen" puts the clock left of O-Morchy and the indicators right of it,
  only on request, with undo; `--remove` undoes both. Severe weather (DWD
  level 3 and 4) also pops up and goes into the news, once per warning,
  again only when it is raised (#189). The tile reaches down to the big
  view's bottom edge (#190): the rain bars grow, the warnings sit at the bottom.

- **O-Morchy lives in the bar** (#182): a bar widget (Omarchy's `bar-widget`
  plugin kind) beside the clock, as large as the bar allows, with a short
  text while an agent works or needs you. The peek, pop-ups and the big view
  open under it as an Omarchy pop-up (under, above or beside the bar,
  wherever it is), in the theme's pop-up colours, edge, corner radius (also
  for buttons, switches and rows) and font. The settings offer other fonts:
  Omarchy's monospace ones and Adwaita Sans, the island's font until now.
  The setup moves the plugin from `plugins[]` into the bar; the invisible
  zone around the pill (#180) is gone with the pill.

- **The pill is small again, the peek opens from close by** (#180): at rest
  O-Morchy is back to size 2 (2.5 since #177 took too much room); the peek
  keeps 2.5. An invisible zone around the pill and the peek (about where the
  2.5 pill reached, not above it into the bar) opens the peek like hovering
  the pill, and a click there is a click on the pill.

- **The keyboard key keeps the view open** (#179): Omarchy's
  notifications keyboard (and act on a pop-up with several buttons) opened
  the view and closed it again at once: Hyprland drops every focus grab
  when the island takes the keyboard exclusively, and the island took that
  for a click elsewhere. Now it takes the grab back right after; a click
  elsewhere still closes the view.

- **"History without text" also covers pop-ups without a heading** (#170):
  such a pop-up shows its text as the title, which `popups.json` kept. Now
  the sender's name (the app, or the website for a browser) takes its place
  there, so a critical pop-up restored after a shell restart still shows who
  it is from. `notifications.json` and `news.json` had no such gap.

- **"For you" keeps what is yours until you act** (#178): mail, chat
  messages, event reminders, critical notifications (such as a nearly empty
  battery) and problems in the news stay in the block until you click them
  (open, a button, a reply) or take them out with its ×; having seen the
  pop-up or opening and closing the view no longer counts. The × there
  deletes it from the history as below (with undo); a news item, which
  cannot be deleted, only leaves the block. Screen readers hear which entry
  a × is for. After 24 hours an entry
  leaves the block by itself, and what leaves the history leaves it too. The
  dot in the pill still goes when you have read it. What is done is kept in
  `ui.json` next to what is read (ids and times only, no text); what was
  read before the update stays out.

- **"For you" at the top of the open view** (#175): agents waiting for an
  answer, unread mail, chat messages and event reminders and unread problems
  in the news (error, warning) stand in a block of their own above
  everything else, each only there and not again below. Below it the other
  agents, messages and news as before; with nothing for you the block is
  gone. Errors and warnings in the news now also show a warning sign instead
  of only a red or yellow dot, and screen readers hear the level and
  "unread".

- **No ticker in the pill** (#174): while agents work the pill shows only
  O-Morchy (since #177 thinking instead of the dots); what runs is in the
  peek and the session list. The setting "Ticker in the pill" is gone; an
  old `"tickerInPill"` in `config.json` is ignored without a hint and
  dropped on the next save.
- **Finished runs no longer in the news** (#173): a normal end of an
  agent run (every agent) only pops up, and only while its terminal is not
  in view; it is no news item and never unread. "done" stays on the agent's
  card (after 10 min "ready"), O-Morchy still celebrates. Errors at the end
  (API error, limit, StopFailure) and blocked actions stay news as before.
  New `omarchy-buddy-say --popup-only`: the item stays in `news.json` for a
  minute so the island can pop it up; finished runs written before this
  leave `news.json` on its next write.
- **O-Morchy reacts to what pops up** (#176, #177): new emotions, each a
  short movement (under a second and a half) when its pop-up appears, held
  for a moment, then rest: raising its hand for an agent's request (then
  "needs you" as before), an outage with a red cross (Uptime Kuma down, a
  program crashed), relief (Kuma back), an alarm clock (appointment
  reminder), a nod with a check mark or a sad face with a tear (long
  terminal command done or failed), a letter or speech bubble (a person's
  mail or chat; only on the pop-up's O-Morchy, never in the pill). While an
  agent works O-Morchy thinks (eyes up, rising dots) instead of looking
  down; the typing dots beside it are gone. An emotion only plays when its
  pop-up does (nothing for what the Ruhemodus, fullscreen or sharing hold
  back, nor for a finished run in the terminal you watch); of several at once the most
  important wins (request, outage, appointment, the rest), without a
  queue; a summary pop-up plays the strongest of what it folds. "Weniger
  Bewegung": only the final picture. The mapping is
  `ToastLogic.emoteFor`/`emoteWins`. O-Morchy in the pill and the peek is
  2.5 instead of 2 (sharp: every edge on a whole screen pixel), the pill a
  few pixels taller. `tests/emotes` shows the emotions in real size (pill,
  pop-up, Weniger Bewegung; `--fotos DIR` saves a GIF and a still of each),
  the gallery each at its real event, `tests/live` checks the mapping, the
  priority and that the letter leaves with its pop-up.

- **Updates only for Omarchy/Arch** (#172): the update check and
  `omarchy-buddy-update` keep what exists on Omarchy (Omarchy, pacman, AUR,
  mise, npm, pnpm, Flatpak, rustup); apt, dnf, zypper, Homebrew and Snap are
  gone along with their tests and texts.

- **Agents in the settings** (#158): a section "Agents" with a switch for
  each agent installed next to Claude (Claude is always on), on by default.
  Off takes its hooks or plugin out through the setup
  (`omarchy-buddy-setup --agent NAME on|off`, new `--agents` lists the
  installed ones) and writes `"agents": {"NAME": false}` to `config.json`;
  a normal setup run follows that. The hook drops events from an agent
  switched off, which is the only way for Grok and Cursor (they run
  Claude's hooks). Agents never tried with the real program carry "not
  tried yet": Cursor, Copilot, Muse (it ran, but without a model no tool or
  question came), Antigravity, Qwen Code, Kimi, Devin, Command Code and
  Kiro. `--remove` no longer says "Codex: hooks are in place".

- **Ready to publish** (#119): the author's own feed sources are gone
  (`feed.pi`: containers, backup and deploys over SSH; `feed.board`: done
  cards via `vk`) along with their texts and the `pi`/`board` sources of
  `omarchy-buddy-say`; such sources belong in a script of your own that
  calls `omarchy-buddy-say`. The morning greeting now only sums up the
  updates. The working notes in `pruefung/` left the repository, comments
  and tests no longer name the author. README: requirements (Omarchy 4.0+ on
  Arch, Hyprland 0.56+ with Lua), a "Security boundaries" section (any
  process running as you can answer a request; what the island reads and
  starts) and a trademark note.
- **install.sh restarts the shell** (#171): Omarchy reloads a plugin when
  its link is set again, but builds the island from its cached old QML, so
  after `./install.sh --stable` the island ran the code from before #149
  and wrote no sign of life (the hook stopped waiting for it, `tests/live`
  18 failures). Every `./install.sh` now ends with `omarchy restart shell`,
  unless the setup has just restarted it.
- **Hook and setup tidied up** (#157, review): `tests/golden-test.py` runs
  the hook in a PID namespace of its own (`unshare`), so it no longer fails
  outside Orca or under Claude's background service. The hook's code moved
  to `lib/hook.py`; `bin/omarchy-buddy-hook` only starts it (every agent's
  settings keep calling that name). Python keeps a module compiled, so an
  event takes 19.7 ms instead of 27 ms and `--prune` 14.3 ms instead of
  20.5 ms (median of 80 runs, sandbox HOME). The hook looks for the
  session's window (process tree, `hyprctl`) before it takes the lock on
  `state.json`, so other agents' hooks no longer wait for that. What the
  rename (#82) left behind is gone: the setup no longer keeps the old
  script names (`claude-buddy-*`, `companion-*`), the old plugin id
  or `companion-check`, and no script copies
  `~/.local/state/companion` or `$XDG_RUNTIME_DIR/claude-buddy` over any
  more (`lib/buddy.py migrate` is gone). Links of the old names left in
  `~/.local/bin` point to nothing anyone calls; delete them by hand.
  The setup keeps the newest 3 backups per file (`*.bak-omarchy-buddy-TIME`)
  and deletes older ones as it writes a new one.
  The hook writes `state.json` only when something changed: the island's
  `--prune` every few seconds no longer makes it reload the sessions.
- **Ticker scrolls once** (#156): a tool text too long for the ticker
  scrolls to its end and back once, then stands still and ends in "…"; the
  next text scrolls again. It used to scroll endlessly and so redrew the
  island at the full refresh rate (165 Hz here) for as long as a tool ran (measured with
  the new `tests/gpu`). The island's layer surface is
  now only as tall as the view shown (pill 1401×74 instead of 1401×851):
  it grows at once and shrinks after the resize has settled. Qt redraws
  the whole surface on every frame something moves, so each animation
  costs about a third less on the graphics card.
- **The hook waits only for a living island** (#149, review M1): the island
  writes a sign of life every 5 s (`$XDG_RUNTIME_DIR/omarchy-buddy/island`,
  tmpfs). An approval, question or plan from Claude, Codex or opencode
  waits for the island only while that file is younger than 15 s and
  Hyprland runs (`HYPRLAND_INSTANCE_SIGNATURE`); otherwise the session shows
  "braucht dich" and the terminal asks at once instead of after 30 s / 5 min.
  The feed checks every 15 minutes whether anyone holds
  `org.freedesktop.Notifications` (`omarchy-buddy-check --rueckfall`): if the
  shell runs but nobody does, Omarchy's notifications come back as after an
  update. Quiet while all is well (no log, no wait).
- **Stable installation apart from main** (#150): `./install.sh --stable`
  (main checkout, on main, committed) runs `tests/run` and, if green, pulls
  main into `~/.local/share/omarchy-buddy-stable` and links that live. A
  merge is no longer live by itself. `./install.sh` in a worktree still
  tries it live; in the main checkout it now switches back to the stable
  clone (to the main checkout only while there is none). `--status` also
  shows the stable and the main version.
- **Plans never load images from the net** (#148, security): an image with
  a title (`![x](URL "t")`) or in reference style (`![x][r]`, `![x]`) stayed
  an image in the plan view, and Qt fetched it as soon as the plan showed.
  Every `![` is now a link (clickable as before); questions and permission
  requests were never affected (plain text).
- **Rewritten notifications pop up again** (#155): a notification the
  sender replaces (`replaces_id`, e.g. Beeper per chat) shows the new text
  as a pop-up again, also after the old one ran out, and moves to the top of
  the history; a waiting or held-back pop-up follows too. One the sender
  withdraws while you are away or in the open view no longer pops up on your
  return. "Verlauf ohne Text" keeps no commands either (a notification's
  click and Omarchy's buttons), in `notifications.json` and `popups.json`.
- **Uptime Kuma and GitHub in the settings** (#164): settings → News →
  "Uptime Kuma: status page address" saves `feed.kuma` in `config.json`,
  only an address ending in `/status/NAME` (otherwise a red line), and tries
  the page at once (`omarchy-buddy-feed --test-kuma URL`): found, or
  "Uptime Kuma unreachable" (saved anyway). Empty: off. The "GitHub" switch
  (on by default, `feed.github`) turns the gh source (#167) off; signed out,
  it says to run `gh auth login`. No restart: the feed reads the file on
  every run.
- **Feinschliff calendar, crashes and long commands** (#169): calendar
  reminders stay until clicked away like critical ones, but not red; in
  Ruhemodus they only go into the history. News with an action get a real
  button in the list and in the pop-up: "Investigate" on a crash item,
  "Update" on the updates item (a click elsewhere on the item or pop-up no
  longer starts them; their texts name the button). A long command says
  "Command finished after 3 min" with the command on exit 0, otherwise
  "Command failed after 3 min" with the command and "(exit code 2)". The
  line under "Report long commands" is short now ("Added to ~/.bashrc.
  Applies to new terminals." / "Removed."); the setup run in a terminal
  still names the backups.
- **GitHub in the island** (#167): with `gh` installed and signed in, every
  run reads the unread notifications (`gh api notifications`, read only) and
  brings review requests, mentions, failed workflow runs and replies in your
  own issues/PRs; each thread once per new activity, several in one item, a
  click opens the page. Without `gh` or signed out: nothing, silently.
- **Crashes and low battery in the island** (#165): the feed reads your own
  programs' new core dumps (`coredumpctl`, read only) into one item with
  their names; a click hands the newest to Omarchy's default agent and its
  diagnose-crash skill (`omarchy-agent-crash`), without one `coredumpctl
  info` in a terminal. The setup links `hooks/battery-low` into Omarchy's
  `battery-low.d`, which keeps the warning with the percentage. Omarchy's own
  "Process crashed" and "Time to recharge!" pop-ups leave nothing in the
  history; where Omarchy showed one, the item only goes into the history, no
  second pop-up. Omarchy's crash capture switch and per-program mutes count.
  Battery tried with a replayed event (no laptop here).
- **Long terminal commands** (#168, off by default): settings → News →
  "Report long commands". A command in bash or zsh that ran a minute or longer
  and ends while its terminal is not in front brings "Command finished after
  N min" with the command and its exit code; a click brings the terminal up.
  The switch adds one marked line to `~/.bashrc` and `~/.zshrc`
  (`lib/long-commands.sh`; at the prompt it only takes a time stamp, the rest
  runs in the background) and takes exactly that out again, also on
  `--remove`. A file chezmoi manages is left alone; the settings show the
  line to add there. Commands that start an agent (claude, codex …) are not
  reported twice; tmux and other terminals without a window of their own are
  left out.
- **Uptime Kuma in the island** (#146): `"feed": {"kuma": "https://HOST/status/SLUG"}`
  in `config.json` reads that status page's public JSON every 15 minutes; a
  monitor that goes down is a warning with its name and since when (several
  in one item), back up once it ran 10 minutes without a down beat, so
  flapping is one outage. Off unless set; README on ntfy for the phone.
- **Feinschliff Spotify and web notifications** (#163): Chromium's
  untranslated "Settings" button is gone from web notifications (only where
  the site was recognised, #147; the site's own buttons stay). Connected to
  Spotify, the check for a saved track is Spotify's green (`Theme.spotify`,
  darker on light themes, at least 3:1) and a click takes the track out of
  the Liked Songs again (`DELETE /me/library`). The settings show the
  Spotify section only once a Spotify player ran (kept in `ui.json`), and
  always while connected.
- **Spotify's + without setup** (#162): while Spotify's desktop app
  plays and has a window (also hidden in the scratchpad), the player window
  shows the + that sends Spotify its own "Like" shortcut (Alt+Shift+B) to
  that window by its address (Hyprland 0.56's Lua dispatcher); it toggles,
  so a short line says it was sent and that an already liked track is out
  again. No window or a failed send: no +. Connected (below), the real state
  as before; the settings say what connecting adds. Tried
  against a test window and `tests/fake-hyprctl`, not against a real Spotify.
- **Spotify's +** (#121, optional): connected to the user's own Spotify app
  (settings → Spotify: Client ID, sign in once in the browser, PKCE without a
  secret), the player window shows a + beside a Spotify track that saves it
  to the Liked Songs, a check when it is in there, and a clear line with
  "Neu verbinden" or "Noch mal" when the sign-in expired, the app may not or
  Spotify cannot be reached. `bin/omarchy-buddy-spotify` holds the tokens
  (`spotify.json`, 600) and never prints them; the island only sees its
  answers. Uses Spotify's library endpoints of February 2026
  (`/me/library`, `/me/library/contains`); tried against a stand-in server
  (`tests/spotify-test.py`), not yet with a real Spotify app.
- **Omarchy 4.5's agents** (#145): Antigravity (`agy`, 4.5's Gemini), Qwen
  Code, Kimi, Devin, Command Code and Kiro CLI show state, ticker, the done
  pop-up and "needs you" like Gemini or Crush; the answer stays in their
  terminal. The setup adds the hook only where the agent's folder is, others'
  hooks stay. Built from the agents' docs and Orca's hook setup, not yet
  tried with the real programs. Hermes, Amp, Kilo, OpenClaw, DeepSeek
  Harness, MiniMax Code, Freebuff and Ori are left out.
- **Calendar reminders** (#166): reminders from GNOME Calendar and
  Evolution (`evolution-alarm-notify`), KOrganizer and Merkuro (`kalendarac`)
  and web calendars (Google Calendar, Proton, Zoho, Notion, Morgen, Tuta)
  get their own mark, a calendar, on the app icon and in the pill; GNOME's
  show the event as the title instead of "Erinnerungen". Before, GNOME's
  had the mail mark ("evolution"). Thunderbird's and Outlook's cannot be
  told from their mail and keep the letter. Fixtures in
  `tests/fixtures/calendar-notes/`.
- **Web notifications by site** (#147): notifications from Chromium,
  Chrome, Brave & co. (also Omarchy's web apps) show the site as sender
  instead of "Chromium" ("Instagram", "Discord", "Gmail", else the host)
  and drop the origin line from the text; known chat and mail sites get the
  chat or mail mark. Firefox sends no origin and stays "Firefox".
- **Muse Code** (#144): state, ticker, the done pop-up and "needs you" with
  the command it is about to run; the answer stays in its terminal (its
  PermissionRequest comes before Muse's own decision, so the island does not
  answer it). The setup adds our hooks to `~/.config/muse/settings.json`
  next to Orca's, only where that folder is. Recorded with Muse's offline
  provider; tool events after Orca's Muse parser.
- **tests/sandbox**: runs a command with HOME and every XDG folder in a
  fresh temporary folder and says loudly if the real HOME's agent or buddy
  files changed meanwhile. The setup and golden tests set all XDG folders.

- **Omarchy's notification keys**: the island answers `notifications.act`
  (`Super + Komma`: click, press the one button or put away the newest
  pop-up; more than one choice works like the keyboard key),
  `notifications.keyboard` (`Super + Strg + Komma`: the big view opens with
  the newest notification's first button focused), `invokeAction` and
  `count`.
- **Omarchy's buttons**: buttons from `omarchy-notification-send --action`
  (hint `omarchy-actions`, e.g. "Play" on a saved screen recording) show in
  the pop-up and the history and run without the sender. Omarchy's feedback
  with buttons stays in the history.
- **Update check**: the contract test reads Omarchy 4.5's `ShellIpc` and the
  Lua key bindings (`{ ipc = "notifications.act" }`) and names missing
  functions; it also says when Omarchy has a new indicator list.
- **Bar indicators**: the list the setup writes (Omarchy's minus
  do-not-disturb) follows Omarchy's current list after an update
  (`omarchy-buddy-setup --indicators`, run by `omarchy-buddy-check`).
- **Setup keeps the hook order**: `omarchy-buddy-setup` (and `./install.sh`)
  leaves the buddy's hooks in `~/.claude/settings.json` and
  `~/.codex/hooks.json` where they stand among Orca's or herdr's; outdated
  ones are replaced in place, only missing ones are appended. A second run
  writes the same bytes.
- **Several Claude subscriptions** (Omarchy 4.5 agent accounts): limit
  warnings and "free again at" per account.
- **Omarchy's default agent**: "Default: Claude" at the right of the
  Agents heading in the big view (the one `SUPER + SHIFT + A` starts); a
  click opens Omarchy's own choice (`omarchy-menu summon
  setup.default.agent`). Follows a change at once; hidden without a default
  or without Omarchy's menu.
- **Limits out of the island**: the 5-hour and weekly limit no longer stand
  in the big view, Omarchy's Agents panel shows them for every agent. The
  warning from `limitWarn`, "free again at …" and a session's context stay.
- **opencode, Pi and Oh My Pi in the island** (#142), through their plugin
  interfaces: state, ticker, done pop-up and "needs you". opencode 2.2's
  approvals get Allow / Always / Deny in the island, with the command or
  the file change as a diff; the answer goes back with
  `ctx.permission.reply`, while opencode asks in its terminal as usual
  (whichever answers first counts; no island, no answer within 30 s or an
  error only leaves the terminal). Its questions (forms) show as "needs
  you". Oh My Pi says when it asks (only its terminal can answer); Pi has
  no approvals. The plugins live in `agent-plugins/`; the setup puts a small
  file of ours into `~/.config/opencode/plugins/`, `~/.pi/agent/extensions/`
  and `~/.omp/agent/extensions/` that loads them from the plugin folder
  (nothing happens if that is gone), `--remove` deletes exactly that file;
  Orca's and herdr's plugins stay. opencode runs as one background service
  for all its terminals; the hook finds a session's terminal by its folder,
  like Codex's app-server. Tested with recordings of the real programs
  against a stand-in model server, without login.
- **More agents in the island** (#141): Gemini CLI 0.66, Crush 0.99, Grok
  1.0, Cursor CLI and GitHub Copilot CLI 1.0 show state, ticker, done
  pop-up and "needs you" with what they ask; the answer stays in their
  terminal (their hooks can deny at most, never allow). Each has its mark.
  The setup adds `omarchy-buddy-hook --agent NAME` to Gemini's
  `settings.json`, Crush's `crush.json` and an own
  `~/.copilot/hooks/omarchy-buddy.json`; `--remove` takes exactly that out.
  Grok and Cursor run the Claude hooks already; the hook now recognises them
  instead of showing their sessions as Claude. Those agents wait for every
  hook, so the hook answers at once and goes on in the background. Gemini,
  Crush and Grok are tested with recordings (a stand-in model server, no
  login), Cursor and Copilot with events built from their docs. opencode,
  Pi, Oh My Pi, Muse and the agents Omarchy 4.5 adds came later.
- **Codex sessions in the island** (Codex CLI 0.165): state, ticker (also
  apply_patch with its files), done pop-up, Escape (Interrupt) and requests
  with Allow / Deny in Codex's answer format, its file changes as a diff;
  Escape shows "interrupted" until the next prompt. Every card names its
  agent, "needs you" shows the asking agent's logo (cod-openai for Codex),
  the section is called "Agents" (also in German, like Omarchy); further agents need one row in
  `SessionLogic.agents` and the hook's translation. Works with Codex's shared
  background server (its hooks run under the server: the session's own
  `codex` is found by its folder). The setup adds the hook to
  `~/.codex/hooks.json` and trusts it in `config.toml` (also for Omarchy
  4.5's further Codex accounts), `--remove` takes exactly that out again.
  Recorded Codex hook inputs (`tests/record-codex-events`, no costs) and
  golden tests.
- **AGENTS.md**: the project rules for Claude Code and Codex in one file;
  `CLAUDE.md` imports it.
- **Diff before allowing**: a request to change a file (Edit, MultiEdit,
  Write, NotebookEdit) shows the change in its own box like the plan: the
  file and its line counts on top, removed and added lines with "−" and "+"
  and their colour, long unchanged stretches folded, long lines wrapped. A
  new file is all "+". Very big changes are cut with a note; the diff is
  never kept in the history. Codex's `apply_patch` can hand in the same
  form (`request.edits`, see `shell/DiffLogic.js`).
- **Language "auto"** follows Omarchy's language choice
  (`~/.config/omarchy/language`, German for de, English otherwise), without
  one the system's `LANG` as before.
- **Songs stay out of the history**: a new track (Spotify and any MPRIS
  player) still pops up briefly with its skip button, but no longer lands in
  the history; the player window shows it. Song entries already in
  `notifications.json` go on the next shell start.
- **`--remove` keeps hooks of others** (#154): a hook someone put into the
  same group as ours (Claude, Codex, Gemini, Qwen, Devin, Command Code,
  Muse) used to go with the whole group. Now only our handler comes out;
  the others stay in their group with its matcher, and a group is only
  dropped once it is empty. Setting up moves ours into a group of its own
  next to it; Codex's trust for the moved hooks moves along. The old status
  line no longer gets lost when `statusline.json` is missing (e.g. after
  "Reset history"): the setup takes it from our status line's guard and
  writes `statusline.json` again, `--remove` puts it back.

## 1.0.0 – 2026-10-30

First release.

- **Island under the clock** with O-Morchy: pill, peek on hover, pop-ups and a
  big view with sessions, news and the notification history; zoom from the
  pixel density, follows the focused monitor, light and dark themes,
  time-based animations, "reduce motion".
- **Claude Code**: one hook for every event and a status line in front of
  yours. Allow / Always allow / Deny, questions with several choices and an
  own answer, plan approval with "Revise …", a queue for several requests,
  jump to the terminal (also Orca panes), ticker of the running tool, 5-hour
  and weekly limits, context, plain-language API errors, sessions in the
  background, "End …".
- **Notifications**: replaces Omarchy's notification server and answers its
  `notifications` IPC; bundling, flood summary, actions, inline replies,
  critical pop-ups survive a shell restart, do not disturb, rules per app;
  messages from people carry a speech bubble (chats) or a letter (mail) on
  the app icon, from the sender's category or a list of known apps.
- **News**: pending updates every 12 hours as one item (Omarchy, pacman, AUR,
  mise, npm, Flatpak, apt, dnf, Homebrew and more, read-only), a click updates
  them in a floating terminal; full disks, failed services, new Claude Code, Omarchy and
  Orca versions, morning greeting; `omarchy-buddy-say` for your own items.
- **Privacy**: state and settings only readable by you, history full / without
  text / off (news and critical pop-ups included), the island hides while
  you share the screen.
- **Player window** beside the big view while any MPRIS player has a track
  loaded (also paused): cover, title, artist, a position bar to drag,
  back / play-pause / next.
- **Settings page** backed by `~/.config/omarchy-buddy/config.json`, watched
  and validated.
- **Setup and uninstall**: `omarchy-buddy-setup` with backups, `--remove`
  puts Omarchy back exactly as it was, `--uninstall` also removes the plugin;
  a check after Omarchy updates takes the whole setup back out (`--remove`)
  if the island does not load.
- English and German texts.
- Pre-release installs under the name "Companion" are migrated automatically
  (old folders copied, old entries in `settings.json` and `shell.json`
  replaced).
