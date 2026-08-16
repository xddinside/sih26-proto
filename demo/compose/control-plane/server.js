// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
//
// Local Control Plane endpoint stub (Demo Profile). Returns 200 OK and logs
// received Incident Triggers. The real Control Plane (state machine, journal,
// dedup, gates) is issue #20; this stub keeps the intake path intact.
const http = require('http');

const PORT = Number(process.env.PORT || 8080);

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/healthz' || req.url === '/')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'POST' && req.url === '/v1/incident-triggers') {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      let trigger;
      try {
        trigger = JSON.parse(raw);
      } catch {
        trigger = { error: 'unparseable' };
      }
      console.log(
        `[control-plane] received trigger incident_key=${trigger.incident_key || '?'} ` +
        `delivery_key=${trigger.delivery_key || '?'} state=${trigger.state || '?'}`
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'accepted' }));
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`[control-plane] stub listening on :${PORT}`));
