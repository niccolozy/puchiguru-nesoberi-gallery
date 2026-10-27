import {CollectionSkillPlayer,loadSkillAssets} from './collection-skill-player.js?v=20261027-names-10';
export class SkillOverlay {
 constructor({stage,surface,model,button,overlay,canvas,closeButton,onStatus}){
  Object.assign(this,{stage,surface,model,button,overlay,canvas,closeButton,onStatus});
  this.serial=0;this.state='idle';this.memberId='';this.frame=null;this.sources=new Set();this.cache=new Map();this.audioLog=[];
  this.pauseButton=overlay.querySelector('#skill-pause');this.replayButton=overlay.querySelector('#skill-replay');
  button.addEventListener('click',()=>this.play());closeButton.addEventListener('click',()=>this.stop());
  this.pauseButton?.addEventListener('click',()=>this.togglePause());
  this.replayButton?.addEventListener('click',()=>{this.stop({focus:false});this.play();});
  stage.addEventListener('keydown',e=>{if(e.key==='Escape'&&this.state!=='idle'){e.preventDefault();this.stop();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)this.stop({focus:false});});window.addEventListener('pagehide',()=>this.stop({focus:false}));
  new ResizeObserver(()=>{if(this.player&&['playing','paused'].includes(this.state))try{this.player.render(this.time);}catch(e){this.failed(e);}}).observe(stage);
  this.catalogReady=this.loadCatalog();
 }
 async loadCatalog(){try{const r=await fetch(new URL('../skills/catalog.json',import.meta.url));if(!r.ok)throw new Error('Skill catalog unavailable');this.catalog=(await r.json()).members;this.updateButton();}catch(e){console.error(e);this.button.hidden=true;}}
 updateButton(){const m=this.catalog?.[this.memberId];this.button.hidden=!m;if(m){const name=this.displayName||m.character;this.button.setAttribute('aria-label',`Play ${name}’s skill animation`);this.canvas.setAttribute('aria-label',`${name} — ${m.costume} skill animation`);}}
 select(memberId,displayName=''){this.stop({focus:false});this.memberId=String(memberId??'');this.displayName=displayName;this.updateButton();if(this.catalog?.[this.memberId])this.prepare(this.memberId).catch(()=>{});}
 prepare(id){
  if(this.cache.has(id)){const v=this.cache.get(id);this.cache.delete(id);this.cache.set(id,v);return v;}
  const item=this.catalog?.[id];if(!item)return Promise.reject(new Error('Skill unavailable'));
  const p=loadSkillAssets(new URL('../skills/'+item.scene,import.meta.url)).catch(e=>{if(this.cache.get(id)===p)this.cache.delete(id);throw e;});
  this.cache.set(id,p);while(this.cache.size>3)this.cache.delete(this.cache.keys().next().value);return p;
 }
 async play(){
  if(this.state!=='idle'||!this.catalog?.[this.memberId])return;
  this.stop({focus:false});const token=++this.serial,id=this.memberId;this.state='loading';this.button.disabled=true;this.onStatus('Loading skill animation…');
  let audioReady;
  try{const Context=window.AudioContext||window.webkitAudioContext;this.audioContext||=new Context();audioReady=this.audioContext.resume().then(()=>true,()=>false);}catch(_){audioReady=Promise.resolve(false);}
  try{
   const assets=await this.prepare(id),audio=await audioReady;if(token!==this.serial||id!==this.memberId)return;
   if(audio&&!assets.audioBuffers){assets.audioBuffers=new Map();await Promise.all([...assets.cueBytes].map(async([key,bytes])=>{try{assets.audioBuffers.set(key,await this.audioContext.decodeAudioData(bytes.slice(0)));}catch(_){}}));}
   if(token!==this.serial||id!==this.memberId)return;
   this.assets=assets;this.player=new CollectionSkillPlayer(this.canvas,assets,{oneLoop:true});this.savedRotation=this.model.hasAttribute('auto-rotate');this.savedInert=this.surface.inert;
   this.model.removeAttribute('auto-rotate');this.surface.inert=true;this.overlay.hidden=false;this.state='playing';this.stage.dataset.skillPlaying='true';
   this.time=0;this.lastNow=performance.now();this.audioEnabled=audio;this.audioLog=[];this.player.render(0);this.routeEvents();
   if(this.pauseButton)this.pauseButton.textContent='Pause';this.closeButton.focus({preventScroll:true});
   this.onStatus('Playing skill animation…');
   const tick=now=>{
    if(token!==this.serial)return;
    const dt=(now-this.lastNow)/1000;this.lastNow=now;
    if(this.state==='playing'){
     this.time+=Math.max(0,dt);
     try{this.player.render(this.time);this.routeEvents();}catch(e){this.failed(e);return;}
     if(this.player.runtime.complete){this.stop({keepAudio:true});return;}
    }
    this.frame=requestAnimationFrame(tick);
   };this.frame=requestAnimationFrame(tick);
  }catch(e){if(token===this.serial){console.error(e);this.stop({message:'Could not load the skill animation. You can try again.'});}}
 }
 routeEvents(){
  for(const event of this.player.drainEvents()){
   const key=event.functionName+':'+event.intParameter;this.audioLog.push({event:event.functionName,index:event.intParameter,time:event.time,state:event.state});
   if(['StopSe','StopVo'].includes(event.functionName)){this.stopAudio();continue;}
   if(!['PlaySe','PlayVo','PlaySPSe','PlaySPVo'].includes(event.functionName))continue;
   const cue=this.assets.scene.audio?.cues[key],buffer=this.assets.audioBuffers?.get(key);
   if(!cue||!buffer||!this.audioEnabled)continue;
   // An event can be crossed between browser frames. Start at its elapsed
   // position instead of shifting the entire recording later by that frame.
   let offset=Math.max(0,this.player.runtime.time-event.time);
   if(cue.loop&&offset>=cue.loop_end&&cue.loop_end>cue.loop_start)offset=cue.loop_start+(offset-cue.loop_start)%(cue.loop_end-cue.loop_start);
   if(!cue.loop&&offset>=buffer.duration)continue;
   const source=this.audioContext.createBufferSource();source.buffer=buffer;source.loop=cue.loop;source.loopStart=cue.loop_start;source.loopEnd=cue.loop_end;
   const effect=event.functionName==='PlaySe'||event.functionName==='PlaySPSe';
   if(effect&&!this.effectGain){this.effectGain=this.audioContext.createGain();this.effectGain.gain.value=.25;this.effectGain.connect(this.audioContext.destination);}
   if(!effect&&!this.voiceGain){this.voiceGain=this.audioContext.createGain();this.voiceGain.gain.value=.5;this.voiceGain.connect(this.audioContext.destination);}
   source.connect(effect?this.effectGain:this.voiceGain);source.onended=()=>{source.disconnect();this.sources.delete(source);};this.sources.add(source);source.start(this.audioContext.currentTime,offset);
  }
 }
 async togglePause(){
  const token=this.serial;
  if(this.state==='playing'){this.state='paused';if(this.pauseButton)this.pauseButton.textContent='Resume';await this.audioContext?.suspend();}
  else if(this.state==='paused'){await this.audioContext?.resume();if(token!==this.serial||this.state!=='paused')return;this.lastNow=performance.now();this.state='playing';if(this.pauseButton)this.pauseButton.textContent='Pause';}
 }
 stopAudio(){for(const source of this.sources){try{source.stop();}catch(_){}source.disconnect();}this.sources.clear();}
 failed(e){console.error(e);this.stop({message:'The skill animation could not be played. The model view has been restored.'});}
 stop({focus=true,message,keepAudio=false}={}){
  const busy=this.state!=='idle';++this.serial;if(this.frame!==null){cancelAnimationFrame(this.frame);this.frame=null;}
  if(!keepAudio)this.stopAudio();else for(const source of [...this.sources])if(source.loop){try{source.stop();}catch(_){}source.disconnect();this.sources.delete(source);}
  // Non-looping audio without a reached stop event may finish. Looped handles
  // are released when the gallery destroys its preview, a declared host cleanup.
  this.overlay.hidden=true;delete this.stage.dataset.skillPlaying;
  if(['playing','paused'].includes(this.state)){this.surface.inert=this.savedInert;this.model.toggleAttribute('auto-rotate',this.savedRotation);}
  this.player?.dispose();this.player=null;this.state='idle';this.button.disabled=false;
  if(busy){this.onStatus(message||'Drag to orbit and use the wheel or pinch to zoom.');if(focus&&!this.button.hidden)this.button.focus({preventScroll:true});}
 }
}
