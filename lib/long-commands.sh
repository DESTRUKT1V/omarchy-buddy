# Omarchy-Buddy: "Befehl fertig" for a command that ran a minute or longer
# (#168). Sourced by bash and zsh from the marked block omarchy-buddy-setup
# writes into ~/.bashrc / ~/.zshrc while "Lange Befehle melden" is on.
# At the prompt it only compares two numbers; whether the terminal is in
# front, which command it was and the news item are the hook's job, in the
# background (omarchy-buddy-hook --command).

[[ $- == *i* ]] || return 0
_omarchy_buddy_start=

_omarchy_buddy_precmd() {
  local s=$?
  if [[ -n $_omarchy_buddy_start ]] && (( SECONDS - _omarchy_buddy_start >= 60 )); then
    local took=$(( SECONDS - _omarchy_buddy_start )) cmd=$_omarchy_buddy_cmd
    # A subshell that starts it in the background (no job number, no "done");
    # bash reads the command from its history there.
    ( { [[ -n $BASH_VERSION ]] && cmd=$(HISTTIMEFORMAT= history 1 | sed 's/^ *[0-9]*\*\? *//')
        [[ -x $HOME/.local/bin/omarchy-buddy-hook ]] &&
          "$HOME/.local/bin/omarchy-buddy-hook" --command "$s" "$took" "$$" "$cmd"; } >/dev/null 2>&1 & )
  fi
  _omarchy_buddy_start=
  return $s
}

if [[ -n $ZSH_VERSION ]]; then
  _omarchy_buddy_preexec() { _omarchy_buddy_start=$SECONDS _omarchy_buddy_cmd=$1; }
  autoload -Uz add-zsh-hook
  add-zsh-hook preexec _omarchy_buddy_preexec
  precmd_functions=(_omarchy_buddy_precmd ${precmd_functions:#_omarchy_buddy_precmd})
elif [[ -n $BASH_VERSION && $PROMPT_COMMAND != *_omarchy_buddy_precmd* ]]; then
  # PS0 is expanded right before a command runs; the arithmetic sets the
  # start time and expands to nothing. First in PROMPT_COMMAND, so $? is
  # still the command's (and stays it for the others); as a string it keeps
  # an array PROMPT_COMMAND's further entries (bash-preexec, bash 5.1+).
  PS0=${PS0-}'${_omarchy_buddy_start:0:$((_omarchy_buddy_start=SECONDS,0))}'
  PROMPT_COMMAND="_omarchy_buddy_precmd${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi
