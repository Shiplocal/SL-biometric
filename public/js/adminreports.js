async function loadKms(){
  const cycleId=document.getElementById('kms-period').value; if(!cycleId)return;
  const grid=document.getElementById('kms-summary-grid');
  const stats=document.getElementById('kms-summary-stats');
  if(!grid||!stats) return;
  grid.innerHTML='<div style="color:var(--text-3);padding:24px">Loading...</div>';
  try{
    const data=await fetch(`/api/admin/kms-summary?cycleId=${cycleId}`).then(r=>r.json());
    if(!data.length){grid.innerHTML='<div style="color:var(--text-3);padding:24px">No stations found for this cycle.</div>';stats.innerHTML='';return;}
    const total=data.length;
    const submitted=data.filter(s=>s.status==='SUBMITTED').length;
    const partial=data.filter(s=>s.status==='PARTIAL'||s.pending>0&&s.submitted>0).length;
    const open=data.filter(s=>s.submitted===0).length;
    stats.innerHTML=`<span style="font-size:.82rem;color:var(--text-2)">${total} stations · <strong style="color:var(--green-d)">${submitted} submitted</strong> · <strong style="color:var(--amber-d)">${partial} partial</strong> · <strong style="color:var(--text-3)">${open} not started</strong></span>`;
    grid.innerHTML=data.map(s=>{
      const pct=s.total>0?Math.round(s.submitted/s.total*100):0;
      const pill=s.status==='SUBMITTED'
        ?'<span class="pill p-submitted">Submitted</span>'
        :s.submitted>0
          ?'<span class="pill p-partial">Partial</span>'
          :'<span class="pill p-open">Not Started</span>';
      return `<div class="ov-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="font-size:.92rem">${s.station_code}</strong>${pill}
        </div>
        <div style="font-size:.78rem;color:var(--text-2);margin-bottom:6px">${s.submitted} of ${s.total} groups submitted · ${s.pending} pending</div>
        <div style="background:var(--bg-2);border-radius:4px;height:6px;overflow:hidden">
          <div style="background:var(--green-d);height:100%;width:${pct}%;transition:width .4s"></div>
        </div>
      </div>`;
    }).join('');
  }catch(e){toast('Failed to load KMS summary.','error');}
}

// -- ADV REPORT --------------------------------------------
async function loadAdv() {
  const status  = document.getElementById('adv-status-filter') ? document.getElementById('adv-status-filter').value : '';
  const station = document.getElementById('adv-station-filter') ? document.getElementById('adv-station-filter').value : '';
  const params  = new URLSearchParams();
  if (status)  params.set('status',  status);
  if (station) params.set('station', station);
  try {
    const data = await fetch(`/api/admin/advance-requests?${params}`).then(r=>r.json());
    const statusStyle = {PENDING:'background:var(--amber-bg);color:var(--amber-d)',APPROVED:'background:var(--green-bg);color:var(--green-d)',REJECTED:'background:var(--red-bg);color:var(--red-d)'};
    document.getElementById('adv-body').innerHTML = data.length
      ? data.map(r => `<tr data-search="${r.station_code.toLowerCase()} ${(r.ic_name||'').toLowerCase()}">
          <td style="font-size:.82rem">${r.station_code}</td>
          <td style="font-size:.82rem;font-weight:600">${r.ic_name||'-'}</td>
          <td style="font-size:.78rem">${r.week_label}</td>
          <td><strong style="color:var(--amber-d)">₹${parseFloat(r.amount||0).toLocaleString('en-IN')}</strong></td>
          <td style="font-size:.78rem;color:var(--text-2)">${r.reason||'-'}</td>
          <td style="font-size:.72rem;color:var(--text-3)">${new Date(r.requested_at).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</td>
          <td><span style="font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:8px;${statusStyle[r.status]||''}">${r.status}</span>
              ${r.decision_note?`<div style="font-size:.68rem;color:var(--text-3);margin-top:2px">${r.decision_note}</div>`:''}</td>
          <td>${r.status==='PENDING'
            ? `<div style="display:flex;gap:6px">
                <button class="btn btn-green btn-sm" onclick="advDecide(${r.id},'APPROVED',this)">✓ Approve</button>
                <button class="btn btn-red btn-sm"   onclick="advDecide(${r.id},'REJECTED',this)">✕ Reject</button>
               </div>`
            : `<span style="font-size:.72rem;color:var(--text-3)">Decided ${r.decided_by||''}</span>`
          }</td>
        </tr>`).join('')
      : '<tr class="empty-row"><td colspan="8">No requests found</td></tr>';
  } catch(e) { toast('Failed to load advance requests.','error'); }
}

let _advDecidePending = null;

function advDecide(id, status, btn) {
  if (status === 'APPROVED') {
    // Approve immediately - no note needed
    btn.closest('tr').querySelectorAll('button').forEach(b=>b.disabled=true);
    _doAdvDecide(id, 'APPROVED', '', btn);
    return;
  }
  // REJECTED - show modal
  const row = btn.closest('tr');
  const icName = row.cells[1] ? row.cells[1].textContent.trim() : '';
  const amount = row.cells[3] ? row.cells[3].textContent.trim() : '';
  document.getElementById('reject-modal-name').textContent = `${icName} - ${amount}`;
  document.getElementById('reject-note').value = '';
  _advDecidePending = {id, btn};
  document.getElementById('reject-confirm-btn').onclick = () => {
    const note = document.getElementById('reject-note').value.trim();
    closeModal('reject-modal');
    btn.closest('tr').querySelectorAll('button').forEach(b=>b.disabled=true);
    _doAdvDecide(id, 'REJECTED', note, btn);
  };
  document.getElementById('reject-modal').classList.remove('hidden');
}

async function _doAdvDecide(id, status, note, btn) {
  try {
    const r = await fetch('/api/admin/advance-decision', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id, status, decidedBy:'Admin', note})
    });
    if ((await r.json()).success) {
      toast(`Request ${status === 'APPROVED' ? 'approved ✓' : 'rejected'}.`, status==='APPROVED'?'success':'info');
      loadAdv();
    } else { toast('Failed.','error'); btn.closest('tr').querySelectorAll('button').forEach(b=>b.disabled=false); }
  } catch(e) { toast('Failed.','error'); btn.closest('tr').querySelectorAll('button').forEach(b=>b.disabled=false); }
}

// -- DEB REPORT --------------------------------------------

// -- DATA MANAGEMENT ---------------------------------------
async function setPeriod(){
  const start=document.getElementById('pd-start').value, end=document.getElementById('pd-end').value, label=document.getElementById('pd-label').value.trim();
  if(!start||!end||!label)return toast('Fill all period fields.','warning');
  const r=await fetch('/api/admin/set-period',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({start,end,label})});
  if(r.ok){toast(`Period ${label} activated.`,'success');await populateFilters();document.getElementById('active-period').textContent=label;}
  else toast('Failed.','error');
}

async function unlockModule(){
  const station=document.getElementById('ul-station').value, mod=document.getElementById('ul-module').value,
        period=document.getElementById('ul-period').value.trim(), admin=document.getElementById('ul-admin').value.trim();
  if(!station||!period||!admin)return toast('Fill all unlock fields.','warning');
  const r=await fetch('/api/admin/unlock-module',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station,module:mod,periodLabel:period,adminName:admin})});
  if(r.ok){toast(`${mod} unlocked for ${station}.`,'success');}else toast('Failed.','error');
}

async function uploadCsv(type, input) {
  const file = input.files[0]; if (!file) return;
  const statusId = type === 'edsp' ? 'edsp-status' : 'deb-status';
  const statusEl = document.getElementById(statusId);
  if (statusEl) statusEl.textContent = 'Uploading…';

  try {
    // Step 1: upload file to server
    const fd = new FormData(); fd.append('file', file); fd.append('dest', type + '_upload');
    const upRes = await fetch('/api/admin/upload-file', {method:'POST', body:fd});
    if (!upRes.ok) { if(statusEl) statusEl.textContent='File upload failed.'; return; }
    const {filePath} = await upRes.json();

    // Step 2: import
    const endpoint = type === 'edsp' ? '/api/admin/edsp-cycles/upload' : '/api/admin/debit-upload';
    const body = type === 'edsp'
      ? { filePath, cycleLabel: document.getElementById('edsp-label')?.value || '', dateFrom: document.getElementById('edsp-from')?.value || '', dateTo: document.getElementById('edsp-to')?.value || '' }
      : { filePath };
    const r = await fetch(endpoint, {
      method:'POST',
      headers:{'Content-Type':'application/json','x-cron-secret':'sl-midnight-2026'},
      body: JSON.stringify(body)
    });
    const d = await r.json();
    if (d.success) {
      if (statusEl) statusEl.textContent = `✓ ${d.inserted} records imported`;
      toast(`${d.inserted} records uploaded.`, 'success');
    } else {
      if (statusEl) statusEl.textContent = 'Failed: ' + d.error;
      toast('Upload failed: ' + d.error, 'error');
    }
  } catch(e) { toast('Upload error: ' + e.message, 'error'); }
  input.value = '';
}

// -- TEST FLAGS --------------------------------------------