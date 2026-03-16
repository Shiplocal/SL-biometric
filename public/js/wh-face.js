// ── LIVENESS STATE ───────────────────────────────────────────
const BLINK_REQUIRED = 2;
const EAR_THRESHOLD  = 0.23;  // set just below user's minimum blink EAR
let _blinks    = 0;
let _lastEAR   = 1.0;
let _headTurned = false;
let _livenessOk = false;
let _livenessInterval = null;

function _resetLiveness(){
  _blinks = 0; _lastEAR = 1.0; _headTurned = false; _livenessOk = false;
  if(_livenessInterval){ clearInterval(_livenessInterval); _livenessInterval = null; }
}

// EAR using face-api.js 68-point model: left eye 36-41, right eye 42-47
function _calcEAR(pts, start){
  const d = (a,b) => Math.hypot(pts[a].x-pts[b].x, pts[a].y-pts[b].y);
  return (d(start+1,start+5) + d(start+2,start+4)) / (2 * d(start,start+3));
}

// ── FACE MODAL ───────────────────────────────────────────────
async function openFace(icId,name,enrolled,clockedIn){
  _resetLiveness();

  face.icId=icId; face.icName=name;
  if(!enrolled)       face.action='ENROLL';
  else if(clockedIn)  face.action='CLOCK_OUT';
  else                face.action='CLOCK_IN';

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

  // Enroll skips liveness — this is a new face being registered, not auth
  btn.onclick = (face.action==='ENROLL') ? doFaceAction : doFaceActionWithLiveness;

  const ring=document.getElementById('face-ring');
  ring.className='face-ring'+(face.action==='CLOCK_IN'?' in':face.action==='CLOCK_OUT'?' out':'');
  document.getElementById('face-overlay').classList.remove('hidden');

  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,facingMode:'user'}});
    face.stream=stream;
    const vid=document.getElementById('face-video');
    vid.srcObject=stream;
    vid.onloadedmetadata=()=>{
      const msgs={
        ENROLL:'Position face in ring',
        CLOCK_IN:'Ready — blink twice and turn head to clock in',
        CLOCK_OUT:'Ready — blink twice and turn head to clock out'
      };
      if(face.aiReady){setFaceStatus('idle',msgs[face.action]);btn.disabled=false;}
      else{setFaceStatus('scanning','Loading AI…');const w=setInterval(()=>{if(face.aiReady){clearInterval(w);setFaceStatus('idle',msgs[face.action]);btn.disabled=false;}},500);}
    };
  }catch(e){setFaceStatus('error','Camera access denied');}
}

function closeFace(){
  _resetLiveness();
  document.getElementById('face-overlay').classList.add('hidden');
  if(face.stream){face.stream.getTracks().forEach(t=>t.stop());face.stream=null;}
  document.getElementById('face-video').srcObject=null;
}

// ── LIVENESS GATE — runs before CLOCK_IN / CLOCK_OUT ─────────
async function doFaceActionWithLiveness(){
  if(_livenessOk){doFaceAction();return;}

  const btn=document.getElementById('btn-face-action');
  btn.disabled=true;
  setFaceStatus('scanning',`👁 Blink ${BLINK_REQUIRED}x  ·  ↔ Turn head left or right`);

  let attempts=0;
  const MAX_ATTEMPTS=35; // ~7s at 200ms

  _livenessInterval=setInterval(async()=>{
    attempts++;
    const vid=document.getElementById('face-video');
    try{
      const det=await faceapi.detectSingleFace(vid).withFaceLandmarks();
      if(det){
        const pts=det.landmarks.positions;

        // Blink detection
        const ear=(_calcEAR(pts,36)+_calcEAR(pts,42))/2;
        if(ear<EAR_THRESHOLD && _lastEAR>=EAR_THRESHOLD) _blinks++;
        _lastEAR=ear;

        // Head turn: nose tip [30] vs face width pts[0]→pts[16]
        // faceW>80 ensures face is close enough; 0.35/0.65 requires deliberate turn
        const faceW=pts[16].x-pts[0].x;
        if(faceW>80){
          const ratio=(pts[30].x-pts[0].x)/faceW;
          if(ratio<0.35||ratio>0.65) _headTurned=true;
        }

        // Live feedback for each check
        const blinkOk = _blinks>=BLINK_REQUIRED;
        const blinkLine = blinkOk
          ? `✅ Blink (${_blinks}/${BLINK_REQUIRED})`
          : `👁 Blink (${_blinks}/${BLINK_REQUIRED}) — close eyes fully`;
        const headLine = _headTurned
          ? `✅ Head turn`
          : `↔ Turn head left or right`;
        setFaceStatus('scanning', blinkLine + '   ' + headLine);

        if(_blinks>=BLINK_REQUIRED && _headTurned){
          clearInterval(_livenessInterval); _livenessInterval=null;
          _livenessOk=true;

          // Screen flash — skin reflects white light differently than a printed photo
          const flash=document.createElement('div');
          flash.style.cssText='position:fixed;inset:0;background:#fff;z-index:9999;opacity:0.85;pointer-events:none';
          document.body.appendChild(flash);
          setTimeout(()=>flash.remove(),350);

          setFaceStatus('scanning','Liveness confirmed — verifying identity…');
          setTimeout(()=>doFaceAction(),900); // camera recovers from flash
          return;
        }
      }
    }catch(e){/* frame failed — skip */}

    if(attempts>=MAX_ATTEMPTS){
      clearInterval(_livenessInterval); _livenessInterval=null;
      setFaceStatus('error','Liveness failed — blink fully and turn head, then try again');
      btn.disabled=false;
    }
  },200);
}

// ── CAPTURE PHOTO ─────────────────────────────────────────────
function capturePhoto(){
  const vid=document.getElementById('face-video');
  const c=document.createElement('canvas');
  c.width=vid.videoWidth||640;
  c.height=vid.videoHeight||480;
  c.getContext('2d').drawImage(vid,0,0);
  return c.toDataURL('image/jpeg',0.7);
}

// ── FACE AUTH (liveness gates entry to this function) ─────────
async function doFaceAction(){
  const btn=document.getElementById('btn-face-action');
  btn.disabled=true;
  setFaceStatus('scanning','Scanning face…');
  const vid=document.getElementById('face-video');
  // Retry up to 3x — camera may need a moment after liveness flash
  let det=null;
  for(let _try=0;_try<3;_try++){
    det=await faceapi.detectSingleFace(vid).withFaceLandmarks().withFaceDescriptor();
    if(det) break;
    if(_try<2){setFaceStatus('scanning',`Detecting… (attempt ${_try+2}/3)`);await new Promise(r=>setTimeout(r,500));}
  }
  if(!det){setFaceStatus('error','No face detected — centre your face and try again');_livenessOk=false;btn.disabled=false;return;}
  const desc=Array.from(det.descriptor).join(',');

  if(face.action==='ENROLL'){
    const photo=capturePhoto();
    const r=await fetch('/api/enroll-face',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({icId:face.icId,descriptor:desc,station:session.station,machineId:session.machineId,photo:photo})});
    if(r.ok){setFaceStatus('success','Face enrolled!');toast(`${face.icName} — enrolled ✓`,'success');setTimeout(()=>{closeFace();loadBioStaff();},1500);}
    else{setFaceStatus('error','Enrolment failed');btn.disabled=false;}

  }else if(face.action==='VERIFY_SUBMIT'){
    const fr=await fetch(`/api/face/${face.icId}`);
    const fd=await fr.json();
    if(!fd.found){setFaceStatus('error','No enrolled face — enrol first');btn.disabled=false;return;}
    const dist=faceapi.euclideanDistance(det.descriptor,new Float32Array(fd.descriptor.split(',').map(Number)));
    if(dist>=0.55){setFaceStatus('error','Face not matched — try again');_livenessOk=false;btn.disabled=false;return;}
    setFaceStatus('success',`${face.icName} verified ✓`);
    const verifiedName=face.icName;
    setTimeout(()=>{
      closeFace();
      if(typeof window._faceVerifyCallback==='function'){
        window._faceVerifyCallback(verifiedName);
        window._faceVerifyCallback=null;
      }
    },1000);

  }else{
    // CLOCK_IN / CLOCK_OUT
    const fr=await fetch(`/api/face/${face.icId}`);
    const fd=await fr.json();
    if(!fd.found){setFaceStatus('error','No enrolled face — enrol first');btn.disabled=false;return;}
    const dist=faceapi.euclideanDistance(det.descriptor,new Float32Array(fd.descriptor.split(',').map(Number)));
    if(dist>=0.55){setFaceStatus('error','Face not matched — try again');_livenessOk=false;btn.disabled=false;return;}
    setFaceStatus('success','Face verified ✓');
    const pr=await fetch('/api/punch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({icId:face.icId,icName:face.icName,station:session.station,machineId:session.machineId})});
    const pd=await pr.json();
    const isIn=pd.action==='CLOCK_IN';
    const res=document.getElementById('shift-result');
    res.className=`shift-result ${isIn?'clock-in':'clock-out'}`;
    document.getElementById('sr-icon').textContent=isIn?'🟢':'🔴';
    document.getElementById('sr-title').textContent=isIn?`${face.icName} — Clocked In`:`${face.icName} — Clocked Out`;
    document.getElementById('sr-sub').textContent=isIn
      ?`Shift started ${new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})}`
      :`Duration: ${fmtDur(pd.durationMins)}`;
    res.style.display='block';
    document.getElementById('v-wrap').style.display='none';
    toast(isIn?`${face.icName} clocked in ✓`:`${face.icName} clocked out · ${fmtDur(pd.durationMins)}`,'success');
    setTimeout(()=>{closeFace();loadBioStaff();},2500);
  }
}

function setFaceStatus(type,msg){
  const el=document.getElementById('face-status');
  el.className=`face-status ${type}`;
  document.getElementById('face-status-txt').textContent=msg;
}