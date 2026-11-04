# Hybelstyring

En enkel og rask styringsside for en hybel. Appen har to helt adskilte deler:

| Del | Hvem | Hvor |
|---|---|---|
| **Utleiersiden** | Deg | Sidemenyen i Home Assistant («Hybel»). Kun for administratorer, aldri eksponert på internett. |
| **Leietakersiden** | Leietakeren | Eget domene via Cloudflare Tunnel, beskyttet av Cloudflare Access. |

Leietakersiden har bare leietakerfunksjoner. Grenser, valg av enheter og standarder finnes ikke på den porten i det hele tatt, og alle grenser sjekkes på serveren.

## 1. Installer og sett opp enhetene

1. Legg til dette repoet under **Innstillinger → Apper → App-butikk → ⋮ → Repositorier**.
2. Installer **Hybelstyring** og start den.
3. Åpne **Hybel** i sidemenyen:
   - **Synlige enheter**: legg til lys, termostat (Varme), varmepumpe/klima og ventilasjon. Termostater og varmepumper har egne temperaturgrenser. Gi dem navnene leietakeren skal se. For lys kan du sette laveste og høyeste ekte lysstyrke – leietakeren ser 1–100 %, som strekkes over området.
   - **Standarder for scener**: still inn Hjemme, Kveld, Natt og Borte.
   - **Grenser**: maks og min gulvvarme, maks tid på høy ventilasjon, og om Borte på ventilasjonen er tillatt.
   - **Varsle meg**: velg varslingstjeneste og alarmer (f.eks. filter- eller frostalarm).
4. Trykk **Lagre endringer**.

## 2. Cloudflare Tunnel

Leietakersiden lytter på port `8100` inne i Home Assistant sitt interne nettverk. Den er ikke åpnet mot hjemmenettet.

1. Finn appens **vertsnavn** på infosiden til Hybelstyring (f.eks. `abcd1234-hybel`).
2. Bruk Cloudflared-appen for Home Assistant (eller en tunnel du allerede har) og legg til et offentlig vertsnavn:
   - **Vertsnavn**: f.eks. `hybel.<ditt-domene>`
   - **Tjeneste**: `http://<vertsnavn>:8100`

   I Cloudflared-appen gjøres dette med `additional_hosts`:
   ```yaml
   additional_hosts:
     - hostname: hybel.<ditt-domene>
       service: http://<vertsnavn>:8100
   ```

## 3. Cloudflare Access (innlogging)

1. Gå til **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Domene: `hybel.<ditt-domene>`. Sett **Session duration** til f.eks. 1 måned, så slipper leietakeren å logge inn ofte.
3. Legg til en policy: **Allow → Emails →** leietakerens e-post (og din egen, om du vil teste).
4. Kopier **Application Audience (AUD) Tag** fra applikasjonens oversikt.
5. Finn **team-domenet** under Zero Trust → Settings (f.eks. `mittteam.cloudflareaccess.com`).
6. Legg begge inn i appens **Konfigurasjon** og start appen på nytt.

Appen kontrollerer Cloudflare-signaturen på hver forespørsel. Er AUD eller team-domene feil eller mangler, er leietakersiden stengt.

## Testing på hjemmenettet

Slå av **Krev Cloudflare Access** og aktiver port `8100` under **Nettverk** i appen. Åpne `http://<home-assistant-ip>:8100`. Husk å skru det av igjen etterpå.

## Slik oppfører leietakersiden seg

- **Scener** lager leietakeren selv (navn, ikon og hva som skal være med). En scene styrer bare det den inneholder – «Dusj» kan f.eks. sette varme og ventilasjon uten å røre lyset.
- **Automasjoner** kjører en scene, slår av alle lys eller setter varmen på et klokkeslett eller ved sol opp/ned, valgte dager.
- **Høy ventilasjon** går automatisk tilbake etter valgt tid, også når en scene eller automasjon har slått den på.
- **Grensene** dine gjelder overalt – også i scener og automasjoner.
- Du kan låse scener og automasjoner, slik at leietakeren bare kan bruke dem som finnes.
- **Leietakerbytte** sletter leietakerens scener og automasjoner og lager nye forslag. Husk å oppdatere e-postlisten i Cloudflare Access.

## Info, strøm og meldinger

- **Info** fylles ut på utleiersiden under «Info til leietaker» (wifi, kontakt, søppel, regler, nødinfo og sikkerhetsfølere).
- **Strøm**: sett pris per kWh. Leietaker legger inn målerstand, og appen regner ut forbruk og beløp per periode. Prisen lagres på hver avlesning.
- **Meldinger**: nye meldinger sendes til varslingstjenesten under «Varsle meg». Svar og status vises for leietaker.
- Ved «Klargjør for ny leietaker» arkiveres avlesninger og meldinger.

## Sjekkliste og pushvarsler

- **Sjekkliste**: «Inn- og utflytting» på utleiersiden. Trykk «Send innflyttingssjekkliste». Leietaker finner den under Info → Sjekkliste. Bilder lagres i appens datamappe og blir med i sikkerhetskopien.
- **Pushvarsler**: leietaker slår på varsler under Info → Meldinger eller i innstillingene i appen. På iPhone må appen først legges på Hjem-skjermen (Del → Legg til på Hjem-skjerm). Nøklene lages automatisk og lagres i datamappen.

## Personvern

Innstillinger, navn og e-postadresser lagres i `/data` i appen og aldri i koden.
