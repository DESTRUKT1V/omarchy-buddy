# Omarchy-Buddy – rules for agents and contributors (Claude Code, Codex, people)

- **Only one checkout is live at a time, normally the stable clone**
  (`~/.local/share/omarchy-buddy-stable`, main as of the last `--stable`). A merge to main is not
  live by itself. `./install.sh --status` shows where the links point and both versions.
  To test a worktree live: run `./install.sh` there, afterwards `./install.sh` in the main
  checkout to switch back (to the stable clone). Check first that nobody else is testing live.
- **Leitstelle only:** after a merge, `./install.sh --stable` in the main checkout (on main, all
  committed) runs `tests/run` and, if green, pulls main into the stable clone and puts it live.
  The first `--stable` makes the clone. Back to the previous version:
  `git -C ~/.local/share/omarchy-buddy-stable reset --hard ORIG_HEAD`, then `./install.sh`.
- Run the setup or the hook by hand only through `tests/sandbox CMD …` (HOME and every XDG folder
  in a fresh temporary one; it warns loudly if the real HOME changed). Never `env $VARS …` in zsh.
- After QML changes: `omarchy restart shell`; errors in the newest
  `$XDG_RUNTIME_DIR/quickshell/by-id/*/log.log`.
- `tests/looks` photographs the real screen: run it only one at a time,
  `flock /tmp/omarchy-buddy-looks.lock tests/looks …` (several workers otherwise catch each other's windows).
- The hook must never block Claude or Codex or let them crash (always exit 0, status events async).
- Animations are time-based (monitors run at 60–240 Hz), no keyboard shortcuts, no sounds,
  no autostart.
- UI texts in German and English (`shell/Strings.js`, `lib/texts.py`); German addresses the
  user with „du“.
- Rules (sorting, bundling, states, texts) go into the `*Logic.js` files as pure functions;
  the QML files only hold state and display. Run `tests/run` before every commit.
- This file is the one source for Claude Code and Codex; `CLAUDE.md` only imports it
  (`@AGENTS.md`). No symlink: `omarchy-plugin-validate` refuses symlinks in a plugin.
