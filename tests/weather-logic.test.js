"use strict"
// WeatherLogic.js (#184): Omarchy's place, the answers of Open-Meteo and
// Bright Sky (shapes as they came on 01.11.2026), rain and warnings in
// words, the bar text.
process.env.TZ = "Europe/Berlin"
const test = require("node:test")
const assert = require("node:assert/strict")
const W = require("./lib/load").load("WeatherLogic.js")

const at = (h, m, day) => new Date(2026, 10, day || 1, h, m).getTime() / 1000
const NOW = at(17, 40)
const AACHEN = { name: "Aachen", lat: 50.762, lon: 6.088 }
const PARIS = { name: "Paris", lat: 48.85, lon: 2.35 }

const om = {
  utc_offset_seconds: 3600,
  current: { time: "2026-11-01T17:30", temperature_2m: 8.4, apparent_temperature: 7.1, weather_code: 3, is_day: 0 },
  minutely_15: { time: ["2026-11-01T17:30", "2026-11-01T17:45", "2026-11-01T18:00", "2026-11-01T18:15"],
                 precipitation: [0, 0, 0.2, 0.5] },
  daily: { time: ["2026-11-01", "2026-11-02"], temperature_2m_max: [9.3, 11], temperature_2m_min: [3.7, 5] },
  hourly: { time: ["2026-11-01T17:00", "2026-11-01T18:00", "2026-11-01T19:00", "2026-11-01T20:00", "2026-11-01T21:00",
                   "2026-11-01T22:00", "2026-11-01T23:00", "2026-11-02T00:00"],
            temperature_2m: [8.6, 8.1, 7.9, null, 7.6, 7.4, 7.2, 6.9], weather_code: [3, 61, 61, 3, 3, 0, 0, 0],
            is_day: [1, 0, 0, 0, 0, 0, 0, 0] }
}
const current = { weather: { temperature: 8.6, icon: "cloudy", condition: "dry" } }
const radar = (values, from) => ({
  radar: values.map((v, i) => ({ timestamp: new Date((from || at(17, 35)) * 1000 + i * 300000).toISOString(), precipitation_5: [[v]] }))
})
const alert = (severity, onset, expires, de, en) => ({ severity, onset: new Date(onset * 1000).toISOString(),
  expires: new Date(expires * 1000).toISOString(), event_de: de || "FROST", event_en: en || "frost" })

test("Ort: Omarchys weather.json", () => {
  assert.deepEqual(W.parsePlace('{"name":"Aachen","latitude":50.762,"longitude":"6.088"}'), AACHEN)
  assert.deepEqual(W.parsePlace('{"name":" Malibu "}'), { name: "Malibu", lat: null, lon: null }, "nur ein Name")
  assert.equal(W.parsePlace(""), null, "keine Datei: IP-Ortung")
  assert.equal(W.parsePlace("{kaputt"), null)
  assert.equal(W.parsePlace('{"name":""}'), null)
  assert.equal(W.hasCoords(W.parsePlace('{"name":"Malibu"}')), false)
})

test("Ort ohne Koordinaten: wttr.in sucht (Name oder IP)", () => {
  assert.equal(W.locateUrl(null), "https://wttr.in/?format=j1")
  assert.equal(W.locateUrl({ name: "Bad Aibling" }), "https://wttr.in/Bad%20Aibling?format=j1")
  const j1 = JSON.stringify({ nearest_area: [{ areaName: [{ value: "Aachen" }], latitude: "50.767", longitude: "6.083" }] })
  assert.deepEqual(W.located(null, j1), { name: "Aachen", lat: 50.767, lon: 6.083 })
  assert.equal(W.located({ name: "Mein Ort" }, j1).name, "Mein Ort", "der eigene Name bleibt")
  assert.equal(W.located(null, ""), null)
  assert.equal(W.located(null, '{"nearest_area":[]}'), null)
})

test("Quellen: Open-Meteo überall, Bright Sky nur in Deutschland", () => {
  assert.deepEqual(W.sources(PARIS, NOW).map(s => s.key), ["om"])
  const de = W.sources(AACHEN, NOW)
  assert.deepEqual(de.map(s => s.key), ["om", "current", "radar", "alerts"])
  assert.match(de[0].url, /latitude=50\.762&longitude=6\.088/)
  assert.match(de[2].url, /radar\?lat=50\.762&lon=6\.088&distance=0&format=plain&date=2026-11-01T16%3A40/)
  const cmd = W.fetchCommand(de)
  assert.deepEqual(cmd.slice(0, 2), ["sh", "-c"])
  assert.deepEqual(cmd.slice(4), de.map(s => s.url), "Adressen als Argumente, nicht im Skript")
})

test("Antworten zerlegen: eine kaputte Antwort trifft nur sich selbst", () => {
  const list = [{ key: "om" }, { key: "current" }, { key: "radar" }]
  const out = W.split('{"a":1}' + W.separator + W.separator + '{"r":', list)
  assert.deepEqual(out, { om: { a: 1 }, current: null, radar: null })
})

test("Zusammenführen: DWD-Messwert gewinnt, gefühlt und heute von Open-Meteo", () => {
  const d = W.combine({ om, current, radar: radar([0, 0, 0]), alerts: { alerts: [] } }, AACHEN, NOW)
  assert.equal(d.temp, 8.6)
  assert.equal(d.icon, "cloudy")
  assert.equal(d.feels, 7.1)
  assert.deepEqual([d.high, d.low], [9.3, 3.7])
  assert.equal(d.rain.step, 300, "Radar in 5-min-Schritten")
  assert.deepEqual(d.alerts, [])
  assert.equal(d.place, "Aachen")
})

test("Zusammenführen: ohne Bright Sky nur Open-Meteo, ohne beides nichts", () => {
  const d = W.combine({ om }, PARIS, NOW)
  assert.equal(d.temp, 8.4)
  assert.equal(d.icon, "cloudy")
  assert.equal(d.alerts, null, "außerhalb Deutschlands keine Warnungsquelle")
  assert.equal(d.rain.step, 900)
  assert.deepEqual(d.rain.frames.map(f => f.mmh), [0, 0, 0.8, 2], "mm je 15 min → mm/h")
  const off = W.combine({ om, current: null, radar: null, alerts: null }, AACHEN, NOW)
  assert.equal(off.temp, 8.4, "Bright Sky aus: Open-Meteo reicht")
  assert.equal(off.rain.step, 900)
  assert.deepEqual(off.alerts, [], "in Deutschland ohne Antwort: keine Warnungen bekannt")
  assert.equal(W.combine({ om: null, current: null }, AACHEN, NOW), null)
})

test("WMO-Codes → Symbole, Tag und Nacht", () => {
  assert.equal(W.iconForCode(0, true), "clear-day")
  assert.equal(W.iconForCode(0, false), "clear-night")
  assert.equal(W.iconForCode(2, false), "partly-cloudy-night")
  assert.equal(W.iconForCode(48), "fog")
  assert.equal(W.iconForCode(61), "rain")
  assert.equal(W.iconForCode(81), "rain")
  assert.equal(W.iconForCode(66), "sleet")
  assert.equal(W.iconForCode(75), "snow")
  assert.equal(W.iconForCode(96), "thunderstorm")
  assert.equal(W.iconForCode(3), "cloudy")
  assert.equal(W.condition("partly-cloudy-day", "de"), "Heiter")
  assert.equal(W.condition("unbekannt", "en"), "Cloudy")
  assert.notEqual(W.glyph("rain"), W.glyph("snow"))
})

test("Regen: Radar ab jetzt, höchstens zwei Stunden", () => {
  const r = W.rainFrom(radar(new Array(30).fill(0), at(17, 20)), null, NOW)
  assert.equal(r.frames[0].t, at(17, 35), "ältere Bilder fallen weg")
  assert.equal(r.frames.length, 24)
  assert.equal(W.rainFrom(radar([10]), null, NOW).frames[0].mmh.toFixed(2), "1.20", "0,01 mm je 5 min → mm/h")
  assert.equal(W.rainFrom(null, null, NOW), null)
})

test("Regen in Worten", () => {
  const rain = mmh => ({ step: 300, frames: mmh.map((v, i) => ({ t: at(17, 40 + i * 5), mmh: v })) })
  assert.deepEqual(W.rainState(rain([0, 0, 0])), { kind: "dry", at: at(17, 55) })
  assert.equal(W.rainText(W.rainState(rain([0, 0, 0])), NOW, "de"), "Kein Regen bis 17:55")
  assert.equal(W.rainText(W.rainState(rain([0, 0.05, 0.3, 1])), NOW, "de"), "Regen ab etwa 17:50", "unter 0,1 mm/h ist trocken")
  assert.equal(W.rainText(W.rainState(rain([1, 1, 0])), NOW, "en"), "Rain until about 17:50")
  assert.equal(W.rainText(W.rainState(rain([1, 1, 1])), NOW, "de"), "Regen, hält länger an")
  assert.equal(W.rainState(null), null)
  assert.equal(W.rainText(null, NOW, "de"), "")
  assert.equal(W.rainHeight(8), 1)
  assert.equal(W.rainHeight(1), 0.25)
  const r = rain([1, 0, 0])
  assert.deepEqual(W.upcoming(r, at(17, 46)).frames.map(f => f.t), [at(17, 45), at(17, 50)], "Vergangenes fällt weg")
  assert.equal(W.upcoming(r, at(18, 0)), null)
  assert.equal(W.upcoming(null, NOW), null)
  const late = { step: 900, frames: [{ t: at(23, 45), mmh: 0 }] }
  assert.equal(W.rainText(W.rainState(late), NOW, "de"), "Kein Regen bis Mo. 00:00", "anderer Tag mit Wochentag")
})

test("Warnungen: abgelaufene weg, höchste Stufe zuerst, Namen lesbar", () => {
  const list = W.alertsFrom({ alerts: [
    alert("minor", at(23, 0), at(7, 0, 2)),
    alert("severe", at(16, 0), at(20, 0), "SCHWERE STURMBÖEN", "severe gale-force gusts"),
    alert("moderate", at(10, 0), at(12, 0), "GLÄTTE")
  ] }, NOW)
  assert.deepEqual(list.map(a => a.level), [3, 1])
  assert.equal(W.alertTitle(list[0], "de"), "Schwere Sturmböen")
  assert.equal(W.alertTitle(list[0], "en"), "Severe gale-force gusts")
  assert.equal(W.alertWhen(list[0], NOW, "de"), "Stufe 3, bis 20:00")
  assert.equal(W.alertWhen(list[1], NOW, "de"), "Stufe 1, ab 23:00 bis Mo. 07:00")
  assert.equal(W.alertWhen(list[1], NOW, "en"), "Level 1, from 23:00 to Mon 07:00")
  assert.equal(W.alertsFrom(null, NOW), null)
})

test("Leiste: nur bei Warnung oder Regen in der nächsten Stunde", () => {
  const base = { time: NOW, alerts: [], rain: null }
  const rain = (start, stop) => ({ step: 300, frames: Array.from({ length: 24 }, (_, i) => ({ t: NOW + i * 300, mmh: i >= start && i < stop ? 1 : 0 })) })
  assert.equal(W.barText(base, NOW, "de"), null, "trocken: nichts")
  assert.equal(W.barText(Object.assign({}, base, { rain: rain(30, 40) }), NOW, "de"), null)
  assert.deepEqual(W.barText(Object.assign({}, base, { rain: rain(6, 9) }), NOW, "de"), { text: "Regen ab etwa 18:10", icon: "rain", alert: false })
  assert.equal(W.barText(Object.assign({}, base, { rain: rain(13, 20) }), NOW, "de"), null, "erst in mehr als einer Stunde")
  assert.equal(W.barText(Object.assign({}, base, { rain: rain(0, 4) }), NOW, "de").text, "Regen bis etwa 18:00")
  assert.equal(W.barText(Object.assign({}, base, { rain: rain(0, 99) }), NOW, "de").text, "Regen")
  const warn = W.alertsFrom({ alerts: [alert("minor", at(17, 0), at(20, 0))] }, NOW)
  assert.deepEqual(W.barText(Object.assign({}, base, { alerts: warn, rain: rain(0, 4) }), NOW, "de"),
                   { text: "Frost", icon: "alert", alert: true }, "Warnung vor Regen")
  const later = W.alertsFrom({ alerts: [alert("minor", at(23, 0), at(7, 0, 2))] }, NOW)
  assert.equal(W.barText(Object.assign({}, base, { alerts: later }), NOW, "de"), null, "Warnung erst später: nicht in der Leiste")
  assert.equal(W.barText(Object.assign({}, base, { time: NOW - 7200, rain: rain(0, 4) }), NOW, "de"), null, "altes Wetter schweigt")
  assert.equal(W.barText(null, NOW, "de"), null)
})

test("Kachel: Zustände und Stand", () => {
  assert.equal(W.tileState(null, false, false), "loading")
  assert.equal(W.tileState(null, false, true), "error")
  assert.equal(W.tileState(null, true, true), "noPlace")
  assert.equal(W.tileState({}, true, true), "ok", "altes Wetter bleibt sichtbar")
  assert.equal(W.stand({ time: at(17, 30) }, false, NOW, "de"), "Stand 17:30")
  assert.equal(W.stand({ time: at(17, 30) }, true, NOW, "de"), "Keine Verbindung, Stand 17:30")
  assert.equal(W.stand(null, true, NOW, "de"), "")
  assert.equal(W.degrees(-0.4), "0°")
  assert.equal(W.degrees(null), "")
})

test("Ortssuche wie Omarchys: Open-Meteo, dann omarchy-weather-location", () => {
  assert.equal(W.searchUrl(" Bad Aibling ", "de"),
    "https://geocoding-api.open-meteo.com/v1/search?count=5&format=json&language=de&name=Bad%20Aibling")
  const found = W.places(JSON.stringify({ results: [
    { name: "Aachen", admin1: "Nordrhein-Westfalen", country: "Deutschland", latitude: 50.77664, longitude: 6.08342 },
    { name: "ohne Koordinaten" }
  ] }))
  assert.deepEqual(found, [{ name: "Aachen", region: "Nordrhein-Westfalen, Deutschland", lat: 50.77664, lon: 6.08342 }])
  assert.deepEqual(W.places("{}"), [])
  assert.deepEqual(W.places("kaputt"), [])
  assert.deepEqual(W.setPlaceArgs(found[0]), ["--set", "Aachen", "50.7766,6.0834"])
  assert.deepEqual(W.setPlaceArgs({ name: "X", lat: -33.86882, lon: 151.20929 }), ["--set", "X", "-33.8688,151.2093"])
})

test("Unwetter (#189): ab Stufe 3 einmal als Neuigkeit, Hochstufung erneut", () => {
  const storm = (level, expires) => ({ level, event: { de: "Schwere Gewitter", en: "Severe thunderstorms" }, onset: at(17, 0), expires: expires || at(20, 0) })
  const frost = { level: 2, event: { de: "Frost", en: "Frost" }, onset: null, expires: at(23, 0) }
  const data = { place: "Aachen", alerts: [storm(3), frost] }
  const news = W.severeNews(data, [], NOW, "de")
  assert.deepEqual(news, [{ key: "weather:schwere gewitter@" + at(17, 0) + ":3", level: "warn",
                            title: "Unwetterwarnung: Schwere Gewitter", body: "Aachen, Stufe 3, bis 20:00" }], "Stufe 2 nicht")
  const told = news.map((n) => n.key)
  assert.deepEqual(W.severeNews(data, told, NOW, "de"), [], "dieselbe Warnung nicht erneut")
  assert.deepEqual(W.severeNews({ place: "Aachen", alerts: [storm(3, at(23, 0))] }, told, NOW, "de"), [], "verlängert: nicht erneut")
  const up = W.severeNews({ place: "Aachen", alerts: [storm(4)] }, told, NOW, "en")
  assert.equal(up.length, 1, "hochgestuft: erneut")
  assert.equal(up[0].level, "error")
  assert.equal(up[0].title, "Severe weather warning: Severe thunderstorms")
  assert.equal(up[0].body, "Aachen, Level 4, until 20:00")
  assert.deepEqual(W.severeNews({ place: "Aachen", alerts: [storm(3)] }, [up[0].key], NOW, "de"), [], "herabgestuft: nicht erneut")
  assert.equal(W.severeNews({ place: "Aachen", alerts: [Object.assign(storm(3), { onset: at(22, 0) })] }, told, NOW, "de").length, 1, "neue Warnung, später")
  assert.deepEqual(W.severeNews({ place: "Paris", alerts: null }, [], NOW, "de"), [], "ohne Warnungen (Ausland)")
  assert.deepEqual(W.severeNews(null, [], NOW, "de"), [])
})

test("Kachel: bündig mit der großen Ansicht (#190)", () => {
  assert.deepEqual(W.tile(200, 500, 0, true, 40, 0), { height: 500, hours: false, bars: 40, alerts: 300 }, "ohne Musik: so hoch wie die große Ansicht")
  assert.deepEqual(W.tile(200, 500, 180, true, 40, 0), { height: 320, hours: false, bars: 40, alerts: 120 }, "mit Musik: der Rest unter dem Player")
  assert.deepEqual(W.tile(200, 220, 0, true, 40, 0), { height: 220, hours: false, bars: 20, alerts: 20 }, "wenig Platz: alles an die Balken")
  assert.deepEqual(W.tile(200, 150, 0, true, 40, 0), { height: 200, hours: false, bars: 0, alerts: 0 }, "große Ansicht kürzer: so groß wie der Inhalt")
  assert.deepEqual(W.tile(200, 300, 180, true, 40, 0), { height: 200, hours: false, bars: 0, alerts: 0 }, "mit Musik kürzer: so groß wie der Inhalt")
  assert.deepEqual(W.tile(200, 500, 0, false, 40, 0), { height: 500, hours: false, bars: 0, alerts: 300 }, "ohne Regenbalken: nur die Warnungen nach unten")
})

test("Kachel: Stundenvorschau nur, wenn sie ganz Platz hat (#191)", () => {
  assert.deepEqual(W.tile(200, 500, 0, true, 24, 80), { height: 500, hours: true, bars: 24, alerts: 300 }, "lang: Vorschau, dann Balken")
  assert.deepEqual(W.tile(200, 300, 0, true, 24, 80), { height: 300, hours: true, bars: 20, alerts: 100 }, "knapp: die Vorschau zuerst, der Rest an die Balken")
  assert.deepEqual(W.tile(200, 279, 0, true, 24, 80), { height: 279, hours: false, bars: 24, alerts: 79 }, "ein Pixel zu wenig: keine Vorschau")
  assert.deepEqual(W.tile(200, 300, 180, true, 24, 80), { height: 200, hours: false, bars: 0, alerts: 0 }, "mit Musik und kurz: keine Vorschau")
  assert.deepEqual(W.tile(200, 500, 0, true, 24, 0), { height: 500, hours: false, bars: 24, alerts: 300 }, "ohne Stundenwerte: wie vorher")
  // Same room, same answer: whether the hours show never feeds back.
  assert.deepEqual(W.tile(200, 280, 0, true, 24, 80), W.tile(200, 280, 0, true, 24, 80))
})

test("Stundenvorschau: die nächsten sechs vollen Stunden aus Open-Meteo (#191)", () => {
  const hours = W.combine({ om }, PARIS, NOW).hours
  assert.equal(hours.length, 7, "Stunde ohne Temperatur fällt weg")
  assert.deepEqual(hours[0], { t: at(17, 0), temp: 8.6, icon: "cloudy" })
  assert.equal(hours[1].icon, "rain")
  assert.equal(hours[4].icon, "clear-night", "is_day 0: Nachtsymbol")
  assert.equal(W.combine({ om, current, radar: radar([0]), alerts: { alerts: [] } }, AACHEN, NOW).hours.length, 7, "auch in Deutschland von Open-Meteo")
  const next = W.nextHours(hours, NOW)
  assert.deepEqual(next.map(h => new Date(h.t * 1000).getHours()), [18, 19, 21, 22, 23, 0], "ab der nächsten vollen Stunde, höchstens sechs")
  assert.deepEqual(W.nextHours(hours, at(22, 10)).map(h => new Date(h.t * 1000).getHours()), [23, 0], "alter Stand: nur was noch kommt")
  assert.deepEqual(W.nextHours(null, NOW), [])
  assert.equal(W.combine({ om: Object.assign({}, om, { hourly: undefined }) }, PARIS, NOW).hours, null, "ohne hourly: keine Vorschau")
  assert.match(W.sources(PARIS, NOW)[0].url, /&hourly=temperature_2m,weather_code,is_day&forecast_hours=12/)
})

test("Stundenvorschau: Uhrzeit nach Sprache und Omarchys Uhrformat (#191)", () => {
  const clock = format => JSON.stringify({ bar: { layout: { center: [{ id: "omarchy.indicators" }, { id: "omarchy.clock", format }] } } })
  assert.equal(W.twelveHour(clock("ddd d MMM HH:mm")), false)
  assert.equal(W.twelveHour(clock("h:mm AP")), true)
  assert.equal(W.twelveHour(clock("h:mm ap")), true)
  assert.equal(W.twelveHour(clock("'Ta'g HH:mm")), false, "a in Anführungszeichen ist Text")
  assert.equal(W.twelveHour(JSON.stringify({ bar: { layout: { center: [{ id: "omarchy.clock" }] } } })), false, "Omarchys Vorgabe: 24 h")
  assert.equal(W.twelveHour("{kaputt"), false)
  assert.equal(W.twelveHour(""), false)
  assert.equal(W.hourLabel(at(19, 0), "de", true), "19", "Deutsch immer 24 h")
  assert.equal(W.hourLabel(at(0, 0, 2), "de", false), "0")
  assert.equal(W.hourLabel(at(19, 0), "en", false), "19")
  assert.equal(W.hourLabel(at(19, 0), "en", true), "7 PM")
  assert.equal(W.hourLabel(at(0, 0, 2), "en", true), "12 AM")
  assert.equal(W.hourLabel(at(12, 0), "en", true), "12 PM")
})
