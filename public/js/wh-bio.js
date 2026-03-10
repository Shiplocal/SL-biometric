// ── BIOMETRIC MODULE ───────────────────────────────────────
async function loadBioStaff(){
  try{
    const r=await fetch(`/api/staff/${session.station}`);
    allStaff=await r.json();
    await loadShiftStatuses();
    renderStaff();
  }catch(e){toast('Failed to load staff.','error');}
}

async function loadShiftStatuses(){
  openShifts={};
  await Promise.all(allStaff.map(async e=>{
    try{const r=await fetch(`/api/shift-status/${e.ic_id}`);openShifts[e.ic_id]=await r.json();}catch(err){}
  }));
}

function renderStaff(){
  const term=document.getElementById('bio-search').value.toLowerCase();
  const cont=document.getElementById('emp-list');
  const f=allStaff.filter(e=>e.ic_name.toLowerCase().includes(term)||String(e.ic_id).includes(term));
  if(!f.length){cont.innerHTML='<div style="padding:28px;text-align:center;color:var(--text-3)">No employees found</div>';return;}
  cont.innerHTML=f.map(e=>{
    const init=e.ic_name.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const enrolled=e.has_face==1;                   // true only when enroll_status=APPROVED
    const pending=e.enroll_status==='PENDING';       // face scanned, awaiting admin approval
    const shiftData=openShifts[e.ic_id];
    const clockedIn=shiftData&&shiftData.status==='CLOCKED_IN';
    let btnClass,btnLabel,btnDisabled='';
    if(pending){
      btnClass='scan-enroll';btnLabel='PENDING APPROVAL';btnDisabled=' disabled';
    } else if(!enrolled){
      btnClass='scan-enroll';btnLabel='ENROLL';
    } else if(clockedIn){
      btnClass='scan-out';btnLabel='CLOCK OUT';
    } else {
      btnClass='scan-in';btnLabel='CLOCK IN';
    }
    const badge=clockedIn?`<span class="shift-badge in">IN ${fmtDur(shiftData.durationMins)}</span>`:'';
    const statusLine=pending
      ?`· <span style="color:var(--amber-d)">&#x23F3; Awaiting admin approval</span>`
      :enrolled
        ?`· <span style="color:var(--green-d)">Face enrolled</span>`
        :`· <span style="color:var(--text-3)">Not enrolled</span>`;
    const safeName=e.ic_name.replace(/'/g,"\\'");
    const onclk=pending?'':`onclick="openFace('${e.ic_id}','${safeName}',${enrolled},${clockedIn})"`;
    return `<div class="emp-row">
      <div class="emp-avatar">${init}</div>
      <div class="emp-info">
        <div class="emp-name">${e.ic_name}${badge}</div>
        <div class="emp-meta">ID · ${e.ic_id} ${statusLine}</div>
      </div>
      <button class="scan-btn ${btnClass}"${btnDisabled} ${onclk}>${btnLabel}</button>
    </div>`;
  }).join('');
}

function fmtDur(m){if(!m&&m!==0)return '';if(m<60)return `${m}m`;return `${Math.floor(m/60)}h${m%60?String(m%60).padStart(2,'0')+'m':''}`;}