// Source-timeline player for the recovered Unity-only Chika sample.
// Sprite channels use decoded Unity coefficients. Particle behavior is a 2D approximation.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b-a)*t;
const unit = [1,0,0,0, 0,1,0,0, 0,0,1,0];
export const point = (m,x,y,z=0) => [m[0]*x+m[1]*y+m[2]*z+m[3],m[4]*x+m[5]*y+m[6]*z+m[7],m[8]*x+m[9]*y+m[10]*z+m[11]];
export function product(a,b) {
  const result = new Array(12);
  for(let row=0;row<3;row++) {
    for(let col=0;col<3;col++) result[row*4+col]=a[row*4]*b[col]+a[row*4+1]*b[4+col]+a[row*4+2]*b[8+col];
    result[row*4+3]=a[row*4]*b[3]+a[row*4+1]*b[7]+a[row*4+2]*b[11]+a[row*4+3];
  }
  return result;
}
export function matrix(position,rotation,scale) {
  const length=Math.hypot(rotation.x,rotation.y,rotation.z,rotation.w)||1;
  const x=rotation.x/length,y=rotation.y/length,z=rotation.z/length,w=rotation.w/length,sx=scale.x,sy=scale.y,sz=scale.z;
  return [(1-2*y*y-2*z*z)*sx,(2*x*y-2*z*w)*sy,(2*x*z+2*y*w)*sz,position.x,
    (2*x*y+2*z*w)*sx,(1-2*x*x-2*z*z)*sy,(2*y*z-2*x*w)*sz,position.y,
    (2*x*z-2*y*w)*sx,(2*y*z+2*x*w)*sy,(1-2*x*x-2*y*y)*sz,position.z];
}
export function streamed(frames,time,step=false) {
  if(!frames.length) throw new Error('Missing decoded curve');
  let i=0;
  while(i+1<frames.length && frames[i+1].time<=time) i++;
  const frame=frames[i], [a,b,c,d]=frame.coeff;
  const dt=Math.max(0,time-frame.time);
  return step ? d : ((a*dt+b)*dt+c)*dt+d;
}
function hermite(keys,time) {
  if(!keys.length) return 0;
  if(time<=keys[0].time) return keys[0].value;
  let i=0;
  while(i+1<keys.length && keys[i+1].time<=time) i++;
  const a=keys[i],b=keys[i+1];
  if(!b) return a.value;
  const dt=b.time-a.time,t=(time-a.time)/dt;
  if(!Number.isFinite(a.outSlope)||!Number.isFinite(b.inSlope)) return a.value;
  return (2*t**3-3*t*t+1)*a.value+(t**3-2*t*t+t)*dt*a.outSlope
    +(-2*t**3+3*t*t)*b.value+(t**3-t*t)*dt*b.inSlope;
}
export function minmax(curve,time,random=.5) {
  if(!curve) return 0;
  const mode=curve.minMaxState;
  if(mode===0) return curve.scalar;
  if(mode===3) return lerp(curve.minScalar,curve.scalar,random);
  const max=hermite(curve.maxCurve.m_Curve,time)*curve.scalar;
  return mode===1 ? max : lerp(hermite(curve.minCurve.m_Curve,time)*curve.minScalar,max,random);
}
function gradient(data,time) {
  const sample=(kind,component)=>{
    const count=data[kind==='a'?'m_NumAlphaKeys':'m_NumColorKeys'];
    const frames=[];
    for(let i=0;i<count;i++) frames.push({time:data[`${kind==='a'?'atime':'ctime'}${i}`]/65535,value:data[`key${i}`][component]});
    if(!frames.length) return 1;
    let i=0;
    while(i+1<frames.length && frames[i+1].time<=time) i++;
    const a=frames[i],b=frames[i+1];
    return b?lerp(a.value,b.value,clamp((time-a.time)/(b.time-a.time),0,1)):a.value;
  };
  return {r:sample('c','r'),g:sample('c','g'),b:sample('c','b'),a:sample('a','a')};
}
export function color(value,time,random) {
  const mode=value.minMaxState;
  if(mode===0) return {...value.maxColor};
  if(mode===1) return gradient(value.maxGradient,time);
  if(mode===2) return Object.fromEntries(['r','g','b','a'].map(k=>[k,lerp(value.minColor[k],value.maxColor[k],random)]));
  const a=gradient(value.minGradient,time),b=gradient(value.maxGradient,time);
  return Object.fromEntries(['r','g','b','a'].map(k=>[k,lerp(a[k],b[k],random)]));
}
export function random(seed) {
  let state=(seed>>>0)||1;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}

export class UnitySkillPlayer {
  static async load(canvas,base='./',options={}) {
    const root=new URL(base,document.baseURI), response=await fetch(new URL('scene.json',root));
    if(!response.ok) throw new Error(`Scene request returned ${response.status}`);
    const scene=await response.json(), images=new Map();
    const names=new Set([...Object.values(scene.sprites).map(s=>s.image),...scene.particles.map(p=>p.image)]);
    await Promise.all([...names].map(async name=>{const img=new Image();img.src=new URL(name,root).href;await img.decode();images.set(name,img);}));
    return new UnitySkillPlayer(canvas,scene,images,options);
  }
  constructor(canvas,scene,images,options={}) {
    this.canvas=canvas;this.scene=scene;this.images=images;this.duration=scene.duration;
    this.drawBackground=options.drawBackground!==false;
    this.ctx=canvas.getContext('2d');
    if(!this.ctx) throw new Error('Canvas rendering is unavailable');
    this.nodeById=new Map(scene.nodes.map(n=>[n.id,n]));
    this.particleById=new Map(scene.particles.map(p=>[p.id,p]));
    this.subParents=new Map();
    for(const emitter of scene.particles) {
      if(emitter.SubModule.enabled) for(const sub of emitter.SubModule.subEmitters)
        if(sub.type===0) this.subParents.set(String(sub.emitter.m_PathID),emitter.id);
    }
    this.unknownChannels=scene.channels.filter(c=>!(c.binding.typeID===4||c.binding.typeID===1||c.binding.typeID===212
      ||(c.binding.typeID===198&&c.binding.attribute===2007035361)));
    if(!options.deferRender)this.render(0);
  }
  pose(time) {
    const nodes=new Map(this.scene.nodes.map(n=>[n.path,{...n,position:{...n.position},rotation:{...n.rotation},scale:{...n.scale},color:null,sprite:null}]));
    const samples=this.channelSamples?this.channelSamples(time):this.scene.channels.map(channel=>({channel,time,mapping:this.scene.sprite_mapping}));
    for(const {channel,time:sampleTime,mapping} of samples) {
      const node=nodes.get(channel.path),b=channel.binding;
      if(!node)continue; // Unresolved source paths remain in the exported diagnostics.
      const values=channel.curves.map(c=>streamed(c,sampleTime,!!b.isPPtrCurve||b.typeID===1));
      if(b.typeID===4) {
        if(b.attribute===1) node.position={x:values[0],y:values[1],z:values[2]};
        if(b.attribute===3) node.scale={x:values[0],y:values[1],z:values[2]};
        if(b.attribute===4) {
          const [x,y,z]=values.map(v=>v*Math.PI/360),cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
          node.rotation={x:sx*cy*cz+cx*sy*sz,y:cx*sy*cz-sx*cy*sz,z:cx*cy*sz-sx*sy*cz,w:cx*cy*cz+sx*sy*sz};
        }
        if(b.attribute===2) node.rotation={x:values[0],y:values[1],z:values[2],w:values[3]};
      } else if(b.typeID===1) node.active=values[0]>=.5;
      else if(b.typeID===114&&b.attribute===3305885265){node.disabledComponents||={};node.disabledComponents[b.script]=values[0]<.5;}
      else if(b.typeID===198) {
        if(b.attribute===2007035361)node.particleAlpha=values[0];
        if(channel.property){node.particleProperties||=[];node.particleProperties.push([channel.property,values[0]]);}
      } else if(b.typeID===114&&b.script==='ParticleAlphaController') {
        if(b.attribute===3305885265)node.alphaControllerEnabled=values[0]>=.5;
        else node.alpha=values[0];
      }
      else if(b.typeID===114&&b.script==='ParticleSingleAlphaController') {
        if(b.attribute===3305885265)node.singleAlphaEnabled=values[0]>=.5;
        else node.singleAlpha=values[0];
      }
      else if(b.typeID===114&&b.script==='OrderInLayerOverride')node.order=values[0];
      else if(b.typeID===23||b.typeID===96) {
        if(b.attribute===3305885265)node.rendererEnabled=values[0]>=.5;
        else {node.materialChannels||={};node.materialChannels[b.attribute]=values[0];}
      } else if(b.typeID===199)node.rendererEnabled=values[0]>=.5;
      else if(b.typeID===212||(b.typeID===114&&b.script==='Image')) {
        if(b.attribute===3305885265)node.rendererEnabled=values[0]>=.5;
        else if(b.isPPtrCurve) node.sprite=mapping[Math.round(values[0])];
        else {
          node.color ||= {};
          const key={304273561:'a',2526845255:'r',4215373228:'g',2334886179:'b'}[b.attribute];
          if(key) node.color[key]=values[0];
        }
      }
    }
    const complete=node=>{
      if(node.world) return;
      const originalParent=this.nodeById.get(node.parent),parent=originalParent?nodes.get(originalParent.path):null;
      if(parent) complete(parent);
      node.world=product(parent?.world||unit,matrix(node.position,node.rotation,node.scale));
      node.visible=!!node.active && (!parent || parent.visible);
      node.inheritedAlpha=(parent?.inheritedAlpha??1)*(node.alphaControllerEnabled===false?1:node.alpha??1);
    };
    for(const node of nodes.values()) complete(node);
    return nodes;
  }
  births(emitter,offset=0) {
    const e=emitter.EmissionModule;
    if(!e.enabled) return [];
    const delay=offset+minmax(emitter.delay,0),births=[];
    const cycles=emitter.loop&&emitter.length>0?Math.ceil((this.duration-offset)/emitter.length):1;
    for(let loop=0;loop<cycles;loop++)for(const burst of e.m_Bursts||[]) {
      for(let cycle=0;cycle<Math.max(1,burst.cycleCount);cycle++) {
        const count=Math.round((burst.minCount+burst.maxCount)/2);
        for(let i=0;i<count;i++) births.push(delay+loop*emitter.length+burst.time+cycle*burst.repeatInterval);
      }
    }
    const rate=minmax(e.rateOverTime,0);
    if(rate>0) for(let t=1/rate;t<Math.min(emitter.loop?this.duration:emitter.length,this.duration-offset);t+=1/rate) births.push(delay+t);
    return births.sort((a,b)=>a-b);
  }
  particles(time,nodes) {
    const list=[];
    for(let i=0;i<this.scene.particles.length;i++) {
      let e=this.scene.particles[i];const node=nodes.get(e.path);
      if(!node?.visible||node.rendererEnabled===false)continue;
      if(node.particleProperties?.length) {
        e=structuredClone(e);
        for(const [path,value] of node.particleProperties){let object=e;for(const key of path.slice(0,-1))object=object?.[key];if(object)object[path.at(-1)]=value;}
      }
      if(!e.EmissionModule.enabled)continue;
      const parentId=this.subParents.get(e.id),parent=parentId?this.particleById.get(parentId):null;
      const activated=this.activationTime?.(e.path,time)||0;
      const schedule=parent?this.births(parent,activated).flatMap(t=>this.births(e,t)):this.births(e,activated);
      for(let n=0;n<schedule.length;n++) {
        const birth=schedule[n],age=time-birth,rng=random((i+1)*73856093+(n+1)*19349663);
        const initial=e.InitialModule;
        const life=minmax(initial.startLifetime,birth/e.length,rng());
        if(age<0 || age>=life || life<=0) continue;
        const t=age/life,shape=e.ShapeModule;
        let x=0,y=0,z=0;
        if(shape.enabled) {
          const radius=shape.radius.value,angle=rng()*Math.PI*2,r=Math.sqrt(rng())*radius;
          x=Math.cos(angle)*r;y=Math.sin(angle)*r;
          if(shape.type===1) z=(rng()-.5)*radius;
        }
        const velocity=e.VelocityModule;
        if(velocity.enabled) {
          x+=minmax(velocity.x,t,rng())*age;
          y+=minmax(velocity.y,t,rng())*age;
          z+=minmax(velocity.z,t,rng())*age;
        }
        const speed=minmax(initial.startSpeed,birth/e.length,rng());
        z+=speed*age;
        const world=point(node.world,x,y,z);
        const startColor=color(initial.startColor,0,rng());
        const lifeColor=e.ColorModule.enabled?color(e.ColorModule.gradient,t,rng()):{r:1,g:1,b:1,a:1};
        const opacity=startColor.a*lifeColor.a*(node.particleAlpha??1)*(node.inheritedAlpha??1);
        if(opacity<=.001) continue;
        let size=minmax(initial.startSize,birth/e.length,rng());
        const baseSize=size;
        if(e.SizeModule.enabled) size*=minmax(e.SizeModule.curve,t,rng());
        const scale=Math.hypot(node.world[0],node.world[4],node.world[8]);
        const width=Math.max(0,size*(e.billboard_size?.x??scale));
        const height=Math.max(0,size*(e.billboard_size?.y??scale));
        size=Math.max(0,size*scale);
        let rotation=minmax(initial.startRotation,birth/e.length,rng());
        if(e.RotationModule.enabled) rotation+=minmax(e.RotationModule.curve,t,rng())*age;
        const uv=e.UVModule;
        const tilesX=uv.enabled?uv.tilesX:1,tilesY=uv.enabled?uv.tilesY:1;
        const progress=uv.enabled?minmax(uv.startFrame,0,rng())+minmax(uv.frameOverTime,t,rng())*uv.cycles:0;
        const frame=clamp(Math.floor(progress*tilesX*tilesY),0,tilesX*tilesY-1);
        let geometry=null;
        let drawWidth=width,drawHeight=height;
        if(e.precise_geometry) {
          const dimensions=[baseSize,initial.size3D?minmax(initial.startSizeY,birth/e.length,rng()):baseSize,
            initial.size3D?minmax(initial.startSizeZ,birth/e.length,rng()):baseSize];
          if(e.SizeModule.enabled){const axes=e.SizeModule.separateAxes;
            dimensions[0]*=minmax(e.SizeModule.curve,t,.5);
            dimensions[1]*=minmax(axes?e.SizeModule.y:e.SizeModule.curve,t,.5);
            dimensions[2]*=minmax(axes?e.SizeModule.z:e.SizeModule.curve,t,.5);}
          const hierarchy=[Math.hypot(node.world[0],node.world[4],node.world[8]),Math.hypot(node.world[1],node.world[5],node.world[9]),Math.hypot(node.world[2],node.world[6],node.world[10])];
          const scales=e.scaling_mode===2?[1,1,1]:e.scaling_mode===1?[Math.abs(node.scale.x),Math.abs(node.scale.y),Math.abs(node.scale.z)]:hierarchy;
          drawWidth=Math.max(0,dimensions[0]*scales[0]);drawHeight=Math.max(0,dimensions[1]*scales[1]);
          if(e.mesh) {
            const ax=initial.rotation3D?minmax(initial.startRotationX,birth/e.length,.5):0;
            const ay=initial.rotation3D?minmax(initial.startRotationY,birth/e.length,.5):0;
            const cx=Math.cos(ax/2),sx=Math.sin(ax/2),cy=Math.cos(ay/2),sy=Math.sin(ay/2),cz=Math.cos(rotation/2),sz=Math.sin(rotation/2);
            const q={x:sx*cy*cz+cx*sy*sz,y:cx*sy*cz-sx*cy*sz,z:cx*cy*sz-sx*sy*cz,w:cx*cy*cz+sx*sy*sz};
            const local=matrix({x:0,y:0,z:0},q,{x:dimensions[0],y:dimensions[1],z:dimensions[2]});
            const basis=node.world.map((v,index)=>index%4===3?0:v*scales[index%4]/(hierarchy[index%4]||1));
            geometry={vertices:e.mesh.vertices.map(v=>{const p=point(product(basis,local),...v);return [world[0]+p[0],world[1]+p[1],world[2]+p[2]];}),
              uvs:e.mesh.uvs.map(uv=>[(frame%tilesX+uv[0])/tilesX,(Math.floor(frame/tilesX)+1-uv[1])/tilesY]),triangles:e.mesh.triangles.flat(2)};
          }
        }
        list.push({kind:'particle',path:e.path,x:world[0],y:world[1],size,width:drawWidth,height:drawHeight,geometry,rotation,opacity,image:e.image,
          tint:[startColor.r*lifeColor.r,startColor.g*lifeColor.g,startColor.b*lifeColor.b,opacity],
          frame,tilesX,tilesY,order:node.order??e.order,additive:e.additive});
      }
    }
    return list;
  }
  render(time) {
    this.time=clamp(time,0,this.duration);
    const nodes=this.pose(this.time),ctx=this.ctx;
    const width=Math.max(1,this.canvas.clientWidth),height=Math.max(1,this.canvas.clientHeight),dpr=Math.min(devicePixelRatio||1,2);
    if(this.canvas.width!==Math.round(width*dpr)||this.canvas.height!==Math.round(height*dpr)) {
      this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
    }
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const fit=Math.min(width/16,height/17);
    const background=nodes.get('BgFillColor');
    if(this.drawBackground&&background?.visible) {ctx.fillStyle='rgba(0,0,0,.588235)';ctx.fillRect(0,0,width,height);}
    ctx.translate(width/2,height/2);ctx.scale(fit,-fit);ctx.translate(0,1.5);
    const drawables=this.particles(this.time,nodes);
    for(const r of this.scene.renderers) {
      const node=nodes.get(r.path),sprite=this.scene.sprites[node.sprite||r.sprite];
      if(node.visible && sprite) drawables.push({kind:'sprite',sprite,node,renderer:r,order:r.order});
    }
    drawables.sort((a,b)=>a.order-b.order);
    let visible=0;
    for(const item of drawables) {
      ctx.save();
      if(item.kind==='sprite') {
        const {node,sprite,renderer}=item,m=node.world,c={...renderer.color,...node.color};
        ctx.globalAlpha=clamp(c.a,0,1);
        ctx.transform(m[0],m[4],m[1],m[5],m[3],m[7]);
        ctx.translate(sprite.left,sprite.bottom+sprite.height);ctx.scale(1,-1);
        if(renderer.material==='Sprite-ExtremeColor') ctx.filter=`brightness(${Math.min(1,((c.r+c.g+c.b)/3)*2)})`;
        ctx.drawImage(this.images.get(sprite.image),0,0,sprite.width,sprite.height);
      } else {
        ctx.globalAlpha=clamp(item.opacity,0,1);
        ctx.globalCompositeOperation=item.additive?'lighter':'source-over';
        ctx.translate(item.x,item.y);ctx.rotate(item.rotation);ctx.scale(1,-1);
        const image=this.images.get(item.image),tw=image.width/item.tilesX,th=image.height/item.tilesY;
        const sx=(item.frame%item.tilesX)*tw,sy=Math.floor(item.frame/item.tilesX)*th;
        ctx.drawImage(image,sx,sy,tw,th,-item.width/2,-item.height/2,item.width,item.height);
      }
      visible++;ctx.restore();
    }
    this.stats={drawables:visible,particles:drawables.filter(x=>x.kind==='particle').length,
      unsupportedBindings:this.unknownChannels.length};
  }
}
