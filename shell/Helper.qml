import QtQuick
import Quickshell.Io
import "HelperLogic.js" as HelperLogic

// A finite background helper (#255, HelperLogic.js): started with start(),
// it ends after `seconds` with everything it started, keeps at most `limit`
// characters of its output and sends `done` exactly once per start, also
// when it could not start (Quickshell then sends no `exited`, only
// runningChanged). `payload` goes on stdin, never as an argument (#219).
Process {
  id: helper
  property var argv: []
  property int seconds: 30
  property int limit: 65536
  property string payload: ""
  property string output: ""
  property bool active: false  // from start() until done
  property bool queued: false  // request() while active: once more afterwards, with the argv then
  property bool over: false
  property bool late: false
  property bool ended: false   // exited came
  property int code: -1
  // result: HelperLogic.outcome ("ok", "start", "time", "output", "exit")
  signal done(string result, string output)

  command: HelperLogic.command(argv, seconds)
  stdout: SplitParser {
    splitMarker: ""  // every piece as it comes, nothing buffered (StdioCollector keeps all)
    onRead: data => helper.take(data)
  }

  function start() {
    if (active) return false
    output = ""
    over = false
    late = false
    ended = false
    code = -1
    stdinEnabled = payload !== ""
    active = true
    watchdog.restart()
    running = true
    return true
  }

  // For a switch: never lost while the last run still goes.
  function request() { if (!start()) queued = true }

  function take(data) {
    if (over || !active) return
    var r = HelperLogic.take(output, data, limit)
    output = r.text
    if (r.over) { over = true; running = false }  // TERM: timeout passes it to the group
  }

  onStarted: if (stdinEnabled) { write(payload); stdinEnabled = false }
  // A crash (exitStatus 1) gives the signal: as the shell counts it, 128 + signal
  // (timeout's KILL after the grace time ends timeout itself too).
  onExited: (exitCode, exitStatus) => { ended = true; code = exitStatus === 0 ? exitCode : 128 + exitCode }
  onRunningChanged: if (!running && active) {
    active = false
    watchdog.stop()
    done(HelperLogic.outcome(ended, code, over, late), output)
    if (queued) { queued = false; start() }
  }

  // Only if timeout(1) itself hung: it ends the group well before this.
  // (A property: Process takes no children.)
  property Timer watchdog: Timer {
    interval: (helper.seconds + HelperLogic.graceSeconds + 5) * 1000
    onTriggered: { helper.late = true; helper.signal(9) }
  }
}
