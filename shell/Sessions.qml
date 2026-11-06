import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Hyprland
import "SessionLogic.js" as SessionLogic
import "theme"

// Claude Code sessions and their requests. omarchy-buddy-hook keeps
// $XDG_RUNTIME_DIR/omarchy-buddy/state.json (one record per session) and
// waits for decisions written with --decide / --answer;
// omarchy-buddy-statusline keeps usage.json (the island reads the context; limits are the hook's). The rules are
// in SessionLogic.js.
Scope {
  id: store
  required property var app
  readonly property real now: app.now

  property var sessions: []
  property var previousStates: ({})
  property string raw: ""
  property string askKey: ""       // the ask shown in the needs view
  property string expandedKey: ""  // the ask whose full command is shown
  property var answers: ({})       // ask key → { question: [labels] } chosen so far
  property string typingKey: ""    // the text field open: ask key + "|" + question, or + "|plan"
  property string usageRaw: ""
  readonly property var usage: SessionLogic.parseUsage(usageRaw)
  property string endingKey: ""    // the session asked about before it ends
  property bool unfolded: false    // the long list shows every session (SessionLogic.folded)

  // The windows Hyprland has now: a session whose window is gone runs in the background.
  readonly property var windows: Hyprland.toplevels.values.map(function(t) { return String(t.address) })

  property var hidden: ({})        // rows the user hid: session id → its `updated` then

  readonly property var asks: SessionLogic.asks(sessions, now)
  readonly property int askPos: SessionLogic.askPos(asks, askKey)
  readonly property var currentAsk: asks.length ? asks[askPos] : null
  readonly property bool answerable: SessionLogic.answerable(asks)
  readonly property bool hasRequests: SessionLogic.hasRequests(sessions)
  readonly property int needsCount: SessionLogic.count(sessions, "needs", now)
  readonly property int workingCount: SessionLogic.count(sessions, "working", now)
  readonly property string workingName: SessionLogic.agentName(SessionLogic.workingAgent(sessions, now))
  readonly property string needsMark: SessionLogic.needsMark(sessions, now)
  readonly property string needsName: currentAsk ? SessionLogic.agentName(currentAsk.session.agent) : "Claude"
  readonly property int shownCount: SessionLogic.shownCount(sessions, now, hidden)
  readonly property var foldable: SessionLogic.folded(sessions, now, hidden)
  readonly property var folded: unfolded ? ({}) : foldable
  readonly property int foldedCount: Object.keys(foldable).length
  readonly property int backgroundCount: SessionLogic.backgroundCount(sessions, now, windows, hidden)
  readonly property string ticker: SessionLogic.ticker(sessions, now, hidden, Theme.lang)

  function stateOf(s) { return SessionLogic.stateOf(s, now) }
  function stateText(s) { return SessionLogic.stateText(s, now, Theme.lang) }
  function shown(s) { return SessionLogic.shown(s, now, hidden) }
  function canHide(s) { return SessionLogic.canHide(s, now) }
  function liveRequests(s) { return SessionLogic.liveRequests(s, now) }
  function background(s) { return SessionLogic.background(s, windows) }
  function canEnd(s) { return SessionLogic.canEnd(s, windows) }

  function load(text) {
    text = String(text || "{}")
    if (text === raw) return
    raw = text
    var next = SessionLogic.parseSessions(text, now)
    var change = SessionLogic.transitions(previousStates, next)
    if (change.changed) app.touch()
    // The pop-up for a finished run comes as a news item from the hook.
    if (change.finished.length) app.playEmote("celebrate", 2000)
    previousStates = SessionLogic.statesOf(next)
    sessions = next
    hidden = SessionLogic.hide(hidden, next, null)
    forgetAnswered()
  }

  // States age with the clock (a request runs out, a run goes quiet): the
  // order follows, without rebuilding the list when nothing moved.
  onNowChanged: {
    var next = SessionLogic.sortSessions(sessions, now)
    if (!SessionLogic.sameOrder(sessions, next)) sessions = next
  }

  // Off the list until its next hook event.
  function hide(session) {
    if (!SessionLogic.canHide(session, now)) return
    hidden = SessionLogic.hide(hidden, sessions, session)
    app.touch()
  }

  // Chosen answers and an open text field go with their request (answered,
  // in the terminal now, or run out); the keyboard is free again.
  function forgetAnswered() {
    var live = {}, list = SessionLogic.asks(sessions, Date.now() / 1000)
    for (var i = 0; i < list.length; i++) live[list[i].key] = true
    var kept = {}, dropped = false
    for (var key in answers) {
      if (live[key]) kept[key] = answers[key]
      else dropped = true
    }
    if (dropped) answers = kept
    if (typingKey !== "" && !live[typingKey.split("|")[0]]) typingKey = ""
  }
  onAsksChanged: {
    askKey = SessionLogic.shownKey(asks, askKey)
    if (typingKey !== "" || Object.keys(answers).length) forgetAnswered()
  }

  function pageAsk(step) {
    if (asks.length < 2) return
    askKey = SessionLogic.pagedKey(asks, askKey, step)
    app.touch()
  }

  // An answer to the waiting hook; the text field closes. The user's words
  // (text) go on stdin (Buddy.runWithInput).
  function toHook(args, text) {
    if (text === undefined) Quickshell.execDetached([app.hook].concat(args))
    else app.runWithInput([app.hook].concat(args), text)
    typingKey = ""
    app.touch()
  }

  function decide(session, request, decision) { toHook(["--decide", session.id, request.id, decision]) }

  // A plan goes back with the user's words; Claude keeps planning.
  function revisePlan(session, request, text) { toHook(["--decide", session.id, request.id, "revise"], String(text || "")) }

  // Omarchy's default agent (Omarchy 4.0.6: SUPER+SHIFT+A starts it). Hidden
  // without one or without Omarchy's menu; the menu sets it (and starts it).
  readonly property string defaultAgent: menuPresent ? SessionLogic.defaultAgentName(defaultAgentFile.text()) : ""
  property bool menuPresent: false
  function pickDefaultAgent() { Quickshell.execDetached([app.omarchyBin + "omarchy-menu", "summon", "setup.default.agent"]) }
  FileView {
    id: defaultAgentFile
    path: (Quickshell.env("XDG_CONFIG_HOME") || Quickshell.env("HOME") + "/.config") + "/omarchy/defaults/agent"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
  }
  Process {
    running: true
    command: ["test", "-x", store.app.omarchyBin + "omarchy-menu"]
    onExited: (code) => store.menuPresent = code === 0
  }

  function selection(ask) { return answers[ask.key] || ({}) }

  function setSelection(ask, sel) {
    var next = Object.assign({}, answers)
    next[ask.key] = sel
    answers = next
    app.touch()
  }

  // A click on an option; with one question and one choice that answers.
  function choose(ask, q, label) {
    var sel = SessionLogic.toggleOption(selection(ask), q, label)
    if (SessionLogic.answersAtOnce(ask.request.questions)) sendAnswers(ask, sel)
    else setSelection(ask, sel)
  }

  function ownAnswer(ask, q, text) {
    var sel = SessionLogic.setOwnAnswer(selection(ask), q, text)
    typingKey = ""
    if (SessionLogic.answersAtOnce(ask.request.questions) && text.trim() !== "") sendAnswers(ask, sel)
    else setSelection(ask, sel)
  }

  function sendAnswers(ask, sel) {
    var payload = SessionLogic.answerPayload(ask.request.questions, sel || selection(ask))
    toHook(["--answer", ask.session.id, ask.request.id], JSON.stringify(payload))
  }

  // A forgotten session: SIGTERM to its claude, then --prune (the hook checks the pid).
  function endSession(session) {
    Quickshell.execDetached([app.hook, "--end", session.id])
    endingKey = ""
    app.touch()
  }

  function focusSession(session) {
    // The waiting hooks give up, so the terminal shows its prompts.
    if (session.requests.length) Quickshell.execDetached([app.hook, "--decide", session.id, "focus"])
    app.focusTarget(session)
    app.opened = false
  }

  FileView {
    id: sessionFile
    path: store.app.ready ? store.app.runDir + "/state.json" : ""
    watchChanges: true
    printErrors: false
    onLoaded: store.load(text())
    onLoadFailed: store.load("{}")
    onFileChanged: reload()
  }

  FileView {
    id: usageFile
    path: store.app.ready ? store.app.runDir + "/usage.json" : ""
    watchChanges: true
    printErrors: false
    onLoaded: store.usageRaw = text()
    onLoadFailed: store.usageRaw = ""
    onFileChanged: reload()
  }
  // The watcher does the work; atomic replaces can slip past it, so a slow
  // reload is the safety net (unchanged text is ignored).
  Timer {
    interval: 15000
    running: true
    repeat: true
    onTriggered: { sessionFile.reload(); usageFile.reload(); defaultAgentFile.reload() }
  }
  // Every 30 s --prune drops sessions whose claude is gone.
  Timer {
    interval: 30000
    running: true
    repeat: true
    onTriggered: if (store.sessions.length > 0) Quickshell.execDetached([store.app.hook, "--prune"])
  }
  // While a hook waits: the countdown ticks every second, and every few
  // seconds --prune drops requests whose hook was killed.
  Timer {
    property int ticks: 0
    interval: 1000
    running: store.hasRequests
    repeat: true
    onTriggered: {
      store.app.now = Date.now() / 1000
      if (++ticks % 5 === 0) Quickshell.execDetached([store.app.hook, "--prune"])
    }
  }
}
