# Erstinstallation auf frischem Omarchy testen (#198)

Ziel: einmal den ganzen Weg gehen, den ein neuer Nutzer geht –
`omarchy plugin add … --enable` → Pop-up „Noch ein Schritt“ →
**Einrichten** → „Weiter?“ (erst Nein, dann Ja) → Begrüßung → erstes „braucht dich“ – auf einem Omarchy, auf
dem der Buddy noch nie war. Du führst den Test durch, die Leitstelle wertet
aus.

Dauer, grob geschätzt: 1 Stunde beim ersten Mal (davon ca. 30 Min. Omarchy installieren),
danach ca. 15 Min. pro Durchlauf.

## 1. Wo testen

| Weg | Was er prüft | Grenze |
|---|---|---|
| **VM mit Omarchy-ISO (empfohlen)** | Alles: frisches System, frisches HOME, Omarchys Standard-Leiste und -Einstellungen | Grafik in der VM ist langsamer; Animationen wirken ruckeliger als auf echter Hardware, es gibt keinen Akku. |
| Zweiter Rechner mit frischem Omarchy | Alles, dazu echte Grafik und echter Monitor | Braucht ein Gerät, das du neu aufsetzen darfst. |
| Neuer Benutzer auf deinem PC | Frisches HOME: Setup, Pop-up, Begrüßung | Kein frisches System: gleiche Omarchy-Version und Pakete wie bei dir, Abmelden und Anmelden nötig. Gut als Notlösung. |
| `tests/sandbox`, `tests/install-test.sh` | Nur das Setup gegen ein leeres HOME | Keine Leiste, kein Pop-up, kein Klick. Läuft schon in `tests/run`, ersetzt diesen Test nicht. |

Die Anleitung unten geht von der VM aus.

## 2. VM einrichten (einmal)

Auf deinem PC ist noch keine VM-Software installiert. QEMU reicht:

    sudo pacman -S --needed qemu-desktop edk2-ovmf

1. Omarchy-ISO von [omarchy.org](https://omarchy.org) laden (z. B. nach
   `~/Downloads/omarchy.iso`).
2. Platte und UEFI-Speicher anlegen:

       mkdir -p ~/vm/omarchy && cd ~/vm/omarchy
       qemu-img create -f qcow2 omarchy.qcow2 40G
       cp /usr/share/edk2/x64/OVMF_VARS.4m.fd vars.fd

3. VM vom ISO starten (8 GB RAM, 4 Kerne, Grafik mit 3D):

       cd ~/vm/omarchy
       qemu-system-x86_64 -enable-kvm -machine q35 -cpu host -smp 4 -m 8G \
         -drive if=pflash,format=raw,readonly=on,file=/usr/share/edk2/x64/OVMF_CODE.4m.fd \
         -drive if=pflash,format=raw,file=vars.fd \
         -drive file=omarchy.qcow2,if=virtio \
         -device virtio-vga-gl -display gtk,gl=on \
         -nic user,model=virtio-net-pci \
         -device qemu-xhci -device usb-tablet \
         -cdrom ~/Downloads/omarchy.iso -boot d

4. Omarchy installieren wie gewohnt. Sprache wie bei dir wählen (dann
   kommen die Texte auf Deutsch). Danach die VM herunterfahren.
5. Den frischen Stand sichern, damit jeder Durchlauf wieder bei null
   anfängt:

       qemu-img snapshot -c frisch ~/vm/omarchy/omarchy.qcow2

Ab jetzt startet die VM mit demselben Befehl wie in Schritt 3, nur ohne die
letzte Zeile (`-cdrom … -boot d`).

Zurück auf den frischen Stand (VM aus): `qemu-img snapshot -a frisch ~/vm/omarchy/omarchy.qcow2`.

Bleibt der Bildschirm nach dem Anmelden schwarz oder stürzt Hyprland ab:
statt `-device virtio-vga-gl -display gtk,gl=on` nur `-device virtio-vga`
nehmen (ohne 3D, langsam, reicht für den Test) und das notieren.

## 3. Wie das Plugin in die VM kommt

`omarchy plugin add` klont mit `git` und nimmt `https://`, `ssh://`,
`git@host:pfad` (scp-Form), `file://` und einen einfachen Pfad zu einem
Repo oder Git-Bundle. Es fragt dabei nie nach Passwort oder Host-Schlüssel.

Ein privates Repo hinter einer Anmeldung oder SSH mit unbekanntem
Host-Schlüssel geht so nicht. Deshalb
kommt der Stand als **Git-Bundle** (eine Datei mit dem ganzen Repo) in die
VM:

Auf deinem PC, im Hauptcheckout auf `main` (dem Stand, der getestet wird):

    mkdir -p ~/vm-uebergabe
    git -C ~/Projects/companion bundle create ~/vm-uebergabe/omarchy-buddy.bundle HEAD main
    python3 -m http.server 8765 --bind 127.0.0.1 -d ~/vm-uebergabe

Der kleine Server ist nur auf deinem PC selbst erreichbar, nicht im LAN.
Die VM erreicht ihn trotzdem: In QEMUs Standard-Netz ist `10.0.2.2` dein PC.

In der VM, in einem Terminal:

    curl -o ~/omarchy-buddy.bundle http://10.0.2.2:8765/omarchy-buddy.bundle

Danach den Server auf deinem PC mit Strg+C beenden.

Grenze: So wird der Klon aus einer Datei getestet, nicht die spätere
öffentliche Adresse. Ob `omarchy plugin add https://…` von dort klappt,
lässt sich erst prüfen, wenn feststeht, wo das Plugin öffentlich liegt.

## 4. Vor dem Test in der VM

- [ ] `omarchy-version` notieren.
- [ ] `claude` starten und anmelden (Claude Code ist in Omarchy schon
      installiert). Danach Claude beenden. So findet das Setup Claude,
      wie bei einem echten Nutzer.
- [ ] Ein Bildschirmfoto der Leiste, so wie Omarchy sie liefert.

## 5. Der Test

Bei jeder Abweichung: Schrittnummer, was du gesehen hast (genauer Text),
Bildschirmfoto (Druck-Taste), Uhrzeit. Dann weitermachen, wenn es geht.

| # | Schritt | Erwartet |
|---|---|---|
| 1 | Im Terminal: `omarchy plugin add ~/omarchy-buddy.bundle --enable` | Eine Warnung, dass Plugins ungeschützt in der Shell laufen, mit der Adresse, dann „Clone and add this plugin?“ |
| 2 | **Yes** | Klonen, danach „Added io.github.destrukt1v.omarchy-buddy into …/plugins/io.github.destrukt1v.omarchy-buddy“ und gleich „Place io.github.destrukt1v.omarchy-buddy in which bar section?“ mit „center“ vorgewählt (kein „Enable now?“) |
| 3 | Enter | O-Morchy erscheint in der Leiste neben der Uhr. Kurz darauf ein Pop-up unter ihm: „Noch ein Schritt“, „Benachrichtigungen übernehmen und Claude verbinden.“, Knopf **Einrichten**. Das Terminal kehrt ohne Fehler zurück. |
| 4 | **Einrichten** klicken | Omarchys schwebendes Terminal öffnet sich. Das Setup listet, was es ändert (Verknüpfungen, `~/.claude/settings.json`, `~/.config/omarchy/shell.json`; andere Agents nur, wenn sie installiert sind), und fragt „Weiter?“ mit **Ja** (vorgewählt) und **Nein**. Das Pop-up „Noch ein Schritt“ bleibt stehen. |
| 4a | **Nein** (Pfeiltaste oder `n`) | „Abgebrochen, nichts geändert. Später einrichten: …/bin/omarchy-buddy-setup“. Terminal schließen: „Noch ein Schritt“ steht weiter unter O-Morchy, Omarchys Benachrichtigungen laufen wie vorher. |
| 4b | Noch einmal **Einrichten**, dann Enter (Ja) | Das Setup schreibt Zeile für Zeile, was es tut (Skripte, Claude-Hooks, Omarchy-Einstellungen, Timer), dann „Shell neu gestartet.“ und zum Schluss „Fertig. O-Morchy sitzt jetzt in der Leiste rechts neben der Uhr.“ mit drei Hinweisen. |
| 5 | Text im schwebenden Terminal abschreiben oder fotografieren, dann schließen | – |
| 6 | Warten, bis die Shell wieder da ist | Leiste wieder da, O-Morchy neben der Uhr. Einmal winkt er, ein Pop-up „Hallo, NAME!“ (oder „Hallo!“, wenn das System keinen Namen kennt) mit „Ich bin O-Morchy. …“ und dem Knopf **Probier’s aus**. Notiere, welcher Name dasteht. |
| 7 | **Probier’s aus** | Ein Pop-up „Probe-Benachrichtigung“, „So sehen deine Benachrichtigungen jetzt aus.“ unter O-Morchy, nicht oben rechts wie Omarchys eigene. |
| 8 | Im Terminal: `notify-send Hallo "aus dem Terminal"` | Pop-up unter O-Morchy. |
| 9 | Mit der Maus auf O-Morchy, dann klicken | Beim Darüberfahren der Peek, beim Klick die große Ansicht. Unter „Agents“: „Starte Claude oder Codex im Terminal – ich zeige dir hier, was sie tun.“ und darunter „Gefunden:“ mit Claude. Nochmal klicken schließt sie. |
| 10 | Neues Terminal, `claude` starten, schreiben: `Leg die Datei ~/probe.txt mit dem Text hallo an.` | Während Claude arbeitet: in der Leiste „Claude arbeitet“. Sobald Claude fragt: in der Leiste „Claude braucht dich“ (nur das Logo rot), ein Pop-up mit dem Ordnernamen, „braucht dich“, dem Vorhaben, den Knöpfen **Erlauben**, **Ablehnen**, **Zum Fenster** und „noch N s, danach fragt das Terminal“. |
| 11 | **Erlauben** | Pop-up weg, Claude legt die Datei an und macht weiter; im Terminal kein zweites Nachfragen. `cat ~/probe.txt` zeigt „hallo“. |
| 12 | Claude die gleiche Bitte für `~/probe2.txt` geben, diesmal nichts klicken | Nach Ablauf des Countdowns geht die Frage zurück ins Terminal; dort antworten geht. |
| 13 | Claude beenden | Nach kurzer Zeit ist die Sitzung aus „Agents“ verschwunden; die Leiste zeigt nur O-Morchy. |

## 6. Was du bei Abweichungen mitbringst

Die Leitstelle braucht für die Auswertung (am besten alles in einen Ordner,
z. B. per LocalSend oder als Fotos):

- deine Notizen zu den Schritten (Nummer, gesehen, erwartet, Bildschirmfoto)
- den Text aus dem schwebenden Terminal (Schritt 5)
- `omarchy-version`
- das Protokoll der Shell:
  `ls -t $XDG_RUNTIME_DIR/quickshell/by-id/*/log.log | head -1 | xargs cat`
- `cat ~/.local/state/omarchy-buddy/setup.json`
- `jq .bar ~/.config/omarchy/shell.json` (wo O-Morchy in der Leiste steht)

## 7. Danach

VM herunterfahren und den frischen Stand zurückholen
(`qemu-img snapshot -a frisch ~/vm/omarchy/omarchy.qcow2`), dann ist sie für
den nächsten Durchlauf bereit.
