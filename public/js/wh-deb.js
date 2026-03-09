// fmtDate: local copy, no dependency on wh-kms.js
function fmtDate(d){if(!d)return '-';const dt=new Date(d);return isNaN(dt)?d:dt.toLocaleDateString('en-IN',{day:'2-digit',month:'short'});}

function debTab(t){
  debCurTab=t;
  document.getElementById('deb-t-f').classList.toggle('active',t==='final');
  document.getElementById('deb-t-r').classList.toggle('active',t==='recovery');
  renderDeb();
}

function renderDeb(){
  const items=stationData.debit.filter(i=>debCurTab==='final'?i.sub_type==='Final Loss':i.sub_type!=='Final Loss');
  const body=document.getElementById('deb-body');
  body.innerHTML=items.length?items.map(i=>`<tr>
    <td><strong style="font-family:'DM Mono',monospace">${i.tid}</strong><br><span style="font-size:.72rem;color:var(--text-3)">${fmtDate(i.debit_date)}</span></td>
    <td><strong style="color:var(--red-d)">₹${i.amount}</strong></td>
    <td style="font-size:.82rem">${i.confirm_by||'-'}</td>
    <td>
      ${debCurTab==='final'
        ?`<select class="deb-dec" data-tid="${i.tid}" style="font-size:.83rem;margin-bottom:4px"><option value="">Select…</option><option>Accept Loss</option><option>Dispute</option></select>`
        :`<input type="text" class="deb-tt" data-tid="${i.tid}" placeholder="TT #" style="margin-bottom:4px"><input type="text" class="deb-orphan" data-tid="${i.tid}" placeholder="Orphan ref">`
      }
    </td>
    <td><input type="text" class="deb-remarks" data-tid="${i.tid}" placeholder="Remarks…"></td>
  </tr>`).join(''):'<tr class="empty-row"><td colspan="5">No records for this category</td></tr>';
}

async function submitDeb(){
  const rows=stationData.debit.map(i=>{
    const dec=document.querySelector(`.deb-dec[data-tid="${i.tid}"]`);
    const tt=document.querySelector(`.deb-tt[data-tid="${i.tid}"]`);
    const orphan=document.querySelector(`.deb-orphan[data-tid="${i.tid}"]`);
    const rem=document.querySelector(`.deb-remarks[data-tid="${i.tid}"]`);
    return {tid:i.tid,subType:i.sub_type,decision:dec?.value||'',tt:tt?.value||'',orphan:orphan?.value||'',remarks:rem?.value||''};
  });
  try{
    const r=await fetch('/api/submit-deb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({station:session.station,periodLabel:session.periodLabel,rows})});
    if(r.ok){stationData.locks.DEB=true;toast('Debit responses submitted!','success');goHome();updateModuleBadges();}
    else toast('Submit failed.','error');
  }catch(e){toast('Error.','error');}
}

// -- SUMMARY -------------------------------------------------
// showSummary removed — each flow (KMS/ATT/ADV) now owns its own summary renderer// -- FACE MODAL -----------------------------------------------