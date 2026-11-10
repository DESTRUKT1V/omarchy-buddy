import QtQuick
import Quickshell
import "shell"

// Helper.qml (#255) in a real Quickshell, run by tests/helper-qml (offscreen):
// done comes exactly once per start, also when the program cannot start
// (Quickshell sends no exited then); a hanging helper, one that never reads
// its input, one that ignores TERM and one that prints without end end with
// the right result; a helper can be started again afterwards (retry), and
// request() while it runs runs it once more afterwards (a switch clicked twice).
ShellRoot {
  id: root
  property var results: ({})
  property int pending: 0
  function report(name, ok, detail) { console.log((ok ? "ok   " : "FEHLER ") + name + (ok ? "" : ": " + detail)) }
  function finished() { if (--pending === 0) console.log("FERTIG") }

  component Case: Helper {
    property string name
    property var expect: []        // results in order, one per start
    property var check: null       // function(output) -> bool, on the last
    property var got: []
    property int starts: 1
    property real began: 0
    onDone: (result, output) => {
      got = got.concat([result])
      if (got.length < starts) { start(); return }
      var ok = JSON.stringify(got) === JSON.stringify(expect) && (!check || check(output))
      root.report(name, ok, JSON.stringify(got) + " " + output.length + " Zeichen nach " + Math.round((Date.now() - began) / 100) / 10 + " s")
      root.finished()  // a second done would show up as a further line
    }
    Component.onCompleted: { root.pending++; began = Date.now(); start() }
  }

  Case { name: "normal: Eingabe auf stdin, Ausgabe zurück"; argv: ["tr", "a-z", "A-Z"]; payload: "hallo"
         expect: ["ok"]; check: o => o === "HALLO" }
  Case { name: "Startfehler: Quickshell sendet kein exited, done trotzdem genau einmal"
         command: ["/nonexistent/omarchy-buddy-nichts"]; expect: ["start"] }
  Case { name: "Programm fehlt hinter timeout → start"; argv: ["/nonexistent/omarchy-buddy-nichts"]; expect: ["start"] }
  Case { name: "hängt → time nach der Frist"; argv: ["sleep", "60"]; seconds: 1; expect: ["time"] }
  Case { name: "liest die Eingabe nie → time"; argv: ["sleep", "60"]; seconds: 1; payload: "x".repeat(1 << 22); expect: ["time"] }
  Case { name: "ignoriert TERM → time nach der Nachfrist"; argv: ["sh", "-c", "trap '' TERM; sleep 60"]; seconds: 1; expect: ["time"] }
  Case { name: "Ausgabe ohne Ende → output, nur limit behalten"; argv: ["yes"]; limit: 1000
         expect: ["output"]; check: o => o.length === 1000 }
  Case { name: "Fehlercode → exit, Ausgabe bleibt"; argv: ["sh", "-c", "echo kaputt; exit 3"]; expect: ["exit"]; check: o => o === "kaputt\n" }
  Case { name: "noch einmal starten (Wiederholen) geht"; argv: ["sh", "-c", "exit 1"]; starts: 2; expect: ["exit", "exit"] }
  Helper {  // a switch clicked twice while its last run goes: once more afterwards, with the new argv
    id: twice
    argv: ["sh", "-c", "sleep 0.3; echo eins"]
    property var outs: []
    onDone: (result, output) => {
      outs = outs.concat([output])
      if (outs.length < 2) return
      root.report("request() während er läuft: danach genau einmal mit dem neuen argv",
                  JSON.stringify(outs) === JSON.stringify(["eins\n", "zwei\n"]), JSON.stringify(outs))
      root.finished()
    }
    Component.onCompleted: root.pending++
  }
  // After loading: before it, Quickshell starts a process only once loaded, with the argv then.
  Timer {
    interval: 100
    running: true
    onTriggered: { twice.start(); twice.argv = ["sh", "-c", "echo zwei"]; twice.request(); twice.request() }
  }
  Case { name: "start() während er läuft: abgelehnt"; argv: ["sleep", "0.3"]; expect: ["ok"]
         Component.onCompleted: if (start() !== false) root.report(name, false, "zweiter Start angenommen") }
}
