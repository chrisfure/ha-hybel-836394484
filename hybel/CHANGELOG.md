# Endringslogg

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
