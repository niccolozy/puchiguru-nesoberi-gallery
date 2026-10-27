const colorBindings=new WeakMap();
function crc32(s){let value=0xffffffff;for(const c of s){value^=c.charCodeAt(0);for(let i=0;i<8;i++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}
export function shaderContract(material={},node={},globalAlpha=1,singleAlpha=1,time=0,pass=0){
  const name=material.shader?.name||'',p=material.shader?.passes?.[pass],floats=material.floats||{};
  const value=v=>v?.val??v??0;
  const blend=p?.blend;
  const resolve=v=>v?.name&&v.name!=='<noninit>'?floats[v.name]??value(v):value(v);
  const src=blend?resolve(blend.srcBlend):material.additive?5:1;
  const dst=blend?resolve(blend.destBlend):material.additive?1:10;
  let fade=1;
  if(name.includes('/Global/'))fade*=globalAlpha;
  if(name.includes('/VertexStream/Fade/'))fade*=singleAlpha;
  const scroll=name.includes('/SimpleScroll');
  const uvOffset=scroll?[(floats._ScrollX||0)*time/20+Math.sin(time/20*(floats._SineFreqX||0))*(floats._SineAmplX||0),
    -((floats._ScrollY||0)*time+Math.sin(time/20*(floats._SineFreqY||0))*(floats._SineAmplY||0))]:[0,0];
  // PNGs are top-down. Convert the original V scroll exactly once here.
  let bindings=colorBindings.get(material);if(!bindings){bindings=new Map(Object.keys(material.colors||{}).map(k=>[crc32(k)&0xfffffff,k]));colorBindings.set(material,bindings);}
  const colors={...material.colors};for(const [attribute,value] of Object.entries(node?.materialChannels||{})){const a=Number(attribute),index=(a>>>28)-4,key=bindings.get(a&0xfffffff);if(key&&index>=0&&index<4)colors[key]={...colors[key],[['r','g','b','a'][index]]:value};}
  const tint=colors._TintColor||colors._Color||{r:1,g:1,b:1,a:1};
  const particle=name.includes('Particles/')||name.includes('/Global/')||name.includes('/VertexStream/');
  const mode=name==='CreativeTools/Sprite/Mask'?7:name==='CreativeTools/Sprite/FillColor'?6:name.startsWith('Mobile/Particles/')?5:name==='Spine/SkeletonOutLineExtreme'?(pass<4?4:3):name==='CreativeTools/Sprite/ExtremeColor'?2:name==='Particles/Alpha Blended Premultiply'?1:0;
  return {name,src,dst,fade,uvOffset,scroll,tint:[tint.r,tint.g,tint.b,tint.a],multiply:particle&&mode!==1?2:1,mode,
    blendOp:resolve(blend?.blendOp),outline:Object.values(colors._OutlineColor||{r:1,g:1,b:1,a:1}),extreme:Object.values(colors._ExtremeColor||{r:.5,g:.5,b:.5,a:1}),
    premultiply:src===1,depthWrite:!!value(p?.depth_write),depthTest:value(p?.depth_test),cull:value(p?.cull),
    colorMask:value(blend?.colMask)||15,queue:material.render_queue>=0?material.render_queue:3000};
}
