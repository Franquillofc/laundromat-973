// Netlify Function — FasCard API Proxy
// Laundromat 973 · F2274
// Server-side proxy to bypass browser CORS restrictions.

const https = require('https');
const FASCARD_BASE = 'm.fascard.com';

function httpsRequest(options, body) {
  return new Promise(function(resolve, reject) {
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try { resolve({ status: res.statusCode, body: JSON.parse(data), raw: data }); }
        catch(e) { resolve({ status: res.statusCode, body: data, raw: data }); }
      });
    });
    req.on('error', reject);
    if(body) req.write(body);
    req.end();
  });
}

exports.handler = async function(event, context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if(event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};
    const action = params.action;

    if(!action) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing action parameter' }) };
    }

    // ── AUTH ──────────────────────────────────────────────────────────────
    if(action === 'auth') {
      let body;
      try { body = JSON.parse(event.body || '{}'); } catch(e) { body = {}; }
      const { email, password } = body;
      if(!email || !password) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing email or password' }) };
      }
      const payload = JSON.stringify({ UserName: email, Password: password });
      const options = {
        hostname: FASCARD_BASE,
        path: '/api/AuthToken',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };
      const result = await httpsRequest(options, payload);
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    // ── TOKEN CHECK ───────────────────────────────────────────────────────
    const token = (event.headers['authorization'] || '').replace('Bearer ', '');
    if(!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'No authorization token' }) };
    }
    const authHeaders = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // ── MACHINE HISTORY ───────────────────────────────────────────────────
    if(action === 'machine_history') {
      const machId = params.machId;
      const minDT  = params.minDT || '';
      const maxDT  = params.maxDT || '';
      const limit  = params.limit || '200';
      if(!machId) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing machId' }) };
      }
      let path = '/api/Machine/' + machId + '/History?Limit=' + limit;
      if(minDT) path += '&MinDateTime=' + encodeURIComponent(minDT);
      if(maxDT) path += '&MaxDateTime=' + encodeURIComponent(maxDT);
      const options = { hostname: FASCARD_BASE, path, method: 'GET', headers: authHeaders };
      const result = await httpsRequest(options, null);
      // Return both parsed body AND raw string so dashboard can inspect format
      return { statusCode: result.status, headers,
        body: JSON.stringify({ data: result.body, raw: result.raw.slice(0, 2000) }) };
    }

    // ── DIAGNOSTIC — raw response for one machine ─────────────────────────
    if(action === 'diagnose') {
      const machId = params.machId || '1';
      const locId  = params.locId  || '4661';
      // Try multiple endpoints to see which ones return data
      const endpoints = [
        '/api/Machine/' + machId + '/History?Limit=5',
        '/api/Transactions?LocationID=' + locId + '&Limit=5',
        '/api/Machine/' + machId,
      ];
      const results = {};
      for(const ep of endpoints) {
        try {
          const opts = { hostname: FASCARD_BASE, path: ep, method: 'GET', headers: authHeaders };
          const r = await httpsRequest(opts, null);
          results[ep] = { status: r.status, sample: r.raw.slice(0, 500) };
        } catch(e) {
          results[ep] = { error: e.message };
        }
      }
      return { statusCode: 200, headers, body: JSON.stringify(results) };
    }

    // ── MACHINE STATUS ────────────────────────────────────────────────────
    if(action === 'machine_status') {
      const locId = params.locId || '4661';
      const path = '/api/Machine?LocationID=' + locId + '&Limit=50';
      const options = { hostname: FASCARD_BASE, path, method: 'GET', headers: authHeaders };
      const result = await httpsRequest(options, null);
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    // ── TRANSACTIONS ──────────────────────────────────────────────────────
    if(action === 'transactions') {
      const locId  = params.locId || '4661';
      const minDT  = params.minDT || '';
      const maxDT  = params.maxDT || '';
      const limit  = params.limit || '500';
      let path = '/api/Transactions?LocationID=' + locId + '&Limit=' + limit;
      if(minDT) path += '&MinDateTime=' + encodeURIComponent(minDT);
      if(maxDT) path += '&MaxDateTime=' + encodeURIComponent(maxDT);
      const options = { hostname: FASCARD_BASE, path, method: 'GET', headers: authHeaders };
      const result = await httpsRequest(options, null);
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    // ── SYSTEM STATS ──────────────────────────────────────────────────────
    if(action === 'system_stats') {
      const path = '/api/SysStats?Types=Turns,Revenue';
      const options = { hostname: FASCARD_BASE, path, method: 'GET', headers: authHeaders };
      const result = await httpsRequest(options, null);
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Proxy error: ' + err.message }) };
  }
};
