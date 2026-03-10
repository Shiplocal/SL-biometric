// ── FACE MODAL ───────────────────────────────────────────────
async function openFace(icId,name,enrolled,clockedIn){
  face.icId=icId;face.icName=name;
  if(!enrolled)face.action='ENROLL';
  else if(clockedIn)face.action='CLOCK_OUT';
  else face.action='CLOCK_IN';
  const labels={ENROLL:'FACE ENROLMENT',CLOCK_IN:'CLOCK IN',CLOCK_OUT:'CLOCK OUT'};
  document.getElementById('face-mode-lbl').textContent=labels[face.action];
  document.getElementById('face-name-lbl').textContent=name;
  document.getElementById('shift-result').style.display='none';
  document.getElementById('v-wrap').style.display='block';
  setFaceStatus('idle','Initialising camera…');
  const btn=document.getElementById('btn-face-action');
  btn.disabled=true;
  btn.textContent=face.action==='ENROLL'?'Enroll Face':face.action==='CLOCK_IN'?'Clock In':'Clock Out';
  btn.className=`btn ${face.action==='CLOCK_OUT'?'btn-red-solid':face.action==='CLOCK_IN'?'btn-green':'btn-primary'}`;
  const ring=document.getElementById('face-ring');
  ring.className='face-ring'+(face.action==='CLOCK_IN'?' in':face.action==='CLOCK_OUT'?' out':'');
  document.getElementById('face-overlay').classList.remove('hidden');
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,facingMode:'user'}});
    face.stream=stream;
    const vid=document.getElementById('face-video');
    vid.srcObject=stream;
    vid.onloadedmetadata=()=>{
      const msgs={ENROLL:'Position face in ring',CLOCK_IN:'Ready to clock in',CLOCK_OUT:'Ready to clock out'};
      if(face.aiReady){setFaceStatus('idle',msgs[face.action]);btn.disabled=false;}
      else{setFaceStatus('scanning','Loading AI…');const w=setInterval(()=>{if(face.aiReady){clearInterval(w);setFaceStatus('idle',msgs[face.action]);btn.disabled=false;}},500);}
    };
  }catch(e){setFaceStatus('error','Camera access denied');}
}

function closeFace(){
  document.getElementById('face-overlay').classList.add('hidden');
  if(face.stream){face.stream.getTracks().forEach(t=>t.stop());face.stream=null;}
  document.getElementById('face-video').srcObject=null;
}

// ── capture photo from live video ──────────────────────────
function capturePhoto(){
  const vid=document.getElementById('face-video');
  const c=document.createElement('canvas');
  c.width=vid.videoWidth||640;
  c.height=vid.videoHeight||480;
  c.getContext('2d').drawImage(vid,0,0);
  return c.toDataURL('image/jpeg',0.7);
}

async function doFaceAction(){
  const btn=document.getElementById('btn-face-action');
  btn.disabled=true;
  setFaceStatus('scanning','Scanning face…');
  const vid=document.getElementById('face-video');
  const det=await faceapi.detectSingleFace(vid).withFaceLandmarks().withFaceDescriptor();
  if(!det){setFaceStatus('error','No face detected — centre your face');btn.disabled=false;return;}
  const desc=Array.from(det.descriptor).join(',');

  if(face.action==='ENROLL'){
    const photo=capturePhoto();
    const r=await fetch('/api/enroll-face',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({icId:face.icId,descriptor:desc,station:session.station,machineId:session.machineId,photo:photo})});
    if(r.ok){setFaceStatus('success','Face enrolled!');toast(`${face.icName} — enrolled ✓`,'success');setTimeout(()=>{closeFace();loadBioStaff();},1500);}
    else{setFaceStatus('error','Enrolment failed');btn.disabled=false;}

  } else if(face.action==='VERIFY_SUBMIT'){
    // Generic face-gate for any submit — fires window._faceVerifyCallback(icName)
    const fr=await fetch(`/api/face/${face.icId}`);
    const fd=await fr.json();
    if(!fd.found){setFaceStatus('error','No enrolled face — enrol first');btn.disabled=false;return;}
    const dist=faceapi.euclideanDistance(det.descriptor,new Float32Array(fd.descriptor.split(',').map(Number)));
    if(dist>=0.55){setFaceStatus('error','Face not matched — try again');btn.disabled=false;return;}
    setFaceStatus('success',`${face.icName} verified ✓`);
    const verifiedName=face.icName;
    setTimeout(()=>{
      closeFace();
      if(typeof window._faceVerifyCallback==='function'){
        window._faceVerifyCallback(verifiedName);
        window._faceVerifyCallback=null;
      }
    },1000);

  } else {
    // CLOCK_IN / CLOCK_OUT
    const fr=await fetch(`/api/face/${face.icId}`);
    const fd=await fr.json();
    if(!fd.found){setFaceStatus('error','No enrolled face — enrol first');btn.disabled=false;return;}
    const dist=faceapi.euclideanDistance(det.descriptor,new Float32Array(fd.descriptor.split(',').map(Number)));
    if(dist>=0.55){setFaceStatus('error','Face not matched');btn.disabled=false;return;}
    setFaceStatus('success','Face verified ✓');
    const pr=await fetch('/api/punch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({icId:face.icId,icName:face.icName,station:session.station,machineId:session.machineId})});
    const pd=await pr.json();
    const isIn=pd.action==='CLOCK_IN';
    const res=document.getElementById('shift-result');
    res.className=`shift-result ${isIn?'clock-in':'clock-out'}`;
    document.getElementById('sr-icon').textContent=isIn?'🟢':'🔴';
    document.getElementById('sr-title').textContent=isIn?`${face.icName} — Clocked In`:`${face.icName} — Clocked Out`;
    document.getElementById('sr-sub').textContent=isIn?`Shift started ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`:`Duration: ${fmtDur(pd.durationMins)}`;
    res.style.display='block';document.getElementById('v-wrap').style.display='none';
    toast(isIn?`${face.icName} clocked in ✓`:`${face.icName} clocked out · ${fmtDur(pd.durationMins)}`,'success');
    setTimeout(()=>{closeFace();loadBioStaff();},2500);
  }
}

function setFaceStatus(type,msg){
  const el=document.getElementById('face-status');
  el.className=`face-status ${type}`;
  document.getElementById('face-status-txt').textContent=msg;
}