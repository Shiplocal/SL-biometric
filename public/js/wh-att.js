function attTab(t){
  document.getElementById('att-t-p').classList.toggle('active',t==='pending');
  document.getElementById('att-t-d').classList.toggle('active',t==='review');
  document.getElementById('att-cnt-p').textContent=attStore.pending.length;
  document.getElementById('att-cnt-d').textContent=attStore.review.length;
  renderAtt(t);
}

function renderAtt(tab){
  const data=tab==='pending'?attStore.pending:attStore.review;
  const grid=document.getElementById('att-grid');
  const acts=document.getElementById('att-actions');
  grid.innerHTML=data.map(ic=>{
    const init=ic.icName.split(' ').map(w=>w[0]).slice(0,2).join('').toUpperCase();
    const editable=tab==='pending';
    const maxDays=stationData.period.days||15;
    const opts=Array.from({length:maxDays+1},(_,v)=>`<option value="${v}" ${v===ic.daysSubmitted?'selected':''}>${v}</option>`).join('');
    return `<div class="att-card">
      <div class="att-avatar">${init}</div>
      <div style="flex:1">
        <div class="att-name">${ic.icName}</div>
        <div class="att-id">${ic.icId}</div>
        <div class="att-days">
          <select class="att-sel" data-id="${ic.icId}"
            ${editable?`onchange="updateAttDays('${ic.icId}',this.value)"`:'disabled'}
            style="width:72px;padding:5px 6px;font-size:.82rem;border:1.5px solid var(--border);border-radius:7px;background:#fff">
            ${opts}
          </select>
          <span class="att-bio">/ ${maxDays}d · Bio: ${ic.bioDays}d</span>
        </div>
      </div>
    </div>`;
  }).join('');
  if(tab==='pending'){
    acts.innerHTML=`<button class="btn btn-primary" onclick="attMoveToReview()">Validate & Move to Review →</button>`;
  } else {
    acts.innerHTML=`<button class="btn btn-danger" onclick="attReturn()">← Return</button><button class="btn btn-green" onclick="attFinalCommit()">Final Commit ✓</button>`;
  }
}

function updateAttDays(icId,val){const ic=attStore.pending.find(i=>i.icId===icId);if(ic)ic.daysSubmitted=parseInt(val)||0;}

function attMoveToReview(){
  attStore.review=[...attStore.pending];
  attStore.pending=[];
  toast(`${attStore.review.length} records moved to review.`,'success');
  attTab('review');
}

function attReturn(){attStore.pending=[...attStore.review];attStore.review=[];attTab('pending');}

async function attFinalCommit(){
  const rows=attStore.review.map(ic=>({icId:ic.icId,icName:ic.icName,bioDays:ic.bioDays,daysSubmitted:ic.daysSubmitted}));
  try{
    const r=await fetch('/api/submit-att',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:session.station,periodLabel:session.periodLabel,rows})});
    if(r.ok){
      stationData.locks.ATT=true;
      toast('Attendance submitted!','success');
      showAttSummary(attStore.review.map(ic=>({name:ic.icName,days:ic.daysSubmitted})));
    } else toast('Submit failed.','error');
  }catch(e){toast('Error.','error');}
}// -- ADV MODULE ---------------------------------------------

function showAttSummary(data){
  showModule('sum');
  document.getElementById('sum-title').textContent='✅ ATT Data Submitted';
  const tbl=document.querySelector('#m-sum .tbl-wrap table');
  if(tbl){tbl.removeAttribute('class');tbl.style.cssText='width:100%;border-collapse:collapse;table-layout:auto';}
  const cols=document.getElementById('sum-cols');if(cols)cols.innerHTML='';
  document.getElementById('sum-head').innerHTML='<tr><th>IC Name</th><th>Days Submitted</th></tr>';
  document.getElementById('sum-body').innerHTML=(data||[]).map(r=>
    `<tr><td>${r.name||r.icName||''}</td><td style="text-align:center">${r.days||r.daysSubmitted||0}</td></tr>`
  ).join('')||'<tr class="empty-row"><td colspan="2">No records</td></tr>';
}