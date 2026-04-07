// Netlify Function — FasCard API Proxy
// Laundromat 973 · F2274
// Confirmed internal machine IDs from diagnostic 2026-04-06

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
      const opts = {
        hostname: FASCARD_BASE, path: '/api/AuthToken', method: 'POST',
        headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(payload) }
      };
      const r = await httpsRequest(opts, payload);
      return { statusCode: r.status, headers, body: JSON.stringify(r.body) };
    }

    const token = (event.headers['authorization']||'').replace('Bearer ','');
    if(!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'No token' }) };
    const authH = { 'Authorization': 'Bearer '+token, 'Content-Type': 'application/json' };

    // ── MACHINES LIST — live status + FinishTime for all 20 machines ──────
    if(action === 'machines_list') {
      const locId = params.locId || '4661';
      const r = await httpsRequest({
        hostname: FASCARD_BASE,
        path: '/api/Machine?LocationID='+locId+'&Limit=50',
        method: 'GET', headers: authH
      }, null);
      return { statusCode: r.status, headers, body: JSON.stringify(r.body) };
    }

    // ── SYSSTATS — turns + revenue totals (works with current permissions) ─
    if(action === 'system_stats') {
      const types  = params.types  || 'Turns,Revenue';
      const minDT  = params.minDT  || '';
      const maxDT  = params.maxDT  || '';
      let path = '/api/SysStats?Types=' + encodeURIComponent(types);
      if(minDT) path += '&MinDateTime=' + encodeURIComponent(minDT);
      if(maxDT) path += '&MaxDateTime=' + encodeURIComponent(maxDT);
      const r = await httpsRequest({ hostname: FASCARD_BASE, path, method: 'GET', headers: authH }, null);
      return { statusCode: r.status, headers, body: JSON.stringify({ data: r.body, raw: r.raw.slice(0,2000), status: r.status }) };
    }

    // ── MACHINE STATUS — kept for completeness ────────────────────────────
    if(action === 'machine_status') {
      const r = await httpsRequest({
        hostname: FASCARD_BASE,
        path: '/api/Machine?LocationID=4661&Limit=50',
        method: 'GET', headers: authH
      }, null);
      return { statusCode: r.status, headers, body: JSON.stringify(r.body) };
    }

    // ── DIAGNOSTIC ────────────────────────────────────────────────────────
    if(action === 'diagnose') {
      const endpoints = [
        '/api/SysStats?Types=Turns,Revenue',
        '/api/SysStats?Types=Turns',
        '/api/SysStats?Types=Revenue',
        '/api/Machine?LocationID=4661&Limit=3',
      ];
      const results = {};
      for(const ep of endpoints) {
        try {
          const r = await httpsRequest({ hostname: FASCARD_BASE, path: ep, method: 'GET', headers: authH }, null);
          results[ep] = { status: r.status, sample: r.raw.slice(0, 600) };
        } catch(e) { results[ep] = { error: e.message }; }
      }
      return { statusCode: 200, headers, body: JSON.stringify(results) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: '+action }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Proxy error: '+err.message }) };
  }
};
