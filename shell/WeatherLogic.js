.pragma library
.import "Strings.js" as Strings

// The weather (#184) for the tile under the music player and the text at
// the bar widget, as pure functions (Weather.qml fetches and holds it).
// The place is Omarchy's: weather.json, which omarchy-weather-location
// writes ({name, latitude, longitude}; missing: found by the IP address,
// as Omarchy's own widget does through wttr.in). The weather: Open-Meteo
// everywhere (now, felt, today's high and low, rain per 15 min), in
// Germany Bright Sky on top (the DWD's measured weather, the rain radar
// in 5-min steps, the DWD's warnings). No key, no account.
// Times are seconds since 1970.

// Omarchy's weather.json → { name, lat, lon } (lat/lon null without
// coordinates); null when there is none or it holds nothing.
function parsePlace(text) {
  var data
  try { data = JSON.parse(String(text || "")) } catch (e) { return null }
  if (!data || typeof data !== "object") return null
  var lat = parseFloat(data.latitude), lon = parseFloat(data.longitude)
  var name = typeof data.name === "string" ? data.name.trim() : ""
  var coords = !isNaN(lat) && !isNaN(lon)
  if (!name && !coords) return null
  return { name: name, lat: coords ? lat : null, lon: coords ? lon : null }
}

function hasCoords(place) { return !!place && place.lat !== null && place.lon !== null }

// Without coordinates wttr.in finds them: for the name, or (no place) for
// the IP address, as Omarchy's widget does.
function locateUrl(place) {
  return "https://wttr.in/" + (place && place.name ? encodeURIComponent(place.name) : "") + "?format=j1"
}

// wttr.in's answer → the place with coordinates, or null.
function located(place, text) {
  var data
  try { data = JSON.parse(String(text || "")) } catch (e) { return null }
  var area = data && data.nearest_area && data.nearest_area[0]
  if (!area) return null
  var lat = parseFloat(area.latitude), lon = parseFloat(area.longitude)
  if (isNaN(lat) || isNaN(lon)) return null
  var found = area.areaName && area.areaName[0] ? String(area.areaName[0].value || "") : ""
  return { name: place && place.name ? place.name : found, lat: lat, lon: lon }
}

// Roughly Germany: there Bright Sky (the DWD) adds radar and warnings.
function inGermany(lat, lon) { return lat >= 47.2 && lat <= 55.1 && lon >= 5.8 && lon <= 15.1 }

// What to fetch for a place with coordinates, in this order.
function sources(place, now) {
  var at = "latitude=" + place.lat + "&longitude=" + place.lon
  var list = [{ key: "om", url: "https://api.open-meteo.com/v1/forecast?" + at +
    "&current=temperature_2m,apparent_temperature,weather_code,is_day" +
    "&daily=temperature_2m_max,temperature_2m_min&minutely_15=precipitation" +
    "&hourly=temperature_2m,weather_code,is_day&forecast_hours=12" +
    "&forecast_days=2&forecast_minutely_15=10&timezone=auto" }]
  if (!inGermany(place.lat, place.lon)) return list
  var bs = "https://api.brightsky.dev/", ll = "lat=" + place.lat + "&lon=" + place.lon
  return list.concat([
    { key: "current", url: bs + "current_weather?" + ll },
    { key: "radar", url: bs + "radar?" + ll + "&distance=0&format=plain&date=" + encodeURIComponent(new Date(now * 1000).toISOString()) },
    { key: "alerts", url: bs + "alerts?" + ll }
  ])
}

// One shell run for all of them: each answer, then a separator line
// (an answer that fails, breaks off or passes 2 MiB leaves only its own part empty).
var separator = "\n\u001e\n"
function fetchCommand(list) {
  return ["sh", "-c", "for u; do curl -fsS --compressed --max-time 10 --max-filesize 2M \"$u\"; printf '\\n\\036\\n'; done", "sh"]
    .concat(list.map(function(s) { return s.url }))
}

// The shell's output → { key: parsed answer or null }.
function split(text, list) {
  var parts = String(text || "").split(separator), out = {}
  for (var i = 0; i < list.length; i++) {
    try { out[list[i].key] = JSON.parse(parts[i]) } catch (e) { out[list[i].key] = null }
  }
  return out
}

// Open-Meteo's local times ("2026-11-01T17:30") with its offset → seconds.
function omTime(text, offset) {
  var m = /^(\d+)-(\d+)-(\d+)T(\d+):(\d+)/.exec(String(text || ""))
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 1000 - (offset || 0) : NaN
}

// WMO weather codes (Open-Meteo) → Bright Sky's icon names, which the tile uses.
function iconForCode(code, day) {
  var c = Number(code), d = day ? "day" : "night"
  if (c === 0) return "clear-" + d
  if (c === 1 || c === 2) return "partly-cloudy-" + d
  if (c === 45 || c === 48) return "fog"
  if ([56, 57, 66, 67].indexOf(c) !== -1) return "sleet"
  if ((c >= 51 && c <= 65) || (c >= 80 && c <= 82)) return "rain"
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return "snow"
  if (c >= 95) return "thunderstorm"
  return "cloudy"
}

var icons = ["clear-day", "clear-night", "partly-cloudy-day", "partly-cloudy-night", "cloudy", "fog",
             "wind", "rain", "sleet", "snow", "hail", "thunderstorm"]

// Nerd Font (Material Design) glyphs, one set with the island's other icons.
var glyphs = {
  "clear-day": "\u{F0599}", "clear-night": "\u{F0594}", "partly-cloudy-day": "\u{F0595}",
  "partly-cloudy-night": "\u{F0F31}", "cloudy": "\u{F0590}", "fog": "\u{F0591}", "wind": "\u{F059D}",
  "rain": "\u{F0597}", "sleet": "\u{F067F}", "snow": "\u{F0598}", "hail": "\u{F0592}", "thunderstorm": "\u{F067E}",
  "alert": "\u{F0026}", "place": "\u{F034E}"
}
function glyph(icon) { return glyphs[icon] || glyphs.cloudy }

// The DWD's levels: 1 weather warning, 2 marked, 3 severe, 4 extreme.
var levels = { minor: 1, moderate: 2, severe: 3, extreme: 4 }

// "STARKER REGEN" → "Starker Regen"; "gale-force gusts" → "Gale-force gusts".
function eventName(de, en) {
  var cap = function(w) { return w.charAt(0).toUpperCase() + w.slice(1) }
  return {
    de: String(de || "").toLowerCase().split(" ").map(cap).join(" "),
    en: cap(String(en || "").toLowerCase())
  }
}

function seconds(iso) {
  var t = Date.parse(String(iso || ""))
  return isNaN(t) ? null : t / 1000
}

// Bright Sky's warnings → the ones not over yet, highest level first.
function alertsFrom(answer, now) {
  if (!answer || !Array.isArray(answer.alerts)) return null
  return answer.alerts.map(function(a) {
    return { level: levels[a.severity] || 1, event: eventName(a.event_de || a.headline_de, a.event_en || a.headline_en),
             onset: seconds(a.onset), expires: seconds(a.expires) }
  }).filter(function(a) { return a.expires === null || a.expires > now })
    .sort(function(a, b) { return b.level - a.level || (a.onset || 0) - (b.onset || 0) })
}

// Rain in mm/h from now on: the radar (5 min, in 0.01 mm) or Open-Meteo
// (15 min, in mm). { step, frames: [{ t, mmh }] } or null.
function rainFrom(radar, om, now) {
  var frames = []
  if (radar && Array.isArray(radar.radar)) {
    radar.radar.forEach(function(f) {
      var t = seconds(f.timestamp), v = f.precipitation_5 && f.precipitation_5[0] ? Number(f.precipitation_5[0][0]) || 0 : 0
      if (t !== null && t >= now - 300) frames.push({ t: t, mmh: v * 0.12 })
    })
    if (frames.length) return { step: 300, frames: frames.slice(0, 24) }
  }
  var m = om && om.minutely_15
  if (!m || !Array.isArray(m.time)) return null
  for (var i = 0; i < m.time.length; i++) {
    var t = omTime(m.time[i], om.utc_offset_seconds)
    if (t >= now - 900) frames.push({ t: t, mmh: (Number(m.precipitation && m.precipitation[i]) || 0) * 4 })
  }
  return frames.length ? { step: 900, frames: frames.slice(0, 8) } : null
}

// Today's high and low from Open-Meteo's daily values.
function today(om, now) {
  var d = om && om.daily
  if (!d || !Array.isArray(d.time)) return { high: null, low: null }
  for (var i = 0; i < d.time.length; i++) {
    var start = omTime(d.time[i] + "T00:00", om.utc_offset_seconds)
    if (now >= start && now < start + 86400)
      return { high: num(d.temperature_2m_max && d.temperature_2m_max[i]), low: num(d.temperature_2m_min && d.temperature_2m_min[i]) }
  }
  return { high: null, low: null }
}

// The hours ahead (#191) from Open-Meteo's hourly values (also in Germany):
// [{ t, temp, icon }] or null without them.
function hoursFrom(om) {
  var h = om && om.hourly
  if (!h || !Array.isArray(h.time)) return null
  var list = []
  for (var i = 0; i < h.time.length; i++) {
    var temp = num(h.temperature_2m && h.temperature_2m[i])
    if (temp === null) continue
    list.push({ t: omTime(h.time[i], om.utc_offset_seconds), temp: temp,
                icon: iconForCode(h.weather_code && h.weather_code[i], Number(h.is_day && h.is_day[i]) !== 0) })
  }
  return list.length ? list : null
}

// The next six full hours after now (fewer when old weather has no more).
function nextHours(hours, now) {
  return (hours || []).filter(function(h) { return h.t > now }).slice(0, 6)
}

// An hour's label: "19"; in English "7 PM" when Omarchy's clock shows AM/PM.
function hourLabel(t, lang, twelve) {
  var h = new Date(t * 1000).getHours()
  if (lang !== "en" || !twelve) return String(h)
  return (h % 12 || 12) + (h < 12 ? " AM" : " PM")
}

// Whether Omarchy's bar clock shows AM/PM: its format in shell.json (Qt's
// "AP"/"ap"/"A"/"a", not inside quotes; Omarchy's default "dddd HH:mm").
function twelveHour(shellJson) {
  var config
  try { config = JSON.parse(String(shellJson || "")) } catch (e) { return false }
  var layout = config && config.bar && config.bar.layout
  if (!layout || typeof layout !== "object") return false
  for (var side in layout) {
    var list = Array.isArray(layout[side]) ? layout[side] : []
    for (var i = 0; i < list.length; i++)
      if (list[i] && list[i].id === "omarchy.clock")
        return /a/i.test(String(list[i].format || "dddd HH:mm").replace(/'[^']*'/g, ""))
  }
  return false
}

function num(v) { return v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v) }

// The answers → what the tile shows, or null when there is no weather
// in them. In Germany the DWD's measured temperature and sky win; felt
// and today come from Open-Meteo. alerts null: no warnings for this place
// (outside Germany), [] none.
function combine(parts, place, now) {
  var om = parts.om, bs = parts.current && parts.current.weather
  var omNow = om && om.current
  var temp = bs && num(bs.temperature) !== null ? num(bs.temperature) : omNow ? num(omNow.temperature_2m) : null
  if (temp === null) return null
  var icon = bs && icons.indexOf(bs.icon) !== -1 ? bs.icon
    : omNow ? iconForCode(omNow.weather_code, Number(omNow.is_day) !== 0) : "cloudy"
  var day = today(om, now)
  return {
    place: place.name, temp: temp, icon: icon,
    feels: omNow ? num(omNow.apparent_temperature) : null,
    high: day.high, low: day.low,
    rain: rainFrom(parts.radar, om, now),
    hours: hoursFrom(om),
    alerts: inGermany(place.lat, place.lon) ? (alertsFrom(parts.alerts, now) || []) : null,
    time: now
  }
}

// What of the rain is still ahead (old weather, offline, keeps its past
// out of the words and the bars); null when nothing is.
function upcoming(rain, now) {
  if (!rain) return null
  var frames = rain.frames.filter(function(f) { return f.t + rain.step > now })
  return frames.length ? { step: rain.step, frames: frames } : null
}

var wet = 0.1  // mm/h: below that it does not rain

// The next two hours: { kind: "dry" (until `at`), "starts" (at), "stops"
// (at), "lasts" }, null without rain data.
function rainState(rain) {
  if (!rain || !rain.frames.length) return null
  var f = rain.frames
  var first = -1
  for (var i = 0; i < f.length; i++) if (f[i].mmh >= wet) { first = i; break }
  if (first === -1) return { kind: "dry", at: f[f.length - 1].t + rain.step }
  if (first > 0) return { kind: "starts", at: f[first].t }
  for (i = 1; i < f.length; i++) if (f[i].mmh < wet) return { kind: "stops", at: f[i].t }
  return { kind: "lasts", at: null }
}

// A bar's height in the rain row, 0 to 1 (full from 4 mm/h).
function rainHeight(mmh) { return Math.min(1, Math.max(0, mmh) / 4) }

// "17:40", another day "Mo. 07:00".
function clock(t, now, lang) {
  var d = new Date(t * 1000), n = new Date(now * 1000)
  var hm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2)
  if (d.toDateString() === n.toDateString()) return hm
  return Strings.tl(lang, "weekdays").split(" ")[d.getDay()] + " " + hm
}

function rainText(state, now, lang) {
  if (!state) return ""
  if (state.kind === "lasts") return Strings.tl(lang, "weather.rain.lasts")
  return Strings.tl(lang, "weather.rain." + state.kind, clock(state.at, now, lang))
}

function degrees(v) { return v === null || v === undefined ? "" : Math.round(v) + "°" }

function condition(icon, lang) { return Strings.tl(lang, "weather.cond." + (icons.indexOf(icon) !== -1 ? icon : "cloudy")) }

function alertTitle(a, lang) { return (lang === "en" ? a.event.en : a.event.de) || Strings.tl(lang, "weather.alert") }

// "Stufe 2, bis 07:00" / "Stufe 1, ab 23:00 bis Mo. 07:00".
function alertWhen(a, now, lang) {
  var level = Strings.tl(lang, "weather.level", a.level)
  var from = a.onset !== null && a.onset > now ? clock(a.onset, now, lang) : ""
  var until = a.expires !== null ? clock(a.expires, now, lang) : ""
  var key = from && until ? "weather.fromUntil" : from ? "weather.from" : until ? "weather.until" : ""
  return key ? level + ", " + Strings.tl(lang, key, from || until, until) : level
}

function active(a, now) { return (a.onset === null || a.onset <= now) && (a.expires === null || a.expires > now) }

var fresh = 3600  // older weather says nothing in the bar

// The bar widget's text (01.11.2026: only for rain or a warning):
// a warning in force, otherwise rain now or within the hour.
// { text, icon, alert } or null.
function barText(data, now, lang) {
  if (!data || now - data.time > fresh) return null
  var on = (data.alerts || []).filter(function(a) { return active(a, now) })
  if (on.length) return { text: alertTitle(on[0], lang), icon: "alert", alert: true }
  var r = rainState(upcoming(data.rain, now))
  if (!r || r.kind === "dry" || (r.kind === "starts" && r.at - now > 3600)) return null
  return { text: r.kind === "lasts" ? Strings.tl(lang, "weather.bar.rain") : rainText(r, now, lang), icon: "rain", alert: false }
}

// The tile's state: "ok" (weather to show, maybe old), "noPlace" (no
// weather.json and the IP address gave none), "error", "loading".
function tileState(data, placeFailed, failed) {
  if (data) return "ok"
  if (placeFailed) return "noPlace"
  return failed ? "error" : "loading"
}

// The line under the weather: when it is from, and that it is old.
function stand(data, failed, now, lang) {
  if (!data) return ""
  return Strings.tl(lang, failed ? "weather.standOffline" : "weather.stand", clock(data.time, now, lang))
}

// The place search (as in Omarchy's own widget): Open-Meteo's geocoding.
function searchUrl(query, lang) {
  return "https://geocoding-api.open-meteo.com/v1/search?count=5&format=json&language=" + (lang === "en" ? "en" : "de") +
    "&name=" + encodeURIComponent(String(query || "").trim())
}

function places(text) {
  var data
  try { data = JSON.parse(String(text || "{}")) } catch (e) { return [] }
  return ((data && data.results) || []).filter(function(r) {
    return r && r.name && !isNaN(parseFloat(r.latitude)) && !isNaN(parseFloat(r.longitude))
  }).map(function(r) {
    return { name: String(r.name), region: [r.admin1, r.country].filter(Boolean).join(", "),
             lat: Number(r.latitude), lon: Number(r.longitude) }
  })
}

// omarchy-weather-location's arguments for a picked place (it checks the
// coordinates as -?digits(.digits)).
function setPlaceArgs(p) {
  var fixed = function(v) { return String(Math.round(v * 10000) / 10000) }
  return ["--set", p.name, fixed(p.lat) + "," + fixed(p.lon)]
}

// Severe weather (#189): a warning of level 3 or 4 also
// pops up and goes into the news, once per warning. A warning is its event
// and onset; the key carries the level, so a raised level tells again, an
// extension or a lowered level does not. told: the keys already said (the
// news' keys, this run's). → [{ key, level, title, body }] for omarchy-buddy-say.
var severe = 3
function warningKey(a, level) {
  return "weather:" + String(a.event.de || a.event.en).toLowerCase() + "@" + (a.onset === null ? "" : Math.round(a.onset)) + ":" + level
}
function severeNews(data, told, now, lang) {
  if (!data) return []
  return (data.alerts || []).filter(function(a) {
    if (a.level < severe) return false
    for (var l = a.level; l <= 4; l++) if (told.indexOf(warningKey(a, l)) !== -1) return false
    return true
  }).map(function(a) {
    return { key: warningKey(a, a.level), level: a.level >= 4 ? "error" : "warn",
             title: Strings.tl(lang, "weather.severe", alertTitle(a, lang)),
             body: (data.place ? data.place + ", " : "") + alertWhen(a, now, lang) }
  })
}

// The tile's height (#190): down to the open view's bottom
// edge (on a bottom bar up to its top edge), never shorter than its content.
// content: what the tile needs; island: the open view's height; above: what
// stands beside the open view before the tile (the player and its gap, or 0).
// The room it gains first takes the hours ahead (#191; hours: their height,
// 0 without them), only when they fit whole; then the rain bars grow (by up
// to barsMax, only with bars), the rest goes above the warnings, so they sit
// at the bottom. Decided on the room, never on what the hours measure shown,
// so showing them changes nothing it depends on.
// → { height, hours (shown), bars (more for the bars), alerts (how far the warnings move down) }
function tile(content, island, above, bars, barsMax, hours) {
  var height = Math.max(content, island - above)
  var extra = height - content
  var shown = hours > 0 && extra >= hours
  var rest = extra - (shown ? hours : 0)
  return { height: height, hours: shown, bars: bars ? Math.min(rest, barsMax) : 0, alerts: extra }
}
