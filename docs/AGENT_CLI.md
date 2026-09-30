# LoggeRythm mit Agenten bedienen

Das CLI nutzt die bestehende REST-API. Sein Schwerpunkt liegt auf Serverfunktionen
und Downloads. Es liefert JSON auf stdout und strukturierte Fehler auf stderr mit
einem Exit-Code ungleich null. `--help` zeigt die verfügbaren Argumente.

Die CLI ist auch separat testbar: `python -m pip install './cli[test]'` und
`python -m pytest cli/tests -q`. Die API-Tests benötigen `api/requirements-test.txt`;
die Produktionsinstallation nutzt weiterhin `api/requirements.txt`.

## Installation und Anmeldung

Im Repository, mit Python 3.10 oder neuer:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install ./cli
loggerythm --help
loggerythm login --email name@example.org
loggerythm me
```

Die Anmeldung fragt das Passwort verdeckt ab. Als Standardserver dient
`https://loggerythm.logge.top`. Einen anderen Server wählt man vor dem Unterbefehl:

```sh
loggerythm --server https://music.example.org login --email name@example.org
```

`LOGGERYTHM_URL` setzt denselben Standard für weitere Aufrufe. HTTPS ist erforderlich;
HTTP ist für lokale Loopback-Adressen erlaubt. Vor der Anmeldung prüft das CLI die
API-Kompatibilität, bevor es Zugangsdaten sendet. Umleitungen werden abgelehnt.

Das `sf_session`-Cookie wird je Server-Origin im Betriebssystem-Schlüsselbund
gespeichert, unter macOS in der Keychain. Passwort und Cookie werden nicht ausgegeben
oder in einer CLI-Konfigurationsdatei abgelegt. Ein nicht verfügbarer oder unsicherer
Schlüsselbund führt zu einem Fehler. Für Automationen können `LOGGERYTHM_EMAIL` und
`LOGGERYTHM_PASSWORD` aus einer Secret-Verwaltung bereitgestellt werden. Alternativ
liefert `LOGGERYTHM_SESSION` ein bereits ausgestelltes Session-Cookie; diesen Wert
wie ein Passwort behandeln und nicht in Prompts, Protokolle oder Repository-Dateien
kopieren.

`loggerythm logout` entfernt die lokal gespeicherte Sitzung. Die bestehende
Server-API widerruft damit keinen bereits ausgestellten JWT. Bei Verwendung einer
Umgebungsvariable muss diese im aufrufenden Prozess entfernt werden. Neue Konten
können auf Freigabe warten: `me` funktioniert dann, geschützte Funktionen liefern 403.

## Funktionen erkunden

```sh
loggerythm capabilities
loggerythm request GET /api/agent --public
loggerythm request GET /api/version --public
```

`/api/agent` beschreibt die Operationen dieses Deployments, die Authentifizierung
und die Download-Funktionen. `/api/openapi.json` liefert den vollständigen Vertrag
mit Parametern, Request-Schemas, Antworttypen und Operation-IDs. `/api/docs` öffnet
die Swagger-Oberfläche im Browser. Die `/api`-Adressen funktionieren auch durch den
Web-Proxy; sie stehen nach Deployment der Backend-Änderungen zur Verfügung.

## Suche und Playlists

```sh
loggerythm search "Daft Punk" --type track
loggerythm search "Daft Punk" --type album
loggerythm playlists list
loggerythm playlists create "Agenten-Auswahl" --description "Aus Suchergebnissen"
loggerythm playlists add-track 12 42
loggerythm playlists get 12
loggerythm likes add 42
loggerythm likes list
loggerythm likes remove 42
```

Die Zahlen sind Beispiele: Die Playlist-ID aus der Erstellungsantwort und die
Deezer-Track-ID aus dem Suchergebnis übernehmen. `add-track` und `likes add` laden
die vollständigen Track-Metadaten, damit auch mehrere beteiligte Künstler erhalten
bleiben. Eine bereits vorhandene Track-ID wird beim Hinzufügen zur Playlist nicht
nochmals angehängt.

## Downloads und Servercache

```sh
loggerythm downloads cached
loggerythm downloads preload 42
loggerythm download track 42 --output ./song.mp3
loggerythm download playlist 12 --output ./playlist.zip
```

`preload` lädt den Song in den Servercache. `cached` zeigt dessen vorhandene
Track-IDs. `download track` speichert die Audiodaten auf dem Rechner, auf dem das
CLI läuft. `download playlist` lädt ein ZIP mit MP3-Dateien in Playlist-Reihenfolge;
die Dateinamen beginnen mit einer laufenden Nummer. Für Downloads ist eine
freigegebene Sitzung erforderlich. Eine Playlist muss dem Konto gehören oder
öffentlich sein. Eine leere Playlist kann nicht exportiert werden.

Das Zielverzeichnis muss existieren. Downloads werden gestreamt, zuerst in eine
temporäre Datei geschrieben und erst nach vollständigem Empfang übernommen.
Fehlerantworten, leere oder abgebrochene Downloads werden nicht als fertige Dateien
gespeichert. Bestehende Zieldateien bleiben erhalten, solange `--force` nicht
ausdrücklich angegeben wird.

Diese Dateien sind lokale Downloads des CLI. Der Servercache unterliegt weiterhin
der konfigurierten Aufbewahrungszeit. Die Offline-Verwaltung der Android-App und
des Browsers wird durch diese Befehle nicht geändert.

## Weitere Endpunkte direkt aufrufen

```sh
loggerythm request GET /api/artists/27 --public
loggerythm request GET /api/search/artist --query 'q=Daft Punk' --public
loggerythm request PATCH /api/playlists/12 --json '{"name":"Neue Auswahl"}'
loggerythm request PATCH /api/playlists/12/visibility --json '{"is_public":true}'
loggerythm request PUT /api/playlists/12/cover --file 'file=./cover.jpg'
loggerythm request PATCH /api/playlists/12/tracks/entries/order --json '{"entry_ids":[99,100]}'
loggerythm request DELETE /api/playlists/12/tracks/entries/99
```

`--json @payload.json` liest eine JSON-Datei; wiederholte `--query KEY=VALUE` setzen
Query-Parameter. `--file FIELD=PATH` sendet Multipart-Dateien. Binärantworten können
über `--output PATH` gespeichert werden. `--public` sendet keine Sitzung. Pfade
müssen mit `/api/` beginnen; vollständige URLs und Pfad-Escapes werden abgelehnt.

`playlist_entry_id` bezeichnet ein einzelnes Vorkommen in einer Playlist; die
Track-ID bezeichnet einen Deezer-Song. Der oben gezeigte Entry-Endpunkt entfernt
genau ein Vorkommen. Die ältere Route `/tracks/{deezer_id}` entfernt alle Vorkommen
dieses Songs. Für die Reihenfolge die vollständige aktuelle Liste der Entry-IDs aus
`playlists get` verwenden; ein veralteter Stand kann 409 liefern.

Admin-Funktionen sind über `request` erreichbar und setzen ein Admin-Konto voraus.
Speicherbereinigung und Benutzerlöschung ändern Serverdaten. Ein Agent sollte sie
nur bei einem entsprechenden Auftrag aufrufen.

## Ablauf für einen Agenten

1. Mit `capabilities` oder `/api/agent` die verfügbaren Operationen erkunden.
2. Mit `me` das angemeldete Konto und dessen Freigabe prüfen.
3. Suchen und die tatsächlichen IDs aus den JSON-Antworten übernehmen.
4. Gewünschte Änderungen ausführen und den neuen Zustand erneut lesen.
5. Downloads mit einem expliziten Zielpfad speichern und die zurückgegebenen
   Dateiinformationen auswerten.

401 bedeutet fehlende oder abgelaufene Anmeldung, 403 fehlende Freigabe oder
Berechtigung. 404 bezeichnet eine nicht verfügbare Ressource, 409 einen Konflikt,
422 ungültige Eingaben, 429 ein Upstream-Limit und 502 einen Upstream-Fehler.
Schreiboperationen nach einem Timeout nicht blind wiederholen: zuerst den
Serverzustand prüfen, da die Änderung bereits angekommen sein kann.

Party-Befehle ändern den gemeinsamen Party-Zustand. Play/Pause setzt einen Host
voraus; eine geöffnete App muss den Zustand umsetzen und Audio selbst abspielen.
`GET /api/party/{code}` aktualisiert auch die Mitgliedschaft. Der SSE-Endpunkt
`/api/party/{code}/events` ist ein dauerhafter Ereignisstrom und keine JSON-Einzelantwort.
