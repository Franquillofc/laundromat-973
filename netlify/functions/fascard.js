// Netlify Function — FasCard API Proxy
// Laundromat 973 · F2274
// Confirmed internal machine IDs from diagnostic 2026-04-06

const https = require('https');
const FASCARD_BASE = 'm.fascard.com';

// Confirmed mapping: MachNo -> Internal ID
const MACH_ID_MAP = {
  1:91029, 2:91030, 3:91031, 4:91032, 5:91033,
  6:91034, 7:91035, 8:91036, 9:91039, 10:91038,
  22:91580, 23:91581, 24:91582, 25:91583,
  26:91584, 27:91585, 28:91586, 29:91587,
  31:91780, 33:91781
};

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

// Try multiple endpoint variants for a given machine internal ID
async function fetchMachineTransactions(internalId, minDT, maxDT, limit, authHeaders) {
  const endpoints = [
    '/api/Machine/' + internalId + '/SalesHistory?Limit=' + limit
      + (minDT ? '&MinDateTime=' + encodeURIComponent(minDT) : '')
      + (maxDT ? '&MaxDateTime=' + encodeURIComponent(maxDT) : ''),
    '/api/Machine/' + internalId + '/Transactions?Limit=' + limit
      + (minDT ? '&MinDateTime=' + encodeURIComponent(minDT) : '')
      + (maxDT ? '&MaxDateTime=' + encodeURIComponent(maxDT) : ''),
    '/api/MachineHistory?MachineID=' + internalId + '&Limit=' + limit
      + (minDT ? '&MinDateTime=' + encodeURIComponent(minDT) : '')
      + (maxDT ? '&MaxDateTime=' + encodeURIComponent(maxDT) : ''),
  ];

  for(const path of endpoints) {
    try {
      const r = await httpsRequest({ hostname: FASCARD_BASE, path, method: 'GET', headers: authHeaders }, null);
      // Return first endpoint that gives a non-403/non-500 response
      if(r.status === 200) return { path, status: r.status, body: r.body, raw: r.raw };
      if(r.status !== 403 && r.status !== 404 && r.status !== 500) {
        return { path, status: r.status, body: r.body, raw: r.raw };
      }
    } catch(e) { /* try next */ }
  }
  return null;
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

    // ── MACHINES LIST ─────────────────────────────────────────────────────
    if(action === 'machines_list') {
      const locId = params.locId || '4661';
      const r = await httpsRequest({ hostname: FASCARD_BASE,
        path: '/api/Machine?LocationID='+locId+'&Limit=50', method: 'GET', headers: authH }, null);
      return { statusCode: r.status, headers, body: JSON.stringify({ data: r.body, raw: r.raw.slice(0,500) }) };
    }

    // ── MACHINE TRANSACTIONS — uses confirmed internal ID ─────────────────
    if(action === 'machine_history') {
      const machNo = parseInt(params.machId);
      const internalId = MACH_ID_MAP[machNo] || machNo;
      const minDT = params.minDT || '';
      const maxDT = params.maxDT || '';
      const limit = params.limit || '500';

      const result = await fetchMachineTransactions(internalId, minDT, maxDT, limit, authH);
      if(result) {
        return { statusCode: 200, headers,
          body: JSON.stringify({ data: result.body, raw: result.raw.slice(0,1000),
            status: result.status, endpoint: result.path, internalId }) };
      }
      return { statusCode: 200, headers,
        body: JSON.stringify({ data: [], raw: '', status: 0, internalId, note: 'All endpoints returned error' }) };
    }

    // ── SALES HISTORY — batch pull for all machines in date range ─────────
    if(action === 'sales_history') {
      const locId = params.locId || '4661';
      const minDT = params.minDT || '';
      const maxDT = params.maxDT || '';
      const limit = params.limit || '1000';

      // Try location-level sales endpoints
      const locEndpoints = [
        '/api/Sales?LocationID='+locId+'&Limit='+limit
          + (minDT ? '&MinDateTime='+encodeURIComponent(minDT) : '')
          + (maxDT ? '&MaxDateTime='+encodeURIComponent(maxDT) : ''),
        '/api/Transaction?LocationID='+locId+'&Limit='+limit
          + (minDT ? '&MinDateTime='+encodeURIComponent(minDT) : '')
          + (maxDT ? '&MaxDateTime='+encodeURIComponent(maxDT) : ''),
        '/api/MachineHistory?LocationID='+locId+'&Limit='+limit
          + (minDT ? '&MinDateTime='+encodeURIComponent(minDT) : '')
          + (maxDT ? '&MaxDateTime='+encodeURIComponent(maxDT) : ''),
      ];
      const results = {};
      for(const path of locEndpoints) {
        try {
          const r = await httpsRequest({ hostname: FASCARD_BASE, path, method: 'GET', headers: authH }, null);
          results[path] = { status: r.status, sample: r.raw.slice(0, 600) };
          if(r.status === 200) {
            return { statusCode: 200, headers,
              body: JSON.stringify({ data: r.body, endpoint: path, status: r.status }) };
          }
        } catch(e) { results[path] = { error: e.message }; }
      }
      return { statusCode: 200, headers, body: JSON.stringify({ tried: results, note: 'No working endpoint found' }) };
    }

    // ── DIAGNOSTIC ────────────────────────────────────────────────────────
    if(action === 'diagnose') {
      const locId = params.locId || '4661';
      // Test the transaction-related endpoints with known internal ID 91584 (MachNo 26)
      const testId = 91584;
      const endpoints = [
        '/api/Machine/'+testId+'/SalesHistory?Limit=3',
        '/api/Machine/'+testId+'/Transactions?Limit=3',
        '/api/Sales?LocationID='+locId+'&Limit=3',
        '/api/Transaction?LocationID='+locId+'&Limit=3',
        '/api/MachineHistory?LocationID='+locId+'&Limit=3',
        '/api/Machine?LocationID='+locId+'&Limit=3',
      ];
      const results = {};
      for(const ep of endpoints) {
        try {
          const r = await httpsRequest({ hostname: FASCARD_BASE, path: ep, method: 'GET', headers: authH }, null);
          results[ep] = { status: r.status, sample: r.raw.slice(0, 400) };
        } catch(e) { results[ep] = { error: e.message }; }
      }
      return { statusCode: 200, headers, body: JSON.stringify(results) };
    }

    // ── MACHINE STATUS ────────────────────────────────────────────────────
    if(action === 'machine_status') {
      const r = await httpsRequest({ hostname: FASCARD_BASE,
        path: '/api/Machine?LocationID=4661&Limit=50', method: 'GET', headers: authH }, null);
      return { statusCode: r.status, headers, body: JSON.stringify(r.body) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: '+action }) };

  } catch(err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Proxy error: '+err.message }) };
  }
};
