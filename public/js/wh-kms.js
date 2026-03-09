function kmsTab(t){
  document.getElementById('kms-t-p').classList.toggle('active',t==='pending');
  document.getElementById('kms-t-d').classList.toggle('active',t==='done');
  document.getElementById('kms-controls-pending').style.display=t==='pending'?'flex':'none';
  document.getElementById('kms-controls-review').style.display=t==='done'?'flex':'none';
  if(t==='pending'){const el=document.getElementById('kms-search');if(el)el.value='';}
  if(t==='done'){const el=document.getElementById('kms-review-search');if(el)el.value='';}
  document.getElementById('kms-cnt-p').textContent=kmsStore.pending.length;
  document.getElementById('kms-cnt-d').textContent=kmsStore.done.length;
  renderKms(t);
}

function renderKms(tab){
  const data=tab==='pending'?kmsStore.pending:kmsStore.done;
  const head=document.getElementById('kms-head');
  const body=document.getElementById('kms-body');
  const acts=document.getElementById('kms-actions');
  const isDone=tab==='done';
  const isSubmitted=tab==='submitted'; // read-only submitted view — no checkboxes, no actions
  const showCb=isDone; // checkboxes only in review tab
  // Inject colgroup for fixed-layout column sizing
  const cols=document.getElementById('kms-cols');
  if(cols){
    const numCols=showCb
      ?`<col class="col-cb"><col class="col-amx"><col class="col-date"><col class="col-ic"><col class="col-kms"><col class="col-type"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num">`
      :`<col class="col-amx"><col class="col-date"><col class="col-ic"><col class="col-kms"><col class="col-type"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num"><col class="col-num">`;
    cols.innerHTML=numCols;
  }
  let hRow=`<tr>`;
  if(showCb)hRow+=`<th style="text-align:center"><input type="checkbox" id="kms-sel-all" onclick="kmsSelectAll(this)"></th>`;
  hRow+=`<th>AMX ID</th><th>Date</th><th>IC Name</th><th style="text-align:center">KMS</th><th style="text-align:center">Type</th><th style="text-align:center">Del</th><th style="text-align:center">Pick</th><th style="text-align:center">SWA</th><th style="text-align:center">SMD</th><th style="text-align:center">MFN</th><th style="text-align:center">Ret</th></tr>`;
  head.innerHTML=hRow;
  const colspan=showCb?12:11;
  if(!data.length){body.innerHTML=`<tr class="empty-row"><td colspan="${colspan}">No records</td></tr>`;acts.innerHTML='';return;}
  const rows=[];
  data.forEach((g,gi)=>{
    g.children.forEach((c,ci)=>{
      const isFirst=ci===0;
      const rs=g.children.length;
      const sepClass=isFirst&&gi>0?'group-sep':'';
      const clickClass=showCb&&isFirst?'kms-row-click':'';
      let row=`<tr class="${sepClass} ${clickClass}" data-key="${g.groupKey}">`;
      if(showCb&&isFirst){
        row+=`<td rowspan="${rs}" class="parent-cell" style="text-align:center"><input type="checkbox" class="kms-cb" data-key="${g.groupKey}" onclick="kmsRowCheck(this)"></td>`;
      }
      if(isFirst){
        row+=`<td rowspan="${rs}" class="parent-cell">${g.amxId}</td>`;
        row+=`<td rowspan="${rs}" class="parent-cell">${fmtDate(g.date)}</td>`;
        row+=`<td rowspan="${rs}" class="parent-cell"><input list="ic-list" class="amx-ic" data-key="${g.groupKey}" value="${g.assignedIC||''}"${isDone||isSubmitted?' disabled':''}></td>`;
        row+=`<td rowspan="${rs}" class="parent-cell"><input type="number" class="amx-kms" data-key="${g.groupKey}" value="${g.assignedKMS||''}" min="0"${isDone||isSubmitted?' disabled':''}></td>`;
      }
      row+=`<td style="text-align:center">${c.pType}</td><td style="text-align:center">${c.delivered}</td><td style="text-align:center">${c.pickup}</td><td style="text-align:center">${c.swa}</td><td style="text-align:center">${c.smd}</td><td style="text-align:center">${c.mfn}</td><td style="text-align:center">${c.returns}</td></tr>`;
      rows.push(row);
    });
  });
  body.innerHTML=rows.join('');

  // Build group index for filtering
  window._kmsGroupIndex=[];
  const groupRowMap={};
  body.querySelectorAll('tr[data-key]').forEach(tr=>{
    const key=tr.dataset.key;
    if(!groupRowMap[key])groupRowMap[key]=[];
    groupRowMap[key].push(tr);
  });
  data.forEach(g=>{
    const searchText=(g.amxId+' '+fmtDate(g.date)+' '+(g.assignedIC||'')).toLowerCase();
    window._kmsGroupIndex.push({key:g.groupKey, text:searchText, trs:groupRowMap[g.groupKey]||[]});
  });

  // Row-click toggles checkbox — review tab only
  if(showCb){
    body.querySelectorAll('tr.kms-row-click').forEach(tr=>{
      tr.addEventListener('click',e=>{
        if(e.target.tagName==='INPUT')return;
        const cb=document.querySelector(`.kms-cb[data-key="${tr.dataset.key}"]`);
        if(cb){cb.checked=!cb.checked;kmsRowCheck(cb);}
      });
    });
  }
  if(isSubmitted){
    acts.innerHTML=''; // no actions on submitted view
  } else if(!isDone){
    acts.innerHTML=`<button class="btn btn-primary" onclick="kmsMoveToReview()">Validate & Move to Review →</button>`;
  } else {
    acts.innerHTML=`<button class="btn btn-danger" onclick="kmsReturnSelected()">← Return Selected</button><button class="btn btn-green" onclick="kmsFinalCommit()">Final Commit ✓</button>`;
  }
}

function kmsRowCheck(cb){
  const entry=window._kmsGroupIndex?.find(e=>e.key===cb.dataset.key);
  if(entry)entry.trs.forEach(tr=>tr.classList.toggle('kms-selected',cb.checked));
  // Only count visible checkboxes so select-all reflects the filtered view
  const allCbs=Array.from(document.querySelectorAll('.kms-cb'));
  const visibleCbs=allCbs.filter(el=>{
    const e=window._kmsGroupIndex?.find(x=>x.key===el.dataset.key);
    return e?e.trs.some(tr=>tr.style.display!=='none'):true;
  });
  const checkedVisible=visibleCbs.filter(el=>el.checked);
  const sa=document.getElementById('kms-sel-all');
  if(sa){
    sa.indeterminate=checkedVisible.length>0&&checkedVisible.length<visibleCbs.length;
    sa.checked=visibleCbs.length>0&&checkedVisible.length===visibleCbs.length;
  }
}

function fmtDate(d){if(!d)return '-';const dt=new Date(d);return isNaN(dt)?d:dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});}

// Single filter function used by both pending (AMX/date search) and review (IC name search)
// Shows/hides entire groups - all child rows move together
function filterKms(v){
  if(!window._kmsGroupIndex)return;
  const val=v.toLowerCase();
  window._kmsGroupIndex.forEach(({text,trs})=>{
    const show=!val||text.includes(val);
    trs.forEach(tr=>tr.style.display=show?'':'none');
  });
}

function filterKmsReview(v){
  filterKms(v);
  // keep select-all checkbox state consistent after filter
  const all=document.querySelectorAll('.kms-cb');
  const checked=document.querySelectorAll('.kms-cb:checked');
  const sa=document.getElementById('kms-sel-all');
  if(sa){sa.indeterminate=checked.length>0&&checked.length<all.length;sa.checked=checked.length>0&&checked.length===all.length;}
}

function kmsSelectVisible(){
  document.querySelectorAll('.kms-cb').forEach(cb=>{
    const entry=window._kmsGroupIndex?.find(e=>e.key===cb.dataset.key);
    const visible=entry?entry.trs.some(tr=>tr.style.display!=='none'):false;
    cb.checked=visible;
    kmsRowCheck(cb);
  });
}

function bulkAssignIC(){
  const ic=document.getElementById('bulk-ic').value;
  if(!ic)return;
  document.querySelectorAll('.amx-ic').forEach(el=>{
    const entry=window._kmsGroupIndex?.find(e=>e.key===el.dataset.key);
    const visible=entry?entry.trs[0]?.style.display!=='none':true;
    if(visible)el.value=ic;
  });
}

function kmsSelectAll(cb){
  document.querySelectorAll('.kms-cb').forEach(el=>{
    const entry=window._kmsGroupIndex?.find(e=>e.key===el.dataset.key);
    const visible=entry?entry.trs.some(tr=>tr.style.display!=='none'):true;
    if(!visible)return;
    el.checked=cb.checked;
    // Toggle highlight directly without triggering header recalc on every row
    if(entry)entry.trs.forEach(tr=>tr.classList.toggle('kms-selected',cb.checked));
  });
  // Update header checkbox once after all rows are processed
  cb.indeterminate=false;
}

function kmsMoveToReview(){
  const moved=[];
  const stayPending=[];
  kmsStore.pending.forEach(g=>{
    const icEl=document.querySelector(`.amx-ic[data-key="${g.groupKey}"]`);
    const kmsEl=document.querySelector(`.amx-kms[data-key="${g.groupKey}"]`);
    const ic=icEl?.value.trim()||'';
    const kms=kmsEl?.value||0;
    const validIC=stationData.ics.some(i=>i.ic_name.toLowerCase()===ic.toLowerCase());
    if(ic&&validIC){
      g.assignedIC=ic;g.assignedKMS=kms;
      g.assignedIcId=(stationData.ics.find(i=>i.ic_name.toLowerCase()===ic.toLowerCase())||{}).ic_id||'';
      moved.push(g);
    } else stayPending.push(g);
  });
  if(moved.length===0){toast('No valid assignments. Enter IC names.','warning');return;}
  kmsStore.done=[...kmsStore.done,...moved];
  kmsStore.pending=stayPending;
  localStorage.setItem('wh_kms_'+session.station+'_'+session.periodLabel,JSON.stringify(kmsStore.done));
  if(stayPending.length>0){
    toast(`${moved.length} moved to review. ${stayPending.length} still pending — assign IC before committing.`,'warning',5000);
  } else {
    toast(`${moved.length} record${moved.length>1?'s':''} moved to review.`,'success');
  }
  kmsTab('done');
}

function kmsReturnSelected(){
  const sel=Array.from(document.querySelectorAll('.kms-cb:checked')).map(cb=>cb.dataset.key);
  if(!sel.length){toast('Select records to return.','warning');return;}
  kmsStore.pending=[...kmsStore.pending,...kmsStore.done.filter(g=>sel.includes(g.groupKey)).map(g=>{
    const clone=Object.assign({},g,{children:g.children.map(c=>Object.assign({},c))});
    delete clone.assignedIC;delete clone.assignedKMS;delete clone.assignedIcId;
    return clone;
  })];
  kmsStore.done=kmsStore.done.filter(g=>!sel.includes(g.groupKey));
  localStorage.setItem('wh_kms_'+session.station+'_'+session.periodLabel,JSON.stringify(kmsStore.done));
  toast(`${sel.length} record${sel.length>1?'s':''} returned to pending.`,'info');
  kmsTab('done');
}

async function kmsFinalCommit(){
  if(!kmsStore.done.length){toast('Nothing to commit.','warning');return;}
  if(kmsStore.pending.length>0){
    toast(`Cannot commit — ${kmsStore.pending.length} record${kmsStore.pending.length>1?'s':''} still pending. Assign IC names first.`,'error',5000);
    kmsTab('pending');
    return;
  }
  const rows=[];
  kmsStore.done.forEach(g=>g.children.forEach(c=>rows.push({
    amxId:g.amxId,icId:g.assignedIcId||'',icName:g.assignedIC,date:g.date,
    kms:g.assignedKMS||0,pType:c.pType,delivered:c.delivered,pickup:c.pickup,
    swa:c.swa,smd:c.smd,mfn:c.mfn,returns:c.returns
  })));
  try{
    const r=await fetch('/api/submit-kms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:session.station,periodLabel:session.periodLabel,rows})});
    if(r.ok){
      localStorage.removeItem('wh_kms_'+session.station+'_'+session.periodLabel);
      stationData.locks.KMS=true;
      toast('KMS submitted successfully!','success');
      window._kmsSubmittedGroups=[...kmsStore.done];
      showKmsSummary(kmsStore.done);
    } else toast('Submit failed.','error');
  }catch(e){toast('Server error.','error');}
}

let _kmsFilterTimer=null;
function debouncedFilterKms(v){
  clearTimeout(_kmsFilterTimer);
  _kmsFilterTimer=setTimeout(()=>filterKms(v),180);
}

function showKmsSummary(data){
  showModule('kms');
  kmsStore.done = data;
  renderKms('submitted');
  // Hide tabs and controls — submitted view is read-only
  const wfTabs=document.querySelector('.wf-tabs');
  if(wfTabs)wfTabs.style.display='none';
  const cp=document.getElementById('kms-controls-pending');
  if(cp)cp.style.display='none';
  const cr=document.getElementById('kms-controls-review');
  if(cr)cr.style.display='none';
  // Show submitted search bar, clear any previous value
  const cs=document.getElementById('kms-controls-submitted');
  if(cs)cs.style.display='flex';
  const si=document.getElementById('kms-submitted-search');
  if(si){si.value='';si.focus();}
}

function showKmsSummaryFlat(kmsLog, edspGroups){
  // Rebuild kmsStore.done groups from server data then reuse showKmsSummary
  // toDateStr: safely extract YYYY-MM-DD from a value that may be a JS Date object,
  // ISO string, or plain YYYY-MM-DD string (mysql2 returns DATE cols as JS Date objects)
  const toDateStr=v=>{
    if(!v)return '';
    if(v instanceof Date)return v.toISOString().substring(0,10);
    const s=String(v);
    const m=s.match(/(\d{4}-\d{2}-\d{2})/);
    return m?m[1]:s.substring(0,10);
  };
  const groupMap={};
  const groupOrder=[];
  (edspGroups||[]).forEach(g=>{
    // groupKey was built in app.js as `${amx_id}_${delivery_date}` — normalise the date part
    const parts=g.groupKey.split('_');
    // date is the last underscore-segment that looks like a date
    const normKey=(g.amxId||parts.slice(0,-1).join('_'))+'_'+toDateStr(g.date||parts[parts.length-1]);
    groupMap[normKey]={...g, groupKey:normKey, assignedIC:'', assignedKMS:0};
    groupOrder.push(normKey);
  });
  (kmsLog||[]).forEach(r=>{
    const key=(r.amx_id||'')+'_'+toDateStr(r.delivery_date);
    if(groupMap[key]){
      groupMap[key].assignedIC=r.ic_name||'';
      groupMap[key].assignedKMS=r.kms||0;
    }
  });
  const groups=groupOrder.map(k=>groupMap[k]).filter(g=>g.assignedIC);
  showKmsSummary(groups);
}