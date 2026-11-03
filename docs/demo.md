# Demo: was der Buddy mit Claude kann (5 Minuten)

Für Vorführungen, für Tester und als Drehbuch für ein GIF. Alles läuft mit
einer echten Claude-Sitzung, keine Testdaten.

## Vorbereitung

1. Einen leeren Ordner und eine **neue** Claude-Sitzung, die fragt:

       mkdir -p ~/buddy-demo && cd ~/buddy-demo && git init -q
       claude --permission-mode manual

   - `manual` ist wichtig: Im Auto- oder Bypass-Modus fragt Claude nie,
     dann gibt es kein „braucht dich“.
   - Neue Sitzung, weil die Hooks erst für neue Sitzungen gelten.
2. Das Terminal auf einen anderen Arbeitsbereich schieben. So sieht man,
   dass alles über die Insel geht.
3. **Zeigst du per Bildschirmteilen** (Videocall): Einstellungen →
   Privatsphäre → „Beim Bildschirmteilen“ auf **nichts ändern** stellen.
   Standard ist „Insel ausblenden“, dann sieht dein Gegenüber nichts.
   Danach zurückstellen.
4. Ruhemodus aus.

## Die fünf Schritte

**1. Eine Datei anlegen**

> Leg eine Datei ideen.md mit drei Ideen für ein Wochenende an.

O-Morchy hebt die Hand, in der Leiste steht „Claude braucht dich“, oben
erscheint die rote Insel mit der neuen Datei als Vorschau.
Zeigen: **Erlauben**.

**2. Ein Befehl, einmal abgelehnt**

> Zeig mir mit ls, was im Ordner liegt, und lösch dann ideen.md.

Über dem Befehl steht Claudes eigene Beschreibung, darunter der Befehl,
dazu der Countdown. `ls` erlauben, beim Löschen **Ablehnen**: Claude bekommt
die Absage und macht weiter.
Erzählen: Nach 30 Sekunden ohne Klick fragt wieder das Terminal, es geht
nichts verloren.

**3. Eine Frage mit Auswahl**

> Frag mich mit Auswahlmöglichkeiten, ob das Skript in Python oder Bash sein soll.

Die Möglichkeiten stehen in der Insel, antworten direkt dort (auch eine
eigene Antwort geht). Fragen und Pläne warten 5 Minuten.

**4. Ein Plan**

Mit Shift+Tab in den Plan-Modus wechseln:

> Plane ein kleines Skript, das jeden Morgen das Wetter ausgibt.

Der Plan kommt aufklappbar in die Insel: annehmen oder **Überarbeiten …**
mit einem Änderungswunsch zurückschicken.

**5. Arbeiten lassen**

Eine längere Aufgabe geben, z. B. „Schreib das Skript und teste es.“, dann
in ein anderes Fenster wechseln.

- In der Leiste steht „Claude arbeitet“.
- Mit der Maus über O-Morchy: Der Peek zeigt, was gerade läuft.
- Am Ende kommt das Fertig-Pop-up.

## Zum Schluss: der Wow-Moment

Eine zweite Sitzung in einem zweiten Terminal (Claude oder Codex) und beide
gleichzeitig etwas tun lassen, das fragt. Die Insel stellt die Anfragen
hintereinander („1/2“), **Zum Fenster** springt ins richtige Terminal, und
die große Ansicht (Klick auf O-Morchy) zeigt beide Sitzungen.

## Als GIF oder Video aufnehmen

`omarchy screenrecord` startet und stoppt die Aufnahme (Bereich wählen:
die obere Bildschirmmitte mit Leiste und Insel). Zählt die Aufnahme bei dir
als Bildschirmteilen, gilt Punkt 3 der Vorbereitung auch hier.

Für das README und die Ankündigung reichen die Schritte 1, 3 und 5,
zusammen unter 30 Sekunden.

## Danach aufräumen

    rm -rf ~/buddy-demo

Die Sitzungen verschwinden aus der Insel, sobald Claude beendet ist (oder
nach 30 Minuten ohne Ereignis).
