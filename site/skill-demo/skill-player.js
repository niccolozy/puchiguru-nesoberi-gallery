// Small renderer for the features present in the recovered Hanayo 3.5 JSON.
// Independently implemented; no Spine or Unity runtime is bundled.
const RAD = Math.PI / 180;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const wrap = angle => ((angle + 180) % 360 + 360) % 360 - 180;
const transform = (m, x, y) => [m.a * x + m.c * y + m.x, m.b * x + m.d * y + m.y];
const inverse = (m, x, y) => {
  const det = m.a * m.d - m.b * m.c;
  return [(m.d * (x - m.x) - m.c * (y - m.y)) / det,
          (-m.b * (x - m.x) + m.a * (y - m.y)) / det];
};
const identity = {a: 1, b: 0, c: 0, d: 1, x: 0, y: 0};

function curvePercent(curve, percent) {
  if (curve === 'stepped') return 0;
  if (!Array.isArray(curve)) return percent;
  const bezier = (t, c1, c2) => 3 * (1-t)**2 * t * c1 + 3 * (1-t) * t*t * c2 + t**3;
  let low = 0, high = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (low + high) / 2;
    if (bezier(mid, curve[0], curve[2]) < percent) low = mid; else high = mid;
  }
  return bezier((low + high) / 2, curve[1], curve[3]);
}

function sample(frames, time, key, fallback = 0, angle = false) {
  if (!frames?.length || time < (frames[0].time ?? 0)) return null;
  let i = 0;
  while (i + 1 < frames.length && (frames[i + 1].time ?? 0) <= time) i++;
  const left = frames[i], right = frames[i + 1];
  const a = left[key] ?? fallback;
  if (!right) return a;
  const span = (right.time ?? 0) - (left.time ?? 0);
  const amount = curvePercent(left.curve, span ? (time - (left.time ?? 0)) / span : 0);
  const delta = angle ? wrap((right[key] ?? fallback) - a) : (right[key] ?? fallback) - a;
  return a + delta * amount;
}

export class HanayoSkillPlayer {
  static async load(canvas, base = './11004106/') {
    const loadJSON = async name => {
      const response = await fetch(new URL(name, new URL(base, document.baseURI)));
      if (!response.ok) throw new Error(`Could not load ${name} (${response.status})`);
      return response.json();
    };
    const [data, metadata] = await Promise.all([loadJSON('skeleton.json'), loadJSON('asset.json')]);
    const image = new Image();
    image.src = new URL(metadata.atlas.image, new URL(base, document.baseURI)).href;
    await image.decode();
    return new HanayoSkillPlayer(canvas, data, metadata, image);
  }

  constructor(canvas, data, metadata, image) {
    this.canvas = canvas;
    this.data = data;
    this.metadata = metadata;
    this.duration = metadata.duration;
    this.animation = metadata.defaultAnimation;
    this.indices = new Map(data.bones.map((bone, i) => [bone.name, i]));
    this.parents = data.bones.map(b => this.indices.get(b.parent) ?? -1);
    this.constraints = [...(data.ik || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    this.bones = [];
    this.world = [];
    this.attachments = new Map();
    this.validateFeatures();
    this.compileAttachments();
    this.initGL(image);
    this.bounds = this.measureBounds();
    this.render(0);
  }

  validateFeatures() {
    if (this.data.skeleton.spine !== '3.5.51') throw new Error('This demo supports the recovered 3.5.51 sample only.');
    if (this.data.transform?.length || this.data.path?.length) throw new Error('Unsupported constraint type.');
    for (const name of this.metadata.animations) {
      const animation = this.data.animations[name];
      if (!animation) throw new Error(`Missing animation ${name}`);
      if (Object.keys(animation).some(k => !['bones', 'slots'].includes(k)))
        throw new Error(`Unsupported timeline in ${name}`);
      for (const timelines of Object.values(animation.bones || {}))
        if (Object.keys(timelines).some(k => !['rotate', 'translate', 'scale', 'shear'].includes(k)))
          throw new Error('Unsupported bone timeline.');
      for (const timelines of Object.values(animation.slots || {}))
        if (Object.keys(timelines).some(k => k !== 'attachment')) throw new Error('Unsupported slot timeline.');
    }
  }

  compileAttachments() {
    for (const [slotName, attachments] of Object.entries(this.data.skins.default)) {
      for (const [name, attachment] of Object.entries(attachments)) {
        const region = this.metadata.atlas.regions[attachment.path || name];
        if (!region) throw new Error(`Missing image region ${name}`);
        const uv = (u, v) => [(region.x + u * region.width) / this.metadata.atlas.width,
                             (region.y + v * region.height) / this.metadata.atlas.height];
        const compiled = {...attachment, region, name};
        if (!attachment.type || attachment.type === 'region') {
          compiled.type = 'region';
          compiled.triangles = [0, 1, 2, 2, 3, 0];
          compiled.texcoords = [uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)];
        } else if (attachment.type === 'mesh') {
          compiled.texcoords = [];
          for (let i = 0; i < attachment.uvs.length; i += 2)
            compiled.texcoords.push(uv(attachment.uvs[i], attachment.uvs[i + 1]));
          compiled.weighted = attachment.vertices.length !== attachment.uvs.length;
          if (compiled.weighted) {
            compiled.weights = [];
            const vertices = attachment.vertices;
            let cursor = 0;
            for (let i = 0; i < compiled.texcoords.length; i++) {
              const count = vertices[cursor++], influences = [];
              for (let n = 0; n < count; n++) {
                const bone = vertices[cursor++], x = vertices[cursor++], y = vertices[cursor++], weight = vertices[cursor++];
                if (!this.data.bones[bone]) throw new Error('Invalid mesh bone index.');
                influences.push({bone, x, y, weight});
              }
              compiled.weights.push(influences);
            }
            if (cursor !== vertices.length) throw new Error('Mesh vertex count mismatch.');
          }
        } else throw new Error(`Unsupported attachment ${attachment.type}`);
        this.attachments.set(`${slotName}/${name}`, compiled);
      }
    }
  }

  updateWorld() {
    for (let i = 0; i < this.bones.length; i++) {
      const bone = this.bones[i], parent = this.world[this.parents[i]] || identity;
      const rx = (bone.rotation + bone.shearX) * RAD;
      const ry = (bone.rotation + 90 + bone.shearY) * RAD;
      const a = Math.cos(rx) * bone.scaleX, b = Math.sin(rx) * bone.scaleX;
      const c = Math.cos(ry) * bone.scaleY, d = Math.sin(ry) * bone.scaleY;
      this.world[i] = {
        a: parent.a*a + parent.c*b, b: parent.b*a + parent.d*b,
        c: parent.a*c + parent.c*d, d: parent.b*c + parent.d*d,
        x: parent.a*bone.x + parent.c*bone.y + parent.x,
        y: parent.b*bone.x + parent.d*bone.y + parent.y,
      };
    }
  }

  solveLegIK(constraint) {
    // Two-link geometry, solved in the upper bone's parent coordinates.
    // Hanayo's constrained leg parents have uniform scale and no shear.
    const upperId = this.indices.get(constraint.bones[0]);
    const lowerId = this.indices.get(constraint.bones[1]);
    const upper = this.bones[upperId], lower = this.bones[lowerId];
    const parent = this.world[this.parents[upperId]] || identity;
    const target = this.world[this.indices.get(constraint.target)];
    const [tx, ty] = inverse(parent, target.x, target.y);
    const dx = tx - upper.x, dy = ty - upper.y;
    const offset = Math.atan2(lower.y * upper.scaleY, lower.x * upper.scaleX);
    const length1 = Math.hypot(lower.x * upper.scaleX, lower.y * upper.scaleY);
    const length2 = (this.data.bones[lowerId].length ?? 0) * lower.scaleX * upper.scaleX;
    const cosine = clamp((dx*dx + dy*dy - length1*length1 - length2*length2) / (2*length1*length2), -1, 1);
    const angle2 = Math.acos(cosine) * (constraint.bendPositive === false ? -1 : 1);
    const angle1 = Math.atan2(dy, dx) - Math.atan2(length2*Math.sin(angle2), length1 + length2*Math.cos(angle2));
    const mix = constraint.mix ?? 1;
    upper.rotation += wrap((angle1 - offset)/RAD - upper.rotation) * mix;
    lower.rotation += wrap((angle2 + offset)/RAD - lower.rotation) * mix;
    this.updateWorld();
  }

  pose(time, animationName = this.animation) {
    const animation = this.data.animations[animationName];
    this.bones = this.data.bones.map(b => ({x: b.x ?? 0, y: b.y ?? 0,
      rotation: b.rotation ?? 0, scaleX: b.scaleX ?? 1, scaleY: b.scaleY ?? 1,
      shearX: b.shearX ?? 0, shearY: b.shearY ?? 0}));
    for (const [name, timelines] of Object.entries(animation.bones || {})) {
      const id = this.indices.get(name), bone = this.bones[id];
      const angle = sample(timelines.rotate, time, 'angle', 0, true);
      if (angle !== null) bone.rotation += angle;
      for (const [axis, key] of [['x', 'x'], ['y', 'y']]) {
        const move = sample(timelines.translate, time, axis);
        if (move !== null) bone[key] += move;
        const scale = sample(timelines.scale, time, axis, 1);
        if (scale !== null) bone[axis === 'x' ? 'scaleX' : 'scaleY'] *= scale;
        const shear = sample(timelines.shear, time, axis);
        if (shear !== null) bone[axis === 'x' ? 'shearX' : 'shearY'] += shear;
      }
    }
    this.updateWorld();
    for (const constraint of this.constraints) this.solveLegIK(constraint);
    const drawables = [];
    for (const slot of this.data.slots) {
      let name = slot.attachment ?? null;
      for (const frame of animation.slots?.[slot.name]?.attachment || []) {
        if ((frame.time ?? 0) > time) break;
        name = frame.name ?? null;
      }
      if (name === null) continue;
      const attachment = this.attachments.get(`${slot.name}/${name}`);
      if (!attachment) throw new Error(`Unresolved attachment ${slot.name}/${name}`);
      const bone = this.world[this.indices.get(slot.bone)];
      const vertices = [];
      if (attachment.type === 'region') {
        const rotation = (attachment.rotation ?? 0) * RAD;
        const c = Math.cos(rotation), s = Math.sin(rotation);
        const w = attachment.width * (attachment.scaleX ?? 1) / 2;
        const h = attachment.height * (attachment.scaleY ?? 1) / 2;
        for (const [x, y] of [[-w,h], [w,h], [w,-h], [-w,-h]])
          vertices.push(transform(bone, c*x-s*y+(attachment.x ?? 0), s*x+c*y+(attachment.y ?? 0)));
      } else if (attachment.weighted) {
        for (const influences of attachment.weights) {
          let x = 0, y = 0;
          for (const influence of influences) {
            const [wx, wy] = transform(this.world[influence.bone], influence.x, influence.y);
            x += wx * influence.weight; y += wy * influence.weight;
          }
          vertices.push([x, y]);
        }
      } else {
        for (let i = 0; i < attachment.vertices.length; i += 2)
          vertices.push(transform(bone, attachment.vertices[i], attachment.vertices[i + 1]));
      }
      drawables.push({attachment, vertices});
    }
    return drawables;
  }

  measureBounds() {
    const bounds = {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity};
    for (const animation of this.metadata.animations) {
      for (let frame = 0; frame <= 60; frame++) {
        for (const drawable of this.pose(frame / 30, animation)) {
          for (const [x, y] of drawable.vertices) {
            bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
            bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
          }
        }
      }
    }
    return bounds;
  }

  initGL(image) {
    const gl = this.canvas.getContext('webgl', {alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true});
    if (!gl) throw new Error('WebGL is unavailable in this browser.');
    this.gl = gl;
    const shader = (type, source) => {
      const result = gl.createShader(type);
      gl.shaderSource(result, source); gl.compileShader(result);
      if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result));
      return result;
    };
    const program = gl.createProgram();
    gl.attachShader(program, shader(gl.VERTEX_SHADER, `
      attribute vec2 position; attribute vec2 uv;
      uniform vec2 center; uniform vec2 scale;
      varying vec2 texcoord;
      void main() { texcoord = uv; gl_Position = vec4((position-center)*scale,0.,1.); }
    `));
    gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `
      precision mediump float; varying vec2 texcoord; uniform sampler2D atlas;
      void main() { gl_FragColor = texture2D(atlas, texcoord); }
    `));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [name, offset] of [['position', 0], ['uv', 8]]) {
      const location = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 16, offset);
    }
    this.centerLocation = gl.getUniformLocation(program, 'center');
    this.scaleLocation = gl.getUniformLocation(program, 'scale');
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
  }

  render(time, animationName = this.animation) {
    if (!this.metadata.animations.includes(animationName)) throw new Error('Unknown animation variant.');
    this.animation = animationName;
    this.time = clamp(time, 0, this.duration);
    const data = [], drawables = this.pose(this.time);
    for (const {attachment, vertices} of drawables) {
      for (const index of attachment.triangles) {
        data.push(...vertices[index], ...attachment.texcoords[index]);
      }
    }
    if (data.some(value => !Number.isFinite(value))) throw new Error('Animation generated an invalid vertex.');
    const gl = this.gl, bounds = this.bounds;
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(width*dpr) || this.canvas.height !== Math.round(height*dpr)) {
      this.canvas.width = Math.round(width*dpr); this.canvas.height = Math.round(height*dpr);
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const fit = Math.min(width/(bounds.maxX-bounds.minX+90), height/(bounds.maxY-bounds.minY+90));
    gl.uniform2f(this.centerLocation, (bounds.minX+bounds.maxX)/2, (bounds.minY+bounds.maxY)/2);
    gl.uniform2f(this.scaleLocation, 2*fit/width, 2*fit/height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 4);
    this.stats = {vertices: data.length / 4, attachments: drawables.length};
  }
}
