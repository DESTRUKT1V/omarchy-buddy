"use strict"
// HelperLogic.js (#255): the rules for finite background helpers, and the
// command Helper.qml really starts, run here as real processes: a helper
// that hangs, never reads its input, ignores TERM, leaves children behind or
// prints without end is gone after its deadline, with everything it started.
const test = require("node:test")
const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const L = require("./lib/load").load("HelperLogic.js")
const S = require("./lib/load").load("Strings.js")

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "omarchy-buddy-helper-"))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

function alive(pid) {
  try { return !/^\S+ \(.*\) Z/.test(fs.readFileSync(`/proc/${pid}/stat`, "utf8")) } catch (e) { return false }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function gone(pid, ms = 2000) {
  for (let t = 0; t < ms && alive(pid); t += 50) await sleep(50)
  return !alive(pid)
}

// Runs HelperLogic.command(argv, seconds) the way Helper.qml does: stdout
// read piece by piece through take(); over the limit it is stopped with TERM
// (running = false). Resolves with how it ended.
function run(argv, seconds, { input, limit = 65536, onStart } = {}) {
  return new Promise(resolve => {
    const began = Date.now()
    const p = spawn(L.command(argv, seconds)[0], L.command(argv, seconds).slice(1), { stdio: ["pipe", "pipe", "ignore"] })
    let kept = "", over = false
    p.stdin.on("error", () => {})
    if (input !== undefined) p.stdin.write(input)
    p.stdin.end()
    p.stdout.setEncoding("utf8")
    p.stdout.on("data", d => {
      if (over) return
      const r = L.take(kept, d, limit)
      kept = r.text
      if (r.over) { over = true; p.kill("SIGTERM") }
    })
    if (onStart) onStart(p)
    p.on("close", (code, signal) => resolve({
      code, signal, kept, took: (Date.now() - began) / 1000,
      result: L.outcome(true, code === null ? 128 + os.constants.signals[signal] : code, over, false),
    }))
  })
}
const pidOf = file => Number(fs.readFileSync(file, "utf8").trim())

test("Befehl: timeout mit Nachfrist vor dem Programm", () => {
  assert.deepEqual(L.command(["/x/omarchy-buddy-setup", "--bar"], 30),
                   ["timeout", "-k", "3", "30", "/x/omarchy-buddy-setup", "--bar"])
})

test("Ausgabe: höchstens limit Zeichen, darüber over", () => {
  assert.deepEqual(L.take("", "abc", 5), { text: "abc", over: false })
  assert.deepEqual(L.take("abc", "de", 5), { text: "abcde", over: false })
  assert.deepEqual(L.take("abc", "def", 5), { text: "abcde", over: true })
  assert.deepEqual(L.take("abcde", "f", 5), { text: "abcde", over: true })
  assert.equal(L.take("", "x".repeat(1e6), 10).text.length, 10)
})

test("Ergebnis: Start, Zeit, Ausgabe, Fehlercode", () => {
  assert.equal(L.outcome(true, 0, false, false), "ok")
  assert.equal(L.outcome(true, 1, false, false), "exit")
  assert.equal(L.outcome(false, -1, false, false), "start", "Quickshell: FailedToStart ohne exited")
  for (const c of [125, 126, 127]) assert.equal(L.outcome(true, c, false, false), "start", "timeout: " + c)
  assert.equal(L.outcome(true, 124, false, false), "time")
  assert.equal(L.outcome(true, 137, false, false), "time", "nach KILL")
  assert.equal(L.outcome(true, 9, false, true), "time", "Wachhund")
  assert.equal(L.outcome(true, 143, true, false), "output", "zu viel Ausgabe gewinnt")
})

test("Zulassung: wenige zugleich, kurze Schlange, dann nichts mehr", () => {
  assert.equal(L.admit(0, 0), "run")
  assert.equal(L.admit(L.maxRunning - 1, 0), "run")
  assert.equal(L.admit(L.maxRunning, 0), "wait")
  assert.equal(L.admit(L.maxRunning, L.maxWaiting - 1), "wait")
  assert.equal(L.admit(L.maxRunning, L.maxWaiting), "drop")
})

test("Einstellungsseite: eigene Worte, sonst ein Fehler zum Wiederholen", () => {
  assert.equal(L.said("ok", "offer\n", "de"), "offer\n")
  assert.equal(L.said("ok", "", "de"), "", "nichts zu sagen bleibt nichts")
  assert.equal(L.said("exit", "shell.json fehlt", "de"), "shell.json fehlt")
  assert.equal(L.said("exit", "  ", "de"), S.tl("de", "helper.failed"))
  for (const r of ["start", "time", "output"]) {
    assert.equal(L.said(r, "halb", "de"), S.tl("de", "helper." + r))
    assert.match(L.said(r, "", "en"), /Try again/)
  }
})

test("Pop-up: ein Schlüssel, nennt das Programm und den Grund", () => {
  const t = L.failedToast(["/home/x/bin/omarchy-buddy-hook", "--decide"], "time", 5, "de")
  assert.equal(t.key, L.failedKey)
  assert.equal(t.level, "warn")
  assert.equal(t.body, S.tl("de", "helper.body.time", "omarchy-buddy-hook"))
  assert.equal(L.failedToast(["x"], "drop", 5, "en").body, S.tl("en", "helper.body.drop", "x"))
  assert.equal(L.failedToast(["x"], "exit", 5, "en").body, S.tl("en", "helper.body.failed", "x"))
})

test("echt: ein normaler Helfer liest seine Eingabe und antwortet", async () => {
  const r = await run(["sh", "-c", "tr a-z A-Z"], 5, { input: "hallo" })
  assert.equal(r.result, "ok")
  assert.equal(r.kept, "HALLO")
})

test("echt: Programm fehlt → start", async () => {
  const r = await run([path.join(tmp, "gibt-es-nicht")], 5)
  assert.equal(r.result, "start")
  assert.ok(r.took < 2)
})

test("echt: hängender Start/Lesen → nach der Frist beendet, samt Kindprozess", async () => {
  const pid = path.join(tmp, "hang.pid")
  const r = await run(["sh", "-c", `sleep 60 & echo $! > ${pid}; sleep 60`], 1)
  assert.equal(r.result, "time")
  assert.ok(r.took < 3, "nach " + r.took + " s")
  assert.ok(await gone(pidOf(pid)), "das Kind lebt noch")
})

test("echt: liest seine Eingabe nie (Schreiben hängt) → beendet", async () => {
  const r = await run(["sleep", "60"], 1, { input: "x".repeat(4 << 20) })
  assert.equal(r.result, "time")
  assert.ok(r.took < 3, "nach " + r.took + " s")
})

test("echt: ignoriert TERM, auch sein Kind → KILL nach der Nachfrist", async () => {
  const pid = path.join(tmp, "stubborn.pid")
  const r = await run(["sh", "-c", `trap '' TERM; sh -c "trap '' TERM; sleep 60" & echo $! > ${pid}; sleep 60`], 1)
  assert.equal(r.result, "time")
  assert.ok(r.took >= 1 + L.graceSeconds - 0.5 && r.took < 1 + L.graceSeconds + 2, "nach " + r.took + " s")
  assert.ok(await gone(pidOf(pid)), "das Kind lebt noch")
})

test("echt: Ausgabe ohne Ende → bei der Grenze gestoppt, nur limit behalten", async () => {
  const r = await run(["yes", "viel"], 20, { limit: 100000 })
  assert.equal(r.result, "output")
  assert.equal(r.kept.length, 100000)
  assert.ok(r.took < 3, "nach " + r.took + " s")
})

test("echt: von der Shell früh beendet (running = false) → die ganze Gruppe geht", async () => {
  const pid = path.join(tmp, "early.pid")
  const r = await run(["sh", "-c", `sleep 60 & echo $! > ${pid}; sleep 60`], 30, {
    onStart: p => setTimeout(() => p.kill("SIGTERM"), 300),
  })
  assert.ok(r.took < 3, "nach " + r.took + " s")
  assert.ok(await gone(pidOf(pid)), "das Kind lebt noch")
})

// #259: every finite background helper of the shell is a Helper. A raw
// Process only where it has its own deadline, start-failure path and bound
// (Paste.qml: PasteLogic.command, a deadline timer; Covers.qml: the cover
// helper's own limits, guard and settle timers).
test("nur Helper.qml, Paste.qml und Covers.qml starten ein rohes Process", () => {
  const { DIR } = require("./lib/load")
  const raw = fs.readdirSync(DIR, { recursive: true }).filter(f => f.endsWith(".qml"))
    .filter(f => /^\s*Process\s*\{/m.test(fs.readFileSync(path.join(DIR, f), "utf8"))).sort()
  assert.deepEqual(raw, ["Helper.qml", "components/Paste.qml", "theme/Covers.qml"])
})
