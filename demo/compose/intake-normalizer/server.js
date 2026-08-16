// Copyright The OpenTelemetry Authors
// SPDX-License-Identifier: Apache-2.0
//
// Intake Normalizer (Demo Profile). Receives the Alertmanager webhook and
// turns each alert into a versioned IncidentTrigger v1, then POSTs it to the
// Control Plane. Key derivation follows docs/research/incident-intake.md:
//
//   incident_key = sha256(tenant_id | environment | service_name | detector_key)
//   delivery_key = sha256(source | alert_fingerprint | status | starts_at | ends_at)
//
// The full Normalizer (signing, schema enforcement, exemplar query) is owned by
// the Control Plane build slice (issue #20); this path is the local stand-in
// that emits the trigger shape the Control Plane accepts.
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 9095);
const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL || 'http://control-plane:8080';

const SOURCE = 'prometheus-alertmanager';
const CONNECTION_ID = 'astronomy-shop-local';

function sha256(parts) {
  return 'sha256:' + crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function buildTrigger(alert) {
  const labels = alert.labels || {};
  const annotations = alert.annotations || {};
  const startsAt = alert.startsAt || new Date().toISOString();
  const endsAt = alert.endsAt || null;

  const tenantId = labels.tenant_id || 'demo';
  const environment = labels.deployment_environment_name || 'demo';
  const serviceName = labels.service_name || 'unknown';
  const detectorKey = labels.detector_key || 'unknown';
  const status = alert.status || 'firing';

  const incidentKey = sha256([tenantId, environment, serviceName, detectorKey]);
  const deliveryKey = sha256([SOURCE, alert.fingerprint || '', status, startsAt, endsAt || '']);

  return {
    schema_version: '1.0',
    trigger_id: crypto.randomUUID(),
    delivery_key: deliveryKey,
    incident_key: incidentKey,
    received_at: new Date().toISOString(),
    detector: {
      source: SOURCE,
      connection_id: CONNECTION_ID,
      rule_id: detectorKey,
      rule_version: labels.rule_version || null,
      source_fingerprint: alert.fingerprint || null,
    },
    state: status,
    severity: labels.severity || null,
    scope: {
      tenant_id: tenantId,
      deployment_environment_name: environment,
      service_name: serviceName,
    },
    window: {
      starts_at: startsAt,
      ends_at: endsAt,
      lookback_seconds: 120,
    },
    signal_summary: {
      name: 'payment error ratio',
      value: null,
      unit: '1',
      threshold: 0.2,
    },
    annotations: {
      summary: annotations.summary || null,
    },
    evidence_refs: [],
  };
}

function forward(trigger) {
  const body = JSON.stringify(trigger);
  const url = new URL(CONTROL_PLANE_URL + '/v1/incident-triggers');
  const req = http.request(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
    res => {
      console.log(`[intake-normalizer] control-plane ${res.statusCode} for ${trigger.incident_key} (${trigger.state})`);
      res.resume();
    }
  );
  req.on('error', err => console.error(`[intake-normalizer] control-plane error: ${err.message}`));
  req.write(body);
  req.end();
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (req.method === 'POST' && req.url === '/webhook') {
    let raw = '';
    req.on('data', chunk => (raw += chunk));
    req.on('end', () => {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        res.writeHead(400);
        res.end('bad json');
        return;
      }
      const alerts = payload.alerts || [];
      console.log(`[intake-normalizer] received ${alerts.length} alert(s)`);
      for (const alert of alerts) {
        const trigger = buildTrigger(alert);
        console.log(`[intake-normalizer] trigger incident_key=${trigger.incident_key} delivery_key=${trigger.delivery_key}`);
        forward(trigger);
      }
      res.writeHead(200);
      res.end('accepted');
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`[intake-normalizer] listening on :${PORT}, control-plane=${CONTROL_PLANE_URL}`));
