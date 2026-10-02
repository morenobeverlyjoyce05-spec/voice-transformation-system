/* Multi-Mode Voice Transformation - frontend.
   All voice effects are done by the Python backend (/api/transform). */
const API = location.port === '5500' ? 'http://127.0.0.1:5000' : '';
const $ = id => document.getElementById(id);
const FX = {robot:'Robot', chipmunk:'Chipmunk', male:'Male', female:'Female'};
let mode = 'file', fx = 'robot', srcBuf = null, origBlob = null, outBlobURL = null, origURL = null;
let busy = false, again = false, live = null, origAn = null;

/* ---------- helpers ---------- */
function encodeWav(f32, sr){
  const n = f32.length, v = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0,'RIFF'); v.setUint32(4,36+n*2,true); w(8,'WAVEfmt '); v.setUint32(16,16,true); v.setUint16(20,1,true); v.setUint16(22,1,true);
  v.setUint32(24,sr,true); v.setUint32(28,sr*2,true); v.setUint16(32,2,true); v.setUint16(34,16,true); w(36,'data'); v.setUint32(40,n*2,true);
  for(let i=0;i<n;i++){ const s=Math.max(-1,Math.min(1,f32[i])); v.setInt16(44+i*2, s<0?s*0x8000:s*0x7fff, true) }
  return new Blob([v], {type:'audio/wav'});
}
async function decodeMono(blob){
  const ac = new AudioContext(); const raw = await ac.decodeAudioData(await blob.arrayBuffer()); ac.close();
  const mono = new AudioBuffer({length:raw.length, sampleRate:raw.sampleRate, numberOfChannels:1});
  const d = mono.getChannelData(0);
  for(let c=0;c<raw.numberOfChannels;c++){ const s=raw.getChannelData(c); for(let i=0;i<s.length;i++) d[i]+=s[i]/raw.numberOfChannels }
  return mono;
}
async function callPython(wavBlob, effect, offset=0, fast=false){
  let r;
  try{ r = await fetch(`${API}/api/transform?effect=${effect}&offset=${offset}&fast=${fast?1:0}`, {method:'POST', headers:{'Content-Type':'audio/wav'}, body:wavBlob}) }
  catch(e){ throw new Error('Cannot reach the Python server. Run: python backend/app.py') }
  if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error || 'Server error');
  return r.blob();
}

/* ---------- mode & effect selection ---------- */
function setMode(m){
  mode = m;
  $('mFile').classList.toggle('on', m==='file'); $('mLive').classList.toggle('on', m==='live');
  $('fileIn').classList.toggle('hidden', m!=='file'); $('liveIn').classList.toggle('hidden', m!=='live');
  $('step3').classList.toggle('hidden', m!=='file'); $('hr3').classList.toggle('hidden', m!=='file');
  if(m==='file') stopLive();
}
$('mFile').onclick = () => setMode('file'); $('mLive').onclick = () => setMode('live');

document.querySelectorAll('.fxc').forEach(b => b.onclick = () => {
  fx = b.dataset.fx;
  document.querySelectorAll('.fxc').forEach(x => x.classList.toggle('on', x===b));
  $('outTitle').textContent = FX[fx] + ' voice'; $('afterName').textContent = FX[fx]; renderInfo();
  if(mode==='file' && srcBuf) processFile();          // auto-apply
  if(mode==='live' && live) $('liveBadge').textContent = 'Live · ' + FX[fx];
});

/* ---------- MODE A: upload / record -> Python ---------- */
async function loadBlob(blob, label){
  try{
    srcBuf = await decodeMono(blob);
    origBlob = encodeWav(srcBuf.getChannelData(0), srcBuf.sampleRate); origAn = null;
    if(origURL) URL.revokeObjectURL(origURL);
    origURL = URL.createObjectURL(origBlob); $('orig').src = origURL;
    $('fileInfo').textContent = `Loaded: ${label} (${srcBuf.duration.toFixed(1)}s)`;
    processFile();
  }catch(e){ $('fileInfo').textContent = 'Could not read that audio. Try an MP3, WAV, OGG or M4A file.' }
}
async function processFile(){
  if(!origBlob) return;
  if(busy){ again = true; return }
  busy = true; $('outNote').textContent = 'Python is applying the ' + FX[fx] + ' effect…';
  try{
    const out = await callPython(origBlob, fx);
    if(outBlobURL) URL.revokeObjectURL(outBlobURL);
    outBlobURL = URL.createObjectURL(out);
    $('player').src = outBlobURL; $('dl').disabled = false;
    $('outNote').textContent = FX[fx] + ' effect applied. Pick another effect to compare.';
    showAnalysis(out);
  }catch(e){ $('outNote').textContent = e.message }
  busy = false;
  if(again){ again = false; processFile() }
}
$('dl').onclick = () => { if(!outBlobURL) return; const a=document.createElement('a'); a.href=outBlobURL; a.download=`voice-${fx}.wav`; a.click() };
$('reset').onclick = () => {
  srcBuf = origBlob = null;
  ['orig','player'].forEach(id => { $(id).removeAttribute('src'); $(id).load() });
  $('dl').disabled = true; $('file').value = '';
  $('fileInfo').textContent = 'No audio yet.'; $('outNote').textContent = 'Add an audio file or record your voice to create a preview.';
};

const drop = $('drop');
drop.onclick = () => $('file').click();
drop.onkeydown = e => { if(e.key==='Enter'||e.key===' '){ e.preventDefault(); $('file').click() } };
$('file').onchange = e => { const f = e.target.files[0]; if(f) loadBlob(f, f.name) };
['dragover','dragenter'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over') }));
['dragleave','drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over') }));
drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if(f) loadBlob(f, f.name) });

let rec = null, chunks = [];
$('recBtn').onclick = async () => {
  if(rec){ rec.stop(); return }
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:true});
    chunks = []; rec = new MediaRecorder(stream);
    rec.ondataavailable = e => chunks.push(e.data);
    rec.onstop = () => { stream.getTracks().forEach(t => t.stop()); rec = null;
      $('recBtn').textContent = '🎙 Record with microphone'; $('recBtn').classList.replace('red','amber');
      loadBlob(new Blob(chunks), 'Mic recording') };
    rec.start(); $('recBtn').textContent = '⏹ Stop recording'; $('recBtn').classList.replace('amber','red');
    $('fileInfo').textContent = 'Recording… click again to stop.';
  }catch(e){ $('fileInfo').textContent = 'Microphone blocked. Allow mic access in your browser and try again.' }
};

/* ---------- MODE B: real time (mic -> Python in short chunks -> speakers) ---------- */
const capSrc = `class Cap extends AudioWorkletProcessor{process(i){const x=i[0]&&i[0][0];if(x)this.port.postMessage(x.slice());return true}}registerProcessor('cap',Cap);`;
const capURL = URL.createObjectURL(new Blob([capSrc], {type:'application/javascript'}));
const CHUNK_SEC = 0.8;

async function startLive(){
  try{
    const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:true}});
    const ctx = new AudioContext(); await ctx.audioWorklet.addModule(capURL);
    const src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx,'cap'), mute = ctx.createGain();
    mute.gain.value = 0; src.connect(node); node.connect(mute); mute.connect(ctx.destination);
    const l = live = {stream, ctx, node, parts:[], n:0, size:Math.round(ctx.sampleRate*CHUNK_SEC), offset:0, next:0, q:Promise.resolve(), out:[], stopped:false};
    node.port.onmessage = e => {
      const x = e.data; let p = 0; for(let i=0;i<x.length;i++) p = Math.max(p, Math.abs(x[i]));
      $('meter').style.width = Math.min(100, p*160) + '%';
      l.parts.push(x); l.n += x.length; if(l.n >= l.size) flushChunk(l);
    };
    $('liveOut').classList.add('hidden');
    $('liveBtn').textContent = '⏹ Stop real-time voice'; $('liveBtn').classList.add('red');
    $('liveBadge').textContent = 'Live · ' + FX[fx]; $('liveBadge').classList.add('on');
  }catch(e){ $('liveBadge').textContent = 'Mic blocked or unsupported' }
}
function flushChunk(l){
  const data = new Float32Array(l.n); let o = 0; for(const p of l.parts){ data.set(p,o); o += p.length }
  l.parts = []; l.n = 0;
  const wav = encodeWav(data, l.ctx.sampleRate), off = l.offset, effect = fx; l.offset += data.length;
  l.q = l.q.then(async () => {
    try{
      const blob = await callPython(wav, effect, off, true);
      const ab = await l.ctx.decodeAudioData(await blob.arrayBuffer());
      l.out.push(ab.getChannelData(0).slice());
      if(!l.stopped){
        const s = l.ctx.createBufferSource(); s.buffer = ab; s.connect(l.ctx.destination);
        const t = Math.max(l.ctx.currentTime + 0.05, l.next); s.start(t); l.next = t + ab.duration;
      }
    }catch(e){ $('liveBadge').textContent = e.message }
  });
}
function stopLive(){
  if(!live) return;
  const l = live; live = null; l.stopped = true;
  l.stream.getTracks().forEach(t => t.stop()); l.node.disconnect();
  $('meter').style.width = '0'; $('liveBtn').textContent = '🎙 Start real-time voice'; $('liveBtn').classList.remove('red');
  $('liveBadge').textContent = 'Mic off'; $('liveBadge').classList.remove('on');
  l.q.then(() => {
    if(l.out.length){                      // build downloadable recording of the transformed voice
      const all = new Float32Array(l.out.reduce((a,c) => a + c.length, 0)); let o = 0;
      for(const c of l.out){ all.set(c,o); o += c.length }
      const url = URL.createObjectURL(encodeWav(all, l.ctx.sampleRate));
      $('livePlayer').src = url; $('liveOut').classList.remove('hidden');
      $('liveDl').onclick = () => { const a=document.createElement('a'); a.href=url; a.download='voice-live.wav'; a.click() };
    }
    l.ctx.close();
  });
}
$('liveBtn').onclick = () => live ? stopLive() : startLive();

/* ---------- Signal analysis (data computed by Python /api/analyze, drawn here) ---------- */
const INFO = {
  robot:'Robot uses <b>ring modulation</b>. Each sample of the voice is multiplied by a <b>55 Hz</b> sine wave: <code>y[n] = x[n] · sin(2π·55·n/fs)</code>. This adds new frequencies 55 Hz above and below the original ones, which gives the buzzing, metallic sound. The pitch is also lowered a little (−1.5 semitones).',
  chipmunk:'The pitch is raised by <b>10 semitones</b>, so every frequency is multiplied by <code>r = 2^(10/12) ≈ 1.78</code>. To keep the speed the same, the voice is first stretched with a <b>phase vocoder</b>, then <b>resampled</b> back to its original length.',
  male:'The pitch is lowered by <b>5 semitones</b>, so every frequency is multiplied by <code>r = 2^(−5/12) ≈ 0.75</code>. It uses the same method as Chipmunk <b>(phase vocoder, then resampling)</b>, so the voice gets deeper but not slower.',
  female:'The pitch is raised by <b>4 semitones</b>, so every frequency is multiplied by <code>r = 2^(4/12) ≈ 1.26</code>. It uses the same method as Chipmunk <b>(phase vocoder, then resampling)</b>, so the voice gets higher but not faster.'
};
function renderInfo(){ $('fxInfo').innerHTML = INFO[fx] }
renderInfo();

async function analyze(blob){
  const r = await fetch(`${API}/api/analyze`, {method:'POST', headers:{'Content-Type':'audio/wav'}, body:blob});
  if(!r.ok) throw new Error('analysis failed'); return r.json();
}
async function showAnalysis(outBlob){
  try{
    if(!origAn) origAn = await analyze(origBlob);
    const b = await analyze(outBlob);
    drawWave($('wvA'), origAn.wave, '#8a837c'); drawWave($('wvB'), b.wave, '#ff5f3d');
    drawSpecgram($('spA'), origAn.spectrogram); drawSpecgram($('spB'), b.spectrogram);
    drawSpectrum($('spec'), origAn.spectrum, b.spectrum);
    $('anNote').textContent = 'Spectrum and spectrogram are normalized to each signal\'s own peak, so you can compare where the frequencies moved.';
  }catch(e){ $('anNote').textContent = 'Could not draw analysis: ' + e.message }
}
function drawWave(c, wave, color){
  const g = c.getContext('2d'), W = c.width, H = c.height; g.clearRect(0,0,W,H);
  g.strokeStyle = '#eee7df'; g.beginPath(); g.moveTo(0,H/2); g.lineTo(W,H/2); g.stroke();
  g.fillStyle = color; const bw = W / wave.length;
  wave.forEach((m,i) => { const y1 = H/2 - m[1]*H/2, y2 = H/2 - m[0]*H/2; g.fillRect(i*bw, y1, Math.max(1,bw), Math.max(1,y2-y1)) });
}
function drawSpecgram(c, sp){
  const bytes = Uint8Array.from(atob(sp.data), ch => ch.charCodeAt(0));
  const off = document.createElement('canvas'); off.width = sp.frames; off.height = sp.bins;
  const og = off.getContext('2d'), img = og.createImageData(sp.frames, sp.bins);
  for(let f=0; f<sp.frames; f++) for(let b=0; b<sp.bins; b++){
    const v = bytes[f*sp.bins + b], o = ((sp.bins-1-b)*sp.frames + f)*4;
    img.data[o] = v; img.data[o+1] = v*v/255*.8; img.data[o+2] = v<200 ? (255-v)*.25 : 0; img.data[o+3] = 255;
  }
  og.putImageData(img,0,0);
  const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.drawImage(off, 0, 0, c.width, c.height);
}
function drawSpectrum(c, A, B){
  const g = c.getContext('2d'), W = c.width, H = c.height, pad = 34; g.clearRect(0,0,W,H);
  g.font = '18px sans-serif'; g.fillStyle = '#6b6560'; g.strokeStyle = '#eee7df';
  [0,2000,4000,6000,8000].forEach(f => { const x = pad + f/8000*(W-pad-10); g.beginPath(); g.moveTo(x,10); g.lineTo(x,H-26); g.stroke(); g.fillText(f? f/1000+'k' : '0', x-8, H-6) });
  g.fillText('Hz', W-34, H-6);
  const line = (S, color) => { g.strokeStyle = color; g.lineWidth = 2.5; g.beginPath();
    S.freqs.forEach((f,i) => { const x = pad + f/8000*(W-pad-10), y = 10 + (-S.db[i]/90)*(H-36); i ? g.lineTo(x,y) : g.moveTo(x,y) }); g.stroke() };
  line(A, '#8a837c'); line(B, '#ff5f3d');
}
