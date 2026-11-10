.pragma library

// Pasting into the island's text fields (#252) without Qt's own paste: Qt
// reads the whole clipboard offer synchronously, with no byte or time limit,
// inside the shared shell. Paste.qml fetches it with wl-paste instead, in a
// separate process with a byte and an absolute time limit, and inserts it
// only while the field is still as it was when the user pasted. Pure
// functions (no Quickshell, no QML), so tests/*.test.js can load this file.

var maxBytes = 65536    // more than any field here needs; more is dropped, not cut
var limitSeconds = 2    // the whole transfer, from asking to the last byte
// The island's own backstop for a fetch that never reports back (it could
// not start): later than the command's own limit plus its kill grace.
var deadlineMs = (limitSeconds + 3) * 1000

// The command for one paste. The inner `timeout` ends its whole process
// group at the limit (wl-paste hands the transfer to a `cat` of its own),
// even when the island is gone. The outer one is what the island signals
// when it cancels: it passes SIGTERM on to the inner one at once, and if
// it is killed itself, the inner one still ends in time. head stops reading
// one byte past the limit, so too much shows as too long.
function command(primary) {
  return ["timeout", "-k", "1", String(limitSeconds + 1),
          "timeout", "-k", "1", String(limitSeconds),
          "sh", "-c", "wl-paste --no-newline --type text \"$@\" | head -c " + (maxBytes + 1),
          "sh"].concat(primary ? ["--primary"] : [])
}

// Ctrl+V, Shift+Insert and the Paste key: `matchesPaste` is the QML key
// event's matches(StandardKey.Paste), the rest Qt's key and modifier values.
var keyInsert = 0x01000006
var keyPaste = 0x010000e2
var shiftModifier = 0x02000000
function isPasteKey(matchesPaste, key, modifiers) {
  return matchesPaste === true || key === keyPaste || (key === keyInsert && (modifiers & shiftModifier) !== 0)
}

// The text a fetch brought, as far as it counts: only from a command that
// ended on its own (exit 0, also when head stopped one byte past the
// limit); a timeout, a signal or an error brings at most part of it, which
// is never inserted.
function outputOf(exitCode, normalExit, text) {
  return normalExit && exitCode === 0 ? String(text || "") : ""
}

// What the field looked like: a result applies only to exactly this.
function snapshot(id, text, selectionStart, selectionEnd, cursorPosition) {
  return { id: id, text: String(text), start: selectionStart, end: selectionEnd, cursor: cursorPosition }
}

// Bytes of `s` as UTF-8. Never fewer than the bytes that came in: an
// invalid byte arrives as U+FFFD, which counts three.
function utf8Bytes(s) {
  var n = 0
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { n += 4; i++ }
    else n += 3
  }
  return n
}

// Whether a finished fetch still applies: `request` is the paste still
// waiting (null once cancelled), `id` the fetch that finished, `now` the
// field's snapshot at this moment, `usable` whether it still has the focus
// and shows. Not when another paste came since or the field changed (text,
// selection, cursor).
function applies(request, id, now, usable) {
  if (!request || request.id !== id || !usable || !now) return false
  return now.text === request.text && now.start === request.start && now.end === request.end && now.cursor === request.cursor
}
function textOf(output) { return String(output === undefined || output === null ? "" : output) }

// The edit a finished fetch makes, or null: nothing when it no longer
// applies, the text is empty or over the limit.
function result(request, id, now, usable, output) {
  if (!applies(request, id, now, usable)) return null
  var text = textOf(output)
  if (text === "" || utf8Bytes(text) > maxBytes) return null
  return { start: request.start, end: request.end, text: text }
}

// The field says "Zu viel zum Einfügen" for hintMs (#260): only when the
// paste still applies and its text is over the limit, never when it was
// empty, cancelled or ran out of time (head ends a long one at the limit,
// so a timeout always brings less).
var hintMs = 4000
function tooMuch(request, id, now, usable, output) {
  return applies(request, id, now, usable) && utf8Bytes(textOf(output)) > maxBytes
}
