"use strict"
const test = require("node:test")
const assert = require("node:assert/strict")
const L = require("./lib/load").load("PlayerLogic.js")

const p = (id, state, title) => ({ id: id, state: state, title: title === undefined ? "Lied" : title })

test("Player: nur mit geladenem Lied, spielend vor pausiert", () => {
  assert.equal(L.pick([], {}), "")
  assert.equal(L.pick([p("a", "stopped")], {}), "")
  assert.equal(L.pick([p("a", "paused", "")], {}), "", "ohne Titel kein Lied")
  assert.equal(L.pick([p("a", "paused")], {}), "a")
  assert.equal(L.pick([p("a", "paused"), p("b", "playing")], { a: 9, b: 1 }), "b")
})

test("Player: mehrere – der zuletzt spielende", () => {
  assert.equal(L.pick([p("a", "playing"), p("b", "playing")], { a: 1, b: 2 }), "b", "zuletzt gestartet")
  assert.equal(L.pick([p("a", "paused"), p("b", "paused")], { a: 5, b: 2 }), "a", "zuletzt angehalten")
  assert.equal(L.pick([p("a", "paused"), p("b", "paused")], {}), "a", "ohne Zeitstempel der erste")
})

test("Player: singt bei Liedwechsel, nicht bei Pause oder Sprung", () => {
  assert.equal(L.sings("a/1", "a/2", false), true, "nächstes Lied")
  assert.equal(L.sings("a/1", "b/7", false), true, "anderer Player")
  assert.equal(L.sings("", "a/1", false), true, "Musik startet")
  assert.equal(L.sings("a/1", "a/1", false), false, "Fortsetzen oder Sprung im selben Lied")
  assert.equal(L.sings("a/1", "", false), false, "Pause")
  assert.equal(L.sings(null, "a/1", false), false, "lief schon beim Start")
  assert.equal(L.sings("a/1", "a/2", true), false, "weg oder verdeckt")
})

test("Player: Musikdienst – eigene App am Namen, Browser an der Seite", () => {
  const app = (dbusName, identity, desktopEntry) => L.isMusic({ dbusName, identity, desktopEntry, metadata: {} })
  // Spotify's desktop app as busctl shows it (01.11.2026).
  assert.equal(L.isMusic({ dbusName: "org.mpris.MediaPlayer2.spotify", identity: "Spotify", desktopEntry: "spotify",
    metadata: { "xesam:url": "https://open.spotify.com/track/7Mpcc5isvuzFQnUwTkOata" } }), true)
  assert.equal(app("org.mpris.MediaPlayer2.spotifyd.instance42", "", ""), true, "spotifyd")
  assert.equal(app("org.mpris.MediaPlayer2.tidal-hifi", "tidal-hifi", "tidal-hifi"), true)
  assert.equal(app("org.mpris.MediaPlayer2.youtube-music", "YouTube Music", ""), true)
  assert.equal(app("org.mpris.MediaPlayer2.deezer", "Deezer", ""), true)
  for (const other of [["org.mpris.MediaPlayer2.mpv", "mpv", "mpv"], ["org.mpris.MediaPlayer2.vlc", "VLC media player", "vlc"],
                       ["org.mpris.MediaPlayer2.buddytest", "Buddy-Test", "buddy-test"]])
    assert.equal(app(...other), false, other[1])

  const ff = (url) => L.isMusic({ dbusName: "org.mpris.MediaPlayer2.firefox.instance_1_23", identity: "Mozilla Firefox",
    desktopEntry: "firefox", metadata: url === undefined ? {} : { "xesam:url": url } })
  for (const url of ["https://open.spotify.com/album/x", "https://listen.tidal.com/track/1", "https://music.amazon.de/albums/B0",
                     "https://music.amazon.co.uk/x", "https://music.youtube.com/watch?v=a", "https://www.deezer.com/de/",
                     "https://soundcloud.com/a/b", "https://artist.bandcamp.com/track/x"])
    assert.equal(ff(url), true, url)
  for (const url of [undefined, "", "https://www.youtube.com/watch?v=a", "https://www.amazon.de/x", "https://notsoundcloud.com/",
                     "https://music.amazon.evil.com/", "https://evil.com/?u=https://open.spotify.com", "file:///home/x/song.mp3"])
    assert.equal(ff(url), false, String(url))
  assert.equal(L.isMusic({ dbusName: "org.mpris.MediaPlayer2.chromium.instance123", identity: "Chromium", metadata: {} }), false,
    "Chromium nennt keine Seite")
  assert.equal(L.isMusic(null), false)
})

test("Player: Zeiten mit Stunden, Fortschritt begrenzt", () => {
  assert.equal(L.clock(0), "0:00")
  assert.equal(L.clock(187.9), "3:07")
  assert.equal(L.clock(3727), "1:02:07")
  assert.equal(L.clock(-3), "0:00")
  assert.equal(L.clock(NaN), "0:00")
  assert.equal(L.progress(30, 120), 0.25)
  assert.equal(L.progress(200, 120), 1)
  assert.equal(L.progress(10, 0), 0)
})


test("Spotify: nur ein Spotify-Titel bekommt das +", () => {
  const id = "6dwB8djWh6NarxPIMidnlG"
  assert.equal(L.spotifyTrack({ "mpris:trackid": "/com/spotify/track/" + id }), "spotify:track:" + id)
  assert.equal(L.spotifyTrack({ "mpris:trackid": "spotify:track:" + id }), "spotify:track:" + id, "ältere Spotify-Versionen")
  assert.equal(L.spotifyTrack({ "mpris:trackid": 'QVariant(QDBusObjectPath, QDBusObjectPath("/com/spotify/track/' + id + '"))' }), "spotify:track:" + id, "so in Quickshell")
  assert.equal(L.spotifyTrack({ "xesam:url": "https://open.spotify.com/track/" + id + "?si=x" }), "spotify:track:" + id)
  assert.equal(L.spotifyTrack({ "mpris:trackid": "/com/spotify/ad/" + id }), "", "Werbung")
  assert.equal(L.spotifyTrack({ "mpris:trackid": "/com/spotify/episode/" + id }), "", "Podcast")
  assert.equal(L.spotifyTrack({ "mpris:trackid": "spotify:local:a:b:c:1" }), "", "lokale Datei")
  assert.equal(L.spotifyTrack({ "mpris:trackid": "/org/mpris/MediaPlayer2/firefox/1", "xesam:url": "https://example.com/track/" + id }), "")
  assert.equal(L.spotifyTrack(null), "")
  // Ein Spotify-Player (#163): Name oder Titel
  assert.equal(L.isSpotify("org.mpris.MediaPlayer2.spotify", {}), true)
  assert.equal(L.isSpotify("org.mpris.MediaPlayer2.spotifyd", null), true)
  assert.equal(L.isSpotify("org.mpris.MediaPlayer2.ncspot", { "mpris:trackid": "/com/spotify/track/" + id }), true)
  assert.equal(L.isSpotify("org.mpris.MediaPlayer2.firefox.instance_1_2", { "xesam:url": "https://www.youtube.com/watch?v=x" }), false)
  assert.equal(L.isSpotify("", null), false)
})

test("Spotify: die Antwort des Helfers", () => {
  assert.deepEqual(L.helperReply('{"uri": "u", "saved": true}\n'), { uri: "u", saved: true })
  assert.deepEqual(L.helperReply(""), { error: "failed" })
  assert.deepEqual(L.helperReply("Traceback"), { error: "failed" })
  assert.deepEqual(L.helperReply("[1]"), { error: "failed" })
})

test("Spotify: was das + zeigt", () => {
  const u = "spotify:track:x"
  assert.equal(L.likeState(false, u, { uri: u, saved: true }, false), "", "ohne Verbindung ändert sich nichts")
  assert.equal(L.likeState(true, "", null, false), "", "kein Spotify-Titel")
  assert.equal(L.likeState(true, u, null, false), "busy")
  assert.equal(L.likeState(true, u, { uri: "spotify:track:alt", saved: true }, false), "busy", "Antwort zum vorigen Titel")
  assert.equal(L.likeState(true, u, { uri: u, saved: false }, true), "busy")
  assert.equal(L.likeState(true, u, { uri: u, saved: false }, false), "add")
  assert.equal(L.likeState(true, u, { uri: u, saved: true }, false), "saved")
  assert.equal(L.likeState(true, u, { uri: u, error: "offline" }, false), "error")
  assert.equal(L.likeState(true, u, { uri: u, error: "unconnected" }, false), "", "Datei von Hand gelöscht")
})

test("Spotify: Fehler sagen, was jetzt hilft", () => {
  assert.deepEqual(L.likeError("expired"), { key: "spotify.error.expired", fix: "reconnect" })
  assert.deepEqual(L.likeError("forbidden"), { key: "spotify.error.forbidden", fix: "reconnect" })
  assert.deepEqual(L.likeError("offline"), { key: "spotify.error.offline", fix: "retry" })
  assert.deepEqual(L.likeError("limit"), { key: "spotify.error.limit", fix: "retry" })
  assert.deepEqual(L.likeError("whatever"), { key: "spotify.error.failed", fix: "retry" })
  assert.equal(L.connectError(""), "")
  assert.equal(L.connectError("port"), "spotify.connect.port")
  assert.equal(L.connectError("usage"), "spotify.connect.failed")
})

test("Spotify ohne Verbindung: nur Spotifys Desktop-App", () => {
  assert.equal(L.spotifyApp("org.mpris.MediaPlayer2.spotify"), true)
  assert.equal(L.spotifyApp("org.mpris.MediaPlayer2.spotify.instance4711"), true, "zweite Instanz")
  assert.equal(L.spotifyApp("org.mpris.MediaPlayer2.spotifyd"), false, "Daemon ohne Fenster")
  assert.equal(L.spotifyApp("org.mpris.MediaPlayer2.chromium.instance9"), false, "Web-Player")
  assert.equal(L.spotifyApp("org.mpris.MediaPlayer2.ncspot"), false)
  assert.match(L.spotifyFocus, /^hl\.dsp\.focus\(\{ window = "class:/, "Hyprlands Lua-Dispatcher, nach Klasse (auch im Scratchpad)")
  assert.equal(L.spotifyApp(undefined), false)
})

test("Spotify ohne Verbindung: das Fenster per Adresse", () => {
  const w = (address, cls, title) => ({ address: address, class: cls, initialClass: cls, title: title || "Spotify Premium" })
  assert.equal(L.spotifyWindow([w("0xa1", "foot"), w("0xb2", "spotify")], "Lied"), "0xb2")
  assert.equal(L.spotifyWindow([w("0xb2", "Spotify")], ""), "0xb2", "XWayland schreibt groß")
  assert.equal(L.spotifyWindow([w("0xa1", "foot")], "Lied"), "", "kein Fenster")
  assert.equal(L.spotifyWindow([w("0xb2", "spotify"), w("0xc3", "spotify", "Band - Lied")], "Lied"), "0xc3", "mehrere: das mit dem Titel")
  assert.equal(L.spotifyWindow([w("0xb2", "spotify"), w("0xc3", "spotify")], "Lied"), "0xb2", "sonst das erste")
  assert.equal(L.spotifyWindow([w("0xb2; rm", "spotify")], ""), "", "keine Adresse")
  assert.equal(L.spotifyWindow({ error: 1 }, ""), "")
  assert.equal(L.spotifyWindow(null, ""), "")
  assert.equal(L.likeShortcut("0xb2"), 'hl.dsp.send_shortcut({ mods = "ALT SHIFT", key = "B", window = "address:0xb2" })')
  assert.equal(L.likeShortcut('0xb2" }) hl.dsp.exec_cmd("x'), "")
  assert.equal(L.likeShortcut(""), "")
})

test("Spotify ohne Verbindung: was das + zeigt", () => {
  const u = "spotify:track:x"
  const k = (more) => Object.assign({ app: true, window: "0xb2", busy: false, sent: "" }, more)
  assert.equal(L.likeState(false, u, null, false, k()), "toggle")
  assert.equal(L.likeState(false, u, null, false, k({ busy: true })), "busy")
  assert.equal(L.likeState(false, u, null, false, k({ sent: u })), "sent")
  assert.equal(L.likeState(false, u, null, false, k({ sent: "spotify:track:alt" })), "toggle", "neuer Titel")
  assert.equal(L.likeState(false, u, null, false, k({ app: false })), "", "Web-Player oder anderer Player")
  assert.equal(L.likeState(false, u, null, false, k({ window: "" })), "", "kein Fenster oder Fehler")
  assert.equal(L.likeState(false, "", null, false, k()), "", "Werbung, Podcast")
  assert.equal(L.likeState(true, u, { uri: u, saved: true }, false, k()), "saved", "verbunden: echter Zustand")
})

// #251: a cover on the net reaches Image only as the helper's checked file.
const FILE = "file:///run/user/1000/omarchy-buddy/covers/0123456789abcdef0123456789abcdef.jpg"

test("Cover: Bilder vom Rechner unverändert, aus dem Netz nur als geprüfte Datei", () => {
  assert.equal(L.coverSource("file:///tmp/a.png", {}), "file:///tmp/a.png")
  assert.equal(L.coverSource("/tmp/a.png", {}), "/tmp/a.png")
  assert.equal(L.coverSource("image://qsimage/1", {}), "image://qsimage/1")
  assert.equal(L.coverSource("", {}), "")
  assert.equal(L.coverSource("https://i.scdn.co/image/ab", {}), "", "noch nicht geladen: Platzhalter")
  assert.equal(L.coverSource("https://i.scdn.co/image/ab", { "https://i.scdn.co/image/ab": { path: "", at: 1 } }), "", "fehlgeschlagen: Platzhalter")
  assert.equal(L.coverSource("https://i.scdn.co/image/ab", { "https://i.scdn.co/image/ab": { path: FILE, at: 1 } }), FILE)
  assert.equal(L.coverSource("http://example.com/a.png", {}), "", "http nie direkt")
  assert.equal(L.coverSource("ftp://example.com/a.png", {}), "")
  assert.equal(L.coverSource("HTTPS://example.com/a.png", {}), "")
})

test("Cover: nur https wird geholt, einmal, nach Fehler erst später wieder", () => {
  const u = "https://i.scdn.co/image/ab"
  assert.equal(L.coverWanted(u, {}, [], 0), true)
  assert.equal(L.coverWanted("http://example.com/a.png", {}, [], 0), false)
  assert.equal(L.coverWanted("file:///tmp/a.png", {}, [], 0), false)
  assert.equal(L.coverWanted("https://", {}, [], 0), false)
  assert.equal(L.coverWanted(u, {}, [u], 0), false, "wartet schon")
  assert.equal(L.coverWanted(u, { [u]: { path: FILE, at: 0 } }, [], 1e9), false, "schon da")
  assert.equal(L.coverWanted(u, { [u]: { path: "", at: 1000 } }, [], 1000 + L.coverRetryMs - 1), false, "eben fehlgeschlagen")
  assert.equal(L.coverWanted(u, { [u]: { path: "", at: 1000 } }, [], 1000 + L.coverRetryMs), true, "erneuter Versuch")
})

test("Cover: Warteschlange und Gedächtnis begrenzt, die neuesten bleiben", () => {
  let q = []
  for (let i = 0; i < 10; i++) q = L.coverQueued(q, "https://a/" + i)
  assert.deepEqual(q, ["https://a/6", "https://a/7", "https://a/8", "https://a/9"])
  assert.deepEqual(L.coverQueued(q, "https://a/7"), ["https://a/6", "https://a/8", "https://a/9", "https://a/7"])
  let known = {}
  for (let i = 0; i < 40; i++) known = L.coverKnown(known, "https://a/" + i, "", i)
  assert.equal(Object.keys(known).length, L.coverKeep)
  assert.ok(!("https://a/0" in known) && "https://a/39" in known)
  assert.ok(L.coverKeep < 32, "der Helfer behält mehr Dateien, als die Insel kennt")
})

test("Cover: nur die Antwort des Helfers aus dem privaten Ordner zählt", () => {
  assert.equal(L.coverPath(FILE + "\n"), FILE)
  assert.equal(L.coverPath(""), "")
  assert.equal(L.coverPath("https://i.scdn.co/image/ab"), "")
  assert.equal(L.coverPath("file:///home/me/x.png"), "")
  assert.equal(L.coverPath("file:///run/user/1000/omarchy-buddy/covers/../../../etc/0123456789abcdef0123456789abcdef.png"), "")
  assert.equal(L.coverPath(FILE.replace(".jpg", ".svg")), "")
  assert.equal(L.coverPath(FILE + "\n" + FILE), "")
})
