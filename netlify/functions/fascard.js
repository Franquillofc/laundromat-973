// Netlify Function — FasCard API Proxy
// Laundromat 973 · F2274
// This function runs on Netlify's server, not in the browser.
// It forwards requests to FasCard's API, bypassing browser CORS restrictions.
// Credentials are passed from the dashboard and never stored on this server.

const https = require('https');

const FASCARD_BASE = 'm.fascard.com';

function httpsRequest(options, body) {
  return new Promise(function(resolve, reject) {
    const req = https.request(options, function(res) {
      let data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch(e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if(body) req.write(body);
    req.end();
  });
}

exports.handler = async function(event, context) {
  // CORS headers — allow requests from any origin (our dashboard)
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight OPTIONS request
  if(event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const params = event.queryStringParameters || {};
    const action = params.action;

    if(!action) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing action parameter' }) };
    }

    // ── ACTION: auth — get Bearer Token ──────────────────────────────────
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
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      };
      const result = await httpsRequest(options, payload);
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    // ── All other actions require a Bearer token ──────────────────────────
    const token = (event.headers['authorization'] || '').replace('Bearer ', '');
    if(!token) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'No authorization token provided' }) };
    }

    const authHeaders = {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    };

    // ── ACTION: machine_history — get cycles for a specific machine ────────
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
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    // ── ACTION: machine_status — get live status of all machines ──────────
    if(action === 'machine_status') {
      const locId = params.locId || '4661';
      const path = '/api/Machine?LocationID=' + locId + '&Limit=50';
      const options = { hostname: FASCARD_BASE, path, method: 'GET', headers: authHeaders };
      const result = await httpsRequest(options, null);
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    // ── ACTION: transactions — get revenue transactions ───────────────────
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

    // ── ACTION: system_stats — get summary statistics ─────────────────────
    if(action === 'system_stats') {
      const path = '/api/SysStats?Types=Turns,Revenue';
      const options = { hostname: FASCARD_BASE, path, method: 'GET', headers: authHeaders };
      const result = await httpsRequest(options, null);
      return { statusCode: result.status, headers, body: JSON.stringify(result.body) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };

  } catch(err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Proxy error: ' + err.message })
    };
  }
};
