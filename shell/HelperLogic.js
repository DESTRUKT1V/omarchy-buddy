.pragma library
.import "Strings.js" as Strings

// Finite background helpers (#255, Helper.qml): a setup call, a check, an
// answer passed on to the hook. Each ends after a deadline together with
// everything it started, keeps a bounded output, reports exactly once (also
// when it could not start) and only a few run at a time. Terminals and
// agents the user opens are no helpers: they run as long as the user wants
// (Quickshell.execDetached; omarchy-buddy-analyze lets its agent go).
// Pure functions, tested in Node (tests/helper-logic.test.js).

var graceSeconds = 3  // after the deadline TERM, this much later KILL
var maxRunning = 4    // helpers with input at the same time (Buddy.runWithInput)
var maxWaiting = 16   // waiting behind them; more are not started

// timeout(1) puts the command into a process group of its own and signals
// the whole group, on the deadline and when the shell ends it early: what
// the helper started goes with it (unless it left on purpose, like a terminal).
function command(argv, seconds) {
  return ["timeout", "-k", String(graceSeconds), String(seconds)].concat(argv)
}

// The output so far plus a new piece, at most `limit` characters. Over the
// limit the helper is stopped and the rest is never kept.
function take(kept, chunk, limit) {
  var room = limit - kept.length
  var piece = String(chunk)
  return piece.length > room ? { text: kept + piece.slice(0, Math.max(room, 0)), over: true }
                             : { text: kept + piece, over: false }
}

// How a run ended: "ok", "start" (could not start: no exit at all, or
// timeout's 125–127), "time" (ran past its deadline), "output" (said too
// much), "exit" (an error code).
function outcome(exited, code, over, late) {
  if (over) return "output"
  if (late || code === 124 || code === 137) return "time"
  if (!exited || (code >= 125 && code <= 127)) return "start"
  return code === 0 ? "ok" : "exit"
}

// Start now, wait, or not at all ("drop") with `running` helpers going and
// `waiting` queued.
function admit(running, waiting) {
  return running < maxRunning ? "run" : waiting < maxWaiting ? "wait" : "drop"
}

// What the settings page shows from a setup call: its own words when it ran
// to the end, else why it did not (to be tried again).
function said(result, output, lang) {
  var text = String(output || "")
  if (result === "ok" || (result === "exit" && text.trim() !== "")) return text
  return Strings.tl(lang, "helper." + (result === "exit" ? "failed" : result))
}

// A helper with input that did not get through: one pop-up (the same key,
// so failures do not pile up). `name` the program.
var failedKey = "buddy-helper-failed"
function failedToast(argv, result, time, lang) {
  var name = String(argv && argv[0] || "").split("/").pop()
  return { key: failedKey, time: time, source: "buddy", level: "warn",
           title: Strings.tl(lang, "helper.title"),
           body: Strings.tl(lang, "helper.body." + (["start", "time", "output", "drop"].indexOf(result) !== -1 ? result : "failed"), name) }
}
