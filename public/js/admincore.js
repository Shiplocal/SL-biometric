let pendingApprove={cctvCode:null,stationCode:null}, resolveViolId=null, activePL='';
let _cachedCycles=null;

function toast(msg,type='info',dur=3500){
  const icons={success:'✓',error:'✕',info:'ℹ',warning:'⚠'};
  const el=document.createElement('div'); el.className=`toast ${type}`;
  el.innerHTML=`<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>{el.style.animation='tOut .3s ease forwards';setTimeout(()=>el.remove(),300)},dur);
}

async function doLogin() {
  const pw=document.getElementById('inp-pass').value;
  if(!pw)return toast('Enter the admin password.','warning');
  const btn=document.getElementById('btn-login'); btn.disabled=true; btn.textContent='Verifying…';
  const r=await fetch('/api/admin-verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw})});
  if(r.ok){
    document.getElementById('login-wrap').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    await populateFilters(); refreshAll();
  } else { toast('Incorrect password.','error'); btn.disabled=false; btn.textContent='Access Dashboard →'; }
}

async function populateFilters() {
  try {
    const list=await fetch('/api/stations').then(r=>r.json());
    // Global station filter
    const gSel=document.getElementById('global-station');
    const curVal=gSel.value;
    gSel.innerHTML='<option value="">🏢 All Stations</option>';
    list.forEach(s=>gSel.innerHTML+=`<option value="${s.station_code}">${s.station_code}</option>`);
    if(curVal) gSel.value=curVal;

    [document.getElementById('viol-station'),document.getElementById('ul-station'),
     document.getElementById('debit-edit-station-filter'),
     document.getElementById('adv-station-filter')].forEach(sel=>{
      if(!sel)return;
      const cv=sel.value;
      sel.innerHTML='<option value="">All Stations</option>';
      list.forEach(s=>sel.innerHTML+=`<option value="${s.station_code}">${s.station_code}</option>`);
      if(cv) sel.value=cv;
    });
    // Users station filter
    const uSel=document.getElementById('users-station-filter');
    if(uSel){const cv=uSel.value;uSel.innerHTML='<option value="">All Stations</option>';list.forEach(s=>uSel.innerHTML+=`<option value="${s.station_code}">${s.station_code}</option>`);if(cv)uSel.value=cv;}
  } catch(e){}
  try {
    // Populate period selectors (ov-period, deb-period) from config_period
    const periods=await fetch('/api/admin/periods').then(r=>r.json());
    const active=periods.find(p=>p.is_active);
    const defaultPL = active ? active.period_label : null;
    ['ov-period'].forEach(sid=>{
      const s=document.getElementById(sid); if(!s)return; s.innerHTML='';
      periods.forEach(p=>s.innerHTML+=`<option value="${p.period_label}" ${p.period_label===defaultPL?'selected':''}>${p.period_label}${p.is_active?' ★':''}</option>`);
    });
    if(defaultPL){activePL=defaultPL;document.getElementById('active-period').textContent=defaultPL;document.getElementById('ul-period').value=defaultPL;}
  } catch(e){}
  try {
    // Populate KMS cycle selector from edsp_cycles (keyed by cycle id, not period_label)
    const cycles=await fetch('/api/admin/edsp-cycles').then(r=>r.json());
    if(Array.isArray(cycles)){ _cachedCycles=cycles; if(typeof edspRenderCycles==='function') edspRenderCycles(cycles); }
    const kmsSel=document.getElementById('kms-period'); if(kmsSel && Array.isArray(cycles) && cycles.length){
      kmsSel.innerHTML='';
      // Default to most recent cycle (first in list, ordered by id DESC)
      cycles.forEach((c,i)=>kmsSel.innerHTML+=`<option value="${c.id}" ${i===0?'selected':''}>${c.cycle_label}${c.is_active?' ★':''}</option>`);
    }
  } catch(e){}
}

function getGlobalStation(){return document.getElementById('global-station').value;}

function onGlobalStationChange(){
  // Re-run current active tab's load function
  const station=getGlobalStation();
  const activeTab=document.querySelector('.tab-panel.active');
  if(!activeTab)return;
  const id=activeTab.id;
  if(id==='t-kms'){loadEdspCycles();}
  else if(id==='t-adv')loadAdv();
  else if(id==='t-deb'){debSubTab('resp');populateDebStations();}
  else if(id==='t-ov')renderOvView();
  else if(id==='t-users'){loadUsers();loadEnroll();}
  else if(id==='t-viol')loadViol();
}

function sw(id){
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.getElementById('tab-'+id).classList.add('active');
  // Auto-load tab content
  if(id==='t-kms'){loadEdspCycles();}
  else if(id==='t-adv')loadAdv();
  else if(id==='t-deb'){debSubTab('resp');populateDebStations();}
  else if(id==='t-ov')renderOvView();
  else if(id==='t-users'){loadUsers();loadEnroll();}
  else if(id==='t-viol')loadViol();
  else if(id==='t-machines')loadMachines();
  else if(id==='t-legacy')loadLegacyTab();
  else if(id==='t-test')loadTestFlags();
  else if(id==='t-data'){}
}

function refreshAll(){
  const activeTab = document.querySelector('.tab-panel.active');
  if (!activeTab) return;
  const id = activeTab.id;
  if(id==='t-kms'){loadEdspCycles();}
  else if(id==='t-adv')loadAdv();
  else if(id==='t-deb'){debSubTab('resp');populateDebStations();}
  else if(id==='t-ov')renderOvView();
  else if(id==='t-users'){loadUsers();loadEnroll();}
  else if(id==='t-viol')loadViol();
  else if(id==='t-machines')loadMachines();
  else if(id==='t-legacy')loadLegacyTab();
  else renderOvView();
}// -- EDSP CYCLES -------------------------------------------
let edspUploadFile = null;
let currentEditingDebitCycleId = null;

function onEdspFileSelected(input) {
  edspUploadFile = input.files[0];
  document.getElementById('edsp-file-lbl').textContent = edspUploadFile ? edspUploadFile.name : 'Click to select EDSP file';
  document.getElementById('btn-edsp-upload').disabled = !edspUploadFile;
  autoFillEdspLabel();
}

function autoFillEdspLabel() {
  const from=document.getElementById('edsp-from').value;
  const to=document.getElementById('edsp-to').value;
  if(from&&to){
    const f=new Date(from),t=new Date(to);
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const label=`${months[f.getMonth()]} ${f.getDate()}-${t.getDate()} ${t.getFullYear()}`;
    document.getElementById('edsp-cycle-label').value=label;
  }
}
document.addEventListener('DOMContentLoaded',()=>{ 
  document.getElementById('edsp-from')?.addEventListener('change',autoFillEdspLabel);
  document.getElementById('edsp-to')?.addEventListener('change',autoFillEdspLabel);
  // Populate legacy station filter
  fetch('/api/legacy/stations').then(r=>r.json()).then(stations => {
    window._stations = stations;
    // Legacy data tab filter
    const legSel = document.getElementById('leg-station-filter');
    if (legSel) stations.forEach(s => legSel.innerHTML += `<option value="${(s.station_code||'').trim()}">${(s.station_code||'').trim()} - ${(s.store_name||'').trim()}</option>`);
    // Debit admin station filter
    const debSel = document.getElementById('deb-admin-station-filter');
    if (debSel) stations.forEach(s => debSel.innerHTML += `<option value="${(s.station_code||'').trim()}">${(s.station_code||'').trim()}</option>`);
    // Debit new row station dropdown
    const dnewSel = document.getElementById('dnew-station');
    if (dnewSel) stations.forEach(s => dnewSel.innerHTML += `<option value="${(s.station_code||'').trim()}">${(s.station_code||'').trim()}</option>`);
  }).catch(()=>{});
});

async function uploadEdspCycle() {
  const cycleLabel=document.getElementById('edsp-cycle-label').value.trim();
  const dateFrom=document.getElementById('edsp-from').value;
  const dateTo=document.getElementById('edsp-to').value;
  if(!cycleLabel||!dateFrom||!dateTo||!edspUploadFile) return toast('Fill all fields and select a file.','warning');

  const statusEl=document.getElementById('edsp-upload-status');
  statusEl.textContent='Checking for existing data…';

  // Check if data exists for this label
  const check=await fetch(`/api/admin/edsp-cycles/check?cycleLabel=${encodeURIComponent(cycleLabel)}`).then(r=>r.json());
  if(check.exists){
    if(!confirm(`⚠ Cycle "${cycleLabel}" already has ${check.count} rows. Replace all data?`)) return;
  }

  statusEl.textContent='Saving file to server…';
  // Upload file to server first via form
  const fd=new FormData(); fd.append('file',edspUploadFile); fd.append('dest','edsp_upload');
  const upRes=await fetch('/api/admin/upload-file',{method:'POST',body:fd});
  if(!upRes.ok){statusEl.textContent='File upload failed.';return;}
  const {filePath}=await upRes.json();

  statusEl.textContent='Importing data…';
  const res=await fetch('/api/admin/edsp-cycles/upload',{
    method:'POST',headers:{'Content-Type':'application/json','x-cron-secret':'sl-midnight-2026'},
    body:JSON.stringify({cycleLabel,dateFrom,dateTo,filePath})
  });
  const data=await res.json();
  if(data.success){
    statusEl.textContent=`✓ Inserted ${data.inserted} rows (${data.skipped} skipped). Ready to publish.`;
    loadEdspCycles();
  } else {
    statusEl.textContent=`Error: ${data.error}`;
  }
}

function loadEdspCycles(){
  if(typeof edspRenderCycles==='function' && _cachedCycles && _cachedCycles.length){
    edspRenderCycles(_cachedCycles);
  } else if(typeof edspTestLoad==='function'){
    edspTestLoad();
  }
}

async function toggleEdspPublish(cycleId, publish){
  const r=await fetch('/api/admin/edsp-cycles/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cycleId,publish})});
  if(r.ok){toast(publish?'Cycle set as active ✓':'Cycle deactivated.', publish?'success':'warning');loadEdspCycles();}
  else toast('Failed.','error');
}// -- DEBIT ADMIN ------------------------------------------
let debAdmFile = null;
let _debStationsLoaded = false;

function populateDebStations() {
  if (_debStationsLoaded) return;
  const stations = window._stations || [];
  if (!stations.length) {
    // fetch now if not yet loaded
    fetch('/api/legacy/stations').then(r=>r.json()).then(sts => {
      window._stations = sts;
      _fillDebStations(sts);
    }).catch(()=>{});
    return;
  }
  _fillDebStations(stations);
}

function _fillDebStations(stations) {
  if (_debStationsLoaded) return;
  _debStationsLoaded = true;
  const selectors = ['deb-admin-station-filter','dnew-station'];
  selectors.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    // Keep first option, rebuild rest
    while (sel.options.length > 1) sel.remove(1);
    stations.forEach(s => {
      const code = (s.station_code||'').trim();
      if (!code) return;
      const opt = document.createElement('option');
      opt.value = code;
      opt.textContent = code + (s.store_name ? ' - '+s.store_name.trim().substring(0,18) : '');
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
}
let debAdminData = [];
const debSelectedIds = new Set();

function onDebAdmFileSelected(inp) {
  debAdmFile = inp.files[0] || null;
  document.getElementById('deb-adm-file-lbl').textContent = debAdmFile ? debAdmFile.name : 'Upload Excel';
  const btn = document.getElementById('btn-deb-adm-upload');
  btn.disabled = !debAdmFile;
  btn.style.opacity = debAdmFile ? '1' : '.45';
  btn.style.cursor  = debAdmFile ? 'pointer' : 'not-allowed';
}

async function uploadDebEntries() {
  if (!debAdmFile) return;
  const statusEl = document.getElementById('deb-adm-status');
  statusEl.textContent = 'Importing…';
  const fd = new FormData();
  fd.append('file', debAdmFile);
  try {
    const res = await fetch('/api/admin/debit-upload', {method:'POST', body:fd});
    const text = await res.text();
    let d;
    try { d = JSON.parse(text); }
    catch(e) { statusEl.textContent = 'Server error (non-JSON response). Check server logs.'; console.error('Server returned:', text.substring(0,300)); return; }
    if (d.success) {
      const errNote = d.firstError ? ` — first error: ${d.firstError}` : '';
      statusEl.innerHTML = `<span style="color:${d.inserted?'var(--green-d)':'var(--red-d)'}">✓ ${d.inserted} imported, ${d.skipped} skipped${errNote}</span>`;
      debAdmFile = null;
      document.getElementById('deb-adm-file-lbl').textContent = 'Upload Excel';
      const btn = document.getElementById('btn-deb-adm-upload');
      btn.disabled = true;
      btn.style.opacity = '.45';
      btn.style.cursor = 'not-allowed';
      loadDebAdmin();
    } else {
      statusEl.textContent = 'Error: ' + d.error;
    }
  } catch(e) {
    statusEl.textContent = 'Error: ' + e.message;
  }
}

const STATUS_PILL = {
  draft:      '<span class="pill p-open">Draft</span>',
  published:  '<span class="pill p-enrolled">Published</span>',
  answered:   '<span style="font-size:.7rem;padding:2px 8px;border-radius:8px;background:var(--green-bg);color:var(--green-d);font-weight:600">Answered</span>',
  sent_back:  '<span style="font-size:.7rem;padding:2px 8px;border-radius:8px;background:var(--amber-bg);color:var(--amber-d);font-weight:600">Sent Back</span>',
};