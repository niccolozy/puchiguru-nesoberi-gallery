import {streamed} from './unity-skill-player.js?v=20261027-names-10';

const key=c=>`${c.path}|${c.binding.typeID}|${c.binding.script||''}|${c.binding.attribute}`;
const condition=(c,p)=>{const v=p[c.parameter]??0;switch(c.mode){case 1:return !!v;case 2:return !v;case 3:return v>c.threshold;case 4:return v<c.threshold;case 6:return v===c.threshold;case 7:return v!==c.threshold;default:throw new Error(`Unsupported Animator condition ${c.mode}`);}};

// Deterministic fixed update for the exported state graph. It never invents a
// loop duration. An explicit Finish input drives the recovered EndLoop path.
export class AnimatorRuntime {
  constructor(scene,{level=1,onEvent=()=>{},onStep=()=>{}}={}){
    this.scene=scene;this.level=level;this.onEvent=onEvent;this.onStep=onStep;
    this.clips=new Map(scene.clips.map(c=>[c.id,c]));this.reset();
  }
  reset(){
    this.time=0;this.complete=false;this.introComplete=false;this.finishing=false;this.controllerState=0;this.events=[];
    this.parameters={...this.scene.animator.parameters,animPattern:this.level<5?1:2,animState:0};
    this.layers=this.scene.animator.layers.map((spec,i)=>({spec,index:i,state:spec.default_state,entered:0,offset:0,values:new Map(),eventCursor:0}));
    for(const l of this.layers)if(l.spec.weight>0)this.enter(l,l.state,0);
    this.transitions();this.sample();this.onStep(0,0);
  }
  state(l){return l.spec.states[l.state];}
  clip(l){const s=this.state(l);return this.clips.get(s.motions[0]?.clip);}
  speed(l){const s=this.state(l);return s.speed*(s.speed_parameter?this.parameters[s.speed_parameter]??1:1);}
  local(l,t=this.time){return (t-l.entered)*this.speed(l)+l.offset;}
  enter(l,index,at,offset=0){
    l.state=index;l.entered=at;const s=this.state(l),clip=this.clip(l);l.offset=offset*(clip?.duration||0)+(s.cycle_offset||0)*(clip?.duration||0);
    if(s.write_defaults)l.values.clear();
    l.eventCursor=l.offset-1e-8;
    // Resolve zero-duration transitions before the first evaluation. Otherwise
    // an initial CutIn and its immediate destination can both emit time-zero
    // events even though the preview never evaluates that CutIn motion.
  }
  emit(event,at,l){
    const value={...event,time:at,clip_time:event.time,clip_id:this.clip(l)?.id,state:this.state(l).name,layer:l.spec.name};
    this.events.push(value);if(this.events.length>2000)this.events.shift();
    switch(event.functionName){
      case 'animEndFlag':this.complete=true;break;
      case 'animRoopFlag':if(this.controllerState===1)this.parameters.animState=1;break;
      case 'spineResetFlag':this.complete=false;this.controllerState=0;this.parameters.animState=0;break;
      case 'OnFinishIntro':this.introComplete=true;break;
      // spineStopFlag is a verified no-op in this binary.
    }
    this.onEvent(value);
  }
  crossEvents(l,to,now){
    const clip=this.clip(l);if(!clip)return;
    const loop=this.state(l).loop&&clip.duration>0,from=l.eventCursor,d=clip.duration;
    const begin=loop?Math.max(0,Math.floor(Math.max(0,from)/d)):0,end=loop?Math.floor(to/d):0;
    for(let cycle=begin;cycle<=end;cycle++)for(const e of clip.events){
      const t=e.time+(loop?cycle*d:0);
      if(t>from+1e-12&&t<=to+1e-12){const at=l.entered+(t-l.offset)/(this.speed(l)||1);this.emit(e,at,l);}
    }
    l.eventCursor=to;
  }
  transitions(){
    for(const l of this.layers){if(l.spec.weight<=0)continue;
      for(let iteration=0;iteration<16;iteration++){
        if(l.blend&&this.time<l.blend.start+l.blend.duration-1e-10)break;
        const s=this.state(l),clip=this.clip(l),local=this.local(l);
        const t=s.transitions.find(t=>t.conditions.every(c=>condition(c,this.parameters))&&(!t.has_exit_time||(clip?.duration>0&&local+1e-8>=t.exit_time*clip.duration))&&(t.self||t.destination!==l.state));
        if(!t)break;
        if(!l.spec.states[t.destination])throw new Error('Unresolved Animator destination');
        const source=t.duration>0?{...l,values:new Map(l.values),blend:null}:null;
        const duration=t.fixed_duration?t.duration:t.duration*(clip?.duration||0)/(this.speed(l)||1);
        this.enter(l,t.destination,this.time,t.offset);
        if(source)l.blend={source,start:this.time,duration};
      }
    }
    for(const l of this.layers)if(l.spec.weight>0)this.crossEvents(l,this.local(l),this.time);
  }
  sampleLayer(l){
      const state=this.state(l),clip=this.clip(l);if(state.write_defaults)l.values.clear();if(!clip)return;
      const elapsed=Math.max(0,this.local(l));const t=state.loop&&clip.duration>0?elapsed%clip.duration:Math.min(elapsed,clip.duration);
      for(const channel of clip.channels){const values=channel.curves.map(c=>streamed(c,t,!!channel.binding.isPPtrCurve||channel.binding.typeID===1));
        l.values.set(key(channel),{channel:{...channel,curves:values.map(v=>[{time:0,coeff:[0,0,0,v]}])},time:0,mapping:clip.sprite_mapping});}
  }
  sample(){
    for(const l of this.layers){if(l.spec.weight<=0)continue;this.sampleLayer(l);l.output=null;
      if(l.blend){const weight=Math.min(1,(this.time-l.blend.start)/l.blend.duration),source=l.blend.source;this.sampleLayer(source);l.output=new Map();
        for(const k of new Set([...source.values.keys(),...l.values.keys()])){
          const a=source.values.get(k),b=l.values.get(k);if(!a){l.output.set(k,b);continue;}if(!b){l.output.set(k,a);continue;}
          const step=b.channel.binding.isPPtrCurve||b.channel.binding.typeID===1||b.channel.binding.typeID===114&&b.channel.binding.attribute===3305885265;
          if(step){l.output.set(k,weight<.5?a:b);continue;}
          const curves=b.channel.curves.map((c,i)=>[{time:0,coeff:[0,0,0,a.channel.curves[i][0].coeff[3]*(1-weight)+c[0].coeff[3]*weight]}]);
          l.output.set(k,{...b,channel:{...b.channel,curves}});
        }
        if(weight>=1){l.blend=null;l.output=null;}
      }
    }
  }
  samples(){const result=[];for(const l of this.layers)if(l.spec.weight>0)result.push(...(l.output||l.values).values());return result;}
  advance(target){
    if(target<this.time-1e-8){this.reset();}
    let guard=0;
    while(this.time<target-1e-8&&!this.complete){
      if(++guard>100000)throw new Error('Animator preview advance exceeded bound');
      const previous=this.time;let next=Math.min(target,this.time+1/120);
      // Split updates at authored event/exit boundaries instead of firing early
      // with a tolerance and accidentally firing that event again next frame.
      for(const l of this.layers){if(l.spec.weight<=0||this.speed(l)<=0)continue;
        const clip=this.clip(l),state=this.state(l),local=this.local(l);if(!clip)continue;
        for(const event of clip.events){let t=event.time;
          if(state.loop&&clip.duration>0){t+=Math.max(0,Math.floor(local/clip.duration))*clip.duration;if(t<=local+1e-12)t+=clip.duration;}
          const at=l.entered+(t-l.offset)/this.speed(l);if(at>previous+1e-12&&at<next)next=at;
        }
        for(const transition of state.transitions)if(transition.has_exit_time&&clip.duration>0){const at=l.entered+(transition.exit_time*clip.duration-l.offset)/this.speed(l);if(at>previous+1e-12&&at<next)next=at;}
      }
      this.time=next;
      for(const l of this.layers)if(l.spec.weight>0){this.crossEvents(l,this.local(l),this.time);if(l.blend)this.crossEvents(l.blend.source,this.local(l.blend.source),this.time);}
      this.transitions();this.sample();this.onStep(this.time,this.time-previous);
    }
  }
  finish(){
    if(this.scene.master_skill.handler!=='loop'||this.finishing||this.complete)return;
    this.finishing=true;this.controllerState=1;this.parameters.animState=1;
    const stop={functionName:'StopSe',time:this.time,intParameter:0,native_input:'EndLoop'};this.events.push(stop);this.onEvent(stop);
    this.transitions();this.sample();this.onStep(this.time,0);
  }
  stateNames(){return this.layers.filter(l=>l.spec.weight>0).map(l=>this.state(l).name);}
}
