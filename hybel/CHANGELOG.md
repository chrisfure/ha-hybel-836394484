# Endringslogg

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
