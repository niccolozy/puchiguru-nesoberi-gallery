import {point,product,matrix,minmax,color,random} from './unity-skill-player.js?v=20261027-names-10';
const ID=[1,0,0,0,0,1,0,0,0,0,1,0],clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,n)=>a.map(v=>v*n),length=v=>Math.hypot(...v);
const normalize=v=>mul(v,1/(length(v)||1));
const vector=(m,v)=>[m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[4]*v[0]+m[5]*v[1]+m[6]*v[2],m[8]*v[0]+m[9]*v[1]+m[10]*v[2]];
export function inverseFrame(m){
 const [a,b,c,x,d,e,f,y,g,h,i,z]=m,det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);
 if(Math.abs(det)<1e-10)return ID;
 const v=[(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det,0,(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det,0,(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det,0];
 const t=vector(v,[x,y,z]);v[3]=-t[0];v[7]=-t[1];v[11]=-t[2];return v;
}
function euler(x,y,z){const cx=Math.cos(x/2),sx=Math.sin(x/2),cy=Math.cos(y/2),sy=Math.sin(y/2),cz=Math.cos(z/2),sz=Math.sin(z/2);
 return {x:sx*cy*cz+cx*sy*sz,y:cx*sy*cz-sx*cy*sz,z:cx*cy*sz-sx*sy*cz,w:cx*cy*cz+sx*sy*sz};}
function hash(s){let n=2166136261;for(const c of s)n=Math.imul(n^c.charCodeAt(0),16777619);return n>>>0;}

export class ParticleSimulation {
 constructor(scene){this.scene=scene;this.warnings=new Set();this.reset();}
 reset(){this.emitters=new Map(this.scene.particles.map(e=>[e.id,{spec:e,active:false,particles:[],phase:0,rate:0,bursts:new Set(),rng:random(e.auto_seed?hash(this.scene.memberId+e.path):e.seed),serial:0}]));this.nodes=null;this.time=0;this.birthLog=[];}
 effective(state,nodes){
  const n=nodes.get(state.spec.path),e=state.spec;
  if(!n?.particleProperties?.length)return e;
  const copy=structuredClone(e);
  for(const [path,value] of n.particleProperties){let o=copy;for(const k of path.slice(0,-1))o=o?.[k];if(o)o[path.at(-1)]=value;}
  return copy;
 }
 frame(e,node,nodes){
  if(e.simulation_space===0)return node.world;
  if(e.simulation_space===1)return ID;
  const ref=String(e.custom_space?.m_PathID||0),source=this.scene.nodes.find(n=>n.id===ref),n=source&&nodes.get(source.path);
  if(!n){this.warnings.add('unresolved custom simulation frame: '+e.path);return ID;}
  return n.world;
 }
 emitterVector(e,node,v,shape=false){
  const worldScale=[0,1,2].map(k=>Math.hypot(node.world[k],node.world[k+4],node.world[k+8])),scale=e.scaling_mode===1?[node.scale.x,node.scale.y,node.scale.z]:e.scaling_mode===2&&!shape?[1,1,1]:worldScale;
  const basis=node.world.map((value,i)=>i%4===3?0:value/(worldScale[i%4]||1));return vector(basis,v.map((value,i)=>value*scale[i]));
 }
 shape(s,rng){
  if(!s?.enabled)return {p:[0,0,0],d:[0,0,1]};
  const radius=s.radius?.value??1,angle=rng()*2*Math.PI;
  let p=[0,0,0],d=[0,0,1];
  if([0,1,2,3].includes(s.type)){
   const z=[2,3].includes(s.type)?rng():rng()*2-1,t=Math.sqrt(1-z*z);d=[Math.cos(angle)*t,Math.sin(angle)*t,z];
   p=mul(d,radius*([1,3].includes(s.type)?1:Math.cbrt(rng())));
  }else if([4,7,8,9].includes(s.type)){
   const r=radius*([7,9].includes(s.type)?1:Math.sqrt(rng())),a=(s.angle||0)*Math.PI/180;
   p=[Math.cos(angle)*r,Math.sin(angle)*r,[8,9].includes(s.type)?rng()*(s.length||0):0];
   d=normalize([Math.cos(angle)*Math.sin(a),Math.sin(angle)*Math.sin(a),Math.cos(a)]);
  }else if([5,15,16].includes(s.type)){
   p=[(rng()-.5)*s.boxX,(rng()-.5)*s.boxY,(rng()-.5)*s.boxZ];
   if(s.type!==5){const k=Math.floor(rng()*3);p[k]=Math.sign(p[k]||1)*[s.boxX,s.boxY,s.boxZ][k]/2;if(s.type===16){const j=(k+1)%3;p[j]=Math.sign(p[j]||1)*[s.boxX,s.boxY,s.boxZ][j]/2;}}
  }else if([10,11].includes(s.type)){
   const arc=(s.arc?.value??360)*Math.PI/180,a=rng()*arc,r=radius*(s.type===11?1:Math.sqrt(rng()));d=[Math.cos(a),Math.sin(a),0];p=mul(d,r);
  }else if(s.type===12){p=[(rng()-.5)*radius*2,0,0];d=[0,1,0];}
  else this.warnings.add('shape requires mesh-volume sampling: '+s.type);
  if(s.randomDirectionAmount){const randomD=normalize([rng()-.5,rng()-.5,rng()-.5]);d=normalize(add(mul(d,1-s.randomDirectionAmount),mul(randomD,s.randomDirectionAmount)));}
  return {p,d};
 }
 spawn(state,e,node,nodes,at,parent=null,properties=0,depth=0){
  if(depth>8){this.warnings.add('sub-emitter recursion bound');return;}
  if(state.particles.length>=e.InitialModule.maxNumParticles)return;
  const rng=state.rng,r=Array.from({length:28},()=>rng()),ini=e.InitialModule,norm=state.phase/(e.length||1);
  const life=minmax(ini.startLifetime,norm,r[0])*(parent&&(properties&8)?parent.life:1);if(life<=0)return;
  const shape=this.shape(e.ShapeModule,rng),frame=this.frame(e,node,nodes),inverse=inverseFrame(frame);
  let world=add([node.world[3],node.world[7],node.world[11]],this.emitterVector(e,node,shape.p,true));if(parent)world=parent.world;
  const speed=minmax(ini.startSpeed,norm,r[1]);let velocity=this.emitterVector(e,node,mul(shape.d,speed));
  let col=color(ini.startColor,norm,r[2]);if(parent&&(properties&1))col=Object.fromEntries(['r','g','b','a'].map(k=>[k,col[k]*parent.color[k]]));
  const size=[minmax(ini.startSize,norm,r[3]),ini.size3D?minmax(ini.startSizeY,norm,r[4]):minmax(ini.startSize,norm,r[3]),ini.size3D?minmax(ini.startSizeZ,norm,r[5]):minmax(ini.startSize,norm,r[3])];
  if(parent&&(properties&2))for(let k=0;k<3;k++)size[k]*=parent.size[k];
  const rot=[ini.rotation3D?minmax(ini.startRotationX,norm,r[6]):0,ini.rotation3D?minmax(ini.startRotationY,norm,r[7]):0,minmax(ini.startRotation,norm,r[8])];
  if(parent&&(properties&4))for(let k=0;k<3;k++)rot[k]+=parent.rotation[k];
  const p={id:++state.serial,born:at,age:0,life,r,position:point(inverse,...world),velocity:vector(inverse,velocity),inheritedInitial:[...(node.emitterVelocity||[0,0,0])],world,rotation:rot,size,color:col,trail:[]};
  state.particles.push(p);this.birthLog.push({emitter:e.id,at,position:[...world],parent:parent?.id??null});if(this.birthLog.length>2000)this.birthLog.shift();
  this.sub(state,p,0,nodes,at,depth+1);
 }
 sub(state,p,type,nodes,at,depth=0){
  const module=state.spec.SubModule;if(!module?.enabled)return;
  for(const sub of module.subEmitters||[]){if(sub.type!==type)continue;
   const child=this.emitters.get(String(sub.emitter.m_PathID));if(!child)continue;const n=nodes.get(child.spec.path);if(!n?.visible)continue;
   const e=this.effective(child,nodes),bursts=e.EmissionModule.m_Bursts||[],inherited=this.currentProperties(state.spec,p);
   // Sub-emission inherits the particle's state at this event, not its birth
   // values or the child emitter's unrelated transform origin.
   for(const burst of bursts.length?bursts:[{minCount:1,maxCount:1}]){
    if(child.rng()>(burst.probability??1))continue;
    const count=Math.max(0,Math.floor(burst.minCount+child.rng()*(burst.maxCount-burst.minCount+1)));
    for(let i=0;i<count;i++)this.spawn(child,e,n,nodes,at,inherited,sub.properties,depth);
   }
  }
 }
 currentProperties(e,p){
  const t=clamp(p.age/p.life,0,1),size=[...p.size],m=e.SizeModule;
  if(m.enabled)for(let k=0;k<3;k++)size[k]*=minmax(m.separateAxes?[m.curve,m.y,m.z][k]:m.curve,t,p.r[3+k]);
  const speed=e.SizeBySpeedModule;if(speed?.enabled){const value=clamp(((p.speed||0)-speed.range.x)/(speed.range.y-speed.range.x||1),0,1);for(let k=0;k<3;k++)size[k]*=minmax(speed.separateAxes?[speed.curve,speed.y,speed.z][k]:speed.curve,value,p.r[3+k]);}
  const tint=e.ColorModule.enabled?color(e.ColorModule.gradient,t,p.r[20]):{r:1,g:1,b:1,a:1};
  return {...p,size,color:Object.fromEntries(['r','g','b','a'].map(k=>[k,p.color[k]*tint[k]]))};
 }
 update(time,dt,nodes){
  this.time=time;this.nodes=nodes;
  // Establish every emitter's lifecycle before any parent can spawn a child.
  for(const state of this.emitters.values()){
   const node=nodes.get(state.spec.path);state.justActivated=false;
   if(!node?.visible){if(state.active){state.active=false;state.particles=[];state.rate=0;state.bursts.clear();}continue;}
   if(!state.active){state.active=true;state.phase=0;state.rate=0;state.bursts.clear();state.particles=[];state.delayRandom=state.rng();state.rateRandom=state.rng();state.distanceRandom=state.rng();state.justActivated=true;state.previousWorld=null;}
  }
  for(const state of this.emitters.values()){
   const e=this.effective(state,nodes),node=nodes.get(e.path);if(!node)continue;
   if(!node.visible)continue;
   if(state.justActivated){
    if(e.loop&&e.prewarm){const warm=Math.max(0,e.length);for(let t=0;t<warm;t+=1/120){this.emit(state,e,node,nodes,t,1/120,time-warm+t);this.integrate(state,e,node,nodes,1/120,time-warm+t);}}
   }
   const step=dt*(e.simulation_speed??1);node.emitterVelocity=dt>0&&state.previousWorld?mul([node.world[3]-state.previousWorld[0],node.world[7]-state.previousWorld[1],node.world[11]-state.previousWorld[2]],1/dt):[0,0,0];
   state.previousWorld=[node.world[3],node.world[7],node.world[11]];
   this.emit(state,e,node,nodes,state.phase,step,time);this.integrate(state,e,node,nodes,step,time);state.phase+=step;
  }
 }
 emit(state,e,node,nodes,phase,dt,time){
  const emission=e.EmissionModule;if(!e.play_on_awake||!emission.enabled)return;
  const delay=minmax(e.delay,0,state.delayRandom??.5),from=phase-delay,to=from+dt,d=e.length||1;
  if(to<0)return;
  const first=e.loop?Math.max(0,Math.floor(Math.max(0,from)/d)):0,last=e.loop?Math.floor(Math.max(0,to)/d):0;
  for(let cycle=first;cycle<=last;cycle++)for(let bi=0;bi<(emission.m_Bursts||[]).length;bi++){
   const burst=emission.m_Bursts[bi];for(let repeat=0;repeat<Math.max(1,burst.cycleCount);repeat++){
    const when=cycle*d+burst.time+repeat*burst.repeatInterval,k=`${cycle}:${bi}:${repeat}`;
    if(when>=Math.max(0,from)-1e-8&&when<=to+1e-8&&!state.bursts.has(k)){
     state.bursts.add(k);if(state.rng()>(burst.probability??1))continue;
     const count=Math.floor(burst.minCount+state.rng()*(burst.maxCount-burst.minCount+1));
     for(let n=0;n<count;n++)this.spawn(state,e,node,nodes,time);
    }
   }
  }
  if(from>=d&&!e.loop)return;
  const t=Math.max(0,from%d)/d;state.rate+=Math.max(0,minmax(emission.rateOverTime,t,state.rateRandom??.5))*dt;
  if(node.emitterVelocity)state.rate+=Math.max(0,minmax(emission.rateOverDistance,t,state.distanceRandom??.5))*length(node.emitterVelocity)*dt;
  let n=Math.floor(state.rate);state.rate-=n;while(n-->0)this.spawn(state,e,node,nodes,time);
 }
 integrate(state,e,node,nodes,dt,at){
  const frame=this.frame(e,node,nodes),inverse=inverseFrame(frame),alive=[];
  for(const p of state.particles){
   p.age+=dt;
   const t=clamp((p.age-dt/2)/p.life,0,1),v=e.VelocityModule,f=e.ForceModule;
   let velocity=[...p.velocity];
   const inherit=e.InheritVelocityModule;
   if(inherit?.enabled&&e.simulation_space!==0){const v=inherit.m_Mode===0?p.inheritedInitial:node.emitterVelocity||[0,0,0];velocity=add(velocity,vector(inverse,mul(v,minmax(inherit.m_Curve,t,p.r[9]))));}
   if(v?.enabled){let extra=['x','y','z'].map((axis,i)=>minmax(v[axis],t,p.r[10+i]));extra=v.inWorldSpace?vector(inverse,extra):vector(inverse,vector(node.world,extra));velocity=add(velocity,extra);}
   let acceleration=[0,0,0];
   if(f?.enabled){let force=['x','y','z'].map((axis,i)=>minmax(f[axis],t,p.r[13+i]));acceleration=f.inWorldSpace?vector(inverse,force):vector(inverse,vector(node.world,force));}
   const gravity=minmax(e.InitialModule.gravityModifier,t,p.r[16]);if(gravity)acceleration=add(acceleration,vector(inverse,[0,-9.81*gravity,0]));
   p.velocity=add(p.velocity,mul(acceleration,dt));velocity=add(velocity,mul(acceleration,dt/2));
   const limit=e.ClampVelocityModule;
   if(limit?.enabled){
    const toLimit=limit.inWorldSpace?frame:product(inverseFrame(node.world),frame),fromLimit=inverseFrame(toLimit),before=vector(toLimit,velocity),target=[...before];
    if(limit.separateAxis)for(let k=0;k<3;k++){const max=Math.max(0,minmax(limit[['x','y','z'][k]],t,p.r[10+k]));target[k]=clamp(target[k],-max,max);}
    else {const max=Math.max(0,minmax(limit.magnitude,t,p.r[10]));if(length(target)>max)for(let k=0;k<3;k++)target[k]*=max/(length(before)||1);}
    // Unity's native damping kernel is not recovered. Full damping is an
    // exact hard limit; partial damping uses an explicit 60 Hz exponential.
    const damp=1-Math.pow(1-clamp(limit.dampen,0,1),dt*60),limited=vector(fromLimit,before.map((v,k)=>v+(target[k]-v)*damp));
    if(limit.dampen>0&&limit.dampen<1)this.warnings.add('partial velocity damping uses 60 Hz exponential approximation');
    p.velocity=add(p.velocity,add(limited,mul(velocity,-1)));velocity=limited;
   }
   p.speed=length(vector(frame,velocity));
   p.currentVelocity=vector(frame,velocity);
   p.position=add(p.position,mul(velocity,dt));p.world=point(frame,...p.position);
   const rotation=e.RotationModule;if(rotation?.enabled){const axes=rotation.separateAxes;
    p.rotation[0]+=axes?minmax(rotation.x,t,p.r[17])*dt:0;p.rotation[1]+=axes?minmax(rotation.y,t,p.r[18])*dt:0;
    p.rotation[2]+=minmax(rotation.curve,t,p.r[19])*dt;}
   const spin=e.RotationBySpeedModule;if(spin?.enabled){const speed=clamp((p.speed-spin.range.x)/(spin.range.y-spin.range.x||1),0,1);p.rotation[0]+=spin.separateAxes?minmax(spin.x,speed,p.r[17])*dt:0;p.rotation[1]+=spin.separateAxes?minmax(spin.y,speed,p.r[18])*dt:0;p.rotation[2]+=minmax(spin.curve,speed,p.r[19])*dt;}
   if(p.age>=p.life){this.sub(state,p,1,nodes,at);continue;}
   if(e.NoiseModule?.enabled)this.warnings.add('noise kernel not reproduced');
   if(e.CollisionModule?.enabled)this.warnings.add('collision world unavailable; collision sub-emission unresolved');
   if(e.TrailModule?.enabled)this.warnings.add('trail geometry not reproduced');
   if(e.ExternalForcesModule?.enabled)this.warnings.add('external force-field scene unavailable');
   if(e.LimitVelocityModule?.enabled)this.warnings.add('limit-velocity/drag integration not reproduced');
   alive.push(p);
  }
  state.particles=alive;
 }
 drawables(nodes){
  const result=[];
  for(const state of this.emitters.values()){
   const e=this.effective(state,nodes),n=nodes.get(e.path),renderer=e.renderer;if(!n?.visible||!(n.rendererEnabled??e.enabled??true))continue;
   const worldScale=[0,1,2].map(k=>Math.hypot(n.world[k],n.world[k+4],n.world[k+8]));
   const scale=e.scaling_mode===2?[1,1,1]:e.scaling_mode===1?[Math.abs(n.scale.x),Math.abs(n.scale.y),Math.abs(n.scale.z)]:worldScale;
   for(const p of state.particles){
    const t=p.age/p.life,current=this.currentProperties(e,p),sizes=current.size;
    const c=['r','g','b','a'].map(k=>current.color[k]);
    const uv=e.UVModule,tx=uv.enabled?uv.tilesX:1,ty=uv.enabled?uv.tilesY:1;
    const progress=uv.enabled?minmax(uv.startFrame,0,p.r[21])+minmax(uv.frameOverTime,t,p.r[22])*uv.cycles:0;
    const frameCount=uv.animationType===1?tx:tx*ty,frame=((Math.floor(progress*frameCount)%frameCount)+frameCount)%frameCount,col=frame%tx,row=uv.animationType===1?(uv.randomRow?Math.min(ty-1,Math.floor(p.r[26]*ty)):uv.rowIndex):Math.floor(frame/tx);
    const mapUV=(u,v)=>[(col+(uv.enabled&&p.r[24]<(uv.flipU||0)?1-u:u))/tx,(row+(uv.enabled&&p.r[25]<(uv.flipV||0)?1-v:v))/ty];
    let vertices,uvs,triangles;
    if(e.render_mode===4){
     if(!e.mesh){this.warnings.add('missing particle mesh: '+e.path);continue;}
     const size={x:sizes[0]*scale[0],y:sizes[1]*scale[1],z:sizes[2]*scale[2]},local=matrix({x:0,y:0,z:0},euler(...p.rotation),size);
     const basis=n.world.map((v,i)=>i%4===3?0:v/(worldScale[i%4]||1));
     // Local-space mesh particles retain the emitter's orientation even when
     // the renderer keeps its default View alignment setting.
     const orientation=e.render_alignment===2||e.render_alignment===0&&e.simulation_space===0?product(basis,local):local;
     vertices=e.mesh.vertices.map(v=>add(p.world,point(orientation,...v)));uvs=e.mesh.uvs.map(v=>mapUV(v[0],1-v[1]));triangles=e.mesh.triangles.flat(2);
    }else{
     const axes=e.gallery_billboard_scale_axes?.axes||[0,1];
     // View billboards use the opposite roll sign to the XY rotation matrix.
     // Convert at rendering so source angles and integrated spin stay intact.
     let w=sizes[0]*scale[axes[0]],h=sizes[1]*scale[axes[1]],angle=(e.render_mode===0&&e.render_alignment===0?-1:1)*p.rotation[2];
     if(e.gallery_billboard_override){w=sizes[0]*e.gallery_billboard_override.size.x;h=sizes[1]*e.gallery_billboard_override.size.y;this.warnings.add('retained Kotori strip compensation; native billboard Z-axis scale behavior remains unverified');}
     if(e.render_mode===1){const velocity=p.currentVelocity||vector(this.frame(e,n,nodes),p.velocity);angle=Math.atan2(velocity[1],velocity[0])-Math.PI/2;h=h*(renderer.m_LengthScale||1)+length(velocity)*(renderer.m_VelocityScale||0);}
     const pivot=renderer.m_Pivot||{x:0,y:0,z:0},cs=Math.cos(angle),sn=Math.sin(angle);
     const corners=[[-.5,.5],[.5,.5],[.5,-.5],[-.5,-.5]];
     vertices=corners.map(([x,y])=>{x=(x-pivot.x)*w;y=(y-pivot.y)*h;let delta=[x*cs-y*sn,x*sn+y*cs,0];
      if(e.render_mode===2)delta=[delta[0],0,delta[1]];
      if(e.render_alignment===2){const basis=n.world.map((v,i)=>i%4===3?0:v/(worldScale[i%4]||1));delta=vector(basis,delta);}
      return add(p.world,delta);});
     if(e.render_alignment===3)this.warnings.add('facing alignment uses reference-view approximation');
     uvs=[[0,0],[1,0],[1,1],[0,1]].map(v=>mapUV(...v));triangles=[0,1,2,2,3,0];
    }
    result.push({sourcePath:e.path,image:e.image,vertices,uvs,triangles,tint:c,material:e.material,node:n,
     order:n.order??e.order,sortingLayer:renderer.m_SortingLayer,particle:p});
   }
  }
  return result;
 }
}
