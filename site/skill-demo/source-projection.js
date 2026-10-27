export function referenceViewport(width,height,contract){
  const ratio=contract.reference_width/contract.reference_height;
  const w=Math.min(width,height*ratio),h=w/ratio;
  return {x:(width-w)/2,y:(height-h)/2,width:w,height:h};
}
export function sourceProjection(contract,width=750,height=1334){
  const ref=contract.reference_height/contract.reference_width;
  const root=[...contract.root_position];root[2]=contract.root_position[2]*Math.max(1,(height/width)/ref);
  const f=1/Math.tan(contract.vertical_fov*Math.PI/360),aspect=width/height,near=.01,far=1000;
  const q=(far+near)/(far-near),r=2*far*near/(far-near);
  // Full homogeneous projection of the inspected identity view/root TRS. Keep
  // depth in clip.w so UVs interpolate perspectively; the engine looks along +Z.
  const camera=contract.camera_position||[0,0,0],x=root[0]-camera[0],y=root[1]-camera[1],z=root[2]-camera[2];
  return new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,q,1,x*f/aspect,y*f,q*z-r,z]);
}
export function projectPoint(point,contract,width,height){
  const m=sourceProjection(contract,width,height),[x,y,z=0]=point;
  const w=m[3]*x+m[7]*y+m[11]*z+m[15];
  return [(m[0]*x+m[4]*y+m[8]*z+m[12])/w,(m[1]*x+m[5]*y+m[9]*z+m[13])/w,w];
}
