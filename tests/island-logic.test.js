"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const L = require("./lib/load").load("IslandLogic.js")

// physicalPixelDensity is in pixels per millimetre.
const density = ppi => ppi / 25.4

test("Zoom aus der Pixeldichte, Bezug 104 ppi, Stufen 0,05, 1 bis 2", () => {
  assert.equal(L.autoZoom(density(104), 1), 1)
  assert.equal(L.autoZoom(density(90), 1), 1)
  // 34" mit 3440×1440
  assert.equal(L.autoZoom(density(Math.hypot(3440, 1440) / 34), 1), 1.05)
  // 14"-Laptop 2880×1800 bei Skalierung 2: logisch ~121 ppi
  assert.equal(L.autoZoom(density(Math.hypot(2880, 1800) / 14), 2), 1.15)
  assert.equal(L.autoZoom(density(500), 1), 2)
  assert.equal(L.autoZoom(0, 1), 1)
  assert.equal(L.autoZoom(undefined, undefined), 1)
  assert.equal(L.zoom(1.5, 1.05), 1.5)
  assert.equal(L.zoom(0, 1.05), 1.05)
})

test("Uhrzeit: heute nur Zeit, sonst mit Datum", () => {
  const now = new Date(2026, 9, 28, 17, 30).getTime() / 1000
  assert.equal(L.when(new Date(2026, 9, 28, 9, 5).getTime() / 1000, now), "09:05")
  assert.equal(L.when(new Date(2026, 9, 27, 23, 59).getTime() / 1000, now), "27.10. 23:59")
  assert.equal(L.when(new Date(2026, 0, 3, 0, 0).getTime() / 1000, now), "03.01. 00:00")
})

test("Begrüßung und Nacht", () => {
  assert.deepEqual([0, 4, 5, 10, 11, 16, 17, 21, 22, 23].map(h => L.greeting(h, "Lea")), [
    "Noch wach, Lea?", "Noch wach, Lea?", "Guten Morgen, Lea", "Guten Morgen, Lea", "Hallo Lea",
    "Hallo Lea", "Guten Abend, Lea", "Guten Abend, Lea", "Schon spät, Lea", "Schon spät, Lea"])
  assert.deepEqual([22, 23, 0, 6, 7].map(L.night), [false, true, true, true, false])
})

test("Name aus dem System: Vorname aus GECOS, sonst Login groß", () => {
  assert.equal(L.firstName("lea:x:1000:1000::/home/lea:/usr/bin/zsh\n"), "Lea")
  assert.equal(L.firstName("anna:x:1001:1001:Anna Maria Schulz,,,:/home/anna:/bin/bash"), "Anna")
  assert.equal(L.firstName("bob:x:1002:1002: ,,,:/home/bob:/bin/sh"), "Bob")
  assert.equal(L.firstName(""), "")
})

test("Ungelesen: Neuigkeiten und Benachrichtigungen, ohne Musik und Gesehenes", () => {
  const news = [{ title: "a", time: 20, level: "warn", source: "system" }, { title: "b", time: 5 }]
  const notes = [{ app: "Beeper", time: 30, urgency: 2 }, { app: "Spotify", time: 30, media: true },
                 { app: "Orca", time: 30, seen: true }, { app: "Mail", time: 1 }]
  const unread = L.unread(news, notes, 10)
  assert.deepEqual(unread.map(u => u.title || u.app), ["a", "Beeper"])
  assert.equal(unread[1].level, "error")
  assert.equal(L.hasProblem(unread), true)
  assert.equal(L.hasProblem([{ level: "info" }]), false)
  assert.equal(L.readUpTo(10, news, notes), 30)
  assert.equal(L.readUpTo(50, [], []), 50)
})

test("Zusammenfassung in einer Zeile", () => {
  const none = { needs: 0, working: 0, shown: 0 }
  assert.equal(L.summary(none, []), "Alles ruhig")
  assert.equal(L.summary({ needs: 2, working: 1, shown: 3 }, []), "2× braucht dich")
  assert.equal(L.summary({ needs: 0, working: 1, shown: 3 }, []), "Claude arbeitet")
  assert.equal(L.summary({ needs: 0, working: 1, workingName: "Codex", shown: 3 }, []), "Codex arbeitet")
  assert.equal(L.summary({ needs: 0, working: 2, shown: 3 }, []), "2 Sitzungen arbeiten")
  assert.equal(L.summary({ needs: 0, working: 0, shown: 1 }, []), "1 Sitzung offen")
  assert.equal(L.summary({ needs: 0, working: 0, shown: 3, background: 1 }, []), "2 Sitzungen offen, 1 im Hintergrund")
  assert.equal(L.summary({ needs: 0, working: 0, shown: 2, background: 2 }, []), "2 Sitzungen im Hintergrund")
  assert.equal(L.summary({ needs: 0, working: 0, shown: 1, background: 1 }, []), "1 Sitzung im Hintergrund")
  assert.equal(L.summary({ needs: 0, working: 1, shown: 2, background: 1 }, []), "Claude arbeitet, 1 im Hintergrund")
  assert.equal(L.summary({ needs: 1, working: 0, shown: 2, background: 1 }, []), "1× braucht dich")
  const unread = [{ app: "Beeper" }, { source: "kuma" }, { app: "Beeper" }, { source: "x" }, { app: "notify-send" }]
  assert.equal(L.summary({ needs: 0, working: 0, shown: 2 }, unread), "2 Sitzungen offen, 2 neu von Beeper, 1 neu von Uptime Kuma, 2 weitere")
  assert.equal(L.summary({ needs: 0, working: 0, shown: 0 }, [{ source: "x" }, { app: "Beeper" }]), "1 neu, 1 neu von Beeper")
  // Web-Benachrichtigungen nach Seite (#147)
  assert.equal(L.summary({ needs: 0, working: 0, shown: 0 }, [{ app: "Chromium", site: "Instagram" }, { app: "Chromium", site: "Instagram" }]), "2 neu von Instagram")
})

test("Welche Ansicht: offen vor Rückfrage vor Pop-up vor Peek", () => {
  assert.equal(L.mode(true, {}, {}, true, true), "open")
  assert.equal(L.mode(false, {}, {}, true, true), "needs")
  // Asks only in the terminal: pop-ups first, then the ask again.
  assert.equal(L.mode(false, {}, {}, true, false), "toast")
  assert.equal(L.mode(false, {}, null, true, false), "needs")
  assert.equal(L.mode(false, null, {}, true), "toast")
  assert.equal(L.mode(false, null, null, true), "peek")
  assert.equal(L.mode(false, null, null, false), "pill")
})

test("O-Morchys Stimmung", () => {
  const base = { needs: 0, working: 0, unreadProblem: false, away: false, mode: "pill", quietFor: 0, night: false }
  const mood = fields => L.mood(Object.assign({}, base, fields))
  assert.equal(mood({ needs: 1, working: 1 }), "needs")
  assert.equal(mood({ working: 1, unreadProblem: true }), "thinking")
  assert.equal(mood({ unreadProblem: true, away: true }), "worried")
  assert.equal(mood({ away: true }), "sleep")
  assert.equal(mood({ quietFor: 601 }), "sleep")
  assert.equal(mood({ quietFor: 601, mode: "toast" }), "idle")
  assert.equal(mood({ quietFor: 121, night: true }), "sleep")
  assert.equal(mood({ quietFor: 121 }), "idle")
})

test("Bildschirm: fokussierter Monitor, fest eingestellter gewinnt, hält beim Zeigen", () => {
  const names = ["DP-1", "HDMI-A-1"]
  assert.equal(L.pickScreen(names, "HDMI-A-1", "", "DP-1", false), "HDMI-A-1")
  // zeigt gerade etwas: bleibt, wo es ist
  assert.equal(L.pickScreen(names, "HDMI-A-1", "", "DP-1", true), "DP-1")
  // fest eingestellt, solange angeschlossen
  assert.equal(L.pickScreen(names, "HDMI-A-1", "DP-1", "HDMI-A-1", false), "DP-1")
  assert.equal(L.pickScreen(names, "HDMI-A-1", "eDP-1", "DP-1", false), "HDMI-A-1")
  // bisheriger Bildschirm abgezogen, während etwas zu sehen ist
  assert.equal(L.pickScreen(["HDMI-A-1"], "HDMI-A-1", "", "DP-1", true), "HDMI-A-1")
  // Hyprland meldet noch keinen Fokus
  assert.equal(L.pickScreen(names, "", "", "", false), "DP-1")
  assert.equal(L.pickScreen(names, "", "", "HDMI-A-1", false), "HDMI-A-1")
  assert.equal(L.pickScreen([], "DP-1", "", "DP-1", false), "")
})

test("Helle Themes: erkannt am Hintergrund, kräftigere Zweittexte und Karten", () => {
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  for (const bg of ["#ffffff", "#eff1f5", "#FFFCF0", "#faf4ed"]) assert.equal(L.isLight(...rgb(bg)), true, bg)
  for (const bg of ["#0c0b0c", "#1a1b26", "#101315", "#808080"]) assert.equal(L.isLight(...rgb(bg)), false, bg)
  assert.ok(L.shades(true).muted > L.shades(false).muted)
  assert.notEqual(L.shades(true).good, L.shades(false).good)
  assert.notEqual(L.shades(true).aside, L.shades(false).aside)
})

// Die Farben eines Themes, so gelesen wie Commons/Color.qml es tut.
function themeColors(file) {
  const fs = require("node:fs")
  const c = { foreground: "#cacccc", background: "#101315", accent: "", urgent: "#a55555" }
  let color4 = ""
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*["']?(#[0-9A-Fa-f]{6})/)
    if (!m) continue
    if (m[1] === "foreground" || m[1] === "background" || m[1] === "accent") c[m[1]] = m[2]
    else if (m[1] === "color4") color4 = m[2]
    else if (m[1] === "red" || m[1] === "color1") c.urgent = m[2]
  }
  if (!c.accent) c.accent = color4 || "#cacccc"
  const rgb = hex => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 })
  return { fg: rgb(c.foreground), bg: rgb(c.background), accent: rgb(c.accent), urgent: rgb(c.urgent) }
}

test("Kontrast: Zweittext, Rot, Akzent, fertig und Hintergrund in jedem Omarchy-Theme ab 4,5:1 (F6)", () => {
  const fs = require("node:fs"), path = require("node:path")
  const dirs = ["/usr/share/omarchy/themes", path.join(process.env.HOME || "", ".config/omarchy/themes")]
  const files = dirs.flatMap(d => fs.existsSync(d) ? fs.readdirSync(d).map(t => path.join(d, t, "colors.toml")) : [])
    .filter(f => fs.existsSync(f))
  if (!files.length) return  // kein Omarchy auf diesem Rechner
  for (const file of files) {
    const t = themeColors(file), light = L.isLight(t.bg.r, t.bg.g, t.bg.b)
    const ink = L.inks(t.fg, t.bg, t.accent, t.urgent, light)
    // die rote Zeile ist mit dem Rot der Insel getönt (Theme.urgent)
    const on = [t.bg, L.mix(t.bg, t.fg, 0.08), L.mix(t.bg, ink.urgent, 0.12), L.mix(t.bg, t.accent, 0.07)]
    for (const k of ["muted", "urgent", "accent", "good", "aside"])
      for (const s of on) {
        // Wo selbst die Textfarbe es nicht schafft, nimmt die Insel sie.
        const best = Math.min(4.5, L.contrast(t.fg, s))
        assert.ok(L.contrast(ink[k], s) >= best - 1e-9, `${file}: ${k} ${L.contrast(ink[k], s).toFixed(2)}`)
      }
    // Spotifys Haken (#163): ein Symbol, 3:1 auf dem Player und beim Drüberfahren
    for (const s of [t.bg, L.mix(t.bg, t.fg, 0.12)])
      assert.ok(L.contrast(ink.spotify, s) >= Math.min(3, L.contrast(t.fg, s)) - 1e-9, `${file}: spotify ${L.contrast(ink.spotify, s).toFixed(2)}`)
    // Rot sieht weder wie Zweittext noch wie der Akzent aus (#187). Ab 30 sicher;
    // knapp, weil beide Rote zur Textfarbe hin gehoben werden: Everforest
    // (Zweittext 22) und Ristretto (Akzent 27).
    for (const [what, other] of [["Zweittext", ink.muted], ["Akzent", t.accent]])
      assert.ok(L.distance(ink.urgent, other) >= 20, `${file}: Rot zu ${what} ΔE ${L.distance(ink.urgent, other).toFixed(0)}`)
  }
})

test("Rosé Pine (hell): Rot bleibt rot, nicht Mauve wie der Zweittext (#187)", () => {
  const rgb = hex => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 })
  const fg = rgb("#575279"), bg = rgb("#faf4ed"), accent = rgb("#56949f"), own = rgb("#b4637a")
  const ink = L.inks(fg, bg, accent, own, true)
  assert.ok(L.distance(ink.urgent, ink.muted) >= L.minDistance, `zum Zweittext ΔE ${L.distance(ink.urgent, ink.muted).toFixed(0)}`)
  assert.ok(L.distance(ink.urgent, accent) >= L.minDistance)
  assert.ok(L.contrast(ink.urgent, bg) >= 4.5)
  assert.ok(ink.urgent.r > ink.urgent.b + 0.3, "rot, nicht lila")
})

test("Kontrast: wo das Theme reicht, bleibt der Look", () => {
  const black = { r: 0, g: 0, b: 0 }, white = { r: 1, g: 1, b: 1 }, red = { r: 1, g: 0.3, b: 0.3 }, blue = { r: 0.4, g: 0.6, b: 1 }
  const ink = L.inks(white, black, blue, red, false)
  assert.deepEqual(ink.urgent, red)
  assert.ok(Math.abs(ink.muted.r - 0.55) < 1e-9, "dunkel: 55 % Weiß")
  // dunkles Rot auf Schwarz wird heller
  const dark = L.inks(white, black, blue, { r: 0.5, g: 0, b: 0 }, false)
  assert.ok(dark.urgent.r > 0.5 && L.contrast(dark.urgent, black) >= 4.5)
  assert.ok(Math.abs(L.contrast(white, black) - 21) < 1e-9)
})

test("Spotify-Grün: im Dunkeln Spotifys eigenes, im Hellen dunkler (#163)", () => {
  const rgb = hex => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 })
  const dark = L.inks(rgb("#ffffff"), rgb("#121212"), rgb("#7aa2f7"), rgb("#f7768e"), false)
  assert.deepEqual(dark.spotify, rgb("#1ed760"))
  const light = L.inks(rgb("#000000"), rgb("#ffffff"), rgb("#6e6e6e"), rgb("#c62828"), true)
  assert.ok(L.contrast(light.spotify, rgb("#ffffff")) >= 3 && light.spotify.g > light.spotify.r + 0.2, "grün und lesbar")
})

test("Rot zu nah am Akzent wird nachgeschärft, bleibt aber lesbar (#118)", () => {
  const rgb = hex => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 })
  // last-horizon: Rot #c38b7b, Akzent #b59790
  const fg = rgb("#FAFCFB"), bg = rgb("#0c0b0c"), accent = rgb("#b59790"), own = rgb("#c38b7b")
  assert.ok(L.distance(own, accent) < L.minDistance)
  const ink = L.inks(fg, bg, accent, own, false)
  assert.ok(L.distance(ink.urgent, accent) >= L.minDistance, "deutlich anders als der Akzent")
  assert.ok(L.contrast(ink.urgent, bg) >= 4.5)
  // tokyo-night: eigenes Rot weit genug weg, bleibt
  const tn = L.inks(rgb("#c0caf5"), rgb("#1a1b26"), rgb("#7aa2f7"), rgb("#f7768e"), false)
  assert.deepEqual(tn.urgent, rgb("#f7768e"))
  // helles Theme: das helle Ersatzrot
  const white = L.inks(rgb("#000000"), rgb("#ffffff"), rgb("#6e6e6e"), rgb("#2a2a2a"), true)
  assert.ok(L.distance(white.urgent, rgb("#6e6e6e")) >= L.minDistance && L.contrast(white.urgent, rgb("#ffffff")) >= 4.5)
})

test("Gesehene Pop-ups gelten als gelesen", () => {
  const news = [{ title: "a", time: 20, source: "system" }, { title: "b", time: 15, source: "system" }]
  const notes = [{ key: "n3", app: "Beeper", group: "Beeper\nAnna", time: 30, urgency: 1 },
                 { key: "n2", app: "Beeper", group: "Beeper\nAnna", time: 25, urgency: 1 },
                 { key: "n1", app: "Mail", group: "Mail\nx", time: 22, urgency: 1 }]
  assert.equal(L.unread(news, notes, 10, {}).length, 5)
  // ein Nachrichten-Pop-up: der Eintrag selbst
  let read = L.addRead({}, L.readBy({ title: "a", time: 20, source: "system" }, notes), 10)
  assert.deepEqual(read, { "news:20": 20 })
  assert.equal(L.newsUnread(news[0], 10, read), false)
  assert.equal(L.newsUnread(news[1], 10, read), true)
  // ein Bündel: alles vom selben Absender bis zum Pop-up, nichts Neueres, nichts anderes
  const bundle = L.readBy({ note: true, key: "n2", group: "Beeper\nAnna", time: 25 }, notes)
  assert.deepEqual(bundle, { n2: 25 })
  read = L.addRead(read, L.readBy({ note: true, key: "n3", group: "Beeper\nAnna", time: 30 }, notes), 10)
  assert.deepEqual(read, { "news:20": 20, n3: 30, n2: 25 })
  assert.deepEqual(L.unread(news, notes, 10, read).map(i => i.time), [15, 22])
  // Zusammenfassungen nannten nur Namen
  assert.deepEqual(L.readBy({ title: "5 Neuigkeiten", names: ["x"], time: 40 }, notes), {})
  assert.deepEqual(L.readBy(null, notes), {})
  // was lastRead abdeckt, fällt raus (ui.json bleibt klein)
  assert.deepEqual(L.addRead(read, {}, 25), { n3: 30 })
  assert.deepEqual(L.addRead(undefined, undefined, 0), {})
})

test("Klickschutz: neuer Inhalt unter dem Zeiger, nicht beim Überfahren", () => {
  assert.equal(L.clickGuardMs, 300)
  assert.equal(L.clickTarget("pill", "", ""), "")
  assert.equal(L.clickTarget("peek", "t1", ""), "")
  assert.equal(L.clickTarget("open", "t1", "a"), "open")
  assert.equal(L.clickTarget("toast", "t1", ""), "toast:t1")
  assert.notEqual(L.clickTarget("toast", "t2", ""), L.clickTarget("toast", "t1", ""))
  assert.equal(L.clickTarget("needs", "", "s/1"), "needs:s/1")
})

test("Klick auf die Insel: was er tut (B45)", () => {
  assert.equal(L.clickAction(true, "open", null), "close")
  assert.equal(L.clickAction(true, "toast", { title: "a" }), "dismiss")
  assert.equal(L.clickAction(true, "needs", null), "goToAsk")
  assert.equal(L.clickAction(false, "toast", { note: true }), "activateNote")
  assert.equal(L.clickAction(false, "toast", { window: "abc" }), "activate")
  assert.equal(L.clickAction(false, "toast", { url: "https://x" }), "activate")
  assert.equal(L.clickAction(false, "toast", { title: "Neu" }), "openFromToast")
  // the action has its button; a click on the pop-up opens the view (#169)
  assert.equal(L.clickAction(false, "toast", { title: "Updates: 3 Pakete", action: "updates" }), "openFromToast")
  assert.equal(L.clickAction(false, "toast", { title: "x", action: "rm -rf" }), "openFromToast")  // only known actions
  assert.equal(L.clickAction(false, "open", null), "none")
  assert.equal(L.clickAction(false, "pill", null), "open")
  assert.equal(L.clickAction(false, "needs", null), "open")
})

test("Fensteradresse nur als Hex-Zahl in den Hyprland-Befehl (B46)", () => {
  assert.equal(L.windowAddress("55d1c0ffee"), "0x55d1c0ffee")
  assert.equal(L.windowAddress("0x55D1"), "0x55D1")
  assert.equal(L.windowAddress('1" }) os.execute("x'), "")
  assert.equal(L.windowAddress(""), "")
  assert.equal(L.windowAddress(undefined), "")
})

test("Knopf an einer Neuigkeit: Updates und Absturz starten ihr Skript aus dem Checkout (#165, #169)", () => {
  assert.deepEqual(L.actionCommand("updates", "/r"), ["/r/bin/omarchy-buddy-update"])
  assert.deepEqual(L.actionCommand("crash:4711", "/r"), ["/r/bin/omarchy-buddy-crash", "4711"])
  assert.equal(L.actionCommand("crash:4711; rm -rf ~", "/r"), null)
  assert.equal(L.actionCommand("crash:", "/r"), null)
  assert.equal(L.actionCommand("", "/r"), null)
  assert.equal(L.clickable({ action: "crash:1" }), false, "die Aktion hat ihren Knopf")
  assert.equal(L.clickable({ url: "https://x" }), true)
  assert.equal(L.actionLabel("crash:1", "de"), "Untersuchen")
  assert.equal(L.actionLabel("updates", "en"), "Update")
  assert.equal(L.actionLabel("anderes", "de"), "")
  assert.equal(L.actionKeepsToast("setup"), true)  // #208: a No in the setup leaves the offer
  assert.equal(L.actionKeepsToast("try"), false)
  assert.equal(L.actionKeepsToast("updates"), false)
  // #192: Einrichten im Terminal, Probier's aus schickt eine echte Benachrichtigung
  const setup = L.actionCommand("setup", "/r", "de")
  assert.equal(setup[setup.length - 1], "/r/bin/omarchy-buddy-setup")
  assert.match(setup[2], /omarchy-launch-floating-terminal-with-presentation/)
  assert.deepEqual(L.actionCommand("try", "/r", "de"), ["notify-send", "-a", "O-Morchy", "Probe-Benachrichtigung", "So sehen deine Benachrichtigungen jetzt aus."])
  assert.equal(L.actionLabel("setup", "de"), "Einrichten")
  assert.equal(L.actionLabel("try", "de"), "Probier’s aus")
  assert.equal(L.actionLabel("try", "en"), "Try it")
  assert.equal(L.actionLabel(undefined, "de"), "")
})

test("Pille: Sprechblase/Brief statt Punkt, wenn die neueste Neuigkeit eine Nachricht ist (#123)", () => {
  const chat = { source: "app", level: "info", time: 30, kind: "chat" }
  const mail = { source: "app", level: "info", time: 20, kind: "mail" }
  const news = { source: "system", level: "info", time: 10 }
  assert.equal(L.pillMark([news, mail, chat]), "chat")
  assert.equal(L.pillMark([news, mail]), "mail")
  assert.equal(L.pillMark([mail, Object.assign({}, news, { time: 40 })]), "")
  assert.equal(L.pillMark([chat, { source: "system", level: "warn", time: 1 }]), "", "Problem behält den roten Punkt")
  assert.equal(L.pillMark([]), "")
  const notes = [{ key: "a", app: "Signal", time: 50, kind: "chat", urgency: 1 }]
  assert.equal(L.pillMark(L.unread([], notes, 10, {})), "chat")
})

test("Fläche: wächst sofort, schrumpft erst nach dem Größenwechsel, nie über voll (#156)", () => {
  assert.equal(L.surfaceHeight(80, 400.2, 851, false), 401, "wächst sofort, aufgerundet")
  assert.equal(L.surfaceHeight(400, 80, 851, false), 400, "schrumpft nicht mitten im Größenwechsel")
  assert.equal(L.surfaceHeight(400, 80, 851, true), 80, "schrumpft danach")
  assert.equal(L.surfaceHeight(80, 2000, 851, false), 851, "höchstens so hoch wie voll")
  assert.equal(L.surfaceHeight(851, 851, 851, true), 851)
})

test("Für dich (#175, #178): Menschen, Termine, Kritisches und Probleme bleiben bis Klick oder ×", () => {
  const n = (key, group, time, kind, urgency = 1, more = {}) => ({ key, group, time, kind, urgency, ...more })
  const notes = [n("k9", "mail", 90, "mail"), n("k8", "chat", 80, "chat"), n("k7", "termin", 70, "event"),
                 n("k6", "akku", 60, "", 2), n("k5", "app", 50, ""), n("k4", "erledigt", 40, "mail"),
                 n("k3", "alt", 3, "mail"), n("k2", "musik", 85, "", 2, { media: true })]
  const groups = notes.map(x => ({ group: x.group, note: x, count: 1, unread: false }))
  const news = [{ title: "kaputt", level: "error", time: 20 }, { title: "Update", level: "warn", time: 19 },
                { title: "grün", level: "good", time: 18 }, { title: "alt", level: "error", time: 2 },
                { title: "weg", level: "error", time: 17 }]
  // Read or not does not matter; done (doneIds), up to doneUpTo, or older than since does.
  const r = L.forYou(groups, notes, news, 0, { k4: 40, "news:17": 17 }, 10)
  assert.deepEqual(r.notes.map(x => x.group), ["mail", "chat", "termin", "akku"])
  assert.deepEqual(r.otherNotes.map(x => x.group), ["app", "erledigt", "alt", "musik"])
  assert.deepEqual(r.news.map(x => x.title), ["kaputt", "Update"])
  assert.deepEqual(r.otherNews.map(x => x.title), ["grün", "alt", "weg"])
  assert.deepEqual(L.forYou(groups, notes, news, 75, {}, 0).notes.map(x => x.group), ["mail", "chat"], "doneUpTo")
  // A group stays while one of its messages is open.
  const two = [n("b", "mail", 30, "mail"), n("a", "mail", 20, "mail")]
  assert.deepEqual(L.forYou([{ group: "mail", note: two[0] }], two, [], 0, { b: 30 }, 0).notes.length, 1)
  assert.deepEqual(L.forYou([], [], [], 0, {}, 0), { notes: [], otherNotes: [], news: [], otherNews: [] })
  assert.equal(L.forYouKeep, 24 * 3600)
})

test("Für dich erledigt (#178): Neuigkeit, Nachricht mit den früheren ihres Absenders", () => {
  const notes = [{ key: "c", group: "g", time: 30 }, { key: "b", group: "g", time: 20 },
                 { key: "x", group: "h", time: 15 }, { key: "a", group: "g", time: 10 }]
  assert.deepEqual(L.doneBy({ title: "kaputt", time: 7 }, notes), { "news:7": 7 })
  assert.deepEqual(L.doneBy(notes[1], notes), { b: 20, a: 10 })
  assert.deepEqual(L.doneBy({ note: true, key: "c", group: "g", time: 30 }, notes), { c: 30, b: 20, a: 10 })
  assert.deepEqual(L.doneBy(null, notes), {})
})

test("Neuigkeit für den Screenreader: Stufe und ungelesen in Worten", () => {
  assert.equal(L.newsName({ title: "Absturz", level: "error" }, true, "de"), "Fehler: Absturz, ungelesen")
  assert.equal(L.newsName({ title: "Update", level: "warn" }, false, "en"), "Warning: Update")
  assert.equal(L.newsName({ title: "Tests grün", level: "good" }, false, "de"), "Tests grün")
})

test("Neuigkeiten nach Tagen: heute höchstens 5, ältere Tage zugeklappt (#183)", () => {
  const now = new Date(2026, 10, 1, 17, 0).getTime() / 1000  // So., 1.11.
  const at = (d, h, m) => ({ time: new Date(2026, 9, d, h, m || 0).getTime() / 1000 })
  const today = h => ({ time: new Date(2026, 10, 1, h).getTime() / 1000, title: "heute " + h })
  const items = [today(9), today(10), today(11), today(12), today(13), today(14), today(15),
                 at(31, 20), at(31, 8), at(29, 12), at(27, 1)]
  const days = L.newsDays(items, now, {})
  assert.deepEqual(days.map(d => [d.label, d.count, d.open, d.items.length]),
    [["Heute", 7, true, 5], ["Gestern", 2, false, 0], ["Do., 29.10.", 1, false, 0], ["Di., 27.10.", 1, false, 0]])
  assert.deepEqual(days[0].items.map(i => i.title), ["heute 15", "heute 14", "heute 13", "heute 12", "heute 11"],
    "neueste zuerst, auch ungeordnet geliefert")
  assert.equal(days[0].more, "2 weitere heute")
  assert.equal(days[0].moreName, "2 weitere heute, zugeklappt")
  assert.equal(days[1].more, "")
  assert.equal(days[1].name, "Gestern, 2 Neuigkeiten, zugeklappt")
  assert.equal(days[2].name, "Do., 29.10., 1 Neuigkeit, zugeklappt")

  const open = L.newsDays(items, now, { "2026-11-01": true, "2026-10-31": true })
  assert.equal(open[0].items.length, 7)
  assert.equal(open[0].more, "weniger anzeigen")
  assert.equal(open[0].moreName, "weniger anzeigen, aufgeklappt")
  assert.deepEqual([open[1].open, open[1].items.length, open[1].name], [true, 2, "Gestern, 2 Neuigkeiten, aufgeklappt"])
  assert.equal(open[2].open, false)

  // Genau 5 heute: keine Zeile darunter. Nichts heute: nur zugeklappte Tage.
  assert.equal(L.newsDays(items.slice(0, 5), now, {})[0].more, "")
  assert.deepEqual(L.newsDays(items.slice(7), now, {}).map(d => d.open), [false, false, false])
  assert.deepEqual(L.newsDays([], now, {}), [])

  // Lokaler Tag: kurz nach Mitternacht ist schon heute, 23:59 gestern.
  assert.deepEqual(L.newsDays([{ time: new Date(2026, 10, 1, 0, 1).getTime() / 1000 }, at(31, 23, 59)], now, {})
    .map(d => d.label), ["Heute", "Gestern"])
  // Gestern auch über die Zeitumstellung (25.10.) und den Jahreswechsel.
  assert.equal(L.dayLabel(at(25, 12).time, new Date(2026, 9, 26, 1).getTime() / 1000), "Gestern")
  assert.equal(L.dayLabel(new Date(2025, 11, 31, 22).getTime() / 1000, new Date(2026, 0, 1, 8).getTime() / 1000), "Gestern")

  const en = L.newsDays(items, now, {}, "en")
  assert.deepEqual(en.map(d => d.label), ["Today", "Yesterday", "Thu, Oct 29", "Tue, Oct 27"])
  assert.equal(en[0].more, "2 more today")
  assert.equal(en[2].name, "Thu, Oct 29, 1 news item, collapsed")
})

test("#182 Leisten-Widget: Klick öffnet und schließt wie ein Omarchy-Pop-up, rechts wie die Insel", () => {
  assert.equal(L.widgetClickAction(false, "pill", null), "open")
  assert.equal(L.widgetClickAction(false, "peek", null), "open")
  assert.equal(L.widgetClickAction(false, "needs", null), "open")
  assert.equal(L.widgetClickAction(false, "open", null), "close")
  assert.equal(L.widgetClickAction(false, "toast", { title: "a", url: "x" }), "openFromToast")
  assert.equal(L.widgetClickAction(true, "toast", { title: "a" }), "dismiss")
  assert.equal(L.widgetClickAction(true, "open", null), "close")
})

test("#182 Text in der Leiste nur, wenn etwas los ist", () => {
  assert.equal(L.barText({ needs: 0, working: 0 }, "de"), "")
  assert.equal(L.barText({ needs: 1, needsName: "Codex", working: 2 }, "de"), "Codex braucht dich")
  assert.equal(L.barText({ needs: 3, working: 0 }, "en"), "3× needs you")
  assert.equal(L.barText({ needs: 0, working: 1, workingName: "Claude" }, "de"), "Claude arbeitet")
  assert.equal(L.barText({ needs: 0, working: 2 }, "de"), "2 Sitzungen arbeiten")
})

test("#182 O-Morchy füllt die Leiste in halben Pixelstufen", () => {
  assert.equal(L.barMorchyPx(26), 1.5)
  assert.equal(L.barMorchyPx(28), 1.5)
  assert.equal(L.barMorchyPx(34), 2)
  assert.equal(L.barMorchyPx(12), 1)
})

test("#182 Insel dockt an der Leiste unter dem Widget an", () => {
  const base = { bar: 26, gap: 5, screenW: 3440, screenH: 1440, surfaceW: 1300, fullH: 800 }
  // Leiste oben, Widget rechts neben der Uhr: Insel trotzdem in der Bildschirmmitte (#200, Dynamic Island).
  let d = L.dock({ ...base, edge: "top", widget: { x: 1800, y: 0, w: 40, h: 26 } })
  assert.deepEqual(d, { left: 1070, top: 0, centre: 650, inset: 31 })
  assert.equal(L.islandX("top", d.centre, 26, 5, 1300, 300), 500)
  assert.equal(d.left + 500 + 150, 3440 / 2, "Inselmitte = Bildschirmmitte")
  assert.deepEqual(L.dock({ ...base, edge: "top", widget: null }), d, "ohne Widget gleich")
  d = L.dock({ ...base, edge: "bottom", widget: { x: 3400, y: 1414, w: 40, h: 26 } })
  assert.equal(d.left, 1070, "Widget ganz rechts: Insel bleibt in der Mitte")
  // Versteckte Leiste: nur der Abstand.
  assert.equal(L.dock({ ...base, bar: 0, edge: "top", widget: null }).inset, 5)
  // Leiste seitlich: oben bündig mit dem Widget, unten auf dem Bildschirm gehalten.
  d = L.dock({ ...base, edge: "left", bar: 28, widget: { x: 0, y: 300, w: 28, h: 40 } })
  assert.deepEqual(d, { left: 0, top: 300, centre: 0, inset: 5 })
  d = L.dock({ ...base, edge: "right", bar: 28, widget: { x: 0, y: 1200, w: 28, h: 40 } })
  assert.deepEqual(d, { left: 0, top: 640, centre: 0, inset: 560 })
  assert.equal(L.islandX("left", 0, 28, 5, 1300, 300), 33)
  assert.equal(L.islandX("right", 0, 28, 5, 1300, 300), 967)
})
