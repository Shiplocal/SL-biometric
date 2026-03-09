// ── HELPERS ───────────────────────────────────────────────
function filterTbl(tbodyId,inputId){
  const term=document.getElementById(inputId).value.toLowerCase();
  document.querySelectorAll(`#${tbodyId} tr[data-search]`).forEach(r=>r.style.display=r.dataset.search.includes(term)?'':'none');
}
function closeModal(id){document.getElementById(id).classList.add('hidden');}
function confirm2(title,sub,cb){
  document.getElementById('conf-title').textContent=title; document.getElementById('conf-sub').textContent=sub;
  document.getElementById('confirm-modal').classList.remove('hidden');
  document.getElementById('conf-ok').onclick=async()=>{closeModal('confirm-modal');await cb();};
}
['approve-modal','success-modal','confirm-modal','resolve-modal','photo-modal','offboard-modal'].forEach(id=>{
  document.getElementById(id).addEventListener('click',function(e){if(e.target===this)closeModal(id);});
});
// defaults
document.getElementById('ov-date').value = new Date().toISOString().split('T')[0];
document.getElementById('viol-month').value=new Date().toISOString().substring(0,7);
// init overview
setOvView('att');