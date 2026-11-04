import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HAClient } from './ha.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { startTenantServer } from './tenant-server.js';
import { startAdminServer } from './admin-server.js';
import { log, setLevel } from './log.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || '/data';

let options = {};
try {
  options = JSON.parse(readFileSync(join(dataDir, 'options.json'), 'utf8'));
} catch {
  log.warn('Fant ingen options.json – bruker standardverdier.');
}
setLevel(options.log_level || 'info');

function readToken() {
  if (process.env.SUPERVISOR_TOKEN) return process.env.SUPERVISOR_TOKEN;
  if (process.env.HA_TOKEN) return process.env.HA_TOKEN;
  // Reserve: s6-overlay lagrer miljøet her når det ikke sendes videre.
  for (const f of ['/run/s6/container_environment/SUPERVISOR_TOKEN', '/var/run/s6/container_environment/SUPERVISOR_TOKEN']) {
    try { return readFileSync(f, 'utf8').trim(); } catch {}
  }
  return null;
}
const token = readToken();
if (!token) {
  log.error('Mangler tilgang til Home Assistant (SUPERVISOR_TOKEN). Er "homeassistant_api: true" satt?');
  process.exit(1);
}

const ha = new HAClient({ url: process.env.HA_WS_URL || 'ws://supervisor/core/websocket', token });
const store = new Store(dataDir);
const engine = new Engine({ ha, store });
const webRoot = process.env.WEB_ROOT || join(here, '..', 'web');

const { hub } = startTenantServer({ engine, options, webRoot, port: Number(process.env.TENANT_PORT || 8100) });
startAdminServer({ engine, ha, webRoot, port: Number(process.env.ADMIN_PORT || 8099), tenantHub: hub, devOpen: process.env.DEV_ADMIN_OPEN === '1' });
ha.start();
{
  const d = store.data;
  log.info(`Oppsett: varsling=${d.alerts?.notify_service || 'kun bjella i Home Assistant'}, husleie=${d.lease?.rent ?? 'ikke satt'}, kontrakt=${d.lease?.start || '–'}→${d.lease?.end || '–'}, meldinger=${(d.reports || []).length}, avlesninger=${(d.readings || []).length}, varsel-enheter leietaker=${(d.push_subs || []).length}`);
}

const shutdown = () => {
  store.flush();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
