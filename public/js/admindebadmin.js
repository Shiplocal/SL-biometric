async function loadDebAdmin() {
  const station = document.getElementById('deb-admin-station-filter')?.value || '';
  const status  = document.getElementById('deb-admin-status-filter')?.value  || '';
  const body    = document.getElementById('deb-admin-body');
  body.innerHTML = '<tr><td colspan="15" style="text-align:center;padding:16px;color:var(--text-3)">Loading…</td></tr>';
  debSelectedIds.clear();
  updateDebSelCount();

  let url = '/api/admin/debit-queue';
  const qp = new URLSearchParams();
  if (station) qp.set('station', station);
  if (status)  qp.set('status', status);
  if (qp.toString()) url += '?' + qp.toString();

  try {
    const resp = await fetch(url).then(r => r.json());
    if (!Array.isArray(resp)) {
      body.innerHTML = `<tr class="empty-row"><td colspan="15">Error: ${resp.error||'Unexpected response'}</td></tr>`;
      return;
    }
    debAdminData = resp;
    if (!debAdminData.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="15">No entries found</td></tr>';
      return;
    }
    const esc = v => (v||'').toString().replace(/"/g,'&quot;').replace(/</g,'&lt;');
    body.innerHTML = debAdminData.map(it => `
      <tr id="dadmin-row-${it.id}" style="opacity:${it.status==='answered'?'.65':'1'}">
        <td><input type="checkbox" class="deb-chk" value="${it.id}" onchange="debRowCheck(${it.id},this.checked)"></td>
        <td style="font-family:monospace;font-size:.72rem;font-weight:700">${esc(it.station_code)}</td>
        <td style="font-family:monospace;font-size:.7rem">${esc(it.tid)}</td>
        <td style="white-space:nowrap;font-size:.74rem">${it.debit_date?it.debit_date.toString().substring(0,10):'-'}</td>
        <td style="font-size:.74rem">${esc(it.bucket)}</td>
        <td style="font-size:.72rem;color:var(--text-2)">${esc(it.loss_sub_bucket)}</td>
        <td style="font-size:.72rem">${esc(it.shipment_type)}</td>
        <td style="font-size:.72rem">${esc(it.ic_name)}</td>
        <td style="font-weight:700;text-align:right">₹${parseFloat(it.amount||0).toLocaleString('en-IN',{minimumFractionDigits:2})}</td>
        <td style="font-size:.72rem">${esc(it.confirm_by)}</td>
        <td style="font-size:.72rem">${esc(it.cash_recovery_type)}</td>
        <td style="font-size:.72rem;text-align:center">${it.cm_confirm||'-'}</td>
        <td style="font-size:.72rem;color:var(--text-2)">${esc(it.remarks)}</td>
        <td>${STATUS_PILL[it.status]||it.status}</td>
        <td style="white-space:nowrap;display:flex;gap:3px">
          ${it.status==='draft'
            ? `<button class="btn btn-green btn-sm" onclick="publishSelected([${it.id}])" title="Publish">🚀</button>`
            : ''}
          ${it.status==='answered'
            ? `<button class="btn btn-ghost btn-sm" onclick="sendBackSelected([${it.id}])" title="Send Back">↩</button>`
            : ''}
          <button class="btn btn-red btn-sm" onclick="deleteDebEntry(${it.id})" title="Delete">✕</button>
        </td>
      </tr>`).join('');
  } catch(e) {
    body.innerHTML = `<tr class="empty-row"><td colspan="15">Error: ${e.message}</td></tr>`;
  }
}

function debRowCheck(id, checked) {
  checked ? debSelectedIds.add(id) : debSelectedIds.delete(id);
  updateDebSelCount();
}

function debToggleAll(chk) {
  document.querySelectorAll('.deb-chk').forEach(c => {
    c.checked = chk.checked;
    debRowCheck(parseInt(c.value), chk.checked);
  });
}

function updateDebSelCount() {
  document.getElementById('deb-selected-count').textContent = `${debSelectedIds.size} selected`;
}

async function publishSelected(ids) {
  const toPublish = ids || [...debSelectedIds];
  if (!toPublish.length) return toast('Select entries to publish.', 'warning');
  const r = await fetch('/api/admin/debit-publish', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ids: toPublish})
  });
  if (r.ok) { toast(`Published ${toPublish.length} entr${toPublish.length===1?'y':'ies'} ✓`, 'success'); loadDebAdmin(); }
  else toast('Publish failed.', 'error');
}

async function publishAllDraft() {
  if (!confirm('Publish ALL draft entries?')) return;
  const r = await fetch('/api/admin/debit-publish', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ids:[]})
  });
  if (r.ok) { toast('All draft entries published ✓', 'success'); loadDebAdmin(); }
  else toast('Publish failed.', 'error');
}

async function sendBackSelected(ids) {
  const toSend = ids || [...debSelectedIds];
  if (!toSend.length) return toast('Select answered entries to send back.', 'warning');
  const r = await fetch('/api/admin/debit-sendback', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ids: toSend})
  });
  if (r.ok) { toast('Sent back ✓', 'success'); loadDebAdmin(); }
  else toast('Failed.', 'error');
}

async function deleteDebEntry(id) {
  if (!confirm('Delete this debit entry?')) return;
  const r = await fetch(`/api/admin/debit-data/${id}`, {method:'DELETE'});
  if (r.ok) { document.getElementById(`dadmin-row-${id}`)?.remove(); toast('Deleted.', 'success'); }
  else toast('Delete failed.', 'error');
}

async function deleteSelected() {
  if (!debSelectedIds.size) return toast('Select entries to delete.', 'warning');
  if (!confirm(`Delete ${debSelectedIds.size} entries?`)) return;
  await Promise.all([...debSelectedIds].map(id =>
    fetch(`/api/admin/debit-data/${id}`, {method:'DELETE'})
  ));
  toast('Deleted.', 'success');
  loadDebAdmin();
}

// New row entry
async function loadNewRowICs() {
  const station = document.getElementById('dnew-station').value;
  const sel     = document.getElementById('dnew-ic');
  if (!station) { sel.innerHTML = '<option value="">Select station first…</option>'; return; }
  sel.innerHTML = '<option>Loading…</option>';
  try {
    const resp = await fetch(`/api/ic-list?station=${encodeURIComponent(station)}`);
    const data = await resp.json();
    const ics  = data.ics || [];
    sel.innerHTML = '<option value="">Select IC…</option>';
    if (ics.length) {
      ics.forEach(u => {
        const name = (u.ic_name||'').trim();
        const opt  = document.createElement('option');
        opt.value       = name;
        opt.textContent = name + (u.designation ? ' ('+u.designation+')' : '');
        sel.appendChild(opt);
      });
    } else {
      sel.innerHTML = '<option value="">No staff found for '+station+'</option>';
    }
  } catch(e) { sel.innerHTML = '<option value="">Could not load</option>'; }
}

async function saveNewDebRow() {
  const tid     = document.getElementById('dnew-tid').value.trim();
  const station = document.getElementById('dnew-station').value;
  const value   = document.getElementById('dnew-value').value;
  if (!tid)     return toast('TID is required.', 'warning');
  if (!station) return toast('Station is required.', 'warning');
  if (!value || parseFloat(value) <= 0) return toast('Value must be > 0.', 'warning');

  const payload = {
    tid, station_code: station,
    impact_date:     document.getElementById('dnew-date').value || null,
    loss_bucket:     document.getElementById('dnew-bucket').value,
    loss_sub_bucket: document.getElementById('dnew-subbucket').value,
    shipment_type:   document.getElementById('dnew-shiptype').value,
    ic_name:         document.getElementById('dnew-ic').value,
    value:           parseFloat(value),
    confirm_by:      document.getElementById('dnew-confirmby').value,
    cash_recovery_type: document.getElementById('dnew-recovery').value,
    cm_confirm:      document.getElementById('dnew-cmconfirm').value,
    remarks:         document.getElementById('dnew-remarks').value,
  };

  const r = await fetch('/api/admin/debit-data/single', {
    method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
  });
  if (r.ok) {
    toast('Entry added ✓', 'success');
    // Clear new row fields
    ['dnew-tid','dnew-date','dnew-bucket','dnew-subbucket','dnew-value','dnew-confirmby','dnew-remarks']
      .forEach(id => { const el = document.getElementById(id); if(el) el.value=''; });
    ['dnew-station','dnew-shiptype','dnew-recovery','dnew-cmconfirm','dnew-ic']
      .forEach(id => { const el = document.getElementById(id); if(el) el.selectedIndex=0; });
    loadDebAdmin();
  } else {
    const d = await r.json();
    toast('Error: ' + d.error, 'error');
  }
}

// Old stubs kept for compatibility
async function loadDebitCycles() { loadDebAdmin(); }
async function openDebitEdit() {}
async function loadDebitEditItems() {}
const debRowEdits = {};
function debRowChanged() {}
async function saveDebRow() {}
async function deleteDebRow(id) { deleteDebEntry(id); }
async function createOrGetCycle() {}
function autoFillDebLabel() {
  const f=document.getElementById('deb-adm-from')?.value;
  const t=document.getElementById('deb-adm-to')?.value;
  if(!f||!t)return;
  const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fd=new Date(f),td=new Date(t);
  const lbl=document.getElementById('deb-adm-label');
  if(lbl)lbl.value=`${months[fd.getMonth()]} ${fd.getDate()}-${td.getDate()} ${td.getFullYear()}`;
}// -- OVERVIEW ---------------------------------------------