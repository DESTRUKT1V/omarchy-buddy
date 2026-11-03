import QtQuick
import "../theme"

// O-Morchy: a 13×10 pixel blob on a 17×15 grid (room for arms, a "!", zZ and
// jumps). A timer advances `t` at 8 frames per second (2 when asleep or when
// it only blinks, speeding up for the blink itself) and
// stops while hidden or paused. Each tick computes the pose as a list of
// pixel rectangles; the canvas repaints only when that list differs from
// the one on screen (breathing changes it about once a second).
//   moods:  idle, sleep, needs, worried, thinking (an agent works)
//   emotes: wave, talk, celebrate, squish, dizzy (short, set by the island)
//   #177:   ask, outage, alarm, done, failed, relief, mail, chat - the
//           island's events (ToastLogic.emoteFor): play once (about a
//           second), then hold their last frame until the island takes them
//   #185:   sing - a new song: sings, pixel notes rise and fade
// With "Weniger Bewegung" (F16) it only blinks: no breathing, hopping or
// looking around, none of the first five emotes; "!", zZ, the worried drop
// and the thinking dots stand still, the #177 emotes show only their last frame, singing a still note.
// px may be fractional (e.g. 2.5): every edge is rounded to a whole screen
// pixel, so it stays sharp, but its pixels are then 2 or 3 screen pixels wide.
Canvas {
  id: m
  property real px: 2
  property bool paused: false  // user away or the island covered: no frames
  property bool still: Theme.reduceMotion
  property string mood: "idle"
  property string emote: ""
  property int t: 0
  property int blinkAt: 24
  property int lookAt: 40
  property int look: 0
  property var ops: []
  property string drawn: ""
  property color body: Theme.accent
  property color ink: Theme.bg
  readonly property color shine: Theme.fg
  readonly property color alert: Theme.urgent

  width: Math.round(17 * px)
  height: Math.round(15 * px)
  antialiasing: false
  opacity: mood === "sleep" ? 0.65 : 1
  Behavior on opacity { NumberAnimation { duration: 400 } }

  Timer {
    running: m.visible && !m.paused
    repeat: true
    interval: m.mood === "sleep" || (m.still && (m.t < m.blinkAt - 1 || m.t > m.blinkAt + 1)) ? 500 : 125
    onTriggered: {
      m.t++
      // Every 2.5–6 s; at 2 Hz (only blinking) the ticks are four times as long.
      if (m.t > m.blinkAt + 1) m.blinkAt = m.t + (m.still ? 5 + Math.floor(Math.random() * 8) : 20 + Math.floor(Math.random() * 30))
      if (m.t > m.lookAt) {
        m.look = m.mood === "thinking" ? [-1, 0, 1][Math.floor(Math.random() * 3)]
          : Math.random() < 0.35 ? (Math.random() < 0.5 ? -1 : 1) : 0
        m.lookAt = m.t + 16 + Math.floor(Math.random() * 24)
      }
      m.refresh()
    }
  }
  onMoodChanged: refresh()
  onEmoteChanged: { t = 0; refresh() }
  onBodyChanged: refresh()
  onInkChanged: refresh()
  onPxChanged: { drawn = ""; refresh() }
  Component.onCompleted: refresh()

  function refresh() {
    var list = pose()
    var key = JSON.stringify(list)
    if (key === drawn) return
    drawn = key
    ops = list
    requestPaint()
  }

  onPaint: {
    var c = getContext("2d")
    c.reset()
    for (var i = 0; i < ops.length; i++) {
      var o = ops[i]
      c.globalAlpha = o[5]
      c.fillStyle = o[4]
      var x0 = Math.round(o[0] * px), y0 = Math.round(o[1] * px)
      c.fillRect(x0, y0, Math.round((o[0] + o[2]) * px) - x0, Math.round((o[1] + o[3]) * px) - y0)
    }
  }

  function pose() {
    var still = m.still
    var ops = [], t = m.t, mood = m.mood
    // The #177 emotes run on k: frame 0, 1, … (8 a second) from their start,
    // 99 with less motion (their end).
    var held = ["ask", "outage", "alarm", "done", "failed", "relief", "mail", "chat"].indexOf(m.emote) !== -1
    var e = still && !held && m.emote !== "sing" ? "" : m.emote
    var k = still ? 99 : t
    var ox = 2, oy = 4, alpha = 1
    var body = String(m.body), ink = String(m.ink), shine = String(m.shine), alert = String(m.alert)

    // Whole-body motion.
    if (e === "celebrate") oy += [0, -1, -2, -3, -2, -1, 0, 0][t % 8]
    else if (e === "dizzy") ox += [0, 1, 0, -1][t % 4]
    else if (e === "done") oy += (k === 1 || k === 2 || k === 4 || k === 5) ? 1 : 0  // nods twice
    else if (e === "outage" && k < 6) ox += [0, 1, 0, -1][k % 4]  // a shudder
    else if (mood === "needs" && !still && !held) oy += (t % 4 < 2) ? -1 : 0

    function dot(x, y, col) { ops.push([x + ox, y + oy, 1, 1, col, alpha]) }
    function box(x, y, w, h, col) { ops.push([x + ox, y + oy, w, h, col, alpha]) }

    // Body: breathing drops the top row every other beat, a squish drops
    // two and spreads the bottom.
    var insets = [4, 2, 1, 0, 0, 0, 0, 0, 1, 2]
    var beat = mood === "sleep" ? Math.floor(t / 2) % 2 : Math.floor(t / 10) % 2
    var drop = e === "squish" ? 2 : (e === "" && mood !== "needs" && beat && !still) ? 1 : 0
    if ((e === "failed" && k >= 2) || (e === "relief" && k >= 2 && k < 5)) drop = 1
    for (var r = drop; r < insets.length; r++) {
      var ins = insets[r] - (e === "squish" && r >= 7 ? 1 : 0)
      box(ins, r, 13 - ins * 2, 1, body)
    }

    // Eyes. Left eye column 3, right 8; three-wide shapes start one
    // further left on the left eye so both stay symmetric around column 6.
    var ey = 3 + drop
    var blinking = t === m.blinkAt || t === m.blinkAt + 1
    var face = held ? {
      ask: "big", outage: k < 2 ? "shock" : "worried", alarm: k < 8 ? "big" : "open", done: "happy",
      failed: k < 2 ? "open" : "sad", relief: k < 2 ? "worried" : k < 5 ? "closed" : "happy",
      mail: k < 6 ? "down" : "happy", chat: "open" }[e] : ""
    var shape = face ? face
      : e === "dizzy" ? "x"
      : e === "squish" ? "annoyed"
      : e === "celebrate" || e === "sing" ? "happy"
      : e === "wave" ? "big"
      : mood === "sleep" ? "closed"
      : blinking ? "closed"
      : mood === "needs" ? "big"
      : mood === "worried" ? "worried"
      : mood === "thinking" ? "up"
      : "open"
    var lx = (e === "" && !still && (shape === "open" || shape === "down" || shape === "big" || shape === "up")) ? m.look : 0
    if (e === "mail") lx = 1  // looks at the letter

    function eye(x, left) {
      var w3 = left ? x - 1 : x
      switch (shape) {
      case "open":
        box(x + lx, ey, 2, 3, ink); dot(x + lx, ey, shine); break
      case "big":
        box(x + lx, ey - 1, 2, 4, ink); dot(x + lx, ey - 1, shine); dot(x + lx + 1, ey + 1, shine); break
      case "down":
        box(x + lx, ey + 1, 2, 2, ink); dot(x + lx, ey + 1, shine); break
      case "closed":
        box(x, ey + 2, 2, 1, ink); break
      case "happy":
        dot(w3, ey + 1, ink); dot(w3 + 1, ey, ink); dot(w3 + 2, ey + 1, ink); break
      case "x":
        dot(w3, ey, ink); dot(w3 + 2, ey, ink); dot(w3 + 1, ey + 1, ink); dot(w3, ey + 2, ink); dot(w3 + 2, ey + 2, ink); break
      case "annoyed":
        if (left) { dot(w3, ey, ink); dot(w3 + 1, ey + 1, ink); dot(w3, ey + 2, ink) }
        else { dot(w3 + 2, ey, ink); dot(w3 + 1, ey + 1, ink); dot(w3 + 2, ey + 2, ink) }
        break
      case "worried":
        box(x, ey + 1, 2, 2, ink); dot(left ? x + 1 : x, ey - 1, ink); break
      case "up":
        box(x + lx, ey - 1, 2, 2, ink); dot(x + lx + 1, ey - 1, shine); break
      case "shock":  // white eyes, small pupils
        box(x, ey - 1, 2, 3, shine); dot(left ? x + 1 : x, ey, ink); break
      case "sad":
        box(x, ey + 2, 2, 1, ink); dot(left ? x + 1 : x, ey, ink); break
      }
    }
    eye(3, true)
    eye(8, false)

    // Mouth and cheeks.
    if (e === "talk") {
      if (t % 4 < 2) box(5, ey + 4, 3, 2, ink); else box(5, ey + 4, 3, 1, ink)
    } else if (e === "sing") {  // an "o", wide and narrow with the tune
      if (still || k % 6 < 4) box(5, ey + 4, 3, 2, ink); else box(6, ey + 4, 1, 2, ink)
    } else if (e === "celebrate" || e === "wave") {
      dot(5, ey + 4, ink); dot(6, ey + 5, ink); dot(7, ey + 4, ink)
    } else if (held) {
      var mo = { ask: k < 2 ? "" : "open", outage: k < 2 ? "open" : "frown", alarm: k < 8 ? "open" : "",
        done: "smile", failed: k < 2 ? "" : "frown", relief: k < 5 ? "" : "smile", mail: k < 4 ? "" : "smile",
        chat: k >= 2 && k <= 6 ? (k % 2 ? "line" : "open") : k > 6 ? "smile" : "" }[e]
      if (mo === "smile") { dot(5, ey + 4, ink); dot(6, ey + 5, ink); dot(7, ey + 4, ink) }
      else if (mo === "frown") { dot(5, ey + 5, ink); dot(6, ey + 4, ink); dot(7, ey + 5, ink) }
      else if (mo === "open") box(5, ey + 4, 3, 2, ink)
      else if (mo === "line") box(5, ey + 4, 3, 1, ink)
    } else if (mood === "worried") {
      dot(5, ey + 5, ink); dot(6, ey + 4, ink); dot(7, ey + 5, ink)
    } else if (mood === "thinking" && e === "") {
      box(6, ey + 4, 2, 1, ink)
    }
    if (e === "celebrate" || e === "wave" || e === "squish" || e === "sing") {
      alpha = 0.55; dot(1, ey + 3, alert); dot(11, ey + 3, alert); alpha = 1
    }

    // Extras around the body.
    if (e === "wave") {
      if (t % 4 < 2) { dot(13, 4, body); dot(14, 3, body) }
      else { dot(13, 5, body); dot(14, 5, body) }
    }
    if (mood === "needs" && e === "" && (still || t % 6 < 4)) {
      dot(13, -3, alert); dot(13, -2, alert); dot(13, 0, alert)
    }
    if (mood === "sleep") {
      alpha = 0.7
      var zy = (t % 2 && !still) ? -2 : -3
      var zx = (t % 2 && !still) ? 11 : 12
      dot(zx, zy, body); dot(zx + 1, zy, body); dot(zx + 1, zy + 1, body)
      dot(zx, zy + 2, body); dot(zx + 1, zy + 2, body)
      alpha = 1
    }
    if (mood === "worried" && e === "") {
      alpha = 0.8; dot(12, 1 + (t % 8 < 4 || still ? 0 : 1), String(Theme.good)); alpha = 1
    }
    if (e === "celebrate" && t % 2 === 0) {
      dot(-1, -1 + (t % 4), shine); dot(14, -2 + (t % 3), shine)
    }
    if (e === "dizzy") {
      alpha = 0.8
      var a = [[5, -2], [7, -3], [9, -2], [7, -1]][t % 4]
      dot(a[0], a[1], shine)
      alpha = 1
    }

    // Thinking (#176): dots rising one by one every half second.
    if (mood === "thinking" && e === "") {
      var step = still ? 3 : Math.floor(t / 4) % 6
      alpha = 0.8
      if (step >= 1) dot(10, -1, shine)
      if (step >= 2) dot(12, -2, shine)
      if (step >= 3) box(13, -4, 2, 2, shine)
      alpha = 1
    }
    // Singing (#185): a note rises beside it every 3/4 s, right and left in
    // turn, and fades on its way up (still: one note, standing).
    if (e === "sing") {
      var note = function(x, f) {  // f: its frame, 0 … 11
        var y = -1 - Math.floor(f * 3 / 11)  // over the shoulder, a pixel off the body
        alpha = f < 6 ? 0.9 : 0.9 * (12 - f) / 6
        box(x + 1, y, 1, 2, body); box(x, y + 2, 2, 2, body)  // stem, head; in its colour, which stands out wherever it does
        alpha = 1
      }
      if (still) note(13, 4)
      else {
        note(13, k % 12)
        if (k >= 6) note(-2, (k - 6) % 12)
      }
    }
    // #177's props; each moves for about a second, then stands.
    if (e === "ask") {  // raises its hand and waves it, a blinking "!" beside
      if (k < 1) { dot(13, 5, body); dot(14, 5, body) }
      else if (k < 2) { dot(13, 4, body); dot(14, 3, body) }
      else if (k < 8 && k % 2) { dot(13, 3, body); dot(13, 2, body); dot(12, 1, body) }
      else { dot(13, 3, body); dot(14, 2, body); dot(14, 1, body) }
      if (k >= 2 && k !== 5) { dot(-1, -3, alert); dot(-1, -2, alert); dot(-1, 0, alert) }
    }
    if (e === "outage") {
      if (k < 2) { dot(-1, 1, alert); dot(-2, 0, alert); dot(13, 1, alert); dot(14, 0, alert) }  // startled
      if (k >= 6 || k % 2 === 0) {  // a red cross, blinking three times
        dot(11, -3, alert); dot(13, -3, alert); dot(12, -2, alert); dot(11, -1, alert); dot(13, -1, alert)
      }
    }
    if (e === "alarm") {  // an alarm clock, ringing for a second
      var cx = k < 8 ? -(k % 2) : 0
      box(10 + cx, -3, 5, 4, shine); dot(10 + cx, -4, shine); dot(14 + cx, -4, shine)
      dot(12 + cx, -2, ink); dot(12 + cx, -1, ink); dot(13 + cx, -1, ink)
    }
    if (e === "done" && k >= 1) {  // a check mark, drawn stroke by stroke
      var g = String(Theme.good), check = [[11, -2], [12, -1], [13, -2], [14, -3]]
      for (var c = 0; c < Math.min(k, 4); c++) dot(check[c][0], check[c][1], g)
    }
    if (e === "failed" && k >= 3 && k < 8) {  // a tear runs down
      alpha = 0.8; dot(3, ey + k, shine); alpha = 1
    }
    if (e === "relief" && k >= 2 && k < 5) {  // a breath out, drifting away
      var puff = [[-1, 7], [-2, 6], [-2, 5]]
      alpha = 0.6
      for (var p = Math.max(0, k - 3); p <= k - 2; p++) dot(puff[p][0], puff[p][1], shine)
      alpha = 1
    }
    if (e === "mail") {  // a letter, raised from below
      var ly = 6 + Math.max(0, 4 - k)
      box(9, ly, 6, 4, shine); dot(10, ly + 1, ink); box(11, ly + 2, 2, 1, ink); dot(13, ly + 1, ink)
    }
    if (e === "chat" && k >= 1) {  // a speech bubble, filling dot by dot
      box(10, -3, 5, 3, shine); dot(10, 0, shine)
      if (k >= 2) dot(11, -2, ink)
      if (k >= 3) dot(13, -2, ink)
    }
    return ops
  }
}
