const FACE_MODEL='https://unpkg.com/@vladmandic/face-api@1.7.15/model/';
let session={station:'',machineId:'',periodLabel:''};
let stationData={locks:{},ics:[],groups:[],bioMap:{},debit:[]};
let kmsStore={pending:[],done:[]};
let attStore={pending:[],review:[]};
let advStore={pending:[],review:[]};
let debCurTab='final';
let openShifts={};
let allStaff=[];
let poll=null,curCode=null;
let face={action:null,icId:null,icName:null,stream:null,aiReady:false};

// -- TOAST --------------------------------------------------
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
}

function updateModuleBadges(){
  const {locks}=stationData;
  ['kms','att','adv','deb'].forEach(m=>{
    const badge=document.getElementById(`badge-${m}`);
    const locked=locks[m.toUpperCase()];
    badge.style.display=locked?'block':'none';
    badge.textContent=locked?'SUBMITTED':'OPEN';
    badge.className=`mc-badge ${locked?'badge-submitted':'badge-open'}`;
    document.getElementById(`mc-${m}`).classList.toggle('locked',locked);
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
  advStore.pending=stationData.ics.map(ic=>({icId:ic.ic_id,icName:ic.ic_name,amount:'',reason:''}));
  advStore.review=[];
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
      // map server field names to what showAttSummary expects: {name, days}
      const attData=(stationData.attLog||[]).map(r=>({name:r.ic_name||r.name||'',days:r.days_submitted||r.days||0}));
      showAttSummary(attData);return;
    }
    if(mod==='ADV'){
      // map server field names to what showAdvSummary expects: {name, amount, reason}
      const advData=(stationData.advLog||[]).map(r=>({name:r.ic_name||r.name||'',amount:r.amount||0,reason:r.reason||'-'}));
      showAdvSummary(advData);return;
    }
    return;
  }
  if(mod==='DEB'&&locked){toast('Debit already submitted.','info');return;}
  if(mod==='KMS'){showModule('kms');kmsTab('pending');return;}
  if(mod==='ATT'){showModule('att');attTab('pending');return;}
  if(mod==='ADV'){showModule('adv');advTab('pending');return;}
  if(mod==='DEB'){showModule('deb');debTab('final');return;}
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