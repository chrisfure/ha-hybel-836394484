ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.22
FROM ${BUILD_FROM}

# Node 22+ gir innebygd WebSocket-klient – ingen npm-avhengigheter trengs.
RUN apk add --no-cache nodejs

WORKDIR /app
COPY server/ /app/server/
COPY web/ /app/web/

ENV NODE_ENV=production
# Kjør Node direkte (ikke via s6-overlay), slik at SUPERVISOR_TOKEN fra miljøet er tilgjengelig.
ENTRYPOINT []
CMD ["node", "/app/server/main.js"]
