# Gjestesiden

En rask og pen styringsside for gjester på hjemmenettet. Gjestene logges **ikke** inn i Home Assistant. De ser bare rommene, lysene, termostatene og radioen du har valgt, og alt sjekkes på serveren.

| Del | Hvem | Hvor |
|---|---|---|
| **Gjestesiden** | Gjestene | `http://<home-assistant-ip>:8200` eller et lokalt navn |
| **Oppsett** | Deg | Sidemenyen i Home Assistant («Gjest»), kun for administratorer |

Siden er laget for å være lokal. Ikke legg den i Cloudflare Tunnel eller åpne porten mot internett.

## 1. Installer

1. Legg til dette repoet under **Innstillinger → Apper → App-butikk → ⋮ → Repositorier**.
2. Installer **Gjestesiden** og start den.

## 2. Sett opp rom og radio

Åpne **Gjest** i sidemenyen:

- **Rom**: hvert rom blir en fane. Legg til lys og gi dem navnene gjestene skal se. Lys som støtter farge eller hvittoner får automatisk et fargevalg.
- **Varme**: velg en termostat per rom, eller vis bare temperaturen fra en føler.
- **Radio**: velg høyttaler, høyeste tillatte volum og kanalene. «Kanal i Music Assistant» er det du ville brukt som `media_id` i `music_assistant.play_media`.
- **Grenser**: laveste og høyeste temperatur gjestene kan velge.

Trykk **Lagre endringer**. Gjestesiden oppdateres med en gang.

### Importer oppsett (valgfritt)

Under appens **Konfigurasjon** kan du lime inn et helt oppsett som JSON i «Importer oppsett». Det leses ved oppstart, og bare når innholdet er endret. Formatet er det samme som oppsettsiden lagrer:

```json
{
  "texts": { "kicker": "Velkommen" },
  "rooms": [
    {
      "name": "Stue",
      "short": "Stue",
      "lights": [{ "entity_id": "light.stue_tak", "name": "Taklys" }],
      "heat": { "entity_id": "climate.stue", "name": "Varmepumpe" }
    },
    {
      "name": "Soverom",
      "short": "Sove",
      "lights": [],
      "temp_sensor": "sensor.soverom_temperatur"
    }
  ],
  "radio": {
    "player": "media_player.stue",
    "max_volume": 50,
    "stations": [{ "name": "NRK P1", "sub": "Østlandet", "media_id": "NRK P1" }]
  },
  "limits": { "heat_min": 16, "heat_max": 24 }
}
```

## 3. Et pent navn på hjemmenettet (valgfritt)

Gjestesiden virker med en gang på `http://<home-assistant-ip>:8200`. Vil du ha et navn i stedet:

1. **Lokal DNS** i ruteren (for eksempel UniFi Network: lokal DNS-oppføring under DNS-innstillingene): pek `gjest.<ditt-domene>` på IP-adressen til Home Assistant. Ikke legg navnet i den offentlige DNS-en.
2. **Nginx Proxy Manager** (egen app): lag en *Proxy Host* for `gjest.<ditt-domene>` → `http://<home-assistant-ip>:8200`. Legg inn `proxy_buffering off;` under *Advanced*, slik at sanntidsoppdateringene kommer fram med en gang.
3. **Sertifikat**: bruk *DNS Challenge* i Nginx Proxy Manager (for eksempel med Cloudflare). Da får du et gyldig sertifikat uten å åpne noe mot internett. Et wildcard-sertifikat (`*.<ditt-domene>`) gjør at navnet ikke havner i offentlige sertifikatlogger.

Noen telefoner bruker «privat DNS» og ser ikke lokale navn. Ha derfor gjerne en QR-kode til både navnet og `http://<home-assistant-ip>:8200`.

## Sikkerhet

- Bare enhetene du har valgt kan styres. Alt annet avvises på serveren.
- Temperatur og volum holdes innenfor grensene du har satt, også om noen sender kommandoer direkte.
- Forespørsler fra andre nettsteder avvises, og det er en bremse mot for mange kommandoer.
- Oppsettet er bare tilgjengelig gjennom Home Assistant, aldri på port 8200.

## Personvern

Navn, rom og kanaler lagres i `/data` i appen og aldri i koden.
