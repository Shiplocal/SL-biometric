// ── LEGACY DATA BROWSER ──────────────────────────────────
let legacyCurTab = 'stations';
let legacyData   = [];

async function loadLegacyTab() {
  // Test connection first
  try {
    const t = await fetch('/api/legacy/test').then(r=>r.json());
    const el = document.getElementById('legacy-conn-status');
    if (t.connected) {
      el.textContent = `✅ Connected — ${t.stores} stations · ${t.ics} ICs · ${t.users} users`;
      el.style.background = 'var(--green-bg)'; el.style.color = 'var(--green-d)';
    } else {
      el.textContent = '❌ Cannot connect to legacy DB';
      el.style.background = 'var(--red-bg)'; el.style.color = 'var(--red-d)';
    }
  } catch(e) {}
  legacySubTab(legacyCurTab);
}

function legacySubTab(tab) {
  legacyCurTab = tab;
  ['stations','ics','users','debit','advances','salary','leaves','managers'].forEach(t => {
    const el = document.getElementById('leg-t-'+t);
    if (el) el.classList.toggle('active', t===tab);
  });
  legacySubTabRefresh();
}

async function legacySubTabRefresh() {
  const station    = document.getElementById('leg-station-filter').value;
  const activeOnly = document.getElementById('leg-active-only').checked;
  const head       = document.getElementById('leg-head');
  const body       = document.getElementById('leg-body');
  body.innerHTML   = '<tr><td colspan="10" style="padding:20px;text-align:center;color:var(--text-3)">Loading…</td></tr>';

  try {
    const qp = new URLSearchParams();
    if (station)     qp.set('station', station);
    if (!activeOnly) qp.set('active', '0');
    const param = qp.toString() ? '?' + qp.toString() : '';
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
        <td style="font-weight:600">${r.ic_name.trim()}</td>
        <td>${r.station_code||'—'}</td>
        <td>${r.mobile||'—'}</td>
        <td style="font-family:monospace;font-size:.72rem">${r.account_number||'—'}</td>
        <td style="font-family:monospace;font-size:.72rem">${r.ifsc_code||'—'}</td>
        <td style="font-size:.72rem">${r.bank_name||'—'}</td>
        <td style="font-size:.72rem">${r.pancard||'—'}</td>
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
        <td><span style="font-size:.7rem;padding:2px 7px;border-radius:8px;${r.status==1?'background:var(--green-bg);color:var(--green-d)':'background:var(--red-bg);color:var(--red-d)'}">${r.status==1?'Active':'Inactive'}</span></td>`;

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
        <td style="font-weight:600">${r.staff_name||'—'}</td>
        <td>${r.station_code||'—'}</td>
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
            'background:var(--amber-bg);color:var(--amber-d)'}">${r.approval_status||'—'}</span></td>`;

    } else if (legacyCurTab === 'managers') {
      url  = '/api/legacy/managers';
      cols = ['Name','Station','Designation','Mobile','Email','User ID','Account No','IFSC','Bank','Joined','Status'];
      rowFn = r => `<td style="font-weight:600">${r.name||'—'}</td>
        <td>${r.primary_station||'—'}</td>
        <td style="font-size:.72rem">${r.designation||'—'}</td>
        <td>${r.mobile||'—'}</td>
        <td style="font-size:.72rem">${r.email||'—'}</td>
        <td style="font-family:monospace;font-size:.72rem">${r.userid||'—'}</td>
        <td style="font-family:monospace;font-size:.72rem">${r.account_no||'—'}</td>
        <td style="font-family:monospace;font-size:.72rem">${r.ifsc_code||'—'}</td>
        <td style="font-size:.72rem">${r.bank_name||'—'}</td>
        <td style="font-size:.72rem">${r.joing_date?String(r.joing_date).substring(0,10):'—'}</td>
        <td><span style="font-size:.7rem;padding:2px 7px;border-radius:8px;${r.status===0?'background:var(--green-bg);color:var(--green-d)':'background:var(--red-bg);color:var(--red-d)'}">${r.status===0?'Active':'Inactive'}</span></td>`;
    }

    const resp = await fetch(url);
    if (!resp.ok) { body.innerHTML = `<tr class="empty-row"><td colspan="${cols.length}">Server error: ${resp.status} — ${resp.statusText}</td></tr>`; return; }
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch(e) {
      body.innerHTML = `<tr class="empty-row"><td colspan="${cols.length}">Parse error — server returned unexpected response. Check console.</td></tr>`;
      console.error('Legacy fetch error:', text.substring(0,300));
      return;
    }
    legacyData = data;

    head.innerHTML = '<tr>'+cols.map(c=>`<th style="white-space:nowrap">${c}</th>`).join('')+'</tr>';
    document.getElementById('leg-count').textContent = `${data.length} records`;

    if (!data.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="'+cols.length+'">No records found</td></tr>';
      return;
    }
    body.innerHTML = data.map((r,i) =>
      `<tr data-idx="${i}" style="${i%2?'background:#f9fafb':''}">${rowFn(r)}</tr>`
    ).join('');

    legacyFilterTable();
  } catch(e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="10">Error: ${e.message}</td></tr>`;
  }
}

function legacyFilterTable() {
  const term = (document.getElementById('leg-search').value||'').toLowerCase();
  let vis = 0;
  document.querySelectorAll('#leg-body tr').forEach(tr => {
    const match = !term || tr.textContent.toLowerCase().includes(term);
    tr.style.display = match ? '' : 'none';
    if (match) vis++;
  });
  document.getElementById('leg-count').textContent = `${vis} records`;
}

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

async function loadRecentSubmissions() {
  const wrap = document.getElementById('recent-submissions');
  wrap.innerHTML = '<div style="color:var(--text-3);font-size:.78rem">Loading…</div>';
  try {
    const data = await fetch('/api/admin/recent-submissions').then(r=>r.json());
    if (!data.length) { wrap.innerHTML='<div style="color:var(--text-3);font-size:.78rem">No submissions found.</div>'; return; }
    const modColor = {KMS:'var(--amber-d)', ADV:'var(--green-d)', DEB:'var(--red-d)'};
    wrap.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:.78rem">
      <thead><tr style="border-bottom:1px solid var(--border)">
        <th style="padding:6px 10px;text-align:left">Module</th>
        <th style="padding:6px 10px;text-align:left">Station</th>
        <th style="padding:6px 10px;text-align:left">Period / Cycle</th>
        <th style="padding:6px 10px;text-align:left">Submitted</th>
        <th style="padding:6px 10px"></th>
      </tr></thead>
      <tbody>${data.map(r=>`<tr style="border-bottom:1px solid var(--border)">
        <td style="padding:6px 10px"><span style="font-weight:700;color:${modColor[r.module]||'var(--text-1)'}">${r.module}</span></td>
        <td style="padding:6px 10px">${r.station_code}</td>
        <td style="padding:6px 10px;font-family:'DM Mono',monospace;font-size:.72rem">${r.period_label}</td>
        <td style="padding:6px 10px;color:var(--text-2)">${new Date(r.submitted_at).toLocaleString('en-IN')}</td>
        <td style="padding:6px 10px;text-align:right">
          <button class="btn btn-red btn-sm" onclick="resetSubmission('${r.station_code}','${r.module}','${r.period_label}',this)">🗑 Reset</button>
        </td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch(e) { wrap.innerHTML='<div style="color:var(--red-d);font-size:.78rem">Failed to load.</div>'; }
}

async function resetSubmission(station, module, periodLabel, btn) {
  if (!confirm(`Reset ${module} for ${station} / ${periodLabel}?\n\nThis will DELETE the submitted data and unlock the module for retesting.`)) return;
  btn.disabled=true; btn.textContent='Resetting…';
  try {
    const r = await fetch('/api/admin/reset-submission', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({station, module, periodLabel})
    });
    const d = await r.json();
    if (d.success) { toast(`${module} reset for ${station} ✓`,'success'); loadRecentSubmissions(); }
    else { toast(`Failed: ${d.error}`,'error'); btn.disabled=false; btn.textContent='🗑 Reset'; }
  } catch(e) { toast('Error.','error'); btn.disabled=false; btn.textContent='🗑 Reset'; }
}