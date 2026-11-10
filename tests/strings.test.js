"use strict"
// Strings.js: both languages complete, the language from config.json or
// the system, and a few texts as they come out in English.
const test = require("node:test")
const assert = require("node:assert/strict")
const { load } = require("./lib/load")
const S = load("Strings.js")
const Island = load("IslandLogic.js")
const Session = load("SessionLogic.js")
const Toast = load("ToastLogic.js")
const Note = load("NoteLogic.js")
const Settings = load("SettingsLogic.js")

test("Deutsch und Englisch haben dieselben Schlüssel und Platzhalter", () => {
  const de = Object.keys(S.texts.de).sort(), en = Object.keys(S.texts.en).sort()
  assert.deepEqual(en, de)
  const holes = t => (t.match(/\{\d\}/g) || []).sort().join()
  for (const k of de) if (k !== "months") assert.equal(holes(S.texts.en[k]), holes(S.texts.de[k]), k)
  assert.equal(S.tl("en", "months").split(" ").length, 12)
})

test("Sprache: Einstellung gewinnt, sonst LC_ALL, LC_MESSAGES, LANG", () => {
  assert.equal(S.pickLanguage("de", ["en_US.UTF-8"]), "de")
  assert.equal(S.pickLanguage("en", ["de_DE.UTF-8"]), "en")
  assert.equal(S.pickLanguage("auto", ["", "", "de_DE.UTF-8"]), "de")
  assert.equal(S.pickLanguage("auto", ["", "", "de_AT.UTF-8"]), "de")
  assert.equal(S.pickLanguage("auto", ["C.UTF-8", "", "de_DE.UTF-8"]), "en")
  assert.equal(S.pickLanguage("auto", ["", "de_CH.UTF-8", "en_US.UTF-8"]), "de")
  assert.equal(S.pickLanguage("auto", ["", "", "fr_FR.UTF-8"]), "en")
  assert.equal(S.pickLanguage("auto", ["", "", "deu"]), "en")
  assert.equal(S.pickLanguage(undefined, []), "en")
  // Omarchy 4.5: omarchy language (~/.config/omarchy/language) vor LANG
  assert.equal(S.pickLanguage("auto", ["", "", "en_US.UTF-8"], "de\n"), "de")
  assert.equal(S.pickLanguage("auto", ["", "", "de_DE.UTF-8"], "fr"), "en")
  assert.equal(S.pickLanguage("auto", ["", "", "de_DE.UTF-8"], "pt-BR"), "en")
  assert.equal(S.pickLanguage("en", [], "de"), "en")
  assert.equal(S.pickLanguage("auto", ["", "", "de_DE.UTF-8"], "dex-"), "de", "kein gültiger Code: LANG")
  assert.equal(S.pickLanguage("auto", ["", "", "de_DE.UTF-8"], ""), "de", "ohne Datei (Omarchy 4.0): LANG")
})

test("tl/tr: Platzhalter, Rückfall, unbekannte Sprache", () => {
  assert.equal(S.tl("de", "sum.needs", 2), "2× braucht dich")
  assert.equal(S.tl("de", "gibt.es.nicht"), "gibt.es.nicht")
  assert.equal(S.tl("xx", "sum.quiet"), "Alles ruhig")
  assert.equal(S.tl(undefined, "sum.quiet"), "Alles ruhig")
  assert.equal(S.tr("en", "type.send", ["Reply"]), "Reply – Enter sends")
})

test("Englisch: Begrüßung, Zusammenfassung, Zustände, Pop-ups", () => {
  const en = "en"
  assert.equal(Island.greeting(9, "Anna", en), "Good morning, Anna")
  assert.equal(Island.summary({ needs: 0, working: 2, shown: 3, background: 1 }, [], en), "2 sessions working, 1 in the background")
  assert.equal(Island.summary({ needs: 0, working: 0, shown: 0 }, [], en), "All quiet")
  assert.equal(Island.summary({ needs: 0, working: 0, shown: 0 }, [{ source: "x" }], en), "1 new")
  assert.equal(Island.summary({ needs: 0, working: 0, shown: 0 }, [{ app: "Beeper" }, { app: "Beeper" }], en), "2 new from Beeper")
  const now = new Date(2026, 9, 28, 17, 30).getTime() / 1000
  assert.equal(Island.when(new Date(2026, 9, 27, 23, 59).getTime() / 1000, now, en), "Oct 27 23:59")
  const s = { id: "a", name: "a", state: "working", updated: now - 600, running: [], requests: [], prompt: "hi" }
  assert.equal(Session.stateText(s, now, en), "Claude has been quiet for 10 min")
  assert.equal(Session.stateText(Object.assign({}, s, { state: "needs", updated: now }), now, en), "Claude needs you")
  assert.equal(Session.rowDetail(Object.assign({}, s, { state: "done" }), now, en), "“hi”")
  assert.equal(Session.workText(Object.assign({}, s, { updated: now, running: [{ tool: "Read", detail: "/a/b.txt", at: now }] }), now, en), "reads b.txt")
  assert.equal(Session.askLabel({ request: { kind: "plan" } }, en), "plan to approve")
  assert.equal(Toast.checkLabel({ running: false, done: true, found: 3 }, en), "3 new")
  assert.equal(Toast.fold([], [1, 2, 3, 4].map(i => ({ title: "t" + i })), 9, en).slice(-1)[0].title, "4 notifications")
  assert.equal(Toast.welcomeBack([{ title: "a" }, { title: "b" }], 9, en)[0].title, "While you were away: 2 notifications")
  const crit = i => ({ title: "c" + i, level: "error", sticky: true })
  const many = Toast.fold([], Array.from({ length: Toast.maxSticky + 2 }, (_, i) => crit(i)), 9, en)
  assert.equal(many.filter(x => x.sticky)[0].title, "3 important notifications")
  assert.equal(S.tl(en, "paste.tooMuch"), "Too much to paste")
  assert.equal(Note.actionLabel("Mark as read", en), "Mark read")
  assert.equal(Settings.sharingOptions(en)[0].label, "no change")
  assert.equal(Settings.sharingNote({ whenSharing: "quiet" }, true, en), "quiet – screen is shared")
  assert.equal(Settings.sharingOptions(en)[2].label, "hide island")
  assert.equal(Session.endQuestion(Object.assign({}, s, { updated: now }), now, en), "End “a”? Claude is still working.")
  assert.equal(Note.actionLabel("Mark as read", "de"), "Gelesen")
  assert.equal(Note.actionLabel("Snooze", "de"), "Snooze")
})
