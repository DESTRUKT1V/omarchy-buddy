// Reading what Omarchy and Quickshell promise, for tests/contract.test.js:
// which "notifications" IPC calls Omarchy's scripts and key bindings make,
// which functions an IpcHandler offers, and which members a .qmltypes file
// declares.
"use strict"
const fs = require("node:fs")
const path = require("node:path")

// `omarchy-shell [-q] notifications METHOD` in a script, binding or QML
// file; since Omarchy 4.5 also `{ ipc = "notifications.METHOD" }` in the
// Lua key bindings and `ipc notifications.METHOD` in default/omarchy/shortcuts.
function ipcCalls(text, target) {
  const forms = ["omarchy-shell\\s+(?:-q\\s+)?" + target + "\\s+(\\w+)",
                 "\\bipc\\s*=\\s*[\"']" + target + "\\.(\\w+)[\"']",
                 "^ipc\\s+" + target + "\\.(\\w+)"]
  const re = new RegExp(forms.join("|"), "gm")
  return [...text.matchAll(re)].map(m => m[1] || m[2] || m[3])
}

// The functions of the IpcHandler (ShellIpc since Omarchy 4.5) with this
// target in a QML file (up to the handler's closing brace at its own indentation).
function ipcFunctions(qml, target) {
  const lines = qml.split("\n")
  const start = lines.findIndex((l, i) => /^\s*(IpcHandler|ShellIpc)\s*\{/.test(l) &&
    lines.slice(i, i + 4).some(x => x.includes(`target: "${target}"`)))
  if (start < 0) return []
  const indent = lines[start].match(/^\s*/)[0]
  const names = []
  for (let i = start + 1; i < lines.length && lines[i] !== indent + "}"; i++) {
    const m = /^\s*function\s+(\w+)\s*\(/.exec(lines[i])
    if (m) names.push(m[1])
  }
  return names
}

// Members (properties, methods, signals) of the qmltypes component that is
// exported as `name` ("Quickshell.Services.Notifications/Notification").
function qmlMembers(qmltypes, name) {
  const at = qmltypes.indexOf(`exports: ["${name} `)
  const start = at < 0 ? -1 : qmltypes.lastIndexOf("Component {", at)
  if (start < 0) return null
  const next = qmltypes.indexOf("\n    Component {", at)
  const block = qmltypes.slice(start, next < 0 ? undefined : next)
  return [...block.matchAll(/name:\s*"(\w+)"/g)].map(m => m[1])
}

// Every regular file below dir (symlinks followed), skipping the given
// directory names.
function files(dir, skip) {
  const out = []
  for (const entry of fs.readdirSync(dir)) {
    if (skip.includes(entry)) continue
    const p = path.join(dir, entry)
    let st
    try { st = fs.statSync(p) } catch (e) { continue }
    if (st.isDirectory()) out.push(...files(p, skip))
    else if (st.isFile() && st.size < 1e6) out.push(p)
  }
  return out
}

module.exports = { ipcCalls, ipcFunctions, qmlMembers, files }
