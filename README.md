# Husapper for Home Assistant

To Home Assistant-apper uten eksterne avhengigheter (kun Node.js 22+ fra Alpine):

| App | Hva | Nås via |
|---|---|---|
| [**Hybelstyring**](hybel/DOCS.md) | Scener, lys, gulvvarme og ventilasjon for en hybel | Eget domene via Cloudflare Tunnel og Access |
| [**Gjestesiden**](gjest/DOCS.md) | Lys, farger, varme og radio for gjester | Kun hjemmenettet (port 8200) |

All administrasjon skjer i sidemenyen i Home Assistant. Personlige verdier lagres i appenes `/data`, aldri i koden.

## Utvikling

```bash
./tools/dev.sh        # Hybelstyring  – leietaker :8100, utleier :8099
./tools/dev-gjest.sh  # Gjestesiden   – gjest :8200, oppsett :8099
```

Begge starter en falsk Home Assistant (`tools/mock-ha.mjs`).
