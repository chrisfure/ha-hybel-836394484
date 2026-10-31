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
   - **Synlige enheter**: legg til lys, termostat (Varme) og ventilasjon. Gi dem navnene leietakeren skal se.
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

- **Scenene** setter lys, varme og ventilasjon samtidig.
- **Endringer på forsiden er midlertidige.** Leietakeren kan gå tilbake til scenen eller lagre endringen som ny standard (om du tillater det).
- **Høy ventilasjon** går automatisk tilbake etter valgt tid.
- **Om natten** (kl. 03) settes hybelen tilbake til aktiv scene hvis noe er glemt. Leietakeren kan slå dette av.
- **Leietakerbytte** tilbakestiller leietakerens scener og innstillinger. Husk å oppdatere e-postlisten i Cloudflare Access.

## Personvern

Innstillinger, navn og e-postadresser lagres i `/data` i appen og aldri i koden.
