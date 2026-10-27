// SpriteRenderer Simple / Sliced / Tiled geometry, in the sprite's local units.
const quad=(x0,y0,x1,y1,u0,v0,u1,v1,extra={})=>({
  vertices:[[x0,y1],[x1,y1],[x1,y0],[x0,y0]],
  uvs:[[u0,v0],[u1,v0],[u1,v1],[u0,v1]],...extra});

export function spriteGeometry(renderer,sprite) {
  const sized=renderer.draw_mode===1||renderer.draw_mode===2;
  if(!sized||!renderer.size)return [quad(sprite.left,sprite.bottom,sprite.left+sprite.width,sprite.bottom+sprite.height,0,0,1,1)];
  const w=Math.max(0,renderer.size.x),h=Math.max(0,renderer.size.y);
  const px=sprite.pivot?.x??-sprite.left/sprite.width,py=sprite.pivot?.y??-sprite.bottom/sprite.height;
  const x=-w*px,y=-h*py,b=sprite.border||{};
  let left=b.x||0,bottom=b.y||0,right=b.z||0,top=b.w||0;
  // Preserve corners, shrinking both borders together when the target is tiny.
  const sx=left+right>w?w/(left+right):1,sy=bottom+top>h?h/(bottom+top):1;
  const xs=[x,x+left*sx,x+w-right*sx,x+w],ys=[y,y+bottom*sy,y+h-top*sy,y+h];
  const us=[0,left/sprite.width,1-right/sprite.width,1];
  const vs=[1,1-bottom/sprite.height,top/sprite.height,0];
  const tiled=renderer.draw_mode===2,adaptive=renderer.tile_mode===1;
  const repeats=(size,native)=>{
    const ratio=size/Math.max(native,1e-8);
    return adaptive?Math.max(1,Math.ceil(ratio-(renderer.adaptive_threshold??.5))):ratio;
  };
  const result=[];
  for(let row=0;row<3;row++)for(let col=0;col<3;col++) {
    const dw=xs[col+1]-xs[col],dh=ys[row+1]-ys[row];
    const u0=us[col],u1=us[col+1],v0=vs[row+1],v1=vs[row];
    if(dw<=1e-8||dh<=1e-8||u1-u0<=1e-8||v1-v0<=1e-8)continue;
    if(tiled) {
      const rx=col===1?repeats(dw,(u1-u0)*sprite.width):1;
      const ry=row===1?repeats(dh,(v1-v0)*sprite.height):1;
      result.push(quad(xs[col],ys[row],xs[col+1],ys[row+1],0,0,rx,ry,
        {repeat:true,repeatRect:[u0,v0,u1-u0,v1-v0]}));
    } else result.push(quad(xs[col],ys[row],xs[col+1],ys[row+1],u0,v0,u1,v1));
  }
  return result;
}
