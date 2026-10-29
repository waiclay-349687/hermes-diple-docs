[English](README.md) | [简体中文](README.zh.md) | [繁體中文](README.zh-hant.md) | [日本語](README.ja.md) | [العربية](README.ar.md) | [Русский](README.ru.md) | [Français](README.fr.md) | **Deutsch** | [Español](README.es.md)

# Diple Docs — Markdown-Dokumente für die KI markieren und kommentieren (Hermes-Desktop-Plugin)

Öffnen Sie eine `.md`-Datei in Hermes Desktop, markieren Sie Passagen, schreiben Sie Kommentare dazu und geben Sie sie an die KI in Ihrem Chat weiter; jede Annotation behält ihre Stelle in der Datei und zeigt, ob sie gesendet, beantwortet oder erledigt ist.

> **Der Name.** Die *Diplé* (›) ist das Zeichen, mit dem griechische Schreiber am Rand eine Zeile auf ihren Kommentar verwiesen. Diple Docs (圈批·文档) ist das Familienmitglied für Dokumente; [Diple](https://github.com/waiclay-349687/hermes-diple) (圈批) das für den Chat.

> **Inoffiziell.** Dies ist ein Community-Plugin. Es wird nicht von Nous Research oder dem Hermes-Agent-Projekt erstellt, geprüft oder unterstützt.

## Funktionen

- **Eine schreibgeschützte Dokumentseite** — öffnet eine `.md`- / `.markdown`-Datei in einem eigenen Tab, an derselben Stelle wie die Hermes-Vorschau: neben dem Chat, rechts davon. Ansichten **Gerendert** und **Quelltext**, **Neu laden** und **Im Finder zeigen**. Das Plugin bearbeitet das Dokument nie.
- **Eine Auswahl annotieren** — Text auswählen und auf **Annotieren** klicken. Der Editor öffnet sich direkt unter der Passage, und die Auswahl behält eine leichte vorübergehende Tönung, damit Sie sehen, was Sie annotieren. Noch ist nichts hinzugefügt.
- **Erst gespeichert, dann in der Liste** — **Speichern** mit Kommentar ergibt einen *Kommentar* (die KI muss ihn beantworten); **Speichern** mit leerem Feld ergibt eine *Markierung* (nur Hintergrund). Erst dann kommt die Annotation in die Liste und wird zur aktuellen. Ein leerer Entwurf verschwindet, wenn Sie daneben klicken oder <kbd>Esc</kbd> drücken. Ein Entwurf mit Text geht nicht verloren, wenn Sie daneben klicken, zu einer anderen Annotation wechseln, die Seite schließen oder neu laden; nur <kbd>Esc</kbd> oder **×** verwirft ihn. Wird die Datei aktualisiert, folgt der Entwurf seiner Stelle; ist sie nicht mehr zu finden, werden Sie gebeten, sie neu auszuwählen. Hat ein anderes Fenster dieselbe Stelle inzwischen gespeichert, wählen Sie: **Bestehenden behalten**, **Durch meinen ersetzen** oder **Zusammenführen**.
- **Die Annotationsliste** — alle Annotationen der Datei in Dokumentreihenfolge, mit Filtern (Alle, Zu senden, Gesendet, Beantwortet, Original geändert, Erledigt). Auf einer Karte: zur Passage springen, Kommentar bearbeiten, als erledigt markieren oder wieder öffnen, löschen (mit Rückgängig), diese senden.
- **Vorherige / nächste offene Anmerkung** — zwei Pfeile im Listenkopf (und in der Statusleiste am Rand) gehen durch das, was noch nicht erledigt ist.
- **Gesammelt löschen, mit Rückgängig** — das **⋯**-Menü der Liste löscht alle, die erledigten, die gesendeten oder beantworteten, die mit geändertem Original oder die gefilterten, markiert alle als erledigt oder kopiert alle als Markdown. Jedes Löschen lässt sich rückgängig machen.
- **Liste über die Symbolleiste ein- oder ausblenden** — der Schalter am rechten Ende der Dokument-Symbolleiste (er zeigt, wie viele noch offen sind). Ausgeblendet hinterlässt die Liste eine **Statusleiste am Rand**: eine Marke pro Annotation an ihrer Stelle im Dokument, nach Status gefärbt; mit dem Mauszeiger über eine Marke für die Vorschau, Klick springt hin.
- **Schmale Fenster** — ist die Seite zu schmal für die Liste neben dem Dokument, wird die Liste zu einer Leiste unten, die sich auf- und zuklappen lässt.
- **Folgt Dateiänderungen** — ändert sich die Datei auf der Festplatte, lädt die Seite neu (während Sie einen Kommentar schreiben, wartet sie) und findet jede Passage wieder. Eine Passage, die sie nicht mehr findet, wird als **Original geändert** markiert und behält den alten Text, mit **Neues Original wählen** auf der Karte.
- **An den Chat übergeben** — **N senden ▾** übergibt Annotationen an [Diple](https://github.com/waiclay-349687/hermes-diple): in die Warteliste der Unterhaltung, damit sie mit Ihrer nächsten Nachricht hinausgehen, oder sofort. Die Karte zeigt dann **Gesendet** und, sobald die KI geantwortet hat, **Beantwortet**, mit einem Link zur Unterhaltung. **Für die KI kopieren** im selben Menü kopiert sie stattdessen als Markdown.
- **„In Diple Docs öffnen“ im Chat** — schreibt die KI eine `.md`-Datei, öffnet eine Karte am Ende ihrer Antwort die Datei zum Annotieren (abschaltbar). Zuletzt geöffnete Dokumente sind auch in der Befehlspalette.

Die Oberfläche des Plugins gibt es in allen Sprachen von Hermes Desktop: **English, 简体中文, 繁體中文, 日本語, العربية, Русский, Français, Deutsch und Español** (Arabisch von rechts nach links). Standardmäßig folgt sie der App-Sprache; in den Plugin-Einstellungen lässt sich auch eine Sprache festlegen.

## Screenshots

Alle Screenshots zeigen die Oberfläche auf vereinfachtem Chinesisch und ein erfundenes Beispieldokument.

Der Kommentar-Editor direkt unter der ausgewählten Passage; rechts die Statusleiste am Rand:

![Der Editor unter einer ausgewählten Passage, mit Kommentarfeld und den Schaltflächen „Speichern und senden“ / „Speichern“ (auf Chinesisch)](docs/screenshots/editor.png)

Der Listenkopf: vorherige / nächste offene Anmerkung, das geöffnete **⋯**-Menü mit den Sammelaktionen, die Filter und die ersten Karten:

![Die Annotationsliste mit geöffnetem ⋯-Menü: alle löschen, erledigte löschen, gesendete/beantwortete löschen, „Original geändert“ löschen, alle als erledigt markieren, alle als Markdown kopieren (auf Chinesisch)](docs/screenshots/list-menu.png)

Die Liste über die Symbolleiste ausgeblendet: die Statusleiste am Rand mit einer Marke pro Annotation (helles und dunkles Design):

![Das Dokument mit ausgeblendeter Liste und einer schmalen Statusleiste farbiger Marken am rechten Rand (auf Chinesisch)](docs/screenshots/rail.png)

![Dasselbe im dunklen Design](docs/screenshots/rail-dark.png)

Eine schmale Seite: die Liste als Leiste unten:

![Eine schmale Dokumentseite mit der Annotationsliste als Leiste unten (auf Chinesisch)](docs/screenshots/narrow.png)

Die Screenshots entstanden in einer Sandbox vor der letzten Änderung am Editor: Dort hatte eine neue Annotation schon bei geöffnetem Editor ihre Nummer; jetzt bekommt sie sie beim Speichern.

## Installation

Das Plugin hat zwei Hälften: ein Desktop-Plugin (`plugin.js`) und ein kleines Python-Backend (`plugins/diple-docs/`). Beide werden gebraucht. Um Annotationen an den Chat zu senden, installieren Sie auch [Diple](https://github.com/waiclay-349687/hermes-diple) (siehe „Begleit-Plugin“ unten). In den Befehlen unten ist `~/.hermes` Ihr Hermes-Verzeichnis; für ein benanntes Profil verwenden Sie `~/.hermes/profiles/<name>`.

### Option A: ein Release herunterladen

1. Laden Sie `plugin.js`, `plugin.js.sha256`, `diple-docs-python-0.1.0.zip` und `diple-docs-python-0.1.0.zip.sha256` aus dem [neuesten Release](https://github.com/waiclay-349687/hermes-diple-docs/releases) herunter und prüfen Sie sie:

   ```bash
   shasum -a 256 -c plugin.js.sha256
   shasum -a 256 -c diple-docs-python-0.1.0.zip.sha256
   ```

2. Legen Sie sie an ihren Platz:

   ```bash
   mkdir -p ~/.hermes/desktop-plugins/diple-docs ~/.hermes/plugins
   cp plugin.js ~/.hermes/desktop-plugins/diple-docs/plugin.js
   unzip -o diple-docs-python-0.1.0.zip -d ~/.hermes/plugins/
   ```

3. Aktivieren Sie das Backend und starten Sie Hermes Desktop neu:

   ```bash
   hermes plugins enable diple-docs
   ```

### Option B: aus dem Quellcode

Benötigt Node.js 22 oder neuer.

```bash
git clone https://github.com/waiclay-349687/hermes-diple-docs.git
cd hermes-diple-docs
npm install
node scripts/install.mjs --home ~/.hermes --no-enable
hermes plugins enable diple-docs
```

`scripts/install.mjs` baut `plugin.js` und kopiert beide Hälften in das mit `--home` angegebene Hermes-Verzeichnis (es rät nie selbst eines). Starten Sie Hermes Desktop danach neu: Die Python-Hälfte wird nur beim Start der App geladen.

## Verwendung

1. Ein Dokument öffnen: in der Befehlspalette (<kbd>⌘K</kbd>) „Diple Docs: Dokument öffnen…“ oder „Diple Docs: Zuletzt geöffnete Dokumente…“ wählen, oder im Chat auf einer Karte „In Diple Docs öffnen“ auf **Öffnen** klicken.
2. Eine Passage auswählen und auf **Annotieren** klicken. Einen Kommentar schreiben oder das Feld für eine Markierung leer lassen und auf **Speichern** klicken (oder <kbd>Enter</kbd>; <kbd>Umschalt</kbd>+<kbd>Enter</kbd> fügt eine Zeile ein). Die Annotation erscheint in der Liste und als Tönung auf der Passage.
3. Weiterlesen. Mit den Pfeilen im Listenkopf gehen Sie durch das, was noch offen ist; mit dem Schalter in der Symbolleiste blenden Sie die Liste aus, wenn Sie die Breite brauchen.
4. **N senden ▾** öffnen: diese eine oder alle ungesendeten dieser Datei wählen, dann die aktuelle Unterhaltung, um sie in deren Warteliste zu legen oder sofort zu senden. Oder **Für die KI kopieren** wählen.
5. Hat die KI geantwortet, zeigen die Karten **Beantwortet**. Markieren Sie Geklärtes als erledigt und löschen Sie es zum Schluss über das **⋯**-Menü.

**Speichern und senden** im Editor speichert zuerst und sendet dann diese eine Annotation an die aktuelle Unterhaltung.

### Tastenkürzel

| Aktion | Standard | Hinweise |
| --- | --- | --- |
| Auswahl auf der Dokumentseite annotieren | <kbd>⌘⇧E</kbd> | Dasselbe Kürzel wie bei Diple, von der Seite selbst behandelt; „Auswahl annotieren (Dokumentseite)“ lässt sich auch in den Tastatureinstellungen der App belegen |
| Annotationsliste ein- oder ausblenden | <kbd>⌘⌥B</kbd> | Änderbar |
| Vorherige / nächste offene Anmerkung | keines | In den Tastatureinstellungen der App belegen |

Die Arbeitsflächen (Schaltfläche, Editor, Liste, Statusleiste) zeigen diese Tasten nicht; die Einstellungsseite des Plugins listet sie auf.

Unter Windows und Linux entspricht <kbd>⌘</kbd> der Taste <kbd>Strg</kbd>. Die Befehlspalette (<kbd>⌘K</kbd>) enthält außerdem „Auswahl annotieren (Dokumentseite)“ und „Diple Docs: Einstellungen“ (in Ihrer Oberflächensprache).

## Einstellungen

Öffnen Sie sie über die Befehlspalette („Diple Docs: Einstellungen“) oder in den Einstellungen der App.

| Einstellung | Standard | Wirkung |
| --- | --- | --- |
| Sprache | Wie die App | Wie die App oder eine der neun Sprachen, jede unter ihrem eigenen Namen. |
| Karte „In Diple Docs öffnen“ anfügen, wenn die KI eine `.md`-Datei schreibt | an | Eine Karte am Ende der Antwort öffnet die geschriebene Datei. Aus: über die Befehlspalette öffnen. |
| Tastenkürzel | — | Listet die Kürzel oben auf; geändert werden sie in den Tastatureinstellungen der App. |
| Auf Standard zurücksetzen | — | Stellt die Standardwerte wieder her. |

## Funktionsweise

### Was die KI erhält

Diple Docs spricht nicht selbst mit der KI. **Senden** übergibt die Annotationen per Plugin-Ereignis an Diple (das Übergabeprotokoll, [ADR 0007](docs/adr/README.md)); Diple legt sie in die Warteliste der Unterhaltung, neben die aus dem Chat, und sendet sie wie seine eigenen: Die Chatblase bleibt kurz, und die KI erhält jede Passage vollständig mit Datei und Zeile, Ihren Kommentar und die Regel, jeden Kommentar zu beantworten. Diple meldet zurück, was gesendet und was beantwortet wurde, und die Karten ziehen nach.

**Für die KI kopieren** legt dieselben Annotationen als Markdown in die Zwischenablage (die Passage als Zitat, dann Ihr Kommentar) — für jeden Chat und jedes Werkzeug.

### Die Stelle jeder Annotation

Eine Annotation speichert ihre Passage, die Zeile und genug umgebenden Text, um sie wiederzufinden. Nach einer Änderung sucht das Plugin die Passage im neuen Text; ist der Kontext nicht eindeutig genug, rät es nicht: Die Annotation wird als **Original geändert** markiert und behält den alten Text.

### Wo Daten gespeichert werden

- Annotationen, ihr Status und die Liste zuletzt geöffneter Dokumente: SQLite unter `~/.hermes/plugin-data/diple-docs/data.db`, nach Dateipfad. Neben Ihren Dokumenten wird nichts geschrieben.
- Layout-Entscheidungen (Listenbreite, ein- oder ausgeblendet, Ansicht): der Desktop-Plugin-Speicher von Hermes Desktop (Schlüssel mit dem Präfix `hermes.plugin.diple-docs.`).

Designentscheidungen sind in [docs/adr](docs/adr/README.md) festgehalten, der Gesamtaufbau in [docs/architecture.md](docs/architecture.md).

## Datenschutz

Alles bleibt auf Ihrem Rechner. Das Plugin stellt selbst keine Netzwerkanfragen und hat keine Telemetrie. Es liest nur die Dokumente, die Sie öffnen, und verweigert Orte mit Zugangsdaten oder internen Hermes-Daten (zum Beispiel `~/.ssh` oder die `.env` von Hermes). Annotationen erreichen Ihren Modellanbieter nur, wenn Sie sie in eine Unterhaltung senden — genau wie Text, den Sie tippen.

## Bekannte Einschränkungen

Die wichtigsten (vollständige Liste mit Gründen in [docs/known-limitations.md](docs/known-limitations.md)):

- Zum Senden wird Diple gebraucht. Ohne es wartet das erste Senden 3 Sekunden auf eine Antwort (10 Sekunden bei einer anderen Unterhaltung, die Diple erst öffnet); dann meldet die Seite, dass Diple nicht antwortet, und schaltet das Senden ab. Liste, Kommentare, **Für die KI kopieren** und **Alle als Markdown kopieren** funktionieren weiter.
- Das Ziel ist immer eine bestehende Unterhaltung: Eine neue lässt sich von hier aus nicht anlegen, weil `newChat()` aus dem SDK keine Sitzungs-ID zurückgibt. _(issue not filed yet)_
- In der gerenderten Ansicht passt eine Auswahl in einer Tabelle, in rohem HTML oder in einer Fußnote eventuell nicht zum Quelltext; dann bittet die Seite, sie in der Quelltext-Ansicht neu zu wählen.
- Eine umbenannte oder verschobene Datei beginnt mit einer leeren Liste.
- Schreibt ein anderes Plugin ebenfalls die Antworten der KI um, kann die Karte „In Diple Docs öffnen“ verloren gehen (der Host behält nur die erste Umschreibung); die Datei steht trotzdem unter den zuletzt geöffneten Dokumenten.

## Kompatibilität

Getestet mit Hermes Agent **v0.22.5 (2026.9.24)**, Commit `bf0203a` (2026-10-22), unter macOS, zusammen mit Diple 0.2.2. Hermes Desktop ist erforderlich (die CLI allein lädt keine Desktop-Plugins). Andere Versionen können funktionieren, sind aber nicht getestet; bitte melden Sie Ihre Erfahrungen.

## Begleit-Plugin: Diple

[Diple](https://github.com/waiclay-349687/hermes-diple) (圈批) ist das Familienmitglied für den Chat: Passagen einer Unterhaltung markieren und kommentieren, sie in einer Warteliste über dem Eingabefeld sammeln und mit der nächsten Nachricht senden; die KI beantwortet jeden Kommentar, und Sie springen zwischen Antwort und Passage hin und her.

- **Ohne Diple**: Dokumente öffnen, annotieren, die Liste, Filter, erledigen, die Statusleiste am Rand, **Für die KI kopieren** im Sendemenü und **Alle als Markdown kopieren** funktionieren. Nur das Senden an eine Unterhaltung braucht Diple.
- **Mit Diple**: **N senden ▾** legt die Annotationen des Dokuments in die Warteliste der Unterhaltung, neben die aus dem Chat, als Chips über dem Eingabefeld; sie gehen mit Ihrer nächsten Nachricht hinaus, oder sofort, wenn Sie im Menü die Unterhaltung selbst wählen. Die Antworten der KI zeigen, welchen Kommentar sie beantworten, und die Karten hier wechseln zu **Gesendet**, dann **Beantwortet**.

Es sind zwei getrennte Plugins mit eigenen Repositorys und Releases; installieren Sie eines oder beide. Zur Laufzeit teilen sie keinen Code: Jedes bündelt seine eigene Kopie des gemeinsamen Kerns.

## Was es unterscheidet

Die eingebaute Vorschau von Hermes Desktop zeigt eine Markdown-Datei an und kann sie bearbeiten. Diple Docs bearbeitet nie: Es dient dem Prüfen. Es führt pro Datei eine Annotationsliste über Sitzungen hinweg, findet die Annotationen nach Änderungen wieder, verfolgt jede von „zu senden“ über „beantwortet“ bis „erledigt“ und übergibt sie über Diple an den Chat.

## Roadmap und Issues

- [ROADMAP.md](ROADMAP.md) — woran jetzt, als Nächstes und später gearbeitet wird.
- [Issues](https://github.com/waiclay-349687/hermes-diple-docs/issues) — offene Fragen, Designdiskussionen und bekannte Einschränkungen.
- [CHANGELOG.md](CHANGELOG.md) — was sich in jeder Version geändert hat.
- [CONTRIBUTING.md](CONTRIBUTING.md) — bauen und testen.

## Lizenz

[MIT](LICENSE).
