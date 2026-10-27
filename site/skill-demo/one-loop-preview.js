// Gallery ending policy, separate from the recovered Animator contract.
// A zero-duration hold has no cycle of its own: use the longest currently
// active particle/audio period, then signal the normal ending transition.
export class OneLoopPreview {
 constructor(){this.reset();}
 reset(){this.deadline=null;this.done=false;this.eventCount=0;this.audioLoops=new Map();}
 update(player){
  const {runtime,scene,simulation}=player;
  if(this.done||runtime.complete||scene.master_skill.handler!=='loop')return;
  for(const event of runtime.events.slice(this.eventCount)){
   if(event.functionName==='StopSe'||event.functionName==='StopVo')this.audioLoops.clear();
   const key=event.functionName+':'+event.intParameter,cue=scene.audio?.cues[key];
   if(cue?.loop)this.audioLoops.set(key,cue.loop_end-cue.loop_start);
  }
  this.eventCount=runtime.events.length;
  if(this.deadline===null){
   const held=runtime.layers.find(l=>l.spec.weight>0&&runtime.state(l).transitions.some(t=>t.conditions.some(c=>c.parameter==='animState'&&c.mode===6&&c.threshold===1)));
   if(!held)return;
   const clip=runtime.clip(held);let period=clip?.duration>0?clip.duration/Math.abs(runtime.speed(held)||1):0;
   if(!period){
    const periods=[...this.audioLoops.values()];
    for(const emitter of simulation.emitters.values()){
     const e=simulation.effective(emitter,player.currentNodes),n=player.currentNodes.get(e.path);
     if(emitter.active&&e.loop&&e.play_on_awake&&e.EmissionModule.enabled&&(n?.rendererEnabled??e.enabled??true)&&e.simulation_speed>0)periods.push(e.length/e.simulation_speed);
    }
    period=Math.max(0,...periods.filter(v=>Number.isFinite(v)&&v>0));
   }
   this.period=period;this.started=held.entered;this.deadline=held.entered+period;
  }
  if(runtime.time+1e-9>=this.deadline){this.done=true;runtime.finish();}
 }
}
