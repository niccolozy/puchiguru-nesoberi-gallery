import {sourceProjection,referenceViewport} from './source-projection.js?v=20261027-names-10';
export class SkillRenderer {
 constructor(canvas,images,projection){
  this.canvas=canvas;this.projection=projection;
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true});if(!gl)throw new Error('WebGL unavailable');this.gl=gl;
  const compile=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s;};
  this.program=gl.createProgram();this.shaders=[compile(gl.VERTEX_SHADER,`attribute vec3 position;attribute vec2 uv;attribute vec4 tint;
    uniform mat4 projection;varying vec2 texcoord;varying vec4 color;
    void main(){texcoord=uv;color=tint;gl_Position=projection*vec4(position,1.);}`),
   compile(gl.FRAGMENT_SHADER,`precision mediump float;varying vec2 texcoord;varying vec4 color;uniform sampler2D atlas;
    uniform vec4 extreme;uniform float repeatUV;uniform vec4 repeatRect;uniform vec2 uvOffset;uniform vec4 textureST;uniform vec4 materialTint;uniform vec3 behavior;uniform float shaderMode;uniform vec4 outline;
    uniform sampler2D maskTexture;uniform vec4 maskST;uniform vec4 maskRect;uniform float maskRepeat;
    void main(){vec2 u=texcoord*textureST.xy+textureST.zw+uvOffset;if(repeatUV>.5)u=repeatRect.xy+fract(u)*repeatRect.zw;
      vec4 tex=texture2D(atlas,u),vertex=color*materialTint,c=tex*vertex;
      if(shaderMode>6.5){vec2 mu=(maskRect.xy+texcoord*maskRect.zw)*maskST.xy+maskST.zw;if(maskRepeat>.5)mu=fract(mu);c.rgb*=c.a;c*=texture2D(maskTexture,mu).r;}
      else if(shaderMode>5.5){float a=tex.a*vertex.a*vertex.a;c=vec4(vertex.rgb*a,a);}
      else if(shaderMode>4.5){c=tex*clamp(color,0.,1.);}
      else if(shaderMode>3.5){float a=tex.a*outline.a*(color.a>=.9999?1.:color.a*.4);c=vec4(outline.rgb*a,a);}
      else if(shaderMode>2.5){vec3 straight=c.rgb/(c.a+step(c.a,.01));float a=c.a*extreme.a;c=vec4((straight*extreme.rgb*2.+max(extreme.rgb-.5,0.)*2.)*a,a);}
      else if(shaderMode>1.5){c=vec4((c.rgb*2.+max(vertex.rgb-.5,0.)*2.)*c.a,c.a);}
      else if(shaderMode>.5){c*=vertex.a;}
      else {c*=behavior.x;c.a*=extreme.a*behavior.y;if(behavior.z>.5)c.rgb*=c.a;}
      gl_FragColor=c;}`)];
  for(const s of this.shaders)gl.attachShader(this.program,s);gl.linkProgram(this.program);if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(this.program));
  gl.useProgram(this.program);this.buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
  for(const [name,size,offset] of [['position',3,0],['uv',2,12],['tint',4,20]]){const loc=gl.getAttribLocation(this.program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,36,offset);}
  this.uniforms=Object.fromEntries(['projection','extreme','repeatUV','repeatRect','uvOffset','textureST','materialTint','behavior','shaderMode','outline','maskTexture','maskST','maskRect','maskRepeat'].map(n=>[n,gl.getUniformLocation(this.program,n)]));
  this.textures=new Map();
  for(const [name,img] of images){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
   gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);this.textures.set(name,t);}
  gl.enable(gl.BLEND);gl.clearColor(0,0,0,0);
 }
 draw(drawables){
  const gl=this.gl,u=this.uniforms,canvas=this.canvas,w=Math.max(1,canvas.clientWidth||canvas.width),h=Math.max(1,canvas.clientHeight||canvas.height),dpr=Math.min(devicePixelRatio||1,2);
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
  const view=referenceViewport(canvas.width,canvas.height,this.projection);this.viewport=view;
  gl.viewport(Math.round(view.x),Math.round(view.y),Math.round(view.width),Math.round(view.height));
  gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.colorMask(true,true,true,true);gl.depthMask(true);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(u.projection,false,sourceProjection(this.projection));
  const factors={0:gl.ZERO,1:gl.ONE,2:gl.DST_COLOR,3:gl.SRC_COLOR,4:gl.ONE_MINUS_DST_COLOR,5:gl.SRC_ALPHA,6:gl.ONE_MINUS_SRC_COLOR,7:gl.DST_ALPHA,8:gl.ONE_MINUS_DST_ALPHA,9:gl.SRC_ALPHA_SATURATE,10:gl.ONE_MINUS_SRC_ALPHA};
  let count=0,batch=[],current=null,key='';
  const flush=()=>{
   if(!batch.length)return;
   const d=current,c=d.shader,e=c.mode===3?c.extreme:d.extreme||[.5,.5,.5,1],material=d.material;
   const texture=this.textures.get(d.image);if(!texture)throw new Error('Missing native-contract texture '+d.image);
   const data=new Float32Array(batch);if(data.some(v=>!Number.isFinite(v)))throw new Error('Invalid skill geometry');
   gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
   const mask=material?.extra_textures?._MaskTex;if(c.mode===7&&!mask)throw new Error('Mask shader missing recovered mask texture');
   gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,mask?this.textures.get(mask.image):texture);gl.activeTexture(gl.TEXTURE0);gl.uniform1i(u.maskTexture,1);
   gl.uniform4fv(u.maskST,[mask?.scale.x??1,mask?.scale.y??1,mask?.offset.x??0,1-(mask?.scale.y??1)-(mask?.offset.y??0)]);gl.uniform4fv(u.maskRect,d.maskRect||[0,0,1,1]);gl.uniform1f(u.maskRepeat,mask?.wrap===0?1:0);
   // RGB uses the recovered pass. Alpha stores transmittance for compositing
   // onto the gallery: additive passes add color without obscuring the model.
   gl.blendFuncSeparate(factors[c.src]??gl.ONE,factors[c.dst]??gl.ONE_MINUS_SRC_ALPHA,c.dst===1?gl.ZERO:gl.ONE,c.dst===1?gl.ONE:gl.ONE_MINUS_SRC_ALPHA);
   gl.blendEquationSeparate(({0:gl.FUNC_ADD,1:gl.FUNC_SUBTRACT,2:gl.FUNC_REVERSE_SUBTRACT})[c.blendOp]||gl.FUNC_ADD,gl.FUNC_ADD);
   gl.uniform4fv(u.extreme,e);gl.uniform1f(u.repeatUV,d.repeat?1:0);gl.uniform4fv(u.repeatRect,d.repeatRect||[0,0,1,1]);gl.uniform2fv(u.uvOffset,c.uvOffset);
   gl.uniform4fv(u.materialTint,c.tint);gl.uniform3fv(u.behavior,[c.multiply,c.fade,c.premultiply?1:0]);
   gl.uniform1f(u.shaderMode,c.mode||0);gl.uniform4fv(u.outline,c.outline||[1,1,1,1]);
   gl.uniform4fv(u.textureST,[material?.texture_scale?.x??1,material?.texture_scale?.y??1,material?.texture_offset?.x??0,1-(material?.texture_scale?.y??1)-(material?.texture_offset?.y??0)]);
   gl.depthMask(c.depthWrite);if(c.depthTest){gl.enable(gl.DEPTH_TEST);gl.depthFunc(({1:gl.NEVER,2:gl.LESS,3:gl.EQUAL,4:gl.LEQUAL,5:gl.GREATER,6:gl.NOTEQUAL,7:gl.GEQUAL,8:gl.ALWAYS})[c.depthTest]||gl.LEQUAL);}else gl.disable(gl.DEPTH_TEST);
   if(c.cull){gl.enable(gl.CULL_FACE);gl.cullFace(c.cull===1?gl.FRONT:gl.BACK);}else gl.disable(gl.CULL_FACE);
   gl.colorMask(!!(c.colorMask&8),!!(c.colorMask&4),!!(c.colorMask&2),true);
   gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);gl.drawArrays(gl.TRIANGLES,0,data.length/9);count+=data.length/9;batch=[];
  };
  for(const d of drawables){const next=JSON.stringify([d.image,d.shader,d.extreme,d.repeat,d.repeatRect,d.maskRect,d.material?.extra_textures,d.material?.texture_scale,d.material?.texture_offset]);
   if(next!==key){flush();key=next;current=d;}
   for(const i of d.triangles){const v=d.vertices[i],uv=d.uvs[i];if(!v||!uv)throw new Error('Invalid triangle reference');batch.push(v[0],v[1],v[2]??0,uv[0],uv[1],...(d.tint||[1,1,1,1]));}}
  flush();return {vertices:count,drawables:drawables.length};
 }
 dispose(){const gl=this.gl;if(!gl)return;for(const t of this.textures.values())gl.deleteTexture(t);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);for(const s of this.shaders)gl.deleteShader(s);this.gl=null;}
}
