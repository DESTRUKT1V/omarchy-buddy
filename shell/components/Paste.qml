import QtQuick
import Quickshell.Io
import "../PasteLogic.js" as PasteLogic

// Paste for a TextInput, in place of Qt's own (#252): Ctrl+V and
// Shift+Insert (the clipboard) and the middle button (the selection) fetch
// the text with wl-paste, bounded in bytes and time (PasteLogic.command),
// and insert it only while the field still has the focus, shows and is as it
// was. Sits on the TextInput (its parent), which hands it its keys:
// Keys.onPressed: (event) => paste.key(event)
// `tooMuch` is true for a few seconds after a paste over the limit; the field
// shows TooMuchHint for it (#260).
MouseArea {
  id: paste
  readonly property TextInput input: parent
  property var request: null   // the paste waiting for its text
  property var fetching: null  // its wl-paste
  property int serial: 0
  property bool tooMuch: false
  anchors.fill: parent
  acceptedButtons: Qt.MiddleButton
  // Like Qt's: the middle button pastes where it was pressed.
  onPressed: (mouse) => {
    input.forceActiveFocus()
    input.deselect()
    input.cursorPosition = input.positionAt(mouse.x, mouse.y)
    start(true)
  }

  function key(event) {
    if (!PasteLogic.isPasteKey(event.matches(StandardKey.Paste), event.key, event.modifiers)) return
    event.accepted = true
    start(false)
  }
  function now(id) { return PasteLogic.snapshot(id, input.text, input.selectionStart, input.selectionEnd, input.cursorPosition) }
  function start(primary) {
    cancel()
    tooMuch = false
    if (input.readOnly) return
    request = now(++serial)
    fetching = fetch.createObject(paste, { pasteId: serial, command: PasteLogic.command(primary) })
    fetching.running = true
    deadline.restart()
  }
  // A newer paste, a change to the field or its closing retires the
  // waiting one: its wl-paste is ended, its text never inserted.
  function cancel() {
    request = null
    deadline.stop()
    if (!fetching) return
    if (fetching.running) fetching.signal(15)
    else fetching.destroy()  // it never started: no exited to clean up after it
    fetching = null
  }
  function finish(id, output) {
    var usable = input.visible && input.focus
    var edit = PasteLogic.result(request, id, now(id), usable, output)
    var over = PasteLogic.tooMuch(request, id, now(id), usable, output)
    if (id !== serial) return
    request = null
    fetching = null  // it destroys itself when it exits
    deadline.stop()
    if (over) { tooMuch = true; hint.restart() }
    if (!edit) return
    if (edit.end > edit.start) input.remove(edit.start, edit.end)
    input.insert(edit.start, edit.text)
  }

  Connections {
    target: paste.input
    function onFocusChanged() { paste.cancel() }
    function onActiveFocusChanged() { paste.cancel() }
    function onVisibleChanged() { paste.cancel(); paste.tooMuch = false }
    function onTextChanged() { if (paste.request) paste.cancel() }
    function onCursorPositionChanged() { if (paste.request) paste.cancel() }
    function onSelectionStartChanged() { if (paste.request) paste.cancel() }
    function onSelectionEndChanged() { if (paste.request) paste.cancel() }
  }
  Component.onDestruction: cancel()
  Timer { id: deadline; interval: PasteLogic.deadlineMs; onTriggered: paste.cancel() }
  Timer { id: hint; interval: PasteLogic.hintMs; onTriggered: paste.tooMuch = false }
  Component {
    id: fetch
    // Answers once both the output and the exit are in (either comes first):
    // only an exit 0 counts (PasteLogic.outputOf).
    Process {
      id: proc
      property int pasteId
      property string out: ""
      property bool read: false
      property bool ended: false
      property bool normal: false
      property int code: -1
      function settle() {
        if (!read || !ended) return
        paste.finish(pasteId, PasteLogic.outputOf(code, normal, out))
        destroy()
      }
      stdout: StdioCollector { onStreamFinished: { proc.out = text; proc.read = true; proc.settle() } }
      onExited: (exitCode, exitStatus) => { code = exitCode; normal = exitStatus === 0; ended = true; settle() }
    }
  }
}
