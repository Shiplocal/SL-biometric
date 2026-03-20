// ── SHARED CELL HELPERS (used by wh-deb, wh-adv, wh-kms) ───────────────────
// renderPills: shows first `limit` names as pills, rest behind expand toggle
// truncRemark: truncates long text with inline read-more toggle
// Both use data-attributes on buttons to avoid any quote-escaping issues.

var _whPillSeq   = 0;
var _whRemarkSeq = 0;

function renderPills(csv, limit) {
  limit = limit || 3;
  var names = (csv || '').split(',').map(function(n){ return n.trim(); }).filter(Boolean);
  if (!names.length) return '<span style="color:var(--text-3);font-size:.75rem">—</span>';

  var id = 'wp-' + (++_whPillSeq);

  function pill(n) {
    return '<span style="display:block;background:var(--blue-bg);color:var(--navy);' +
           'border-radius:5px;padding:2px 8px;margin-bottom:2px;font-size:.7rem;' +
           'white-space:nowrap;font-weight:500">' +
           n.replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</span>';
  }

  var visible = names.slice(0, limit);
  var hidden  = names.slice(limit);

  if (!hidden.length) return visible.map(pill).join('');

  var count = hidden.length;
  return visible.map(pill).join('') +
    '<div id="' + id + '-more" style="display:none">' + hidden.map(pill).join('') + '</div>' +
    '<span class="_pill-toggle" data-target="' + id + '-more" data-count="' + count + '" ' +
    'style="display:inline-block;margin-top:3px;padding:1px 8px;border-radius:99px;' +
    'font-size:.68rem;font-weight:600;cursor:pointer;user-select:none;' +
    'background:var(--bg);color:var(--text-3);border:1px solid var(--border);' +
    'transition:all .15s">+' + count + ' more ▾</span>';
}

function truncRemark(text, max) {
  max = max || 60;
  var t = (text || '').trim();
  if (!t) return '<span style="color:var(--text-3)">—</span>';
  var safe = t.replace(/</g,'&lt;');
  if (t.length <= max) return '<span style="font-size:.72rem;color:var(--text-2)">' + safe + '</span>';

  var id   = 'wr-' + (++_whRemarkSeq);
  var head = safe.substring(0, max);
  var rest = safe.substring(max);
  return '<span style="font-size:.72rem;color:var(--text-2)">' +
    head +
    '<span id="' + id + '-rest" style="display:none">' + rest + '</span>' +
    '…<span class="_rmk-toggle" data-target="' + id + '-rest" ' +
    'style="color:var(--blue);cursor:pointer;font-size:.68rem;font-weight:600;margin-left:2px">more</span>' +
    '</span>';
}

// Single delegated listener handles all pill and remark toggles
document.addEventListener('click', function(e) {
  // Pill expand/collapse
  if (e.target.classList.contains('_pill-toggle')) {
    var btn  = e.target;
    var more = document.getElementById(btn.dataset.target);
    if (!more) return;
    var open = more.style.display !== 'none';
    more.style.display        = open ? 'none' : 'block';
    btn.textContent           = open ? '+' + btn.dataset.count + ' more ▾' : '▴ less';
    btn.style.background      = open ? 'var(--bg)'       : 'var(--amber-bg)';
    btn.style.color           = open ? 'var(--text-3)'   : 'var(--amber-d)';
    btn.style.borderColor     = open ? 'var(--border)'   : 'var(--amber)';
  }
  // Remark read-more/less
  if (e.target.classList.contains('_rmk-toggle')) {
    var btn  = e.target;
    var rest = document.getElementById(btn.dataset.target);
    if (!rest) return;
    var open = rest.style.display !== 'none';
    rest.style.display  = open ? 'none' : 'inline';
    btn.textContent     = open ? 'more' : 'less';
    // hide/show the ellipsis (text node before btn)
    var prev = btn.previousSibling;
    if (prev && prev.nodeType === 3) prev.textContent = open ? '…' : '';
  }
});

// ─────────────────────────────────────────────────────────────────────────────

const FACE_MODEL='https://unpkg.com/@vladmandic/face-api@1.7.15/model/';
let session={station:'',machineId:'',periodLabel:''};
let stationData={locks:{},ics:[],groups:[],bioMap:{},debit:[]};
let kmsStore={pending:[],done:[]};
let attStore={pending:[],review:[]};
let advStore={request:[],submitted:[]};
let debCurTab='final';
let openShifts={};
let allStaff=[];
let poll=null,curCode=null;
let face={action:null,icId:null,icName:null,stream:null,aiReady:false};

// -- TOAST --------------------------------------------------
// ── CM Back Button ────────────────────────────────────────────────────────
function addCMBackButton() {
  var existing = document.getElementById('cm-back-btn');
  if (existing) return;

  // Add "← CM Portal" button to top-right consistently
  var btn = document.createElement('button');
  btn.id = 'cm-back-btn';
  btn.innerHTML = '← CM Portal';
  btn.style.cssText = 'position:fixed;top:12px;right:12px;z-index:9999;' +
    'padding:7px 14px;font-size:.78rem;font-weight:700;' +
    'background:#0f2744;color:#fff;border:none;border-radius:8px;cursor:pointer;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.2);font-family:inherit';
  btn.onclick = function() { window.location.href = '/cm'; };
  document.body.appendChild(btn);

  // Update page title to indicate CM mode
  document.title = 'ShipLocal — CM: ' + session.station;

  // Add a station badge near top so CM knows which station they are acting as
  var badge = document.createElement('div');
  badge.id = 'cm-station-badge';
  badge.innerHTML = '🗺 Acting as: <strong>' + session.station + '</strong>';
  badge.style.cssText = 'position:fixed;top:12px;left:12px;z-index:9999;' +
    'padding:5px 12px;font-size:.76rem;background:#f0fdf4;color:#15803d;' +
    'border:1.5px solid #86efac;border-radius:8px;font-family:inherit;' +
    'box-shadow:0 2px 8px rgba(0,0,0,.1)';
  document.body.appendChild(badge);
}

function toast(msg,type='info',dur=3500){
  const icons={success:'✓',error:'✕',info:'ℹ',warning:'⚠'};
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  el.innerHTML=`<span>${icons[type]||'ℹ'}</span><span>${msg}</span>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(()=>{el.style.animation='toastOut .3s ease forwards';setTimeout(()=>el.remove(),300)},dur);
}

// -- INIT ---------------------------------------------------
window.onload=async()=>{
  loadFaceAI();

  // ── CM bypass: check for cm_token in URL ──────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  const cmToken = urlParams.get('cm_token');
  const cmStation = urlParams.get('cm_station');
  if (cmToken && cmStation) {
    try {
      const r = await fetch('/api/cm/verify-wh-token?token=' + encodeURIComponent(cmToken));
      const d = await r.json();
      if (d.valid && d.station) {
        session.station = d.station;
        session.isCM = true;  // flag so we can show "Back to CM Portal" button
        // Clean URL without exposing token
        window.history.replaceState({}, '', '/');
        // Add CM back button to UI
        addCMBackButton();
        loadDashboard();
        return;
      }
    } catch(e) { /* fall through to normal login */ }
  }

  // Try auto-login with stored token first — skip login screen if approved
  const token=localStorage.getItem('WH_MACHINE_TOKEN')||'';
  if(token){
    try{
      const r=await fetch('/api/verify-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
      const d=await r.json();
      if(d.authorized&&d.station){
        session.station=d.station;
        session.machineId=d.machineId;
        loadDashboard();
        return;
      }
    }catch(e){/* fall through to login screen */}
  }
  // No valid token — load station list and show login
  try{
    const r=await fetch('/api/stations');
    const list=await r.json();
    const sel=document.getElementById('sel-station');
    sel.innerHTML='<option value="">- Select Station -</option>';
    list.forEach(s=>sel.innerHTML+=`<option value="${s.station_code}">${s.station_code}${s.station_name?' · '+s.station_name:''}</option>`);
  }catch(e){toast('Failed to load stations.','error');}
};

async function loadFaceAI(){
  if(typeof faceapi==='undefined'){setTimeout(loadFaceAI,500);return;}
  try{
    await faceapi.nets.ssdMobilenetv1.loadFromUri(FACE_MODEL);
    await faceapi.nets.faceLandmark68Net.loadFromUri(FACE_MODEL);
    await faceapi.nets.faceRecognitionNet.loadFromUri(FACE_MODEL);
    face.aiReady=true;
  }catch(e){console.warn('Face AI',e);}
}

// -- AUTH ---------------------------------------------------
async function doLogin(){
  const st=document.getElementById('sel-station').value;
  const pw=document.getElementById('inp-pass').value;
  if(!st)return toast('Select a station.','warning');
  if(!pw)return toast('Enter the password.','warning');
  const btn=document.getElementById('btn-login');
  btn.disabled=true;btn.textContent='Verifying…';
  try{
    const r=await fetch('/api/manager-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:st,password:pw})});
    if(r.ok){session.station=(await r.json()).stationCode;checkToken();}
    else{toast('Invalid credentials.','error');btn.disabled=false;btn.textContent='Unlock Station →';}
  }catch(e){toast('Server error.','error');btn.disabled=false;btn.textContent='Unlock Station →';}
}

async function checkToken(){
  const token=localStorage.getItem('WH_MACHINE_TOKEN')||'';
  const r=await fetch('/api/verify-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
  const d=await r.json();
  // Accept if token is valid AND matches the station the user just logged into
  if(d.authorized&&d.station&&d.station===session.station){session.machineId=d.machineId;loadDashboard();}
  else showReg();
}

async function showReg(){
  const r=await fetch(`/api/pending-check/${session.station}`);
  const d=await r.json();
  curCode=d.hasPending?d.existingCode:String(Math.floor(100000+Math.random()*900000));
  document.getElementById('cctv-code').textContent=curCode;
  showScreen('s-reg');
}

async function doRequest(){
  const btn=document.getElementById('btn-req');
  btn.disabled=true;btn.textContent='Sent ✓';
  await fetch('/api/register-machine',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:session.station,code:curCode})});
  toast('Request sent - waiting for admin approval…','info',6000);
  document.getElementById('wait-row').classList.remove('hidden');
  if(poll)clearInterval(poll);
  poll=setInterval(async()=>{
    const r=await fetch(`/api/check-approval/${curCode}`);
    const d=await r.json();
    if(d.approved){clearInterval(poll);localStorage.setItem('WH_MACHINE_TOKEN',d.token);session.machineId=d.machineId;toast('Device approved!','success',2500);setTimeout(loadDashboard,1200);}
  },5000);
}

// -- DASHBOARD LOAD -----------------------------------------
async function loadDashboard(){
  showScreen('s-dash');
  document.getElementById('dash-station-title').textContent=`Station ${session.station}`;
  try{
    const r=await fetch(`/api/station-data/${session.station}`);
    stationData=await r.json();
    session.periodLabel=stationData.period.label;
    document.getElementById('dash-period-sub').textContent=`Period: ${stationData.period.label}`;
    document.getElementById('period-pill').textContent=stationData.period.label;
    updateModuleBadges();
    // Pre-populate stores
    initKmsStore();
    initAttStore();
    initAdvStore();
  }catch(e){toast('Failed to load station data.','error');}
  // If CM is logged in via WH token — show CM attendance card
  if (session.isCM) {
    loadCMAttendanceCard();
  }
}

// ── CM Attendance Card on WH Portal ──────────────────────────────────────
async function loadCMAttendanceCard() {
  // Remove existing card
  var existing = document.getElementById('cm-att-card');
  if (existing) existing.remove();

  var card = document.createElement('div');
  card.id = 'cm-att-card';
  card.style.cssText = 'margin:16px;padding:16px 18px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;font-family:inherit';
  card.innerHTML = '<div style="font-weight:700;color:#15803d;margin-bottom:10px">📋 CM Attendance — ' + session.station + '</div>' +
    '<div id="cm-att-status" style="font-size:.82rem;color:#166534;margin-bottom:12px">Loading…</div>' +
    '<div style="display:flex;gap:8px">' +
      '<button onclick="doCMWHPunch(\'CLOCK_IN\')" id="cm-btn-in" ' +
        'style="flex:1;padding:10px;font-size:.85rem;font-weight:700;border:none;border-radius:8px;background:#16a34a;color:#fff;cursor:pointer;font-family:inherit">🟢 Clock In</button>' +
      '<button onclick="doCMWHPunch(\'CLOCK_OUT\')" id="cm-btn-out" ' +
        'style="flex:1;padding:10px;font-size:.85rem;font-weight:700;border:none;border-radius:8px;background:#dc2626;color:#fff;cursor:pointer;font-family:inherit">🔴 Clock Out</button>' +
    '</div>' +
    '<div id="cm-att-msg" style="margin-top:8px;font-size:.76rem;min-height:16px"></div>';

  // Insert at top of dashboard
  var dash = document.getElementById('s-dash');
  if (dash) dash.insertBefore(card, dash.firstChild);

  // Load today's status
  try {
    var today = new Date().toISOString().split('T')[0];
    var r = await fetch('/api/cm/attendance-today?date=' + today, {credentials:'include'});
    var punches = await r.json();
    var stPunches = punches.filter(function(p){ return p.station_code === session.station; });
    var lastIn  = stPunches.filter(function(p){ return p.punch_type === 'CLOCK_IN'; }).pop();
    var lastOut = stPunches.filter(function(p){ return p.punch_type === 'CLOCK_OUT'; }).pop();
    var statusEl = document.getElementById('cm-att-status');
    if (!statusEl) return;
    if (lastIn) {
      var timeIn = new Date(lastIn.punched_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
      statusEl.textContent = lastOut
        ? '✓ Clocked in at ' + timeIn + ', clocked out at ' + new Date(lastOut.punched_at).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})
        : '● Currently clocked in since ' + timeIn;
    } else {
      statusEl.textContent = 'Not yet clocked in today at this station';
    }
  } catch(e) {
    var el = document.getElementById('cm-att-status');
    if (el) el.textContent = 'Could not load attendance';
  }
}

async function doCMWHPunch(punchType) {
  var btnIn  = document.getElementById('cm-btn-in');
  var btnOut = document.getElementById('cm-btn-out');
  var msgEl  = document.getElementById('cm-att-msg');
  if (btnIn)  btnIn.disabled  = true;
  if (btnOut) btnOut.disabled = true;
  if (msgEl)  msgEl.textContent = 'Verifying…';

  try {
    // Face verification required for WH punch
    var faceOk = await verifyCMFace();
    if (!faceOk) {
      if (msgEl) { msgEl.textContent = '❌ Face verification failed. Please try again.'; msgEl.style.color = '#dc2626'; }
      if (btnIn)  btnIn.disabled  = false;
      if (btnOut) btnOut.disabled = false;
      return;
    }
    var r = await fetch('/api/cm/wh-punch', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      credentials: 'include',
      body: JSON.stringify({
        station_code: session.station,
        punch_type:   punchType,
        machine_id:   session.machineId || ''
      })
    });
    var d = await r.json();
    if (r.ok) {
      if (msgEl) { msgEl.textContent = '✅ ' + (punchType==='CLOCK_IN'?'Clocked In':'Clocked Out') + ' at ' + session.station + ' · 🏭 WH Machine'; msgEl.style.color='#15803d'; }
      setTimeout(loadCMAttendanceCard, 1000);
    } else {
      if (msgEl) { msgEl.textContent = '❌ ' + (d.error||'Failed'); msgEl.style.color='#dc2626'; }
    }
  } catch(e) {
    if (msgEl) { msgEl.textContent = '❌ Error: ' + e.message; msgEl.style.color='#dc2626'; }
  }
  if (btnIn)  btnIn.disabled  = false;
  if (btnOut) btnOut.disabled = false;
}

async function verifyCMFace() {
  // Use existing face verification infrastructure
  // If test mode / bypassFace flag is set, skip
  if (window.testFlags && testFlags.bypassFace) return true;
  // Try to use existing face verification
  try {
    if (typeof verifyFaceForPunch === 'function') {
      return await verifyFaceForPunch();
    }
    // Fallback: use simple confirm for now (will be replaced with real face verify)
    return confirm('Face verification required. Are you physically present at ' + session.station + '?');
  } catch(e) { return false; }
}

function updateModuleBadges(){
  const {locks}=stationData;
  ['kms','att','adv','deb'].forEach(m=>{
    const badge=document.getElementById(`badge-${m}`);
    const locked=locks[m.toUpperCase()];
    // ADV and DEB are open-list modules — never show SUBMITTED badge, never lock the card
    if(m==='adv'||m==='deb'){
      badge.style.display='none';
      document.getElementById(`mc-${m}`).classList.remove('locked');
    } else {
      badge.style.display=locked?'block':'none';
      badge.textContent=locked?'SUBMITTED':'OPEN';
      badge.className=`mc-badge ${locked?'badge-submitted':'badge-open'}`;
      document.getElementById(`mc-${m}`).classList.toggle('locked',locked);
    }
  });
}

function initKmsStore(){
  const saved=JSON.parse(localStorage.getItem('wh_kms_'+session.station+'_'+session.periodLabel)||'[]');
  const savedKeys=saved.map(g=>g.groupKey);
  kmsStore.done=saved;
  kmsStore.pending=stationData.groups.filter(g=>!savedKeys.includes(g.groupKey));
  // Restore submitted groups for summary view after page reload
  if(stationData.locks&&stationData.locks.KMS&&saved.length){
    window._kmsSubmittedGroups=saved;
  }
  // populate IC datalist
  document.getElementById('ic-list').innerHTML=stationData.ics.map(ic=>`<option value="${ic.ic_name}">`).join('');
}

function initAttStore(){
  attStore.pending=stationData.ics.map(ic=>({
    icId:ic.ic_id, icName:ic.ic_name,
    bioDays:stationData.bioMap[ic.ic_id]||0,
    daysSubmitted:stationData.bioMap[ic.ic_id]||0
  }));
  attStore.review=[];
}

function initAdvStore(){
  const submittedIds = new Set((stationData.advLog||[]).map(a => String(a.ic_id)));
  advStore.submitted = (stationData.advLog||[]).map(a => ({
    icId: String(a.ic_id), icName: a.ic_name,
    amount: a.amount, reason: a.reason||'',
    verifiedBy: a.verified_by||'', submittedAt: a.submitted_at
  }));
  advStore.request = stationData.ics
    .filter(ic => !submittedIds.has(String(ic.ic_id)))
    .map(ic => ({icId: ic.ic_id, icName: ic.ic_name, amount:'', reason:''}));
}

// -- NAVIGATION --------------------------------------------
function navTo(mod){
  const locked=stationData.locks[mod];
  if(mod==='BIO'){showModule('bio');loadBioStaff();return;}
  if(locked){
    if(mod==='KMS'){
      const groups=window._kmsSubmittedGroups||(kmsStore.done&&kmsStore.done.length?kmsStore.done:null);
      if(groups&&groups.length){showKmsSummary(groups);return;}
      showKmsSummaryFlat(stationData.kmsLog||[],stationData.groups||[]);return;
    }
    if(mod==='ATT'){
      const attData=(stationData.attLog||[]).map(r=>({name:r.ic_name||r.name||'',days:r.days_submitted||r.days||0}));
      showAttSummary(attData);return;
    }
    // ADV and DEB: open-list modules — fall through to normal open handler
    if(mod!=='ADV'&&mod!=='DEB') return;
  }
  if(mod==='KMS'){showModule('kms');kmsTab('pending');return;}
  if(mod==='ATT'){showModule('att');attTab('pending');return;}
  if(mod==='ADV'){showModule('adv');advTab('request');return;}
  if(mod==='DEB'){
    showModule('deb');
    debTab('final');
    return;
  }
}

function goHome(){
  // Restore KMS module UI so it works normally on next open
  const wfTabs=document.querySelector('.wf-tabs');
  if(wfTabs)wfTabs.style.display='';
  const cp=document.getElementById('kms-controls-pending');
  if(cp)cp.style.display='';
  const cs=document.getElementById('kms-controls-submitted');
  if(cs)cs.style.display='none';
  showModule(null);
  showScreen('s-dash');
}

function showModule(id){
  ['bio','kms','att','adv','deb','sum'].forEach(m=>document.getElementById(`m-${m}`).style.display='none');
  if(id)document.getElementById(`m-${id}`).style.display='block';
}

function showScreen(id){
  ['s-login','s-reg','s-dash'].forEach(s=>document.getElementById(s).classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

function doLogout(){
  session={station:'',machineId:'',periodLabel:''};
  if(poll)clearInterval(poll);
  document.getElementById('inp-pass').value='';
  document.getElementById('btn-login').disabled=false;
  document.getElementById('btn-login').textContent='Unlock Station →';
  showModule(null);
  showScreen('s-login');
}