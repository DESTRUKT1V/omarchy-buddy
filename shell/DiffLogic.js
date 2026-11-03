.pragma library
.import "Strings.js" as Strings
.import "IslandLogic.js" as IslandLogic

// A file change before it is allowed (Edit, MultiEdit, Write, NotebookEdit;
// Codex's apply_patch later) as diff rows for the island. Pure functions, so
// tests/diff-logic.test.js can load this file in Node.
//
// Input: request.edits as omarchy-buddy-hook writes it, one entry per change:
//   { file: "/path", old: "text before", new: "text after", created: bool }
// created: a new file (all of it "+"). A patch with context lines (apply_patch)
// fits the same form: its " " and "-" lines are old, its " " and "+" lines new.

var context = 3        // unchanged lines kept around a change
var maxRows = 400      // rows shown at most; the rest is in the terminal
var lcsMax = 250000    // old × new lines beyond this: all "-", then all "+"

function splitLines(text) {
  text = String(text || "")
  if (text === "") return []
  var list = text.split("\n")
  if (list[list.length - 1] === "") list.pop()
  return list
}

// Old and new lines → [{kind: "same"|"del"|"add", text}], the longest
// common subsequence between a common start and end.
function lineDiff(a, b) {
  var start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  var endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  var rows = [], i, j
  for (i = 0; i < start; i++) rows.push({ kind: "same", text: a[i] })
  var n = endA - start, m = endB - start
  if (n * m > lcsMax) {
    for (i = start; i < endA; i++) rows.push({ kind: "del", text: a[i] })
    for (j = start; j < endB; j++) rows.push({ kind: "add", text: b[j] })
  } else {
    // len[i][j]: common lines of a[start+i…] and b[start+j…]
    var len = [], row
    for (i = n; i >= 0; i--) {
      row = new Array(m + 1)
      for (j = m; j >= 0; j--)
        row[j] = i === n || j === m ? 0
          : a[start + i] === b[start + j] ? len[0][j + 1] + 1 : Math.max(len[0][j], row[j + 1])
      len.unshift(row)
    }
    i = 0; j = 0
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) { rows.push({ kind: "same", text: a[start + i] }); i++; j++ }
      else if (i < n && (j === m || len[i + 1][j] >= len[i][j + 1])) { rows.push({ kind: "del", text: a[start + i] }); i++ }
      else { rows.push({ kind: "add", text: b[start + j] }); j++ }
    }
  }
  for (i = endA; i < a.length; i++) rows.push({ kind: "same", text: a[i] })
  return rows
}

// Long unchanged stretches become one "gap" row with their line count;
// `context` lines stay next to each change.
function folded(rows) {
  var out = [], i = 0
  while (i < rows.length) {
    if (rows[i].kind !== "same") { out.push(rows[i]); i++; continue }
    var end = i
    while (end < rows.length && rows[end].kind === "same") end++
    var keepStart = i === 0 ? 0 : context, keepEnd = end === rows.length ? 0 : context
    if (end - i > keepStart + keepEnd + 1) {
      for (var k = i; k < i + keepStart; k++) out.push(rows[k])
      out.push({ kind: "gap", count: end - i - keepStart - keepEnd })
      for (k = end - keepEnd; k < end; k++) out.push(rows[k])
    } else {
      for (k = i; k < end; k++) out.push(rows[k])
    }
    i = end
  }
  return out
}

// The edits → what the island shows: rows ({kind: "file"|"same"|"del"|"add"|
// "gap", text, count}), lines added and removed (all of them, also those cut),
// the files touched, and how many rows did not fit (`cut`). A "file" row
// starts each file when more than one is touched; a "gap" without count
// (count 0) parts two changes in one file.
function diff(edits) {
  // (in the open view's list the edits come through a Repeater's model: a
  // Qt list, not a JS array)
  edits = edits && typeof edits === "object" && typeof edits.length === "number"
    ? Array.prototype.filter.call(edits, function(e) { return e && typeof e === "object" }) : []
  var files = [], rows = [], added = 0, removed = 0
  edits.forEach(function(e) {
    var file = String(e.file || "")
    if (files.indexOf(file) === -1) files.push(file)
  })
  var last = null
  edits.forEach(function(e) {
    var file = String(e.file || "")
    var part = folded(lineDiff(e.created ? [] : splitLines(e.old), splitLines(e.new)))
    part.forEach(function(r) { if (r.kind === "add") added++; else if (r.kind === "del") removed++ })
    if (file !== last && files.length > 1) rows.push({ kind: "file", text: file })
    else if (file === last) rows.push({ kind: "gap", count: 0 })
    last = file
    rows = rows.concat(part)
  })
  var cut = Math.max(0, rows.length - maxRows)
  return { rows: rows.slice(0, maxRows), added: added, removed: removed, files: files, cut: cut }
}

// The line above the diff: the file (inside the session's folder without it),
// or how many files; a new file says so.
function title(d, created, cwd, lang) {
  if (d.files.length > 1) return Strings.tl(lang, "diff.files", d.files.length)
  var path = String(d.files[0] || ""), dir = String(cwd || "").replace(/\/+$/, "") + "/"
  if (dir !== "/" && path.indexOf(dir) === 0) path = path.slice(dir.length)
  return created ? Strings.tl(lang, "diff.created", path) : path
}

// Red and green of the diff, the same in every theme (GitHub's), so they
// read as red and green also where the theme's own are muted (like the
// replacement red, IslandLogic.shades). Rows: the colour over the box
// (fg 6 % over bg), weakened until the text keeps 4.5:1 on it; inks for
// "−"/"+" and the counts: 4.5:1 on the background, the box and their row.
// Colours as { r, g, b } from 0 to 1.
var diffShades = { dark: { add: "#2ea043", del: "#f85149", tint: 0.3 },
                   light: { add: "#1a7f37", del: "#cf222e", tint: 0.2 } }

function colors(fg, bg, light) {
  var sh = diffShades[light ? "light" : "dark"]
  var box = IslandLogic.mix(bg, fg, 0.06)
  var row = function(c) {
    for (var a = sh.tint; a > 0; a -= 0.02) {
      var r = IslandLogic.mix(box, c, a)
      if (IslandLogic.contrast(fg, r) >= 4.5) return r
    }
    return box
  }
  // darker (light themes) or lighter, never toward fg: the ink stays red or green
  var far = light ? { r: 0, g: 0, b: 0 } : { r: 1, g: 1, b: 1 }
  var addRow = row(IslandLogic.hex(sh.add)), delRow = row(IslandLogic.hex(sh.del))
  return { box: box, addRow: addRow, delRow: delRow,
           addInk: IslandLogic.readable(IslandLogic.hex(sh.add), far, 4.5, [bg, box, addRow]),
           delInk: IslandLogic.readable(IslandLogic.hex(sh.del), far, 4.5, [bg, box, delRow]) }
}

// What a "gap" row says.
function gapText(count, lang) {
  return count === 0 ? Strings.tl(lang, "diff.next") : Strings.tl(lang, count === 1 ? "diff.same.one" : "diff.same.many", count)
}
