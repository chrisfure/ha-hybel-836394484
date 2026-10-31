# Hybelstyring for Home Assistant

En Home Assistant-app som gir en hybel sin egen, enkle og raske styringsside på eget domene, mens all administrasjon skjer i Home Assistant.

- **Leietakersiden** – scener, lys, gulvvarme og ventilasjon. Nås via Cloudflare Tunnel og Cloudflare Access.
- **Utleiersiden** – i sidemenyen i Home Assistant. Velg enheter, sett grenser, rediger scener og varsler.

Ingen eksterne avhengigheter: kun Node.js 22+ fra Alpine.

Se [hybel/DOCS.md](hybel/DOCS.md) for installasjon og oppsett av Cloudflare.

## Utvikling

```bash
./tools/dev.sh   # starter en falsk Home Assistant og appen
# Leietaker: http://localhost:8100   Utleier: http://localhost:8099
```
