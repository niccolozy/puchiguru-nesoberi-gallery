// Independent evaluator for the legacy 3.5 / 3.6 data recovered from this game.
// Geometry is returned to the shared renderer; no third-party animation runtime.
const RAD=Math.PI/180;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const wrap=a=>((a+180)%360+360)%360-180;
const identity={a:1,b:0,c:0,d:1,x:0,y:0};
export const transform=(m,x,y)=>[m.a*x+m.c*y+m.x,m.b*x+m.d*y+m.y];
const inverse=(m,x,y)=>{const det=m.a*m.d-m.b*m.c;if(Math.abs(det)<1e-12)return [0,0];
  return [(m.d*(x-m.x)-m.c*(y-m.y))/det,(-m.b*(x-m.x)+m.a*(y-m.y))/det];};
export function curvePercent(curve,p) {
  if(curve==='stepped')return 0;
  if(!Array.isArray(curve))return p;
  const bez=(t,a,b)=>3*(1-t)**2*t*a+3*(1-t)*t*t*b+t**3;
  let l=0,h=1;
  for(let i=0;i<15;i++){const m=(l+h)/2;if(bez(m,curve[0],curve[2])<p)l=m;else h=m;}
  return bez((l+h)/2,curve[1],curve[3]);
}
function span(frames,time) {
  if(!frames?.length||time<(frames[0].time??0))return null;
  let i=0;while(i+1<frames.length&&(frames[i+1].time??0)<=time)i++;
  const a=frames[i],b=frames[i+1];
  return [a,b,b?curvePercent(a.curve,clamp((time-(a.time??0))/((b.time??0)-(a.time??0)||1),0,1)):0];
}
export function sample(frames,time,key,fallback=0,angle=false) {
  const s=span(frames,time);if(!s)return null;
  const [a,b,t]=s,left=a[key]??fallback;
  return b?left+(angle?wrap((b[key]??fallback)-left):(b[key]??fallback)-left)*t:left;
}
export const rgba=hex=>{const s=hex||'ffffffff';return [0,2,4,6].map(i=>parseInt(s.slice(i,i+2)||'ff',16)/255);};
function sampleColor(frames,time,setup) {
  const s=span(frames,time);if(!s)return setup;
  const [a,b,t]=s,left=rgba(a.color);
  return b?left.map((v,i)=>v+(rgba(b.color)[i]-v)*t):left;
}
export function animationDuration(animation) {
  if(!animation||typeof animation!=='object')return 0;
  return Math.max(Number(animation.time)||0,...Object.values(animation).map(animationDuration));
}
function localMatrix(b) {
  const rx=(b.rotation+b.shearX)*RAD,ry=(b.rotation+90+b.shearY)*RAD;
  return {a:Math.cos(rx)*b.scaleX,b:Math.sin(rx)*b.scaleX,c:Math.cos(ry)*b.scaleY,d:Math.sin(ry)*b.scaleY,x:b.x,y:b.y};
}

export class SpinePose {
  constructor(spec) {
    this.spec=spec;this.data=spec.data;
    if(!/^3\.[56]\./.test(this.data.skeleton.spine))throw new Error('Unsupported skeleton version');
    this.indices=new Map(this.data.bones.map((b,i)=>[b.name,i]));
    this.parents=this.data.bones.map(b=>this.indices.get(b.parent)??-1);
    this.attachments=new Map();this.world=[];this.compile();
    this.animation=spec.animation;this.duration=animationDuration(this.data.animations[this.animation]);
    if(!this.data.animations[this.animation])throw new Error('Missing selected animation');
    this.constraints=[...(this.data.ik||[]).map(c=>({...c,kind:'ik'})),...(this.data.transform||[]).map(c=>({...c,kind:'transform'}))]
      .sort((a,b)=>(a.order??0)-(b.order??0));
    if(this.data.path?.length)throw new Error('Path constraints are not supported');
  }
  compile() {
    const skins=this.data.skins;
    const resolve=(skin,slot,name,seen=new Set())=>{
      const key=`${skin}/${slot}/${name}`;if(this.attachments.has(key))return this.attachments.get(key);
      if(seen.has(key))throw new Error('Linked mesh cycle');seen.add(key);
      const raw=skins[skin]?.[slot]?.[name]??skins.default?.[slot]?.[name];
      if(!raw)throw new Error(`Missing attachment ${key}`);
      let a={...raw,name,skin,slot};
      if(a.type==='linkedmesh') {
        const parent=resolve(a.skin||skin,slot,a.parent,seen);
        a={...parent,...a,type:'mesh',uvs:parent.uvs,vertices:parent.vertices,triangles:parent.triangles,
          deformName:a.deform===false?name:parent.deformName||parent.name};
      }
      if(a.type==='boundingbox'||a.type==='point'){this.attachments.set(key,a);return a;}
      if(a.type&&!['mesh','region'].includes(a.type))throw new Error(`Unsupported attachment ${a.type}`);
      const region=this.spec.atlas.regions[a.path||name];
      if(!region)throw new Error(`Missing atlas region ${a.path||name}`);
      a.region=region;a.type=a.type||'region';a.deformName ||= name;
      const uv=(u,v)=>[(region.x+u*region.width)/this.spec.atlas.width,(region.y+v*region.height)/this.spec.atlas.height];
      if(a.type==='region') {
        a.triangles=[0,1,2,2,3,0];a.texcoords=[uv(0,0),uv(1,0),uv(1,1),uv(0,1)];
      } else {
        a.texcoords=[];for(let i=0;i<a.uvs.length;i+=2)a.texcoords.push(uv(a.uvs[i],a.uvs[i+1]));
        a.weighted=a.vertices.length!==a.uvs.length;
        if(a.weighted) {
          let cursor=0,deform=0;a.weights=[];
          for(let i=0;i<a.texcoords.length;i++) {
            const n=a.vertices[cursor++],influences=[];
            for(let j=0;j<n;j++) {
              const bone=a.vertices[cursor++],x=a.vertices[cursor++],y=a.vertices[cursor++],weight=a.vertices[cursor++];
              if(!this.data.bones[bone])throw new Error('Invalid influence bone');
              influences.push({bone,x,y,weight,deform});deform+=2;
            }
            a.weights.push(influences);
          }
          if(cursor!==a.vertices.length)throw new Error('Invalid weighted mesh length');
          a.deformLength=deform;
        } else a.deformLength=a.vertices.length;
      }
      this.attachments.set(key,a);return a;
    };
    for(const [skin,slots] of Object.entries(skins))for(const [slot,entries] of Object.entries(slots))
      for(const name of Object.keys(entries))resolve(skin,slot,name);
  }
  updateWorld() {
    for(let i=0;i<this.bones.length;i++) {
      if(this.overrides?.has(i)){this.world[i]=this.overrides.get(i);continue;}
      const b=this.bones[i],local=localMatrix(b),p=this.world[this.parents[i]]||identity;
      let {a,b:pb,c,d}=p;
      const mode=this.data.bones[i].transform||'normal';
      if(mode==='onlyTranslation'){a=d=1;pb=c=0;}
      else if(mode==='noScale'||mode==='noScaleOrReflection') {
        const n=Math.hypot(a,pb)||1,sign=mode==='noScaleOrReflection'?1:Math.sign(a*d-pb*c)||1;
        a/=n;pb/=n;c=-pb*sign;d=a*sign;
      } else if(mode==='noRotationOrReflection') {
        const det=a*d-pb*c;
        if(det<0){c=-c;d=-d;}
        const angle=Math.atan2(pb-c,a+d),cs=Math.cos(angle),sn=Math.sin(angle);
        [a,pb,c,d]=[cs*a+sn*pb,-sn*a+cs*pb,cs*c+sn*d,-sn*c+cs*d];
      }
      const position=transform(p,b.x,b.y);
      this.world[i]={a:a*local.a+c*local.b,b:pb*local.a+d*local.b,c:a*local.c+c*local.d,d:pb*local.c+d*local.d,x:position[0],y:position[1]};
    }
  }
  ik(c,time,animation) {
    const frames=animation.ik?.[c.name],mix=sample(frames,time,'mix',1)??c.mix??1;
    if(mix<=0)return;
    const key=span(frames,time)?.[0];const bend=(key?key.bendPositive!==false:c.bendPositive!==false)?1:-1;
    const ids=c.bones.map(n=>this.indices.get(n)),target=this.world[this.indices.get(c.target)];
    if(ids.length===1) {
      const id=ids[0],b=this.bones[id],p=this.world[this.parents[id]]||identity;
      const [x,y]=inverse(p,target.x,target.y);
      const angle=Math.atan2(y-b.y,x-b.x)/RAD-b.shearX-(b.scaleX<0?180:0);
      b.rotation+=wrap(angle-b.rotation)*mix;this.updateWorld();return;
    }
    if(ids.length!==2)throw new Error('Unsupported IK chain');
    const [ui,li]=ids,u=this.bones[ui],l=this.bones[li],p=this.world[this.parents[ui]]||identity;
    const targetLocal=inverse(p,target.x,target.y),tx=targetLocal[0]-u.x,ty=targetLocal[1]-u.y;
    const length=this.data.bones[li].length??0;
    const l1=Math.hypot(l.x*u.scaleX,l.y*u.scaleY),l2=Math.abs(length*l.scaleX*u.scaleX);
    if(l1<1e-8||l2<1e-8)return;
    const offset=Math.atan2(l.y*u.scaleY,l.x*u.scaleX);
    const a2=Math.acos(clamp((tx*tx+ty*ty-l1*l1-l2*l2)/(2*l1*l2),-1,1))*bend;
    let ur=(Math.atan2(ty,tx)-Math.atan2(l2*Math.sin(a2),l1+l2*Math.cos(a2))-offset)/RAD;
    let lr=(a2+offset)/RAD;
    // Refine the endpoint in the actual affine chain. This also handles local
    // nonuniform scale and shear, without assuming a circular second link.
    const endpoint=(r1,r2)=>{
      const a=localMatrix({...u,rotation:r1}),b=localMatrix({...l,rotation:r2});
      return [a.a*(l.x+b.a*length)+a.c*(l.y+b.b*length),a.b*(l.x+b.a*length)+a.d*(l.y+b.b*length)];
    };
    const eps=.01;
    for(let i=0;i<12;i++) {
      const q=endpoint(ur,lr),ex=tx-q[0],ey=ty-q[1];if(Math.hypot(ex,ey)<.0001)break;
      const q1=endpoint(ur+eps,lr),q2=endpoint(ur,lr+eps);
      const a=(q1[0]-q[0])/eps,b=(q2[0]-q[0])/eps,c1=(q1[1]-q[1])/eps,d=(q2[1]-q[1])/eps,det=a*d-b*c1;
      if(Math.abs(det)<1e-8)break;
      ur+=clamp((d*ex-b*ey)/det,-30,30);lr+=clamp((a*ey-c1*ex)/det,-30,30);
    }
    u.rotation+=wrap(ur-u.rotation)*mix;l.rotation+=wrap(lr-l.rotation)*mix;this.updateWorld();
  }
  transformConstraint(c,time,animation) {
    const frames=animation.transform?.[c.name],mix={};
    for(const k of ['rotateMix','translateMix','scaleMix','shearMix'])mix[k]=sample(frames,time,k,1)??c[k]??1;
    const t=this.world[this.indices.get(c.target)];
    for(const name of c.bones) {
      const id=this.indices.get(name),b={...this.world[id]};
      if(mix.rotateMix) {
        const angle=wrap((Math.atan2(t.b,t.a)-Math.atan2(b.b,b.a))/RAD+(c.rotation??0))*RAD*mix.rotateMix;
        const cs=Math.cos(angle),sn=Math.sin(angle);
        [b.a,b.b,b.c,b.d]=[cs*b.a-sn*b.b,sn*b.a+cs*b.b,cs*b.c-sn*b.d,sn*b.c+cs*b.d];
      }
      const target=transform(t,c.x??0,c.y??0);
      b.x+=(target[0]-b.x)*mix.translateMix;b.y+=(target[1]-b.y)*mix.translateMix;
      if(mix.scaleMix)for(const [x,y] of [['a','b'],['c','d']]) {
        const size=Math.hypot(b[x],b[y]);if(size>1e-8){const scale=1+(Math.hypot(t[x],t[y])-size+((x==='a'?c.scaleX:c.scaleY)??0))*mix.scaleMix/size;b[x]*=scale;b[y]*=scale;}
      }
      if(mix.shearMix){const len=Math.hypot(b.c,b.d),current=Math.atan2(b.d,b.c),desired=Math.atan2(b.b,b.a)+Math.atan2(t.d,t.c)-Math.atan2(t.b,t.a)+(c.shearY??0)*RAD;
        const angle=current+wrap((desired-current)/RAD)*RAD*mix.shearMix;b.c=Math.cos(angle)*len;b.d=Math.sin(angle)*len;}
      this.overrides.set(id,b);this.updateWorld();
    }
  }
  deform(attachment,animation,time) {
    const frames=animation.deform?.[attachment.skin]?.[attachment.slot]?.[attachment.deformName]
      ??animation.deform?.default?.[attachment.slot]?.[attachment.deformName];
    const s=span(frames,time);if(!s)return null;
    const [a,b,t]=s,read=(f,i)=>f?.vertices?.[i-(f.offset??0)]??0;
    return Array.from({length:attachment.deformLength},(_,i)=>read(a,i)+(b?read(b,i)-read(a,i):0)*t);
  }
  pose(time,animationName=this.animation) {
    const animation=this.data.animations[animationName];if(!animation)throw new Error('Missing animation');
    this.bones=this.data.bones.map(b=>({x:b.x??0,y:b.y??0,rotation:b.rotation??0,scaleX:b.scaleX??1,scaleY:b.scaleY??1,shearX:b.shearX??0,shearY:b.shearY??0}));
    this.overrides=new Map();
    for(const [name,timelines] of Object.entries(animation.bones||{})) {
      const bone=this.bones[this.indices.get(name)];
      bone.rotation+=sample(timelines.rotate,time,'angle',0,true)??0;
      for(const axis of ['x','y']) {
        bone[axis]+=sample(timelines.translate,time,axis)??0;
        bone[axis==='x'?'scaleX':'scaleY']*=sample(timelines.scale,time,axis,1)??1;
        bone[axis==='x'?'shearX':'shearY']+=sample(timelines.shear,time,axis)??0;
      }
    }
    this.updateWorld();
    for(const c of this.constraints)if(c.kind==='ik')this.ik(c,time,animation);else this.transformConstraint(c,time,animation);
    let slots=this.data.slots;
    const order=span(animation.drawOrder||animation.draworder,time)?.[0];
    if(order?.offsets?.length) {
      const arranged=new Array(slots.length),unchanged=[],changed=new Set();
      for(const offset of order.offsets){const i=slots.findIndex(s=>s.name===offset.slot);arranged[i+offset.offset]=slots[i];changed.add(i);}
      slots.forEach((s,i)=>{if(!changed.has(i))unchanged.push(s);});let j=0;
      slots=Array.from({length:slots.length},(_,i)=>arranged[i]||unchanged[j++]);
    }
    const drawables=[];
    for(const slot of slots) {
      let name=slot.attachment??null;const timeline=animation.slots?.[slot.name];
      const frame=span(timeline?.attachment,time)?.[0];if(frame)name=frame.name??null;
      if(name===null)continue;
      const key=`${this.spec.skin||'default'}/${slot.name}/${name}`;
      const a=this.attachments.get(key)||this.attachments.get(`default/${slot.name}/${name}`);
      if(!a)throw new Error(`Unresolved attachment ${key}`);
      if(a.type==='boundingbox'||a.type==='point')continue;
      const bone=this.world[this.indices.get(slot.bone)],vertices=[],deform=this.deform(a,animation,time);
      if(a.type==='region') {
        const r=(a.rotation??0)*RAD,c=Math.cos(r),s=Math.sin(r),w=(a.width??a.region.width)*(a.scaleX??1)/2,h=(a.height??a.region.height)*(a.scaleY??1)/2;
        for(const [x,y] of [[-w,h],[w,h],[w,-h],[-w,-h]])vertices.push(transform(bone,c*x-s*y+(a.x??0),s*x+c*y+(a.y??0)));
      } else if(a.weighted) {
        for(const influences of a.weights) {
          let x=0,y=0;for(const inf of influences){const [wx,wy]=transform(this.world[inf.bone],inf.x+(deform?.[inf.deform]??0),inf.y+(deform?.[inf.deform+1]??0));x+=wx*inf.weight;y+=wy*inf.weight;}
          vertices.push([x,y]);
        }
      } else for(let i=0;i<a.vertices.length;i+=2)vertices.push(transform(bone,a.vertices[i]+(deform?.[i]??0),a.vertices[i+1]+(deform?.[i+1]??0)));
      const tint=sampleColor(timeline?.color,time,rgba(slot.color)),attachmentTint=rgba(a.color);
      drawables.push({attachment:a,vertices,tint:tint.map((v,i)=>v*attachmentTint[i]),additive:slot.blend==='additive'});
    }
    return drawables;
  }
}
