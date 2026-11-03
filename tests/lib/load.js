// Loads one of the plugin's .pragma library files (shell/*.js)
// in Node: the QML pragma goes, `.import "X.js" as Y` loads X the same way,
// and every top-level function and var comes back as one object.
"use strict"
const fs = require("node:fs")
const path = require("node:path")

const DIR = path.join(__dirname, "..", "..", "shell")
const cache = {}

function load(name) {
  if (cache[name]) return cache[name]
  const src = fs.readFileSync(path.join(DIR, name), "utf8")
  const imports = {}
  // Same line count, so stack traces point at the right lines.
  const body = src.split("\n").map(line => {
    if (/^\.pragma\b/.test(line)) return ""
    const m = /^\.import\s+"([^"]+)"\s+as\s+(\w+)/.exec(line)
    if (m) { imports[m[2]] = load(m[1]); return "" }
    return line
  }).join("\n")
  const names = [...body.matchAll(/^(?:function|var)\s+(\w+)/gm)].map(m => m[1])
  const lib = new Function(...Object.keys(imports), body + "\nreturn { " + names.join(", ") + " }")(...Object.values(imports))
  cache[name] = lib
  return lib
}

module.exports = { load, DIR }
