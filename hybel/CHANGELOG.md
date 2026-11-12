# Endringslogg

## 0.11.0

- Ny seksjon **Statistikk** på utleiersiden: velg hvilke målinger leietaker ser. Automatiske målinger (termostater, ventilasjon, ute) kan skjules, og du kan legge til egne sensorer (temperatur, fukt, CO₂, effekt o.l.) med eget navn. Utetermometer er flyttet hit fra Oppsett.
- Grafer for andre sensorer får egen farge og riktig enhet.

## 0.10.2

- Statistikk har nå **utetemperatur** (blå graf). Termometeret velges automatisk (temperaturføler med «ute» i navnet, snitt-sensor foretrekkes) eller under Oppsett på utleiersiden.

## 0.10.1

- Statistikk viser luftfuktighet også når ventilasjonen har fuktføleren som egen sensor på samme enhet (vises også på ventilasjonskortet under Klima).
- Månedsvisning i statistikken er fjernet – bare døgn og uke.

## 0.10.0

- Ny fane **Statistikk**: temperatur (termostater/varmepumpe, med valgt føler) og luftfuktighet/inneluft fra ventilasjonen for siste døgn, uke eller måned. Nåverdi, laveste, snitt og høyeste, og dra fingeren over grafen for å se verdien på et tidspunkt. Grønt felt viser god luftfuktighet (30–60 %).
- Scener har ikke lenger egen fane – de ligger som små knapper øverst på Lys.
- Automasjoner på luftfuktighet kan ikke lenger lages (eksisterende kjører som før).

## 0.9.1

- **Dokumenter**: utleier kan laste opp signert leiekontrakt og andre dokumenter (PDF, JPG, PNG, maks 15 MB) under Leieforhold. Leietaker finner dem under Leie → Leieforholdet og får pushvarsel. Dokumenter kan skjules, gis nytt navn eller slettes, og arkiveres ved leietakerbytte.
- PDF-er (faktura, sjekkliste, dokumenter) sendes uten sidens strenge innholdsregler, så de åpnes i nettleserens PDF-visning overalt.

## 0.9.0

- Scener styrer bare lys – varme og ventilasjon er tatt ut. Eldre scenesverdier for varme/ventilasjon ignoreres, og scener uten lys skjules.
- Bare den sist valgte scenen vises som aktiv (før kunne f.eks. Natt og Borte vises samtidig fordi begge slår av alle lys).
- Scener vises som små knapper i to kolonner; redigering ligger bak «Endre scener».
- **Fast lysknapp**: utleier velger fjernkontroll, knapp og lys under Scener og automasjoner. Opp = på, ned = av, hold inne = dim. Følger hybelen fra start, overlever leietakerbytte og kan ikke endres av leietaker.
- Temperaturkort viser ikke lenger begrunnelse for maks/min, og listen over grenser i innstillingene er fjernet.

## 0.8.4

- Fakturaer kan slettes fra Økonomi (med bekreftelse). Slettede fakturaer vises ikke for leietaker, regnes ikke som utestående og kan gjenopprettes under «Slettede fakturaer». Betalte fakturaer må få fjernet betalingen før de kan slettes.

## 0.8.3

- Zigbee-tilkobling holdes åpen i 10 minutter (Zigbee2MQTT slås på igjen automatisk når den lukker selv).
- Tilkoblingen lukkes ikke lenger bare fordi lyset svarer et øyeblikk – det skjer ofte når lyset får strøm eller under tilbakestillingen. Leietaker tester lyset i appen og trykker «Ferdig – lyset virker».

## 0.8.2

- Lys som ikke svarer, vises som «Ikke tilkoblet» med en infoknapp. Den viser hvordan leietaker kobler lyset til Zigbee igjen: slå på lyset, trykk «Start tilkobling» (åpner for tilkobling i Zigbee2MQTT i 4 minutter), og slå bryteren av og på 7 ganger raskt.
- Tilkoblingen lukkes automatisk når lyset er tilbake eller tiden er ute, og utleier får beskjed i Home Assistant.
- Utleier kan slå funksjonen av under Oppsett.

## 0.8.1

- **Faktura (PDF) for hver måned**: husleie (med avregning ved delvis måned) og strøm med målerstander, kWh og pris, forfallsdato, kontonummer og fakturanummer (H-ÅÅÅÅMM) som betalingsmerking. Betalte måneder får «Betalt»-stempel.
- Leietaker åpner fakturaen fra «Neste betaling» eller ved å trykke på en måned under Betalinger. Utleier har «Faktura» på hver linje i Økonomi.
- Nye felt under Økonomi → Innstillinger: ditt navn, leietakers navn og adressen til hybelen (brukes på fakturaen).

## 0.8.0

- Utleiersiden: ny seksjon **Økonomi** som samler husleie og strøm: utestående, neste forfall, betalt i år og strømpris øverst, deretter betalinger per måned, strømavlesning og -perioder, og innstillinger for husleie og strøm.
- «Marker alle forfalte som betalt» med ett trykk.
- «Leieforhold» inneholder nå bare kontrakt, depositum og hva som er inkludert. Den egne Strøm-seksjonen er slått inn i Økonomi.

## 0.7.4

- Utleiersiden: ny linje «Må gjøres» øverst med det som venter (ubesvarte meldinger, ubetalt leie, sjekkliste til godkjenning, enheter uten kontakt, kontrakt som snart utløper). Trykk for å gå rett til seksjonen.
- Hver seksjon viser merker i overskriften når noe bør sjekkes, også når den er lukket.
- Rettet: strømprisen ble bare lagret sammen med info-feltene.

## 0.7.3

- Velger leietaker en dato fram i tid ved strømavlesning, vises en tydelig advarsel med en gang, og «Lagre avlesning» blir utilgjengelig til datoen er rettet.

## 0.7.2

- Godkjente sjekklister er gjemt: egen fane vises bare mens en sjekkliste er i bruk. Ellers ligger den som en lenke nederst på Info.
- Innsendte og godkjente sjekklister vises som et sammendrag (antall OK, merknader og bilder, med merknadene listet). Hele listen kan åpnes ved behov.
- Strømavlesninger kan ikke legges inn fram i tid.

## 0.7.1

- Automasjoner er samlet i grupper som kan felles sammen: én gruppe per knapp (sortert på knapp og retning, med «Trykk»/«Hold»), «Til faste tider» (sortert gjennom døgnet) og «Når noe skjer».

## 0.7.0

- Ny sensor i Home Assistant: `sensor.hybel_leietaker_venter` viser hvor mange meldinger, svar og sjekklister fra leietaker som venter på deg (0 når alt er besvart). Kan brukes til et kort i dashbordet som bare vises når noe venter.

## 0.6.4

- Scener er tonet ned: vises som en kompakt liste, og fanen ligger etter Lys og Klima. Appen åpner på Lys.

## 0.6.3

- Husleien avregnes per dag når leieforholdet starter etter den 1. eller slutter før månedsslutt, og det vises hvordan beløpet er regnet ut.
- Husleie vises og lagres uten øre.

## 0.6.2

- Åpne sider (også appen på Hjem-skjermen) laster seg automatisk inn på nytt når appen er oppdatert, så nye funksjoner vises uten å lukke appen.
- Første husleie forfaller på innflyttingsdagen når den er etter vanlig forfallsdag.

## 0.6.1

- «Send testvarsel» under «Varsle meg» på utleiersiden viser om varselet kom fram til telefonen og til bjella i Home Assistant.
- Loggen viser nå om hvert varsel ble levert eller feilet, og en oppsummering av oppsettet ved oppstart.

## 0.6.0

- **Leieforhold**: husleie, forfallsdag, kontonummer, depositum, innflytting, kontraktsslutt, oppsigelsestid og hva som er inkludert – settes på utleiersiden.
- Leietaker får fanen **Leie** (tidligere Strøm) med neste betaling (husleie + strøm på etterskudd), betalingshistorikk, nedtelling til kontraktsslutt og frist for oppsigelse.
- Utleier markerer måneder som betalt; strømperiodene i måneden følger med.
- Påminnelse til leietaker før forfall, og varsel til begge 90 og 30 dager før kontrakten utløper.
- Valgfri **automatisk strømavlesning** fra en kWh-måler i Home Assistant siste dag i måneden.

## 0.5.1

- Sjekklisten kan lastes ned som **PDF** med alle merknader, bilder, tidspunkter og hvem som sendte inn, pluss et fingeravtrykk av innholdet.
- Leietaker kan sende PDF-en fra **sin egen e-post** til utleiers e-postadresse (fra Info-innstillingene): på mobil via deling til e-postappen, på PC lastes filen ned og e-postprogrammet åpnes med mottaker og emne.
- Utleier kan laste ned PDF-en fra utleiersiden.
- Leietaker kan bla mellom tidligere sjekklister.

## 0.5.0

- **Inn- og utflyttingssjekkliste**: utleier sender sjekklisten fra utleiersiden, leietaker går gjennom rom for rom og merker OK eller skriver merknad med bilder. Utleier får varsel, kan godkjenne med kommentar, åpne for endringer og skrive ut. Punktene kan redigeres.
- **Meldinger fra utleier**: utleier kan skrive til leietaker fra utleiersiden, og leietaker kan svare.
- **Pushvarsler til leietaker** (Web Push, uten tredjepartstjenester): ved meldinger, svar, statusendringer, sjekklister og påminnelse om strømavlesning i slutten av måneden. På iPhone må appen ligge på Hjem-skjermen.
- Bilder kan legges ved meldinger til utleier.
- «Klargjør for ny leietaker» fjerner også forrige leietakers varselabonnementer og arkiverer sjekklister.

## 0.4.3

- Utleiersiden: alle seksjoner kan felles sammen og ut. Valget huskes; meldinger fra leietaker åpnes automatisk når noe venter.

## 0.4.2

- Utleier kan legge inn **startavlesning** av strømmen før innflytting (og egne avlesninger senere, f.eks. ved utflytting). Første periode regnes fra startavlesningen, og leietaker ser at den er lagt inn av utleier.

## 0.4.1

- Nye meldinger, svar fra leietaker og strømavlesninger havner nå alltid som varsel i Home Assistant (bjella), også når push til telefon er satt opp.
- Varselet forsvinner av seg selv når du setter status på meldingen eller markerer strømmen som betalt.
- Hendelsen `hybel_varsel` (type `melding`, `svar` eller `strom`) fyres, så du kan lage egne automasjoner på den.

## 0.4.0

- Ny fane **Info** for leietaker: wifi med QR-kode, kontakt til utleier, status fra røykvarslere/sensorer, søppel, husregler og nødinfo.
- **Strøm**: leietaker leser av måleren, får kWh, beløp og forbruk per periode. Fast kWh-pris settes på utleiersiden; utleier markerer perioder som betalt.
- **Meld fra**: leietaker sender melding om feil (f.eks. tett avløp) med kategori og «haster». Utleier får varsel, kan sette status og svare.
- Lys kan holdes utenfor «Slå av alle» (f.eks. utelys).

## 0.3.5

- «Nå»-temperaturen for termostater og varmepumper kan hentes fra en valgfri føler (f.eks. gulvføleren) – velges på utleiersiden.

## 0.3.4

- Dimming ved hold går raskere: ett trinn hvert kvarte sekund.

## 0.3.3

- Ny automasjonshandling **«Dim lys»**: lysere eller mørkere i trinn på 5, 10 eller 20 %. Koblet til «hold» på en knapp fortsetter dimmingen til knappen slippes (maks 8 sek).

## 0.3.2

- **Trådløse knapper** (event-entiteter, f.eks. Namron-fjernkontroll) kan legges til på utleiersiden og brukes som utløser i leietakerens automasjoner: velg knapp og trykk/hold, eventuelt bare i et tidsrom.

## 0.3.1

- Nettleseren henter alltid nyeste versjon av siden etter en oppdatering (unngår at siden blir stående på «Kobler til huset»).
- Får siden ikke kontakt innen 15 sekunder, vises en «Last inn på nytt»-knapp. Eventuelle visningsfeil vises i stedet for en tom side.

## 0.3.0

- **Faner** nederst: Scener, Lys, Klima og Automasjoner. Siste fane huskes.
- Scener vises som kort med oppsummering, og kan redigeres med blyant-knappen.
- **Rekkefølge**: leietakeren kan flytte enheter og scener under Innstillinger.
- **Varmepumpe / klimaenhet**: ny enhetstype med av/på, modus (varme, kjøling, auto, tørk, vifte), temperatur og viftehastighet. Kan brukes i scener og automasjoner. Gjenkjennes automatisk når du legger den til.
- **Temperaturgrenser per enhet** (f.eks. gulvvarme 15–28°, varmepumpe 16–24°).
- **Flere automasjonsvalg**: utløs når et lys slås på/av eller når luftfuktigheten går over en grense, eventuelt bare i et tidsrom. Handlingen kan være en scene, «slå av alle lys» eller valgfrie enheter. «Gjør om etter» setter alt tilbake etter valgt tid. «Test nå»-knapp.

## 0.2.1

- Lysområde per lys: utleier setter laveste og høyeste ekte lysstyrke (f.eks. 21–50 %). Leietakeren ser fortsatt 1–100 %, som strekkes over området.

## 0.2.0

- **Egendefinerte scener**: leietakeren lager egne scener (f.eks. Matlaging, Dusj, Kos, Lesestund) med navn og ikon, og velger selv hva hver scene styrer – bare lys, lys og varme, eller lys, varme og ventilasjon. Det som ikke er med, blir som det er.
- Forslag til scener lages automatisk. De gamle faste scenene (Hjemme/Kveld/Natt/Borte) er erstattet.
- **Automasjoner**: kjør en scene, slå av alle lys eller sett varmen på et klokkeslett, ved solnedgang eller soloppgang (med forskyvning), valgte dager.
- Høy ventilasjon går også tilbake av seg selv når en scene slår den på.
- **Retting**: appen kunne bli hengende uten kontakt med Home Assistant etter en omstart. Nå har oppkoblingen tidsavbrudd, livstegn-sjekk hvert 30. sekund og prøver på nytt hvis innloggingen avvises.
- Utleiersiden viser leietakerens scener og automasjoner, med «Bruk nå» og tilbakestilling til forslag.

## 0.1.4

- Zoom er sperret på leietakersiden (kniping og dobbelttrykk), så den oppfører seg som en app.

## 0.1.3

- Temperatur stilles i hele grader. Termostaten svarte med søppelverdier (f.eks. -2713) på halve grader; slike verdier filtreres nå bort.
- Fjernet «Midlertidig endret»-boksen på forsiden.
- Mer kompakte scenevalg.

## 0.1.2

- Gamle bokmerker og ukjente adresser sendes til forsiden i stedet for «Ikke funnet».
- Ikoner for hjemskjerm (iPhone/Android) og favicon.

## 0.1.1

- Retting: appen startet ikke fordi tilgangsnøkkelen til Home Assistant ikke ble sendt videre av s6-overlay.

## 0.1.0

- Første versjon.
- Leietakerside med scener (Hjemme, Kveld, Natt, Borte), lys, gulvvarme og ventilasjon med live-oppdatering.
- Midlertidige endringer med «Tilbake til scene» og «Lagre som standard».
- Utleierside i Home Assistant: synlige enheter, navn, grenser, scenestandarder, varsler og leietakerbytte.
- Cloudflare Access-verifisering på leietakersiden.
- Tidsbegrenset høy ventilasjon og nattlig nullstilling.
