import {SpinePose} from './spine-pose.js?v=20261027-names-10';
import {UnitySkillPlayer,point,product,matrix} from './unity-skill-player.js?v=20261027-names-10';
import {spriteGeometry} from './sprite-geometry.js?v=20261027-names-10';
import {AnimatorRuntime} from './animator-runtime.js?v=20261027-names-10';
import {ParticleSimulation} from './particle-simulation.js?v=20261027-names-10';
import {shaderContract} from './material-runtime.js?v=20261027-names-10';
import {SkillRenderer} from './skill-renderer.js?v=20261027-names-10';
import {OneLoopPreview} from './one-loop-preview.js?v=20261027-names-10';
const triangles=[0,1,2,2,3,0],rgba=c=>[c?.r??1,c?.g??1,c?.b??1,c?.a??1];

export async function loadSkillAssets(url){
 const sceneURL=new URL(url,document.baseURI),revision=new URL(import.meta.url).searchParams.get('v');
 if(revision)sceneURL.searchParams.set('v',revision);
 const response=await fetch(sceneURL,{cache:'no-cache'});if(!response.ok)throw new Error(`Skill request returned ${response.status}`);
 const scene=await response.json(),root=new URL('.',sceneURL),images=new Map();
 const names=new Set([...Object.values(scene.sprites).map(s=>s.image),...scene.particles.map(p=>p.image),...scene.skeletons.map(s=>s.atlas.image),...scene.meshes.map(m=>m.material.image)].filter(Boolean));
 for(const group of ['renderers','meshes','skeletons','particles'])for(const r of scene[group])for(const binding of Object.values(r.material.extra_textures||{}))if(binding.image)names.add(binding.image);
 await Promise.all([...names].map(async name=>{const img=new Image();img.src=new URL(name,root).href;await img.decode();images.set(name,img);}));
 const white=document.createElement('canvas');white.width=white.height=1;white.getContext('2d').fillStyle='#fff';white.getContext('2d').fillRect(0,0,1,1);images.set('__ui_white',white);
 const voice=await fetch(new URL(scene.voice.file,root));if(!voice.ok)throw new Error('Skill voice could not load');
 const voiceBytes=await voice.arrayBuffer(),cueBytes=new Map();
 await Promise.all(Object.entries(scene.audio?.cues||{}).map(async([key,cue])=>{
  if(cue.file===scene.voice.file){cueBytes.set(key,voiceBytes);return;}
  const r=await fetch(new URL(cue.file,root));if(!r.ok)throw new Error('Event audio could not load');cueBytes.set(key,await r.arrayBuffer());
 }));
 return {scene,images,voiceBytes,cueBytes,root};
}

// Source playback, component lifetimes and projection are independent of the
// gallery's underlying model and cancellation controls.
export class CollectionSkillPlayer {
 constructor(canvas,assets,{level=1,oneLoop=false}={}){
  this.canvas=canvas;this.scene=assets.scene;this.images=assets.images;this.duration=this.scene.duration;
  if(this.scene.schema_version!==2)throw new Error('This skill needs the native-contract export');
  this.skeletons=this.scene.skeletons.map(spec=>({spec,pose:new SpinePose(spec),restartComponent:this.scene.components.find(c=>c.path===spec.path&&c.class==='SkeletonAnimationRestart')}));this.skeletonByPath=new Map(this.skeletons.map(s=>[s.spec.path,s]));
  this.unity=new UnitySkillPlayer(document.createElement('canvas'),this.scene,this.images,{deferRender:true,drawBackground:false});
  this.pendingEvents=[];this.runtime=new AnimatorRuntime(this.scene,{level,onEvent:e=>this.pendingEvents.push(e)});
  this.unity.channelSamples=()=>this.runtime.samples();this.simulation=new ParticleSimulation(this.scene);
  this.activeSince=new Map();this.componentStates=new Map();this.globalAlpha=1;
  this.autoLoop=oneLoop?new OneLoopPreview():null;
  this.runtime.onStep=(time,dt)=>{this.currentNodes=this.buildNodes(time);this.simulation.update(time,dt,this.currentNodes);this.autoLoop?.update(this);};
  this.runtime.onStep(0,0);this.renderer=new SkillRenderer(canvas,this.images,this.scene.projection);this.gl=this.renderer.gl;
 }
 drainEvents(){return this.pendingEvents.splice(0);}
 finish(){this.runtime.finish();}
 buildNodes(time){
  const nodes=this.unity.pose(time);
  for(const c of this.scene.components){
   const n=nodes.get(c.path);if(!n)continue;const disabled=n.disabledComponents?.[c.class],active=n.visible&&(disabled===undefined?c.enabled:!disabled),previous=this.componentStates.get(c.id);
   if(c.class==='ParticleAlphaController'){
    const alpha=n.alpha??c.data.alpha??1;
    if(active&&(!previous?.active||previous.alpha!==alpha))this.globalAlpha=alpha;
    if(!active&&previous?.active)this.globalAlpha=1;
    this.componentStates.set(c.id,{active,alpha});
   }
   if(c.class==='OrderInLayerOverride'&&active)for(const target of nodes.values())if(target.path===c.path||target.path.startsWith(c.path+'/'))target.order=n.order??c.data.sortingOrder;
  }
  this.skeletonDraws=[];
  for(const sk of this.skeletons){
   const n=nodes.get(sk.spec.path);sk.clock||={active:false,elapsed:0,last:time};
   if(!n?.visible){sk.clock.active=false;sk.clock.restartActive=false;sk.clock.last=time;continue;}
   const restart=sk.restartComponent&&(n.disabledComponents?.SkeletonAnimationRestart===undefined?sk.restartComponent.enabled:!n.disabledComponents.SkeletonAnimationRestart);
   if(restart&&!sk.clock.restartActive)sk.clock.elapsed=0;sk.clock.restartActive=restart;
   if(!sk.clock.active){sk.clock.active=true;sk.clock.last=time;}
   const enabled=n.disabledComponents?.SkeletonAnimation===undefined?sk.spec.enabled:!n.disabledComponents.SkeletonAnimation;
   if(enabled)sk.clock.elapsed+=Math.max(0,time-sk.clock.last)*sk.spec.timeScale;
   sk.clock.last=time;let t=sk.clock.elapsed;
   t=sk.spec.loop&&!sk.spec.restart&&sk.pose.duration>0?t%sk.pose.duration:Math.min(t,sk.pose.duration);
   sk.trackTime=t;const geometry=sk.pose.pose(t),s=sk.spec.scale,extreme=rgba(sk.spec.material?.colors?._ExtremeColor||{r:.5,g:.5,b:.5,a:1});
   for(const [key,value] of Object.entries(n.materialChannels||{})){const i=[1203672258,1472107714,1740543170,2008978626].indexOf(Number(key));if(i>=0)extreme[i]=value;}
   const outlined=sk.spec.material.shader?.name==='Spine/SkeletonOutLineExtreme',outline=sk.spec.material.floats?._OutlineSize||0;
   const offsets=outlined?[[-outline,0],[outline,0],[0,-outline],[0,outline],[0,0]]:[[0,0]];
   if((n.rendererEnabled??sk.spec.renderer_enabled)!==false)for(let pass=0;pass<offsets.length;pass++)for(const d of geometry){const [ox,oy]=offsets[pass],tint=sk.spec.pma_vertex_colors?d.tint.map((v,i)=>i<3?v*d.tint[3]:v):d.tint;this.skeletonDraws.push({image:sk.spec.atlas.image,sourcePath:sk.spec.path,vertices:d.vertices.map(([x,y])=>point(n.world,x*s+ox,y*s+oy)),uvs:d.attachment.texcoords,triangles:d.attachment.triangles,tint,extreme,pass,order:n.order??sk.spec.order,material:sk.spec.material,node:n,sortingLayer:sk.spec.sorting_layer});}
  }
  const overridden=new Set();
  for(const f of this.scene.follows){
   const sk=this.skeletonByPath.get(f.skeleton),n=nodes.get(f.path),source=nodes.get(f.skeleton),b=sk?.pose.world[sk.pose.indices.get(f.bone)];
   if(!n||!source||!b||!source.visible||f.mode!==0)continue;
   const s=sk.spec.scale,follow=product(source.world,[b.a,b.c,0,b.x*s,b.b,b.d,0,b.y*s,0,0,1,0]);
   // Observed records are Follow with all flags true. Preserve flags instead of
   // silently treating an unreviewed Override record as equivalent.
   if(f.position&&f.rotation&&f.scale){n.world=follow;overridden.add(n.id);}
   else this.simulation.warnings.add('partial utility-bone follow flags require review');
  }
  const visited=new Set(),refresh=n=>{
   if(visited.has(n.id))return;visited.add(n.id);if(overridden.has(n.id)){n.boneDescendant=true;return;}
   const raw=this.unity.nodeById.get(n.parent),parent=raw&&nodes.get(raw.path);if(parent){refresh(parent);if(parent.boneDescendant){n.world=product(parent.world,matrix(n.position,n.rotation,n.scale));n.boneDescendant=true;}}
  };for(const n of nodes.values())refresh(n);
  return nodes;
 }
 advance(time){
  if(time<this.runtime.time-1e-8){this.simulation.reset();this.activeSince.clear();for(const sk of this.skeletons)sk.clock=null;this.componentStates.clear();this.globalAlpha=1;this.pendingEvents=[];this.autoLoop?.reset();this.runtime.reset();}
  this.runtime.advance(time);
 }
 drawables(time=this.runtime.time){
  if(Math.abs(time-this.runtime.time)>1e-8)this.advance(time);
  const nodes=this.currentNodes,result=[...this.skeletonDraws];
  for(const r of this.scene.renderers){
   const n=nodes.get(r.path),s=this.scene.sprites[n?.sprite||r.sprite];if(!n?.visible||!(n.rendererEnabled??r.enabled??true)||!s)continue;
   const c={...r.color,...n.color};
   for(const geometry of spriteGeometry(r,s))result.push({...geometry,sourcePath:r.path,image:s.image,vertices:geometry.vertices.map(v=>point(n.world,v[0]*(r.flip_x?-1:1),v[1]*(r.flip_y?-1:1),v[2]||0)),triangles,
    tint:rgba(c),extreme:null,maskRect:s.source_uv_rect,
    order:n.order??r.order,material:r.material,node:n,sortingLayer:r.sorting_layer});
  }
  for(const m of this.scene.meshes){const n=nodes.get(m.path);if(!n?.visible||!m.material.image||(n.rendererEnabled??m.renderer_enabled)===false)continue;
   result.push({image:m.material.image,sourcePath:m.path,vertices:m.vertices.map(v=>point(n.world,...v)),uvs:m.uvs.map(v=>[v[0],1-v[1]]),triangles:m.triangles.flat(2),tint:[1,1,1,1],order:n.order??m.order,material:m.material,node:n});}
  result.push(...this.simulation.drawables(nodes));
  for(const ui of this.scene.ui_images){
   // Only the primary dim Image is replaced by the gallery's dimmed model.
   // Keep secondary Image artwork, rect/pivot and animated color. The absent
   // runtime Canvas is explicitly a gallery composition adaptation.
   if(ui.background)continue;const n=nodes.get(ui.path);if(!n?.visible||ui.enabled===false||n.disabledComponents?.Image)continue;
   const rect=n.rect;if(!rect){this.simulation.warnings.add('UI Image missing RectTransform: '+ui.path);continue;}
   const size=rect.m_SizeDelta,pivot=rect.m_Pivot,s=this.scene.sprites[n.sprite||ui.sprite],c={...ui.color,...n.color};
   const x=-pivot.x*size.x,y=-pivot.y*size.y;
   result.push({image:s?.image||'__ui_white',sourcePath:ui.path,vertices:[[x,y+size.y],[x+size.x,y+size.y],[x+size.x,y],[x,y]].map(v=>point(n.world,...v)),uvs:[[0,0],[1,0],[1,1],[0,1]],triangles,tint:rgba(c),order:n.order??-10000,material:{shader:{name:'Gallery/UI',passes:[{blend:{srcBlend:5,destBlend:10}}]}},node:n});
   this.simulation.warnings.add('UI serialized rect rendered behind effects; runtime Canvas layout unresolved: '+ui.path);
  }
  for(const d of result){let single=1;
   for(const c of this.scene.components)if(c.class==='ParticleSingleAlphaController'&&(d.sourcePath===c.path||d.sourcePath?.startsWith(c.path+'/'))){const n=nodes.get(c.path),disabled=n?.disabledComponents?.[c.class];if(n?.visible&&(disabled===undefined?c.enabled:!disabled))single=n.singleAlpha??c.data.alpha??1;}
   d.shader=shaderContract(d.material,d.node,this.globalAlpha,single,this.shaderTime??time,d.pass??0);if(d.shader.scroll)d.repeat=true;
  }
  result.sort((a,b)=>(a.sortingLayer||0)-(b.sortingLayer||0)||a.order-b.order||a.shader.queue-b.shader.queue);
  return result;
 }
 render(time){this.advance(time);this.time=this.runtime.time;const draw=this.drawables();this.stats={...this.renderer.draw(draw),unresolvedBindings:this.scene.unresolved_bindings.length};this.viewport=this.renderer.viewport;}
 dispose(){this.renderer?.dispose();this.simulation.reset();this.pendingEvents=[];this.globalAlpha=1;this.gl=null;}
}
