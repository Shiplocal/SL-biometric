function advTab(t){
  document.getElementById('adv-t-p').classList.toggle('active',t==='pending');
  document.getElementById('adv-t-d').classList.toggle('active',t==='review');
  document.getElementById('adv-cnt-p').textContent=advStore.pending.length;
  document.getElementById('adv-cnt-d').textContent=advStore.review.length;
  renderAdv(t);
}

function renderAdv(tab){
  const data=tab==='pending'?advStore.pending:advStore.review;
  const body=document.getElementById('adv-body');
  const acts=document.getElementById('adv-actions');
  const disabled=tab==='review'?'disabled':'';
  body.innerHTML=data.length?data.map(ic=>`<tr>
    <td><strong>${ic.icName}</strong></td>
    <td><span style="font-family:'DM Mono',monospace;font-size:.78rem">${ic.icId}</span></td>
    <td><input type="number" class="adv-amt" data-id="${ic.icId}" value="${ic.amount||''}" placeholder="0" min="0" ${disabled}></td>
    <td><input type="text" class="adv-rsn" data-id="${ic.icId}" value="${ic.reason||''}" placeholder="Reason…" ${disabled}></td>
  </tr>`).join(''):'<tr class="empty-row"><td colspan="4">No records</td></tr>';
  if(tab==='pending'){
    acts.innerHTML=`<button class="btn btn-primary" onclick="advMoveToReview()">Validate & Move to Review →</button>`;
  } else {
    acts.innerHTML=`<button class="btn btn-danger" onclick="advReturn()">← Return</button><button class="btn btn-green" onclick="advFinalCommit()">Final Commit ✓</button>`;
  }
}

function advMoveToReview(){
  document.querySelectorAll('.adv-amt').forEach(el=>{const ic=advStore.pending.find(i=>i.icId===el.dataset.id);if(ic)ic.amount=el.value;});
  document.querySelectorAll('.adv-rsn').forEach(el=>{const ic=advStore.pending.find(i=>i.icId===el.dataset.id);if(ic)ic.reason=el.value;});
  advStore.review=[...advStore.pending];
  advStore.pending=[];
  advTab('review');
}

function advReturn(){advStore.pending=[...advStore.review];advStore.review=[];advTab('pending');}

async function advFinalCommit(){
  const rows=advStore.review.filter(ic=>ic.amount&&parseFloat(ic.amount)>0);
  try{
    const r=await fetch('/api/submit-adv',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:session.station,periodLabel:session.periodLabel,rows})});
    if(r.ok){
      stationData.locks.ADV=true;
      toast('Advances submitted!','success');
      showAdvSummary(rows.map(ic=>({name:ic.icName,amount:ic.amount,reason:ic.reason})));
    } else toast('Submit failed.','error');
  }catch(e){toast('Error.','error');}
}// -- DEBIT MODULE --------------------------------------------

function showAdvSummary(data){
  showModule('sum');
  document.getElementById('sum-title').textContent='✅ ADV Data Submitted';
  const tbl=document.querySelector('#m-sum .tbl-wrap table');
  if(tbl){tbl.removeAttribute('class');tbl.style.cssText='width:100%;border-collapse:collapse;table-layout:auto';}
  const cols=document.getElementById('sum-cols');if(cols)cols.innerHTML='';
  document.getElementById('sum-head').innerHTML='<tr><th>IC Name</th><th>Amount</th><th>Reason</th></tr>';
  document.getElementById('sum-body').innerHTML=(data||[]).map(r=>
    `<tr><td>${r.name||r.icName||''}</td><td style="text-align:center">₹${r.amount||0}</td><td>${r.reason||'-'}</td></tr>`
  ).join('')||'<tr class="empty-row"><td colspan="3">No records</td></tr>';
}