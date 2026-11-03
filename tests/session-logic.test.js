"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const L = require("./lib/load").load("SessionLogic.js")

const NOW = 1_000_000

function session(fields) {
  return Object.assign({ id: "s", state: "idle", cwd: "/x/proj", name: "proj", tool: "", detail: "", prompt: "",
                         error: false, errorText: "", running: [], orca: false, requests: [], window: "",
                         pid: 0, origin: "", updated: NOW, since: 0 }, fields)
}

function request(id, until, fields) {
  return Object.assign({ id: id, tool: "Bash", detail: "ls", full: "ls", always: "", agent: "", until: until, wait: 30 }, fields)
}

test("state.json lesen: Felder, Namen aus dem Ordner, Sortierung", () => {
  const raw = JSON.stringify({
    a: { state: "working", cwd: "/home/user/Projects/werkzeug/", updated: 5 },
    b: { state: "needs", cwd: "/x/web", updated: 9, requests: [{ id: "1-2", detail: "git push", until: 99 }] },
    c: { state: "done", updated: 1, error: true },
  })
  const list = L.parseSessions(raw)
  assert.deepEqual(list.map(s => s.id), ["b", "c", "a"])
  assert.equal(list[2].name, "werkzeug")
  assert.equal(list[1].name, "Claude")
  assert.equal(list[1].error, true)
  assert.deepEqual(list[0].requests, [{ id: "1-2", kind: "permission", tool: "", detail: "git push", full: "git push",
                                        always: "", description: "", agent: "", until: 99, wait: 30, truncated: false, edits: null, editsCut: false,
                                        questions: [] }])
})

test("kaputte oder leere Datei: keine Sitzungen", () => {
  assert.deepEqual(L.parseSessions("{kaputt"), [])
  assert.deepEqual(L.parseSessions(""), [])
  assert.deepEqual(L.parseSessions("null"), [])
})

test("Zustand: offene Anfrage, im Terminal gefragt, still, fertig verblasst", () => {
  assert.equal(L.stateOf(session({ state: "working", requests: [request("r", NOW + 10)] }), NOW), "needs")
  assert.equal(L.stateOf(session({ state: "needs", requests: [request("r", NOW - 1)] }), NOW), "needs")
  assert.equal(L.stateOf(session({ state: "needs", updated: NOW - 121 }), NOW), "asked")
  assert.equal(L.stateOf(session({ state: "working", updated: NOW - 180 }), NOW), "working")
  assert.equal(L.stateOf(session({ state: "working", updated: NOW - 181 }), NOW), "stale")
  assert.equal(L.stateOf(session({ state: "done", updated: NOW - 601 }), NOW), "idle")
  assert.equal(L.stateText(session({ state: "working", updated: NOW - 1200 }), NOW), "Claude ist seit 20 min still")
  assert.equal(L.stateText(session({ state: "done", error: true }), NOW), "Claude: Fehler (API)")
  assert.equal(L.stateText(session({ state: "needs" }), NOW), "Claude braucht dich")
  assert.equal(L.stateText(session({ state: "working", agent: "codex" }), NOW), "Codex arbeitet")
})

test("Still: drei Minuten ohne Ereignis, bei einem Werkzeug mit eigenem Timeout länger", () => {
  const bash = (timeout) => ({ id: "t", tool: "Bash", detail: "npm test", agent: "", at: NOW - 400, timeout: timeout })
  assert.equal(L.stateOf(session({ state: "working", updated: NOW - 400, running: [bash(0)] }), NOW), "stale")
  assert.equal(L.stateOf(session({ state: "working", updated: NOW - 400, running: [bash(600)] }), NOW), "working")
  assert.equal(L.stateOf(session({ state: "working", updated: NOW - 661, running: [bash(600)] }), NOW), "stale")
  // A short timeout never shortens the three minutes.
  assert.equal(L.stateOf(session({ state: "working", updated: NOW - 150, running: [bash(30)] }), NOW), "working")
  const parsed = L.parseSessions(JSON.stringify({ a: { state: "working", running: [{ id: "t", timeout: 600 }, { id: "u" }] } }))
  assert.deepEqual(parsed[0].running.map(r => r.timeout), [600, 0])
})

test("Liste: nach 30 min weg, außer eine Anfrage wartet", () => {
  assert.equal(L.shown(session({ updated: NOW - 1800 }), NOW), true)
  assert.equal(L.shown(session({ updated: NOW - 1801 }), NOW), false)
  assert.equal(L.shown(session({ updated: NOW - 5000, requests: [request("r", NOW + 5)] }), NOW), true)
  const all = [session({ id: "a", state: "working" }), session({ id: "b", state: "working", updated: NOW - 2000 })]
  assert.equal(L.shownCount(all, NOW), 1)
  assert.equal(L.count(all, "working", NOW), 1)
  assert.equal(L.count(all, "stale", NOW), 1)
})

test("Rückfragen: eine pro Anfrage, Terminal-Frage ohne Anfrage, Blättern", () => {
  const sessions = [
    session({ id: "a", state: "needs", requests: [request("1", NOW + 5), request("2", NOW + 5), request("3", NOW - 5)] }),
    session({ id: "b", state: "needs" }),
    session({ id: "c", state: "working" }),
  ]
  const asks = L.asks(sessions, NOW)
  assert.deepEqual(asks.map(a => a.key), ["a/1", "a/2", "b"])
  assert.equal(asks[2].request, null)
  assert.equal(L.answerable(asks), true)
  assert.equal(L.answerable(asks.slice(2)), false)
  assert.equal(L.answerable([]), false)
  assert.equal(L.askPos(asks, "a/2"), 1)
  assert.equal(L.askPos(asks, "weg"), 0)
  assert.equal(L.pagedKey(asks, "b", 1), "a/1")
  assert.equal(L.pagedKey(asks, "a/1", -1), "b")
  assert.equal(L.pagedKey(asks.slice(0, 1), "a/1", 1), "a/1")
  assert.equal(L.hasRequests(sessions), true)
  assert.equal(L.hasRequests([sessions[1]]), false)
})

test("Warteschlange: beantwortbare vorne, die älteste zuerst", () => {
  // b fragt im Terminal und steht in der Sitzungsliste vorne, c fragte früher als a
  const sessions = [
    session({ id: "b", state: "needs", updated: NOW - 50 }),
    session({ id: "a", state: "needs", requests: [request("1", NOW + 80, { wait: 90 })] }),
    session({ id: "c", state: "needs", requests: [request("2", NOW + 20, { wait: 40 })] }),
  ]
  assert.deepEqual(L.asks(sessions, NOW).map(a => a.key), ["c/2", "a/1", "b"])
})

test("Warteschlange: die gezeigte Anfrage bleibt stehen, bis sie erledigt ist", () => {
  const ask = (key, req) => ({ key: key, request: req ? {} : null })
  const list = [ask("a/1", true), ask("b/2", true), ask("c", false)]
  assert.equal(L.shownKey(list, ""), "a/1", "anfangs die erste")
  assert.equal(L.shownKey(list, "b/2"), "b/2", "neue Ereignisse ändern nichts")
  assert.equal(L.shownKey(list.slice(1), "a/1"), "b/2", "erledigt: die nächste")
  assert.equal(L.shownKey(list, "c"), "a/1", "Terminal-Frage weicht einer beantwortbaren")
  assert.equal(L.shownKey([ask("c", false), ask("d", false)], "d"), "d")
  assert.equal(L.shownKey([], "a/1"), "")
})

test("Lange Sitzungsliste: fertige und stille ab der 8. eingeklappt", () => {
  const list = []
  for (let i = 0; i < 6; i++) list.push(session({ id: "w" + i, state: "working" }))
  list.push(session({ id: "gone", state: "done", updated: NOW - 4000 }))   // nicht gezeigt, zählt nicht
  for (let i = 0; i < 4; i++) list.push(session({ id: "d" + i, state: "done" }))
  list.push(session({ id: "w9", state: "working" }))
  assert.deepEqual(Object.keys(L.folded(list, NOW)), ["d1", "d2", "d3"])
  assert.deepEqual(L.folded(list.slice(0, 8), NOW), {})
  assert.deepEqual(Object.keys(L.folded(list, NOW, { d2: NOW })), ["d1", "d3"], "verborgene zählen nicht")
})

test("Texte: Zeile unter der Sitzung und Kurztext der Rückfrage", () => {
  assert.equal(L.rowDetail(session({ state: "needs", tool: "Bash", detail: "rm x" }), NOW), "Bash: rm x")
  assert.equal(L.rowDetail(session({ state: "needs", requests: [request("1", NOW + 5)] }), NOW), "")
  assert.equal(L.rowDetail(session({ state: "working", prompt: "mach was" }), NOW), "„mach was“")
  assert.equal(L.rowDetail(session({ state: "working" }), NOW), "")
  assert.equal(L.askText({ request: request("1", 0, { tool: "Edit", detail: "a.txt" }) }), "Edit: a.txt")
  assert.equal(L.askText({ request: null, session: session({ detail: "Claude needs your permission" }) }), "Claude needs your permission")
  assert.equal(L.askText({ request: null, session: session({}) }), "")
})

test("Übergänge: Änderung und frisch fertig", () => {
  const before = { a: "working", b: "done" }
  const next = [session({ id: "a", state: "done" }), session({ id: "b", state: "done" }), session({ id: "c", state: "done" })]
  assert.deepEqual(L.transitions(before, next), { changed: true, finished: ["a"] })
  assert.deepEqual(L.transitions(L.statesOf(next), next), { changed: false, finished: [] })
})

test("Anfragearten: Frage und Plan lesen, Kurztexte", () => {
  const [q, p, x] = L.parseRequests([
    { id: "1", kind: "question", tool: "AskUserQuestion", detail: "Welche Farbe?",
      questions: [{ question: "Welche Farbe?", header: "Farbe", options: [{ label: "Rot" }, { description: "ohne Label" }] }, {}] },
    { id: "2", kind: "plan", tool: "ExitPlanMode", detail: "Farben anlegen", full: "# Farben anlegen" },
    { id: "3", kind: "komisch", questions: [{ question: "?" }] }])
  assert.deepEqual(q.questions, [{ question: "Welche Farbe?", header: "Farbe", multiSelect: false,
                                   options: [{ label: "Rot", description: "" }] }])
  assert.equal(p.kind, "plan")
  assert.equal(x.kind, "permission")
  assert.deepEqual(x.questions, [])
  assert.equal(L.askText({ request: q }), "Welche Farbe?")
  assert.equal(L.askText({ request: p }), "Plan: Farben anlegen")
  assert.equal(L.askLabel({ request: q }), "fragt dich")
  assert.equal(L.askLabel({ request: p }), "Plan zur Freigabe")
  assert.equal(L.askLabel({ request: x }), "braucht dich")
  assert.equal(L.askLabel({ request: null }), "braucht dich")
})

test("Antworten auf Fragen: auswählen, eigene Antwort, fertig, Reihenfolge", () => {
  const farbe = { question: "Farbe?", multiSelect: false, options: [{ label: "Rot" }, { label: "Blau" }] }
  const tiere = { question: "Tiere?", multiSelect: true, options: [{ label: "Hund" }, { label: "Katze" }, { label: "Maus" }] }
  let sel = {}
  assert.equal(L.answersComplete([farbe, tiere], sel), false)
  sel = L.toggleOption(sel, farbe, "Rot")
  sel = L.toggleOption(sel, farbe, "Blau")
  assert.deepEqual(sel["Farbe?"], ["Blau"], "eine Auswahl ersetzt die andere")
  sel = L.toggleOption(sel, tiere, "Maus")
  sel = L.toggleOption(sel, tiere, "Hund")
  sel = L.toggleOption(sel, tiere, "Katze")
  sel = L.toggleOption(sel, tiere, "Katze")
  assert.equal(L.chosen(sel, "Tiere?", "Hund"), true)
  assert.equal(L.chosen(sel, "Tiere?", "Katze"), false)
  assert.equal(L.answersComplete([farbe, tiere], sel), true)
  assert.deepEqual(L.answerPayload([farbe, tiere], sel), { "Farbe?": "Blau", "Tiere?": "Hund, Maus" })
  // Own text: replaces the choice when only one counts, joins it otherwise.
  sel = L.setOwnAnswer(sel, farbe, "  Lila\n ")
  sel = L.setOwnAnswer(sel, tiere, "Pferd")
  assert.equal(L.ownAnswer(sel, farbe), "Lila")
  assert.deepEqual(L.answerPayload([farbe, tiere], sel), { "Farbe?": "Lila", "Tiere?": "Hund, Maus, Pferd" })
  sel = L.setOwnAnswer(sel, tiere, "")
  assert.deepEqual(L.answerPayload([farbe, tiere], sel), { "Farbe?": "Lila", "Tiere?": "Hund, Maus" })
  // "Eigene Antwort" is a row like the options: marked with a text or an open field.
  assert.equal(L.marked(sel, farbe, "", false), true)
  assert.equal(L.marked(sel, farbe, "Blau", false), false)
  let pick = L.toggleOption({}, farbe, "Blau")
  assert.equal(L.marked(pick, farbe, "", false), false)
  assert.equal(L.marked(pick, farbe, "", true), true, "Feld offen: markiert")
  assert.equal(L.marked(pick, farbe, "Blau", true), false, "eine Auswahl: die ersetzte nicht mehr")
  pick = L.toggleOption({}, tiere, "Hund")
  assert.equal(L.marked(pick, tiere, "Hund", true), true, "mehrere: bleibt markiert")
  assert.equal(L.answersAtOnce([farbe]), true)
  assert.equal(L.answersAtOnce([tiere]), false)
  assert.equal(L.answersAtOnce([farbe, farbe]), false)
})

test("Laufband: Werkzeug in Worten, neuestes, mehrere Sitzungen", () => {
  assert.equal(L.toolText({ tool: "Bash", detail: "npm test", agent: "" }), "$ npm test")
  assert.equal(L.toolText({ tool: "Read", detail: "/x/proj/src/a.js", agent: "" }), "liest a.js")
  assert.equal(L.toolText({ tool: "Grep", detail: "TODO", agent: "Explore" }), "sucht TODO (Explore)")
  assert.equal(L.toolText({ tool: "mcp__orca__terminal_list", detail: "", agent: "" }), "orca: terminal_list")
  assert.equal(L.toolText({ tool: "ToolSearch", detail: "select:X", agent: "" }), "ToolSearch: select:X")
  const run = (id, tool, detail, at) => ({ id: id, tool: tool, detail: detail, agent: "", at: at })
  const a = session({ id: "a", name: "web", state: "working", running: [run("1", "Bash", "npm test", NOW - 5), run("2", "Read", "x.md", NOW - 9)] })
  const b = session({ id: "b", name: "api", state: "working", updated: NOW - 1 })
  assert.equal(L.currentTool(a, NOW).id, "1")
  assert.equal(L.workText(b, NOW), "überlegt …")
  assert.equal(L.ticker([a], NOW), "$ npm test")
  assert.equal(L.ticker([a, b], NOW), "api: überlegt …")
  assert.equal(L.ticker([session({ state: "done" })], NOW), "")
  assert.equal(L.currentTool(session({ state: "needs", running: a.running, requests: [request("r", NOW + 5)] }), NOW), null)
  assert.deepEqual(L.parseSessions(JSON.stringify({ s: { state: "working", running: [{ id: "t", tool: "Bash", at: 3 }] } }))[0].running,
                   [{ id: "t", tool: "Bash", detail: "", agent: "", at: 3, timeout: 0 }])
})

test("Fehlertext aus dem Hook", () => {
  assert.equal(L.stateText(session({ state: "done", error: true, errorText: "Limit erreicht" }), NOW), "Claude: Limit erreicht")
  assert.equal(L.stateText(session({ state: "done", error: true }), NOW), "Claude: Fehler (API)")
})

test("Nutzung: Kontext je Sitzung (die Limits zeigt Omarchys Agents-Panel)", () => {
  const u = L.parseUsage(JSON.stringify({ limits: { five_hour: { used: 81.6, resets: 1 } },
                                          sessions: { s: { context: 72 }, k: { context: 20 } } }))
  assert.deepEqual(Object.keys(u), ["sessions"])
  assert.equal(L.contextText(u, { id: "s" }), "Kontext 72 %")
  assert.equal(L.contextText(u, { id: "k" }), "")
  assert.equal(L.contextText(u, { id: "fehlt" }), "")
  assert.equal(L.parseUsage('{"sessions": {"x": null}}').sessions.x.context, 0)
  assert.deepEqual(L.parseUsage("kaputt").sessions, {})
})

test("Plan: Überschriften werden fette Zeilen", () => {
  assert.equal(L.planMarkdown("# Plan: A\n\n## Context\nText mit # drin\n### Schritte ##"),
               "**Plan: A**  \n\n\n**Context**  \nText mit # drin\n\n**Schritte**  ")
  // A heading after a list starts a paragraph of its own instead of joining the last item.
  assert.equal(L.planMarkdown("- eins\n- zwei\n## Schritt 2\nText"), "- eins\n- zwei\n\n**Schritt 2**  \nText")
  assert.equal(L.planMarkdown(""), "")
})

test("Hintergrund: Claude-Dienst, verschwundenes Fenster, Orca bleibt erreichbar", () => {
  const wins = ["0xabc", "def"]
  assert.equal(L.background(session({ origin: "daemon" }), wins), true)
  assert.equal(L.background(session({ origin: "daemon" }), []), true)
  assert.equal(L.background(session({ window: "abc", origin: "terminal" }), wins), false)
  assert.equal(L.background(session({ window: "0xdef" }), wins), false)
  assert.equal(L.background(session({ window: "0x999" }), wins), true)
  assert.equal(L.background(session({ window: "" }), wins), true)
  assert.equal(L.background(session({ window: "0x999", orca: true }), wins), false)
  // Hyprland noch nicht gelesen: nichts als Hintergrund melden
  assert.equal(L.background(session({ window: "0x999" }), []), false)
})

test("Hintergrund: zählen (nur sichtbare), beenden nur mit pid", () => {
  const wins = ["0xabc"]
  const list = [session({ id: "a", window: "0xabc" }), session({ id: "b", origin: "daemon", pid: 7 }),
                session({ id: "c", window: "0x1", updated: NOW - 4000 }), session({ id: "d", window: "0x2" })]
  assert.equal(L.backgroundCount(list, NOW, wins), 2)
  assert.equal(L.canEnd(list[1], wins), true)
  assert.equal(L.canEnd(list[3], wins), false)
  assert.equal(L.canEnd(session({ window: "0xabc", pid: 7 }), wins), false)
  assert.deepEqual(L.parseSessions(JSON.stringify({ x: { pid: 42, origin: "daemon" } })).map(s => [s.pid, s.origin]),
                   [[42, "daemon"]])
})

test("Beenden: Rückfrage nennt die Sitzung, warnt, wenn sie arbeitet", () => {
  assert.equal(L.endQuestion(session({ name: "web" }), NOW), "„web“ beenden?")
  assert.equal(L.endQuestion(session({ name: "web", state: "working" }), NOW), "„web“ beenden? Claude arbeitet gerade noch.")
})

test("Sortierung nach dem Zustand jetzt, nicht dem gespeicherten", () => {
  const a = session({ id: "a", state: "working", updated: NOW - 1000 })   // still → stale
  const b = session({ id: "b", state: "done", updated: NOW - 700 })       // verblasst → idle
  const c = session({ id: "c", state: "idle", updated: NOW - 10, requests: [request("r", NOW + 5)] })  // needs
  const d = session({ id: "d", state: "working", updated: NOW - 5 })
  const sorted = L.sortSessions([a, b, c, d], NOW)
  assert.deepEqual(sorted.map(s => s.id), ["c", "d", "a", "b"])
  assert.equal(L.sameOrder(sorted, [c, d, a, b]), true)
  assert.equal(L.sameOrder(sorted, [a, b, c, d]), false)
  assert.equal(L.sameOrder(sorted, [c, d, a]), false)
  // gleicher Zustand: wer am längsten wartet, zuerst
  assert.deepEqual(L.sortSessions([d, session({ id: "e", state: "working", updated: NOW - 50 })], NOW).map(s => s.id), ["e", "d"])
  // parseSessions sortiert mit der Uhr
  const raw = JSON.stringify({ x: { state: "working", updated: NOW - 1000 }, y: { state: "done", updated: NOW - 10 } })
  assert.deepEqual(L.parseSessions(raw, NOW).map(s => s.id), ["y", "x"])
})

test("Ausblenden pro Zeile: bis zum nächsten Hook-Ereignis, nie mit offener Anfrage", () => {
  const a = session({ id: "a", state: "done", updated: NOW - 60 })
  const b = session({ id: "b", state: "working" })
  let hidden = L.hide({}, [a, b], a)
  assert.deepEqual(hidden, { a: NOW - 60 })
  assert.equal(L.shown(a, NOW, hidden), false)
  assert.equal(L.shown(b, NOW, hidden), true)
  assert.equal(L.shownCount([a, b], NOW, hidden), 1)
  // neues Ereignis: wieder da, und die Notiz fällt beim nächsten Lesen weg
  const a2 = session({ id: "a", state: "working", updated: NOW })
  assert.equal(L.shown(a2, NOW, hidden), true)
  assert.deepEqual(L.hide(hidden, [a2, b], null), {})
  // Sitzung beendet: Notiz weg
  assert.deepEqual(L.hide(hidden, [b], null), {})
  assert.deepEqual(L.hide(hidden, [a, b], null), { a: NOW - 60 })
  // offene Anfrage zeigt sie trotzdem, und ausblenden geht dann nicht
  const asking = session({ id: "a", updated: NOW - 60, requests: [request("r", NOW + 5)] })
  assert.equal(L.shown(asking, NOW, hidden), true)
  assert.equal(L.canHide(asking, NOW), false)
  assert.equal(L.canHide(a, NOW), true)
  // Laufband ohne ausgeblendete
  const w = session({ id: "w", state: "working" })
  assert.equal(L.ticker([w], NOW, L.hide({}, [w], w)), "")
  assert.equal(L.ticker([w], NOW), "überlegt …")
})

test("Pille: gekürzter Befehl, offene Fragen neben „Antworten“", () => {
  const [a, b] = L.parseRequests([{ id: "1", full: "x …", truncated: true }, { id: "2", truncated: "ja" }])
  assert.equal(a.truncated, true)
  assert.equal(b.truncated, false)
  const farbe = { question: "Farbe?", options: [{ label: "Rot" }] }
  const tiere = { question: "Tiere?", multiSelect: true, options: [{ label: "Hund" }] }
  assert.equal(L.openText([farbe, tiere], {}, "de"), "noch 2 Fragen offen")
  assert.equal(L.openText([farbe, tiere], { "Farbe?": ["Rot"] }, "de"), "noch 1 Frage offen")
  assert.equal(L.openText([farbe, tiere], { "Farbe?": ["Rot"], "Tiere?": ["Hund"] }, "de"), "")
  assert.equal(L.openText([farbe, tiere], undefined, "en"), "2 questions still open")
})

test("Plan: Links in Theme-Farbe, Bilder und Sonderzeichen", () => {
  assert.equal(L.planLinks("Siehe [die Doku](https://x.org/a?b=1&c=2) hier.", "#e0a050"),
    'Siehe <a href="https://x.org/a?b=1&amp;c=2" style="color:#e0a050">die Doku</a> hier.')
  assert.equal(L.planLinks("![Bild](a.png) und [a<b](u)", "#fff"),
    '<a href="a.png" style="color:#fff">Bild</a> und <a href="u" style="color:#fff">a&lt;b</a>')
  assert.equal(L.planLinks("![](https://x/p.png)", "#fff"), '<a href="https://x/p.png" style="color:#fff">https://x/p.png</a>')
  assert.equal(L.planLinks('<img src="https://x/p.png"> a < b', "#fff"), '&lt;img src="https://x/p.png"> a < b')
  assert.equal(L.planLinks("`<img src=x>` und [l](u)\n```\n<b>[l](u)\n```", "#fff"),
    '`<img src=x>` und <a href="u" style="color:#fff">l</a>\n```\n<b>[l](u)\n```')
  assert.equal(L.planLinks("ohne Links", "#fff"), "ohne Links")
})

test("Plan: kein Bild lädt aus dem Netz, egal wie geschrieben (#148)", () => {
  const noImage = (md, why) => assert.ok(!/!\[|<img/i.test(L.planLinks(md, "#fff")), why + ": " + L.planLinks(md, "#fff"))
  noImage('![x](https://a/?d=GEHEIM "t")', "mit Titel")
  noImage("![x](https://a/p.png 't')", "Titel in einfachen Anführungszeichen")
  noImage("![x](<https://a/p q.png>)", "Adresse in spitzen Klammern")
  noImage("![x][r]\n\n[r]: https://a/p.png", "Referenz")
  noImage("![x][]\n\n[x]: https://a/p.png", "leere Referenz")
  noImage("![x]\n\n[x]: https://a/p.png", "Kurzreferenz")
  noImage("[![x](https://a/p.png)](https://a)", "Bild im Link")
  noImage('<IMG SRC="https://a/p.png">', "HTML-img groß")
  noImage('<p><img src="https://a/p.png"></p>', "HTML-img im Block")
  noImage("<https://a/p.png> und <a@b.de>", "Autolinks")
  assert.equal(L.planLinks('![x](https://a/p.png "t")', "#fff"), '[x](https://a/p.png "t")', "bleibt ein Link")
  assert.equal(L.planLinks("<https://a/p.png>", "#fff"), "&lt;https://a/p.png>", "Autolink als Text")
  assert.equal(L.planLinks("`![x](u)`", "#fff"), "`![x](u)`", "Code bleibt wie er ist")
})

test("Countdown: Sekunden unter einer Minute, darüber Minuten", () => {
  assert.equal(L.countdownText(302), "noch 5 min, danach fragt das Terminal")
  assert.equal(L.countdownText(60), "noch 1 min, danach fragt das Terminal")
  assert.equal(L.countdownText(58.2), "noch 59 s, danach fragt das Terminal")
  assert.equal(L.countdownText(29.5), "noch 30 s, danach fragt das Terminal")
  assert.equal(L.countdownText(0), "noch 0 s, danach fragt das Terminal")
})

test("Codex-Sitzungen: Agent, Name, Zeichen (#130)", () => {
  const list = L.parseSessions(JSON.stringify({
    a: { state: "working", cwd: "/x/web", updated: NOW, agent: "codex" },
    b: { state: "idle", updated: NOW },
    c: { state: "idle", updated: NOW, agent: "amp" },
  }), NOW)
  const by = id => list.find(s => s.id === id)
  assert.equal(by("a").agent, "codex")
  assert.equal(by("b").agent, "claude", "vor #130 ohne Agent: Claude")
  assert.equal(by("c").agent, "claude", "Unbekanntes wird Claude")
  assert.equal(L.parseSessions(JSON.stringify({ d: { agent: "codex", updated: NOW } }), NOW)[0].name, "Codex")
  assert.equal(L.agentMark("codex"), "\uec81")
  assert.equal(L.agentMark("claude"), "\uec82")
  assert.equal(L.agentName("codex"), "Codex")
  assert.equal(L.defaultAgentName("claude\n"), "Claude", "Omarchys Standard (#131)")
  assert.equal(L.defaultAgentName("opencode\n"), "opencode", "unbekannt: Omarchys Wort")
  assert.equal(L.defaultAgentName("cursor-agent\n"), "Cursor", "Omarchys Schlüssel (#141)")
  assert.equal(L.defaultAgentName(""), "", "kein Standard: nichts")
  assert.equal(L.defaultAgentName("\n"), "")
  for (const a of Object.keys(L.agents)) assert.ok(L.agents[a].name && L.agents[a].mark, a + ": Name und Zeichen")
  assert.equal(L.endQuestion(session({ name: "web", state: "working", agent: "codex" }), NOW), "„web“ beenden? Codex arbeitet gerade noch.")
})

test("Codex unterbrochen (Escape): eigener Zustand bis zum nächsten Prompt (#130)", () => {
  const s = session({ state: "interrupted", agent: "codex", updated: NOW - 4000 })
  assert.equal(L.stateOf(s, NOW), "interrupted")
  assert.equal(L.stateText(s, NOW), "Codex wurde unterbrochen")
  assert.equal(L.stateText(s, NOW, "en"), "Codex was interrupted")
  const order = L.sortSessions([s, session({ id: "w", state: "working" }), session({ id: "i", state: "idle" })], NOW)
  assert.deepEqual(order.map(x => x.state), ["working", "interrupted", "idle"])
})

test("Codex: wer braucht dich, wer arbeitet, apply_patch im Ticker (#130)", () => {
  const codexAsks = session({ id: "c", agent: "codex", state: "needs", requests: [request("1-1", NOW + 20)] })
  const claudeAsks = session({ id: "k", agent: "claude", state: "needs", requests: [request("2-2", NOW + 20, { wait: 30, until: NOW + 25 })] })
  assert.equal(L.needsMark([codexAsks], NOW), "\uec81")
  assert.equal(L.needsMark([codexAsks, claudeAsks], NOW), "\uec81", "die älteste Anfrage zuerst")
  assert.equal(L.needsMark([], NOW), "\uec82")
  assert.equal(L.workingAgent([session({ state: "working", agent: "codex" })], NOW), "codex")
  assert.equal(L.workingAgent([session({ id: "1", state: "working", agent: "codex" }), session({ id: "2", state: "working" })], NOW), "claude")
  assert.equal(L.toolText({ tool: "apply_patch", detail: "a.txt, neu/b.txt", agent: "" }, "de"), "ändert a.txt, neu/b.txt")
})

test("Weitere Agents: Name, Zeichen, Abschnitt (#141)", () => {
  const list = L.parseSessions(JSON.stringify({
    g: { state: "working", cwd: "/x/a", updated: NOW, agent: "gemini" },
    k: { state: "needs", cwd: "/x/b", updated: NOW, agent: "crush" },
    x: { state: "idle", updated: NOW, agent: "grok" },
  }), NOW)
  assert.deepEqual(list.map(s => s.agent).sort(), ["crush", "gemini", "grok"])
  for (const a of ["gemini", "crush", "grok", "cursor-agent", "copilot"]) {
    assert.ok(L.agentName(a) !== "Claude", a + " hat einen Namen")
    assert.ok(L.agentMark(a) !== L.agentMark("claude"), a + " hat ein eigenes Zeichen")
  }
  assert.equal(L.needsMark(list, NOW), L.agentMark("crush"), "Zeichen der fragenden Sitzung")
  assert.equal(L.workingAgent(list, NOW), "gemini")
})

test("Datei-Änderung: edits für den Diff, nur bei Freigaben", () => {
  const edits = [{ file: "/x/a", old: "1", new: "2", created: false }]
  const [r] = L.parseRequests([{ id: "1", tool: "Edit", edits: edits, edits_cut: true }])
  assert.deepEqual(r.edits, edits)
  assert.equal(r.editsCut, true)
  assert.equal(L.parseRequests([{ id: "2", kind: "plan", edits: edits }])[0].edits, null)
  assert.equal(L.parseRequests([{ id: "3", edits: "kaputt" }])[0].edits, null)
})

test("Für dich (#175): wartende Sitzungen oben, die übrigen darunter", () => {
  const list = [session({ id: "a", state: "working" }),
                session({ id: "b", state: "needs", requests: [request("r", NOW + 10)] }),
                session({ id: "c", state: "needs", updated: NOW - 121 }),
                session({ id: "d", state: "done" })]
  assert.deepEqual(L.forYouPart(list, NOW, true).map(s => s.id), ["b"])
  assert.deepEqual(L.forYouPart(list, NOW, false).map(s => s.id), ["a", "c", "d"])
})

test("Leerzustand Agents (#192): die gefundenen in der Reihenfolge der Insel, Unbekanntes fällt weg", () => {
  assert.deepEqual(L.foundAgents("codex\nclaude\nwas-neues\n").map(a => a.name), ["Claude", "Codex"])
  assert.equal(L.foundAgents("claude")[0].mark, L.agentMark("claude"))
  assert.deepEqual(L.foundAgents(""), [])
})

test("Tastatur (#193, B10): die sichere Antwort der ältesten Anfrage bekommt den Fokus", () => {
  const perm = session({ id: "a", state: "needs", requests: [request("r1", NOW + 20)] })
  const plan = session({ id: "b", state: "needs", requests: [request("r2", NOW + 10, { kind: "plan" })] })
  const question = session({ id: "c", state: "needs", requests: [request("r3", NOW + 5, { kind: "question",
    questions: [{ question: "Farbe?", header: "", multiSelect: false, options: [{ label: "Rot" }, { label: "Blau" }] }] })] })
  assert.equal(L.keyboardTarget(L.asks([perm], NOW)), "list|a/r1|deny")
  assert.equal(L.keyboardTarget(L.asks([plan], NOW)), "list|b/r2|revise")
  assert.equal(L.keyboardTarget(L.asks([question], NOW)), "list|c/r3|Farbe?|Rot")
  assert.equal(L.keyboardTarget(L.asks([perm, question], NOW)), "list|c/r3|Farbe?|Rot", "die älteste zuerst")
  assert.equal(L.keyboardTarget(L.asks([session({ state: "needs" })], NOW)), "", "fragt nur im Terminal")
  assert.equal(L.keyboardTarget([]), "")
})

test("Anfrage: Claudes Beschreibung kommt mit (#193, B9)", () => {
  const r = L.parseRequests([{ id: "1", detail: "rm -rf build/", description: "Build-Ordner leeren" }, { id: "2", detail: "ls" }])
  assert.deepEqual(r.map(x => x.description), ["Build-Ordner leeren", ""])
})
