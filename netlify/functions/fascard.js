// Netlify Function — FasCard API Proxy
// Laundromat 973 · F2274

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

  if(event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const params = event.queryStringParameters || {};
    const action = params.action;
    if(!action) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing action' }) };

    // ── AUTH ──────────────────────────────────────────────────────────────
    if(action === 'auth') {
      let b; try { b = JSON.parse(event.body||'{}'); } catch(e) { b={}; }
      const payload = JSON.stringify({ UserName: b.email, Password: b.password });
      const opts = { hostname: FASCARD_BASE, path: '/api/AuthToken', method: 'POST',
        headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) } };
      const r = await httpsRequest(opts, payload);
      return { statusCode: r.status, headers, body: JSON.stringify(r.body) };
    }

    const token = (event.headers['authorization']||'').replace('Bearer ','');
    if(!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token' }) };
    const authH = { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' };

    // ── GET MACHINES LIST — returns true internal IDs ─────────────────────
    if(action === 'machines_list') {
      const locId = params.locId || '4661';
      const path = '/api/Machine?LocationID=' + locId + '&Limit=50';
      const r = await httpsRequest({ hostname: FASCARD_BASE, path, method: 'GET', headers: authH }, null);
      return { statusCode: r.status, headers, body: JSON.stringify({ data: r.body, raw: r.raw.slice(0,3000) }) };
    }

    // ── MACHINE HISTORY by internal ID ────────────────────────────────────
    if(action === 'machine_history') {
      const machId = params.machId;
      const minDT  = params.minDT || '';
      const maxDT  = params.maxDT || '';
      const limit  = params.limit || '500';
      let path = '/api/Machine/' + machId + '/History?Limit=' + limit;
      if(minDT) path += '&MinDateTime=' + encodeURIComponent(minDT);
      if(maxDT) path += '&MaxDateTime=' + encodeURIComponent(maxDT);
      const r = await httpsRequest({ hostname: FASCARD_BASE, path, method: 'GET', headers: authH }, null);
      return { statusCode: r.status, headers, body: JSON.stringify({ data: r.body, raw: r.raw.slice(0,2000), status: r.status }) };
    }

    // ── DIAGNOSTIC — explores multiple endpoints ───────────────────────────
    if(action === 'diagnose') {
      const locId = params.locId || '4661';
      const endpoints = [
        '/api/Machine?LocationID=' + locId + '&Limit=5',
        '/api/Location/' + locId,
        '/api/Location',
        '/api/Account',
      ];
      const results = {};
      for(const ep of endpoints) {
        try {
          const r = await httpsRequest({ hostname: FASCARD_BASE, path: ep, method: 'GET', headers: authH }, null);
          results[ep] = { status: r.status, sample: r.raw.slice(0, 800) };
        } catch(e) { results[ep] = { error: e.message }; }
      }
      return { statusCode: 200, headers, body: JSON.stringify(results) };
    }

    // ── MACHINE STATUS ────────────────────────────────────────────────────
    if(action === 'machine_status') {
      const locId = params.locId || '4661';
      const r = await httpsRequest({ hostname: FASCARD_BASE,
        path: '/api/Machine?LocationID='+locId+'&Limit=50', method: 'GET', headers: authH }, null);
      return { statusCode: r.status, headers, body: JSON.stringify(r.body) };
    }

    // ── SYSTEM STATS ──────────────────────────────────────────────────────
    if(action === 'system_stats') {
      const r = await httpsRequest({ hostname: FASCARD_BASE,
        path: '/api/SysStats?Types=Turns,Revenue', method: 'GET', headers: authH }, null);
      return { statusCode: r.status, headers, body: JSON.stringify(r.body) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: '+action }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Proxy error: '+err.message }) };
  }
};
