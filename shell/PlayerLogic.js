.pragma library

// The player window beside the open view (#120): which MPRIS player it
// shows and how its times read. Pure functions, tested in
// tests/player-logic.test.js.

// players: [{ id, state: "playing" | "paused" | "stopped", title }],
// stamps: { id: ms of its last start or stop }. Only a player with a track
// loaded counts; one that plays wins, then the one that played last.
function pick(players, stamps) {
  var best = null, bestRank = -1, bestStamp = -1
  for (var i = 0; i < (players || []).length; i++) {
    var p = players[i]
    if (!p || !p.title || (p.state !== "playing" && p.state !== "paused")) continue
    var rank = p.state === "playing" ? 1 : 0
    var stamp = (stamps && stamps[p.id]) || 0
    if (rank > bestRank || (rank === bestRank && stamp > bestStamp)) { best = p.id; bestRank = rank; bestStamp = stamp }
  }
  return best === null ? "" : best
}

// O-Morchy sings (#185) when a new song starts playing. song: "player/track"
// while one plays, "" otherwise; last: the last one that played (null right
// after the start, so music already playing then is no change). Pause and
// play or a jump in the same song keep its key; the user away or the island
// hidden: no song.
function sings(last, song, paused) {
  return !paused && song !== "" && last !== null && song !== last
}

// Whether a player plays from a music service (#188): only then O-Morchy
// sings. player: an MPRIS player (dbusName, identity, desktopEntry, metadata).
// A service's own app by its name; a browser by the page in xesam:url, which
// only Firefox sends (not in a private window). Chromium and its kin send no
// page, so music there stays unknown: no singing.
var musicApps = /spotify|ncspot|tidal|deezer|youtube.?music|ytmd|pear.?desktop|amazon.?music|soundcloud|bandcamp/i
var musicHosts = /(^|\.)(open\.spotify\.com|tidal\.com|music\.amazon\.(com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})|music\.youtube\.com|deezer\.com|soundcloud\.com|bandcamp\.com)$/i
function isMusic(player) {
  var p = player || {}
  var name = String(p.dbusName || "").replace(/^org\.mpris\.MediaPlayer2\./, "")
  if (musicApps.test([name, p.identity || "", p.desktopEntry || ""].join(" "))) return true
  var host = /^https?:\/\/([^\/:?#]+)/i.exec(String((p.metadata || {})["xesam:url"] || ""))
  return !!host && musicHosts.test(host[1])
}

// Seconds as "3:07" or "1:02:07".
function clock(seconds) {
  var s = Math.max(0, Math.floor(Number(seconds) || 0))
  var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, r = s % 60
  var two = function(n) { return (n < 10 ? "0" : "") + n }
  return h > 0 ? h + ":" + two(m) + ":" + two(r) : m + ":" + two(r)
}

// Where the bar stands, 0 … 1.
function progress(position, length) {
  if (!(length > 0)) return 0
  return Math.max(0, Math.min(1, position / length))
}


// Spotify's "+" (#121, bin/omarchy-buddy-spotify does the talking).

// The track it saves: "spotify:track:ID" when the player's metadata names
// a Spotify track (Spotify's own app: mpris:trackid /com/spotify/track/ID);
// "" for other players, ads, podcast episodes and local files.
function spotifyTrack(metadata) {
  var m = metadata || {}
  // Quickshell hands the object path on as "QVariant(QDBusObjectPath, …(\"/com/spotify/track/ID\"))".
  var found = /spotify[\/:]track[\/:]([A-Za-z0-9]{22})(?![A-Za-z0-9])/.exec(String(m["mpris:trackid"] || ""))
    || /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})(\?.*)?$/.exec(String(m["xesam:url"] || ""))
  return found ? "spotify:track:" + found[1] : ""
}

// Whether a player is Spotify (its desktop app, spotifyd, ncspot ... or
// any playing a Spotify track): the settings show the Spotify section once
// one ran (#163).
function isSpotify(dbusName, metadata) {
  return /spotify/i.test(String(dbusName || "")) || spotifyTrack(metadata) !== ""
}

// The helper's one JSON line → an object ({ error: "failed" } for anything else).
function helperReply(text) {
  try {
    var r = JSON.parse(String(text || "").trim())
    if (r && typeof r === "object" && !Array.isArray(r)) return r
  } catch (e) {}
  return { error: "failed" }
}

// Without a connection (#162) the "+" sends Spotify's own shortcut for
// "Like" (Alt+Shift+B, it toggles) to the window of Spotify's desktop app.

// The MPRIS name of Spotify's desktop app (not spotifyd, not a browser).
function spotifyApp(dbusName) {
  return /^org\.mpris\.MediaPlayer2\.spotify(\.instance\d+)?$/.test(String(dbusName || ""))
}

// The hyprctl dispatch that brings Spotify's window up, from the scratchpad too (#199).
var spotifyFocus = 'hl.dsp.focus({ window = "class:^([Ss]potify)$" })'

// The address of Spotify's window in `hyprctl clients -j`, "" for none.
// Of several, the one whose title names the playing track ("Artist - Title").
function spotifyWindow(clients, title) {
  var found = []
  for (var i = 0; i < (Array.isArray(clients) ? clients : []).length; i++) {
    var c = clients[i]
    if (c && /^spotify$/i.test(c["class"] || c.initialClass || "") && /^0x[0-9a-f]+$/.test(c.address)) found.push(c)
  }
  for (i = 0; i < found.length && title; i++) if (String(found[i].title || "").indexOf(title) !== -1) return found[i].address
  return found.length ? found[0].address : ""
}

// The hyprctl dispatch (Hyprland's Lua dispatcher, 0.56) that sends the
// shortcut to that window; "" for an address that is none.
function likeShortcut(address) {
  if (!/^0x[0-9a-f]+$/.test(String(address || ""))) return ""
  return 'hl.dsp.send_shortcut({ mods = "ALT SHIFT", key = "B", window = "address:' + address + '" })'
}

// What the "+" shows: "" (nothing), "busy" (asking Spotify), "add",
// "saved" or "error" when connected; "toggle" (sends the shortcut) and
// "sent" (just sent for this track) when not. answer: the helper's last
// reply for a track ({ uri, saved } or { uri, error }). key: { app (the
// player is Spotify's desktop app), window (its address), busy, sent (the
// track it was last sent for) }.
function likeState(connected, uri, answer, busy, key) {
  if (!uri) return ""
  if (!connected) {
    var k = key || {}
    if (!k.app || !k.window) return ""
    return k.busy ? "busy" : k.sent === uri ? "sent" : "toggle"
  }
  if (busy || !answer || answer.uri !== uri) return "busy"
  if (answer.error === "unconnected") return ""
  if (answer.error) return "error"
  return answer.saved ? "saved" : "add"
}

var likeErrors = ["expired", "forbidden", "offline", "limit", "failed"]

// The message's key in Strings.js, and what the link under it does:
// sign in again where the sign-in is the problem, otherwise try again.
function likeError(error) {
  var e = likeErrors.indexOf(error) !== -1 ? error : "failed"
  return { key: "spotify.error." + e, fix: e === "expired" || e === "forbidden" ? "reconnect" : "retry" }
}

// The settings page's line under "Spotify": the result of the last
// connecting (helper error codes) as a key in Strings.js, "" for none.
function connectError(error) {
  if (!error) return ""
  return ["clientid", "port", "cancelled", "offline", "forbidden"].indexOf(error) !== -1
    ? "spotify.connect." + error : "spotify.connect.failed"
}

// Covers (#251). Qt's own image request reads an answer whole, without a
// byte or time limit, so a cover on the net reaches Image only as the
// checked file bin/omarchy-buddy-cover made of it (Covers.qml fetches one at
// a time). known: { url: { path, at } }, path "" when it failed.
var coverRetryMs = 60000  // a failed cover is tried again after this, when shown again
var coverKeep = 24        // covers remembered (the helper keeps more files)
var coverQueueMax = 4     // waiting at once; the newest win

// What Image gets for a picture's address, by an allowlist (#261): one on
// this machine (a path, file://, image://) as it is; an https one only as
// its checked file, "" until then; anything else (data:, http, qrc:, a
// relative name …) never.
function coverSource(url, known) {
  url = String(url || "")
  if (url.charAt(0) === "/") return "file://" + url
  if (/^(file|image):\/\/./i.test(url)) return url
  var k = /^https:\/\/[^\/]/i.test(url) ? known[url] : null
  return k && k.path ? k.path : ""
}

// Whether to fetch url: https (never plain http or other schemes), not
// fetched yet or failed coverRetryMs ago, not waiting already.
function coverWanted(url, known, queue, now) {
  url = String(url || "")
  if (!/^https:\/\/[^\/]/i.test(url) || queue.indexOf(url) !== -1) return false
  var k = known[url]
  return !k || (!k.path && now - k.at >= coverRetryMs)
}

function coverQueued(queue, url) {
  var q = queue.filter(function (u) { return u !== url })
  q.push(url)
  return q.slice(-coverQueueMax)
}

// known with url's result; only the newest coverKeep stay.
function coverKnown(known, url, path, now) {
  var urls = Object.keys(known).filter(function (u) { return u !== url }).slice(-(coverKeep - 1))
  var next = {}
  urls.forEach(function (u) { next[u] = known[u] })
  next[url] = { path: path, at: now }
  return next
}

// The helper's answer: its file in the private covers folder, else "".
function coverPath(text) {
  text = String(text || "").trim()
  return /^file:\/\/\/[^\s?#]+\/omarchy-buddy\/covers\/[0-9a-f]{32}\.(png|jpg|webp)$/.test(text) && text.indexOf("..") === -1 ? text : ""
}
