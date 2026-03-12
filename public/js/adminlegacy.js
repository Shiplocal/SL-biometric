// ── LEGACY DATA BROWSER ──────────────────────────────────────
let legacyCurTab = 'all-tables';
let legacyData   = [];
let _legAllTables = [];
let _legCurTable  = null;
let _legPage      = 1;

async function loadLegacyTab() {
  try {
    const t = await fetch('/api/legacy/test').then(r=>r.json());
    const el = document.getElementById('legacy-conn-status');
    if (t.connected) {
      el.textContent = `✅ Live DB — ${t.stores} stations · ${t.ics} ICs · ${t.users} users`;
      el.style.background = 'var(--green-bg)'; el.style.color = 'var(--green-d)';
    } else {
      el.textContent = '❌ Cannot connect to legacy DB';
      el.style.background = 'var(--red-bg)'; el.style.color = 'var(--red-d)';
    }
  } catch(e) {}

  // Show sync button if not already present
  if (!document.getElementById('btn-legacy-sync')) {
    const hd = document.querySelector('#t-legacy .pc-hd > div:last-child');
    if (hd) {
      const btn = document.createElement('button');
      btn.id = 'btn-legacy-sync';
      btn.className = 'btn btn-primary btn-sm';
      btn.textContent = '⬇ Sync Legacy → Local';
      btn.onclick = runLegacySync;
      hd.insertBefore(btn, hd.firstChild);
    }
  }

  legacySubTab(legacyCurTab);
}

async function runLegacySync() {
  const btn = document.getElementById('btn-legacy-sync');
  const statusEl = document.getElementById('legacy-conn-status');
  btn.disabled = true; btn.textContent = 'Syncing…';
  statusEl.textContent = 'Copying stations, staff, config_whic from legacy…';
  statusEl.style.background = 'var(--amber-bg)'; statusEl.style.color = 'var(--amber-d)';
  try {
    const d = await fetch('/api/admin/legacy-sync', {method:'POST'}).then(r=>r.json());
    if (d.success) {
      statusEl.textContent = `✅ Sync done — ${d.stations} stations · ${d.staff} staff · ${d.config_whic} ICs updated${d.errors.length?' · '+d.errors.length+' errors':''}`;
      statusEl.style.background = 'var(--green-bg)'; statusEl.style.color = 'var(--green-d)';
      if (d.errors.length) {
        console.warn('Sync errors:', d.errors);
        const sample = d.errors.slice(0,5).join(' | ');
        statusEl.textContent += ' — Sample errors: ' + sample;
      }
      toast(`Legacy sync complete — ${d.config_whic} ICs, ${d.stations} stations`, 'success');
    } else {
      statusEl.textContent = '❌ Sync failed: ' + d.error;
      statusEl.style.background = 'var(--red-bg)'; statusEl.style.color = 'var(--red-d)';
      toast('Sync failed: ' + d.error, 'error');
    }
  } catch(e) {
    statusEl.textContent = '❌ Sync error: ' + e.message;
    toast('Sync error: ' + e.message, 'error');
  }
  btn.disabled = false; btn.textContent = '⬇ Sync Legacy → Local';
}

function legacySubTab(tab) {
  legacyCurTab = tab;
  ['all-tables','stations','ics','users','debit','advances','salary','leaves','managers'].forEach(t => {
    const el = document.getElementById('leg-t-'+t);
    if (el) el.classList.toggle('active', t===tab);
  });
  if (tab === 'all-tables') {
    _legRenderAllTablesPanel();
  } else {
    legacySubTabRefresh();
  }
}

// ── ALL-TABLES PANEL ─────────────────────────────────────────
async function _legRenderAllTablesPanel() {
  const head = document.getElementById('leg-head');
  const body = document.getElementById('leg-body');
  head.innerHTML = '';
  body.innerHTML = '';

  // Replace the table area with our custom two-pane layout
  const tblWrap = document.querySelector('#t-legacy .tbl-wrap');
  if (!tblWrap) return;

  tblWrap.style.maxHeight = 'none';
  tblWrap.style.overflowY = 'visible';
  tblWrap.innerHTML = `
    <div id="leg-all-wrap" style="display:flex;gap:0;min-height:500px">
      <!-- Left: table list -->
      <div id="leg-table-list" style="width:220px;flex-shrink:0;border-right:1px solid var(--border);overflow-y:auto;max-height:65vh">
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:.75rem;font-weight:700;color:var(--text-3);text-transform:uppercase;letter-spacing:.06em">L-Tables</div>
          <button onclick="_legSyncTables()" id="leg-sync-btn"
            style="font-size:.7rem;padding:3px 9px;border:1px solid var(--amber);border-radius:6px;background:var(--amber-bg);color:var(--amber-d);cursor:pointer;font-weight:600">
            ↻ Sync
          </button>
        </div>
        <div id="leg-table-list-body" style="padding:4px 0">
          <div style="padding:12px;text-align:center;color:var(--text-3);font-size:.8rem">Loading…</div>
        </div>
      </div>
      <!-- Right: table browser -->
      <div id="leg-table-browser" style="flex:1;overflow:hidden;display:flex;flex-direction:column">
        <div id="leg-browser-toolbar" style="padding:8px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span id="leg-browser-title" style="font-size:.85rem;font-weight:700;color:var(--navy);font-family:'DM Mono',monospace">← Select a table</span>
          <input type="text" id="leg-browser-search" placeholder="Search…" oninput="_legBrowserSearch()"
            style="padding:5px 10px;font-size:.8rem;border:1.5px solid var(--border);border-radius:8px;width:200px;margin-left:auto">
          <span id="leg-browser-count" style="font-size:.75rem;color:var(--text-3)"></span>
        </div>
        <div id="leg-browser-content" style="flex:1;overflow:auto;max-height:60vh">
          <div style="padding:40px;text-align:center;color:var(--text-3);font-size:.85rem">Select a table from the left to browse its data</div>
        </div>
        <div id="leg-browser-pager" style="padding:8px 12px;border-top:1px solid var(--border);display:flex;align-items:center;gap:8px;font-size:.78rem;color:var(--text-2)"></div>
      </div>
    </div>`;

  await _legLoadTableList();
}

async function _legLoadTableList() {
  const listBody = document.getElementById('leg-table-list-body');
  if (!listBody) return;
  try {
    const data = await fetch('/api/legacy/all-tables').then(r=>r.json());
    _legAllTables = Array.isArray(data) ? data : [];
    const visible = _legAllTables
      .filter(t => t.rows > 0)
      .sort((a, b) => b.rows - a.rows);
    if (!visible.length) {
      listBody.innerHTML = `<div style="padding:14px 12px;font-size:.78rem;color:var(--text-3)">
        No L-tables with data found.<br><br>Click <strong>↻ Sync</strong> to copy all legacy tables here.
      </div>`;
      return;
    }
    listBody.innerHTML = visible.map(t => `
      <div class="leg-tbl-item" onclick="_legOpenTable('${t.table}')"
        style="padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .1s"
        onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background=this.dataset.sel?'var(--blue-bg)':''"
        data-table="${t.table}">
        <div style="font-size:.78rem;font-weight:600;font-family:'DM Mono',monospace;color:var(--navy)">${t.table}</div>
        <div style="font-size:.7rem;color:var(--text-3)">${t.rows.toLocaleString('en-IN')} rows</div>
      </div>`).join('');
  } catch(e) {
    listBody.innerHTML = `<div style="padding:12px;font-size:.78rem;color:var(--red-d)">Error: ${e.message}</div>`;
  }
}

async function _legSyncTables() {
  const btn = document.getElementById('leg-sync-btn');
  const listBody = document.getElementById('leg-table-list-body');
  btn.textContent = 'Syncing…'; btn.disabled = true;
  listBody.innerHTML = `<div style="padding:14px 12px;font-size:.78rem;color:var(--text-2)">Copying all legacy tables…<br>This may take a minute.</div>`;
  try {
    const d = await fetch('/api/legacy/sync-tables', {method:'POST'}).then(r=>r.json());
    if (d.success) {
      toast(`✓ Synced ${d.synced}/${d.total} tables from legacy DB`, 'success');
      await _legLoadTableList();
    } else {
      toast('Sync error: ' + d.error, 'error');
    }
  } catch(e) { toast('Sync failed: ' + e.message, 'error'); }
  btn.textContent = '↻ Sync'; btn.disabled = false;
}

async function _legOpenTable(name) {
  _legCurTable = name;
  _legPage = 1;
  // Highlight selected
  document.querySelectorAll('.leg-tbl-item').forEach(el => {
    const sel = el.dataset.table === name;
    el.style.background = sel ? 'var(--blue-bg)' : '';
    el.style.fontWeight  = sel ? '700' : '';
    el.dataset.sel = sel ? '1' : '';
  });
  document.getElementById('leg-browser-title').textContent = name;
  document.getElementById('leg-browser-search').value = '';
  await _legLoadTablePage();
}

async function _legLoadTablePage() {
  const content = document.getElementById('leg-browser-content');
  const pager   = document.getElementById('leg-browser-pager');
  const countEl = document.getElementById('leg-browser-count');
  const search  = document.getElementById('leg-browser-search').value;
  if (!_legCurTable) return;
  content.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-3)">Loading…</div>`;

  const qp = new URLSearchParams({page: _legPage, limit: 100});
  if (search) qp.set('search', search);

  try {
    const d = await fetch(`/api/legacy/table/${_legCurTable}?${qp}`).then(r=>r.json());
    if (d.error) { content.innerHTML = `<div style="padding:20px;color:var(--red-d)">${d.error}</div>`; return; }

    countEl.textContent = `${d.total.toLocaleString('en-IN')} rows total`;

    if (!d.rows.length) {
      content.innerHTML = `<div style="padding:28px;text-align:center;color:var(--text-3)">No records${search?' matching "'+search+'"':''}</div>`;
      pager.innerHTML = '';
      return;
    }

    // Render table
    const cols = d.columns;
    content.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:.76rem">
        <thead style="position:sticky;top:0;background:var(--bg);z-index:1">
          <tr>${cols.map(c=>`<th style="padding:6px 10px;text-align:left;border-bottom:2px solid var(--border);white-space:nowrap;font-size:.7rem;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em">${c}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${d.rows.map((row,i)=>`<tr style="border-bottom:1px solid var(--border);${i%2?'background:#f9fafb':''}">
            ${cols.map(c=>{
              const v = row[c];
              const display = v===null||v===undefined ? '<span style="color:var(--text-3);font-style:italic">null</span>'
                : v instanceof Date ? v.toISOString().substring(0,10)
                : String(v).length > 80 ? `<span title="${String(v).replace(/"/g,'&quot;')}">${String(v).substring(0,80)}…</span>`
                : String(v);
              return `<td style="padding:5px 10px;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis">${display}</td>`;
            }).join('')}
          </tr>`).join('')}
        </tbody>
      </table>`;

    // Pagination
    const totalPages = Math.ceil(d.total / d.limit);
    pager.innerHTML = totalPages <= 1 ? '' : `
      <button onclick="_legPage=Math.max(1,_legPage-1);_legLoadTablePage()" ${_legPage<=1?'disabled':''} style="padding:3px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);cursor:pointer;font-size:.78rem">← Prev</button>
      <span>Page ${_legPage} of ${totalPages}</span>
      <button onclick="_legPage=Math.min(${totalPages},_legPage+1);_legLoadTablePage()" ${_legPage>=totalPages?'disabled':''} style="padding:3px 10px;border:1px solid var(--border);border-radius:6px;background:var(--card);cursor:pointer;font-size:.78rem">Next →</button>
      <span style="margin-left:auto;color:var(--text-3)">Showing rows ${((d.page-1)*d.limit)+1}–${Math.min(d.page*d.limit,d.total)}</span>`;

  } catch(e) { content.innerHTML = `<div style="padding:20px;color:var(--red-d)">Error: ${e.message}</div>`; }
}

let _legSearchTimer;
function _legBrowserSearch() {
  clearTimeout(_legSearchTimer);
  _legSearchTimer = setTimeout(()=>{ _legPage=1; _legLoadTablePage(); }, 350);
}

// ── EXISTING SUB-TAB HANDLERS (unchanged) ────────────────────
async function legacySubTabRefresh() {
  const station    = document.getElementById('leg-station-filter')?.value || '';
  const activeOnly = document.getElementById('leg-active-only')?.checked;
  const head       = document.getElementById('leg-head');
  const body       = document.getElementById('leg-body');
  if (!head || !body) return;

  // Restore plain table wrap if coming from all-tables pane
  const tblWrap = document.querySelector('#t-legacy .tbl-wrap');
  if (tblWrap && document.getElementById('leg-all-wrap')) {
    tblWrap.style.maxHeight = '60vh';
    tblWrap.style.overflowY = 'auto';
    tblWrap.innerHTML = '<table><thead id="leg-head"></thead><tbody id="leg-body"></tbody></table>';
  }

  const headEl = document.getElementById('leg-head');
  const bodyEl = document.getElementById('leg-body');
  if (!headEl || !bodyEl) return;
  bodyEl.innerHTML = '<tr><td colspan="10" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';

  const qp = new URLSearchParams();
  if (station)     qp.set('station', station);
  if (!activeOnly) qp.set('active', '0');
  const param = qp.toString() ? '?'+qp.toString() : '';

  let url, cols, rowFn;

  if (legacyCurTab === 'stations') {
    url  = '/api/legacy/stations';
    cols = ['Station Code','Store Name','Location','Cluster Manager','CM Mobile','Email','ESIC','Category'];
    rowFn = r => `<td>${r.station_code}</td><td>${r.store_name||'—'}</td><td>${r.location_name||'—'}</td>
      <td>${r.cluster_manager||'—'}</td><td>${r.cm_mobile||'—'}</td><td style="font-size:.72rem">${r.store_email||'—'}</td>
      <td>${r.esic?'Yes':'No'}</td><td>${r.store_cat||'—'}</td>`;

  } else if (legacyCurTab === 'ics') {
    url  = '/api/legacy/ics'+param;
    cols = ['ID','Name','Station','Mobile','Account No','IFSC','Bank','PAN','Per Parcel','Joined'];
    rowFn = r => `<td style="font-family:monospace;font-size:.72rem">${r.ic_id}</td>
      <td style="font-weight:600">${r.ic_name.trim()}</td><td>${r.station_code||'—'}</td>
      <td>${r.mobile||'—'}</td><td style="font-family:monospace;font-size:.72rem">${r.account_number||'—'}</td>
      <td style="font-family:monospace;font-size:.72rem">${r.ifsc_code||'—'}</td>
      <td style="font-size:.72rem">${r.bank_name||'—'}</td><td style="font-size:.72rem">${r.pancard||'—'}</td>
      <td style="text-align:center">₹${parseFloat(r.per_parcel||0).toLocaleString('en-IN')}</td>
      <td style="font-size:.72rem">${r.joing_date?String(r.joing_date).substring(0,10):'—'}</td>`;

  } else if (legacyCurTab === 'users') {
    url  = '/api/legacy/users'+param;
    cols = ['Name','User ID','Station','Designation','Department','Mobile','Email','Type','Status'];
    rowFn = r => `<td style="font-weight:600">${r.full_name||'—'}</td>
      <td style="font-family:monospace;font-size:.72rem">${r.userid||'—'}</td>
      <td>${r.station_code||'—'}</td><td style="font-size:.72rem">${r.designation||'—'}</td>
      <td style="font-size:.72rem">${r.department||'—'}</td><td>${r.mobile||'—'}</td>
      <td style="font-size:.72rem">${r.email||'—'}</td><td style="font-size:.72rem">${r.user_type||'—'}</td>
      <td><span style="font-size:.7rem;padding:2px 7px;border-radius:8px;${r.status==1?'background:var(--green-bg);color:var(--green-d)':'background:var(--red-bg);color:var(--red-d)'}">
        ${r.status==1?'Active':'Inactive'}</span></td>`;

  } else if (legacyCurTab === 'debit') {
    url  = '/api/legacy/debit-notes'+param;
    cols = ['Date','Tracking ID','Station','Store','Amount','EMI Months','Description','Added By'];
    rowFn = r => `<td style="white-space:nowrap">${r.date||'—'}</td>
      <td style="font-family:monospace;font-size:.72rem">${r.tracking_id||'—'}</td>
      <td>${r.station_code||'—'}</td><td style="font-size:.72rem">${r.store_name||'—'}</td>
      <td style="font-weight:700;color:var(--red-d)">₹${parseFloat(r.debit_amount||0).toLocaleString('en-IN')}</td>
      <td>${r.emi_months||1}</td><td style="font-size:.72rem">${r.description||'—'}</td>
      <td style="font-size:.72rem">${r.added_by_name||'—'}</td>`;

  } else if (legacyCurTab === 'advances') {
    url  = '/api/legacy/advances'+param;
    cols = ['Date','Staff','Station','Amount','Description','Status','Approved Date'];
    rowFn = r => `<td style="white-space:nowrap">${r.date||'—'}</td>
      <td style="font-weight:600">${r.staff_name||'—'}</td><td>${r.station_code||'—'}</td>
      <td style="font-weight:700;color:var(--amber-d)">₹${parseFloat(r.amount||0).toLocaleString('en-IN')}</td>
      <td style="font-size:.72rem">${r.description||'—'}</td>
      <td><span style="font-size:.7rem;padding:2px 7px;border-radius:8px;background:var(--bg)">${r.status||'—'}</span></td>
      <td style="font-size:.72rem">${r.approve_date?new Date(r.approve_date).toLocaleDateString('en-IN'):'—'}</td>`;

  } else if (legacyCurTab === 'salary') {
    url  = '/api/legacy/salary-slips'+param;
    cols = ['Month','Staff','Station','Parcels','Working Days','Basic','Net Salary','Advanced','Debit','CTC'];
    rowFn = r => `<td style="white-space:nowrap">${r.month?r.month.substring(0,7):'—'}</td>
      <td style="font-weight:600">${r.staff_name||'—'}</td><td>${r.station_code||'—'}</td>
      <td>${r.total_parcel||0}</td><td>${r.working_days||0}</td>
      <td>₹${parseFloat(r.basic||0).toLocaleString('en-IN')}</td>
      <td style="font-weight:700;color:var(--green-d)">₹${parseFloat(r.net_salary||0).toLocaleString('en-IN')}</td>
      <td style="color:var(--amber-d)">₹${parseFloat(r.advanced||0).toLocaleString('en-IN')}</td>
      <td style="color:var(--red-d)">₹${parseFloat(r.debit_note||0).toLocaleString('en-IN')}</td>
      <td>₹${parseFloat(r.ctc||0).toLocaleString('en-IN')}</td>`;

  } else if (legacyCurTab === 'leaves') {
    url  = '/api/legacy/leaves'+param;
    cols = ['Apply Date','Staff','Station','From','To','Days','Type','Status'];
    rowFn = r => `<td style="white-space:nowrap">${r.apply_date||'—'}</td>
      <td style="font-weight:600">${r.staff_name||'—'}</td><td>${r.station_code||'—'}</td>
      <td style="white-space:nowrap">${r.leave_start_date||'—'}</td>
      <td style="white-space:nowrap">${r.leave_end_date||'—'}</td>
      <td>${r.leave_days||0}</td><td style="font-size:.72rem">${r.leave_type_name||'—'}</td>
      <td><span style="font-size:.7rem;padding:2px 7px;border-radius:8px;
        ${r.approval_status==='approved'?'background:var(--green-bg);color:var(--green-d)':
          r.approval_status==='rejected'?'background:var(--red-bg);color:var(--red-d)':
          'background:var(--amber-bg);color:var(--amber-d)'}">
        ${r.approval_status||'—'}</span></td>`;

  } else if (legacyCurTab === 'managers') {
    url  = '/api/legacy/managers';
    cols = ['Name','Station','Designation','Mobile','Email','User ID','Account No','IFSC','Bank','Joined','Status'];
    rowFn = r => `<td style="font-weight:600">${r.name||'—'}</td><td>${r.primary_station||'—'}</td>
      <td style="font-size:.72rem">${r.designation||'—'}</td><td>${r.mobile||'—'}</td>
      <td style="font-size:.72rem">${r.email||'—'}</td>
      <td style="font-family:monospace;font-size:.72rem">${r.userid||'—'}</td>
      <td style="font-family:monospace;font-size:.72rem">${r.account_no||'—'}</td>
      <td style="font-family:monospace;font-size:.72rem">${r.ifsc_code||'—'}</td>
      <td style="font-size:.72rem">${r.bank_name||'—'}</td>
      <td style="font-size:.72rem">${r.joing_date?String(r.joing_date).substring(0,10):'—'}</td>
      <td><span style="font-size:.7rem;padding:2px 7px;border-radius:8px;${r.status===0?'background:var(--green-bg);color:var(--green-d)':'background:var(--red-bg);color:var(--red-d)'}">
        ${r.status===0?'Active':'Inactive'}</span></td>`;
  }

  if (!url) return;
  try {
    const resp = await fetch(url);
    const data = await resp.json();
    legacyData = data;
    headEl.innerHTML = '<tr>'+cols.map(c=>`<th style="white-space:nowrap">${c}</th>`).join('')+'</tr>';
    document.getElementById('leg-count').textContent = `${data.length} records`;
    if (!data.length) {
      bodyEl.innerHTML = '<tr class="empty-row"><td colspan="'+cols.length+'">No records found</td></tr>';
      return;
    }
    bodyEl.innerHTML = data.map((r,i)=>`<tr data-idx="${i}" style="${i%2?'background:#f9fafb':''}">${rowFn(r)}</tr>`).join('');
    legacyFilterTable();
  } catch(e) {
    bodyEl.innerHTML = `<tr class="empty-row"><td colspan="10">Error: ${e.message}</td></tr>`;
  }
}

function legacyFilterTable() {
  const term = (document.getElementById('leg-search')?.value||'').toLowerCase();
  let vis = 0;
  document.querySelectorAll('#leg-body tr').forEach(tr => {
    const match = !term || tr.textContent.toLowerCase().includes(term);
    tr.style.display = match ? '' : 'none';
    if (match) vis++;
  });
  const cnt = document.getElementById('leg-count');
  if (cnt) cnt.textContent = `${vis} records`;
}

// ── TEST FLAGS (lives here for historical reasons) ───────────
async function loadTestFlags() {
  try {
    const flags = await fetch('/api/test-flags').then(r=>r.json());
    document.getElementById('test-flags-wrap').innerHTML = Object.entries(FLAG_META).map(([key, meta]) => {
      const on = !!flags[key];
      return `<div style="display:flex;align-items:flex-start;gap:14px;padding:14px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <div style="font-size:.88rem;font-weight:700;color:${on?'var(--red-d)':'var(--navy)'}">${meta.label}${on?' ⚠':''}</div>
          <div style="font-size:.76rem;color:var(--text-3);margin-top:2px">${meta.desc}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <span class="pill" style="${on?'background:rgba(239,68,68,.12);color:var(--red-d);border:1px solid rgba(239,68,68,.2)':'background:var(--green-bg);color:var(--green-d);border:1px solid rgba(16,185,129,.2)'};font-size:.72rem">${on?'ON':'OFF'}</span>
          <button class="btn btn-sm ${on?'btn-red':'btn-green'}" onclick="toggleFlag('${key}',${!on})">${on?'Turn OFF':'Turn ON'}</button>
        </div>
      </div>`;
    }).join('');
    document.getElementById('prod-checklist').innerHTML = Object.entries(FLAG_META).map(([key, meta]) => {
      const on = !!flags[key];
      return `<div style="color:${on?'var(--red-d)':'var(--green-d)'}">${on?'✕':'✓'} <strong>${meta.label}</strong> — ${on?'<strong>ON — must turn OFF before production!</strong>':'OFF ✓'}</div>`;
    }).join('');
  } catch(e) { toast('Failed to load test flags.','error'); }
}

async function toggleFlag(key, value) {
  await fetch('/api/test-flags', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({[key]:value})});
  loadTestFlags();
  toast(`${FLAG_META[key]?.label} — ${value?'turned ON ⚠':'turned OFF ✓'}`, value?'warning':'success');
}

async function triggerMidnightClose() {
  const btn = event.target; btn.disabled=true; btn.textContent='Running…';
  const el = document.getElementById('midnight-result');
  try {
    await fetch('/api/midnight-close', {method:'POST', headers:{'x-cron-secret':'sl-midnight-2026'}});
    el.textContent = '✓ Done — check stderr.log for details'; el.style.color='var(--green-d)';
    toast('Midnight close ran.','success');
  } catch(e) { el.textContent='✕ Failed'; el.style.color='var(--red-d)'; }
  btn.disabled=false; btn.textContent='⏱ Run Midnight Close Now';
}

// ── Staff Directory ──────────────────────────────────────────────────────────
let _staffDirAll      = [];
let _staffDirFiltered = [];
let _staffDirPage     = 1;
const STAFF_DIR_PER_PAGE = 15;

async function loadStaffDir() {
  const role    = document.getElementById('staff-dir-role')?.value || '';
  const status  = document.getElementById('staff-dir-status')?.value || 'active';
  const station = document.getElementById('staff-dir-station')?.value || '';
  const tbody   = document.getElementById('staff-dir-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-3)">Loading…</td></tr>';

  const stSel = document.getElementById('staff-dir-station');
  if (stSel && stSel.options.length === 1) {
    try {
      const sts = await fetch('/api/stations').then(r=>r.json());
      sts.forEach(s => {
        const o = document.createElement('option');
        o.value = s.station_code; o.textContent = s.station_code;
        stSel.appendChild(o);
      });
    } catch(e) {}
  }

  try {
    const params = new URLSearchParams();
    if (role) params.set('role', role);
    if (status) params.set('status', status);
    if (station) params.set('station', station);
    _staffDirAll = await fetch('/api/admin/staff-directory?' + params).then(r=>r.json());
    _staffDirFiltered = [..._staffDirAll];
    _staffDirPage = 1;
    const sc = document.getElementById('staff-dir-count');
    if (sc) sc.textContent = '(' + _staffDirAll.length + ')';
    renderStaffDir();
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--red-d);padding:20px">Error: ${e.message}</td></tr>`;
  }
}

function renderStaffDir() {
  const tbody  = document.getElementById('staff-dir-body');
  const footer = document.getElementById('staff-dir-footer');
  if (!tbody) return;
  const rows = _staffDirFiltered;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-3)">No records found</td></tr>';
    if (footer) footer.innerHTML = '<span>No records</span><div></div>';
    return;
  }
  const start = (_staffDirPage - 1) * STAFF_DIR_PER_PAGE;
  const page  = rows.slice(start, start + STAFF_DIR_PER_PAGE);
  tbody.innerHTML = page.map(r => `
    <tr style="cursor:pointer" onclick="openStaffProfile(${r.id})">
      <td><div style="font-weight:500">${escH(r.name)}</div>${r.email?`<div style="font-size:.75rem;color:var(--text-3)">${escH(r.email)}</div>`:''}</td>
      <td style="font-family:monospace;font-size:.82rem">${r.id}</td>
      <td><span style="font-size:.75rem;background:var(--blue-bg);color:var(--blue-d);padding:2px 7px;border-radius:99px;white-space:nowrap">${escH(r.role)}</span></td>
      <td>${r.station_code !== '—' ? `<span style="font-family:monospace;font-size:.82rem">${escH(r.station_code)}</span>` : '<span style="color:var(--text-3)">—</span>'}</td>
      <td style="font-size:.82rem">${escH(r.mobile)}</td>
      <td style="font-size:.82rem">${r.joining !== '—' ? fmtD(r.joining) : '—'}</td>
      <td>${r.is_active
        ? '<span style="color:var(--green-d);font-size:.78rem;font-weight:600">● Active</span>'
        : `<span style="color:var(--red-d);font-size:.78rem;font-weight:600">● Resigned</span>${r.resign_date?`<div style="font-size:.72rem;color:var(--text-3)">${fmtD(r.resign_date)}</div>`:''}`
      }</td>
    </tr>`).join('');
  if (footer) {
    const pages = Math.max(1, Math.ceil(rows.length / STAFF_DIR_PER_PAGE));
    const from  = start + 1, to = Math.min(_staffDirPage * STAFF_DIR_PER_PAGE, rows.length);
    footer.innerHTML =
      `<span>${from}–${to} of ${rows.length}</span>` +
      `<div style="display:flex;gap:6px">` +
        `<button class="btn btn-ghost btn-sm" ${_staffDirPage<=1?'disabled':''} onclick="_staffDirGoTo(${_staffDirPage-1})">← Prev</button>` +
        `<span style="padding:4px 10px;background:var(--bg-2);border-radius:6px;font-weight:600">${_staffDirPage} / ${pages}</span>` +
        `<button class="btn btn-ghost btn-sm" ${_staffDirPage>=pages?'disabled':''} onclick="_staffDirGoTo(${_staffDirPage+1})">Next →</button>` +
      `</div>`;
  }
}

function _staffDirGoTo(p) { _staffDirPage = p; renderStaffDir(); }

function filterStaffDir(q) {
  const lq = (q||'').toLowerCase();
  _staffDirFiltered = lq
    ? _staffDirAll.filter(r =>
        r.name.toLowerCase().includes(lq) ||
        String(r.id).includes(lq) ||
        (r.mobile && r.mobile.includes(lq)) ||
        (r.station_code && r.station_code.toLowerCase().includes(lq)) ||
        r.role.toLowerCase().includes(lq))
    : [..._staffDirAll];
  _staffDirPage = 1;
  renderStaffDir();
}

// keep old signature for compat — no longer used internally
function _filterStaffDirOld(q) {
  if (!q) { renderStaffDir(); return; }
  const lq = q.toLowerCase();
  _staffDirFiltered = _staffDirAll.filter(r =>
    r.name.toLowerCase().includes(lq) ||
    String(r.id).includes(lq) ||
    (r.mobile && r.mobile.includes(lq)) ||
    (r.station_code && r.station_code.toLowerCase().includes(lq)) ||
    r.role.toLowerCase().includes(lq)
  );
}

// ── Staff Profile Modal ──────────────────────────────────────────────────────
async function openStaffProfile(id) {
  const modal = document.getElementById('staff-profile-modal');
  if (!modal) return;
  document.getElementById('spm-name').textContent = 'Loading…';
  document.getElementById('spm-role').textContent = '';
  document.getElementById('spm-body').innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-3)">Loading…</div>';
  modal.classList.remove('hidden');

  try {
    const r = await fetch(`/api/admin/staff/${id}`).then(res=>res.json());
    if (r.error) { document.getElementById('spm-body').innerHTML = `<div style="color:var(--red-d);padding:20px">${r.error}</div>`; return; }

    const roleNames = {1:'Admin', 2:'Station Incharge', 3:'Van', 4:'Delivery Associate',
      5:'Cluster Manager', 6:'Store Admin', 7:'Account',
      8:'Van Associate', 11:'Head Office Admin', 13:'Travelling Manager',
      14:'Station Associate', 15:'Operation Manager', 16:'HR Admin',
      17:'Assistance Cluster Manager', 18:'Process Associate',
      19:'SLPT Team Leader', 20:'Loader', 21:'CP Point'};

    const fullName = [r.fname, r.mname, r.lname].filter(Boolean).map(s=>s.trim()).join(' ');
    const isResigned = r.resign_date && new Date(r.resign_date) <= new Date();

    document.getElementById('spm-name').textContent = fullName;
    document.getElementById('spm-role').innerHTML =
      `<span style="background:var(--blue-bg);color:var(--blue-d);padding:2px 8px;border-radius:99px;font-size:.78rem;margin-right:6px">${roleNames[r.user_type]||'Role '+r.user_type}</span>` +
      `<span style="font-family:monospace;font-size:.78rem;color:var(--text-3)">ID: ${r.id}</span>` +
      (isResigned ? ' <span style="color:var(--red-d);font-size:.78rem;font-weight:600">● Resigned</span>' :
                    ' <span style="color:var(--green-d);font-size:.78rem;font-weight:600">● Active</span>');

    document.getElementById('spm-body').innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        ${_spmSection('Personal', [
          ['Full Name', fullName],
          ['Date of Birth', fmtD(r.dob)],
          ['Blood Group', r.blood_group],
          ['Mobile', r.mobile],
          ['Email', r.email],
          ['Address', r.address],
          ['Pincode', r.pincode]
        ])}
        ${_spmSection('Employment', [
          ['Employee ID', r.associate_id],
          ['User ID', r.userid],
          ['Designation', r.designation],
          ['Department', r.department],
          ['Station', r.station_code],
          ['Joining Date', fmtD(r.joing_date)],
          ['Resign Date', fmtD(r.resign_date)],
          ['Per Parcel', r.per_parcel ? '₹'+r.per_parcel : null],
          ['Gross Salary', r.gross_salary ? '₹'+r.gross_salary : null],
          ['CTC', r.ctc ? '₹'+r.ctc : null]
        ])}
        ${_spmSection('Bank Details', [
          ['Bank Name', r.bank_name],
          ['Account No', r.account_no],
          ['IFSC Code', r.ifsc_code],
          ['Account Name', r.account_name],
          ['UAN', r.uan],
          ['ESIC No', r.esic]
        ])}
        ${_spmSection('Identity & Compliance', [
          ['Aadhaar', r.adhar_card],
          ['PAN', r.pan_card_number],
          ['Voter ID', r.voter_id],
          ['Driving License', r.license],
          ['License Expiry', fmtD(r.licence_expiry)]
        ])}
        ${_spmSection('Emergency Contacts', [
          ['Contact 1', r.emergency_contact_1],
          ['Contact 2', r.emergency_contact_2]
        ])}
        ${_spmSection('System', [
          ['Status', r.status === 0 ? 'Active' : 'Inactive'],
          ['Last Login', r.last_login],
          ['Added', r.added_date],
          ['Updated', r.updated_date],
          ['Employment History', r.employement_history]
        ])}
      </div>`;
  } catch(e) {
    document.getElementById('spm-body').innerHTML = `<div style="color:var(--red-d);padding:20px">Error: ${e.message}</div>`;
  }
}

function _spmSection(title, fields) {
  const rows = fields.filter(([,v]) => v && v !== '—' && v !== '0000-00-00');
  if (!rows.length) return '';
  return `<div style="background:var(--bg-2);border-radius:10px;padding:14px;grid-column:${title==='Employment'||title==='Personal'?'span 1':'span 1'}">
    <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3);margin-bottom:10px">${title}</div>
    ${rows.map(([k,v]) => `
      <div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);font-size:.8rem">
        <span style="color:var(--text-2);white-space:nowrap">${k}</span>
        <span style="font-weight:500;text-align:right;word-break:break-all">${escH(String(v))}</span>
      </div>`).join('')}
  </div>`;
}