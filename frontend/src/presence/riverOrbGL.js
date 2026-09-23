/**
 * riverOrbGL — River's placeholder body, drawn with WebGL on a transparent
 * canvas. Reads a snapshot from riverMind; decides nothing itself.
 *
 * Two passes:
 *
 *   Body   A full-canvas shader. A soft, lobed membrane with several vortices
 *          turning inside it: spiral arms of fine strands around each eye,
 *          and broad silky currents between them. Each vortex turns rigidly
 *          by its own phase, so the arms rotate forever without winding up.
 *
 *   Motes  Points. A shell of particles around her, some loose, which she
 *          flings outward when she is doing something and pulls back after;
 *          ribbons of particles that pass through her and carry her voice;
 *          and flecks that come off her surface and float away, fading.
 *
 * Everything fades to nothing well inside the canvas edge. A hard edge
 * anywhere in this is a defect.
 */

const BODY_VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`

const BODY_FS = `
precision highp float;
uniform vec2  uRes;
uniform float uBody;          // body radius, device px
uniform float uT, uOct;
uniform float uEnergy, uCoh, uTurb, uWob, uLevel, uFlare, uSpark;
uniform vec2  uAttn;
uniform vec4  uV[5];          // vortex: xy centre (body units), z strength, w radius
uniform vec3  uC0, uC1, uC2, uC3, uDeep;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x  = a0.x  * x0.x   + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= uOct) break;
    s += a * snoise(p);
    p = mat2(1.6, 1.2, -1.2, 1.6) * p;
    a *= 0.5;
  }
  return s;
}

vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }

// Smooth walk through the three near hues. The accent is laid in separately.
vec3 pal(float x) {
  float y = fract(x) * 3.0;
  if (y < 1.0) return mix(uC0, uC1, smoothstep(0.0, 1.0, y));
  if (y < 2.0) return mix(uC1, uC2, smoothstep(0.0, 1.0, y - 1.0));
  return mix(uC2, uC0, smoothstep(0.0, 1.0, y - 2.0));
}

// Spiral arms around each vortex: a log-spiral phase, a few broad arms, and
// fine strands running along them. Each vortex turns rigidly by its own
// integrated phase (uV.w), so the arms rotate without ever winding up.
// Returns x: arm light, y: eye glow, z: which vortex dominates (for hue).
vec3 spirals(vec2 q, float warp) {
  float light = 0.0, eye = 0.0, hueW = 0.0, wsum = 0.001;
  for (int i = 0; i < 5; i++) {
    float st = uV[i].z;
    float s = abs(st);
    if (s < 0.02) continue;
    vec2 v = q - uV[i].xy;
    float r = length(v);
    float rad = 0.52 + 0.18 * s;
    float w = exp(-r * r / (rad * rad));
    float th = atan(v.y, v.x) * sign(st);
    float arms = mod(float(i), 2.0) < 0.5 ? 2.0 : 3.0;
    float ph = th + 2.3 * log(r + 0.035) - uV[i].w + warp * 1.4;
    float arm = pow(0.5 + 0.5 * cos(ph * arms), 1.7);
    float strands = pow(0.5 + 0.5 * cos(ph * arms * 6.0 + r * 14.0 + warp * 4.0), 4.0);
    float lit = w * s * (0.06 + arm * (0.32 + 0.75 * strands));
    light += lit;
    eye += exp(-r * r / (0.008 + 0.008 * s)) * s;
    hueW += lit * float(i);
    wsum += lit;
  }
  return vec3(light, eye, hueW / wsum);
}

// Space rotated around each vortex. Sampling the silk here is what makes the
// currents between the eyes curl into them instead of lying flat.
vec2 twist(vec2 q) {
  for (int i = 0; i < 5; i++) {
    float s = abs(uV[i].z);
    if (s < 0.02) continue;
    vec2 v = q - uV[i].xy;
    float rad = 0.52 + 0.18 * s;
    float f = exp(-dot(v, v) / (rad * rad));
    q = uV[i].xy + rot(v, sign(uV[i].z) * f * (1.6 + 0.9 * s) + f * uV[i].w * 0.15);
  }
  return q;
}

// Broad silky currents: low-frequency ridges in twisted space, carried by a
// gentle warp. Wide and few — never the crinkle of high-frequency ridges.
vec2 silk(vec2 q) {
  vec2 tq = twist(q);
  vec2 w = vec2(fbm(tq * 0.8 + uT * 0.05), fbm(tq * 0.8 + vec2(5.2, 1.3) - uT * 0.045));
  vec2 p = tq + w * (0.35 + uTurb * 0.5);
  float ridge = pow(1.0 - abs(snoise(p * 1.1 + uT * 0.03)), 3.2);
  float fine = pow(1.0 - abs(snoise(p * 2.0 - uT * 0.04 + 3.0)), 7.0);
  return vec2(ridge * 0.5 + fine * 0.3, w.x);
}

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 p = gl_FragCoord.xy - 0.5 * uRes;
  vec2 q = p / uBody - uAttn * 0.07;
  float r = length(q);
  float ang = atan(q.y, q.x);

  // Lobed, breathing edge — never a perfect circle.
  vec2 ring = vec2(cos(ang), sin(ang));
  float lob = snoise(ring * 1.15 + uT * 0.23) * 0.6 + snoise(ring * 2.4 + 7.0 - uT * 0.31) * 0.4;
  float edge = 1.0 + uWob * 0.12 * lob + uLevel * 0.07 + uFlare * 0.025;
  float d = r / edge;
  if (d > 1.5) { gl_FragColor = vec4(0.0); return; }

  float inside = 1.0 - smoothstep(0.93, 1.02, d);
  float depth = smoothstep(0.0, 1.0, d);
  float e = 0.5 + uEnergy * 0.75 + uFlare * 0.8 + uLevel * 0.45;

  vec2 sk = silk(q);
  vec3 sp = spirals(q, sk.y * uTurb);

  // Colour: each vortex carries its own part of the palette, drifting.
  float hue = sp.z * 0.23 + sk.y * 0.35 + uT * 0.015;
  vec3 hueA = pal(hue);
  vec3 hueB = pal(hue + 0.4);

  vec3 col = hueA * sp.x * 1.25 * e;
  col += hueB * sk.x * (0.18 + 0.36 * depth) * e;
  col += mix(hueA, vec3(1.0), 0.55) * min(sp.y, 1.5) * 0.7 * e;
  // Sparse accent hue in the silk.
  float acc = pow(max(0.0, snoise(q * 1.4 + uT * 0.07 + 40.0)), 4.0);
  col += uC3 * acc * sk.x * 1.6 * e;
  col *= inside;

  // The membrane: a soft band inside the edge whose brightness wanders, so it
  // reads as a surface catching light rather than a drawn ring.
  float band = smoothstep(0.78, 0.99, d) * (1.0 - smoothstep(0.99, 1.045, d));
  float sheen = pow(0.5 + 0.5 * snoise(ring * 2.2 + uT * 0.4), 1.6);
  col += mix(uC1, uC2, 0.5 + 0.5 * lob) * band * sheen * (0.28 + 0.34 * uCoh) * e;

  // Glow bleeding outward, gone well before the canvas edge.
  float out_ = max(d - 1.0, 0.0);
  float halo = exp(-out_ * 7.5) * (1.0 - smoothstep(1.15, 1.42, d)) * (1.0 - inside * 0.85);
  col += uC1 * halo * (0.10 + 0.14 * uEnergy + 0.25 * uFlare + 0.12 * uLevel);

  // Sparks: tiny twinkling specks in and just around her.
  vec2 cell = q * 17.0;
  vec2 id = floor(cell);
  float h = hash(id);
  vec2 jit = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float sd = length(fract(cell) - 0.5 - jit * 0.7);
  float tw = 0.5 + 0.5 * sin(uT * (2.0 + h * 5.0) + h * 40.0);
  float spark = step(0.86, h) * smoothstep(0.09, 0.0, sd) * tw * (0.35 + uSpark);
  spark *= 1.0 - smoothstep(0.95, 1.2, d);
  col += mix(pal(h), vec3(1.0), 0.6) * spark * 0.9;

  // A faint dark volume behind her so she has depth over any backdrop.
  float deepA = inside * (0.22 + 0.2 * depth) * (0.6 + 0.4 * uCoh);

  // Soft shoulder instead of clipping: bright moments stay coloured rather
  // than burning out to a flat white blob.
  col = 1.0 - exp(-col * 1.35);

  float glow = max(col.r, max(col.g, col.b));
  float alpha = clamp(glow + deepA, 0.0, 1.0);
  gl_FragColor = vec4(col + uDeep * deepA, alpha);
}
`

const MOTE_VS = `
attribute vec4 aSeed;
attribute float aKind;          // 0 shell, 1 ribbon, 2 fleck
uniform vec2  uRes;
uniform float uBody, uDpr, uT, uFlow;
uniform float uShell, uRibbon, uCoh, uTurb, uLevel, uReach, uReachDir, uRibAng, uEnergy;
uniform vec2  uRotXY, uAttn;
uniform vec3  uC0, uC1, uC2;
varying vec4  vCol;

float hash1(float n) { return fract(sin(n) * 43758.5453); }

vec3 palette(float x) {
  float y = fract(x) * 3.0;
  if (y < 1.0) return mix(uC0, uC1, y);
  if (y < 2.0) return mix(uC1, uC2, y - 1.0);
  return mix(uC2, uC0, y - 2.0);
}

void main() {
  vec2 pos;
  float alpha, size;
  vec3 col;

  if (aKind < 0.5) {
    // Shell: a point on the sphere, turned by her slow rotation.
    float z = aSeed.x * 2.0 - 1.0;
    float ph = aSeed.y * 6.2831853;
    float s = sqrt(1.0 - z * z);
    vec3 dir = vec3(s * cos(ph), s * sin(ph), z);
    float cy = cos(uRotXY.y), sy = sin(uRotXY.y);
    dir = vec3(cy * dir.x + sy * dir.z, dir.y, -sy * dir.x + cy * dir.z);
    float cx = cos(uRotXY.x), sx = sin(uRotXY.x);
    dir = vec3(dir.x, cx * dir.y - sx * dir.z, sx * dir.y + cx * dir.z);

    float rad = 1.02 + (1.0 - uCoh) * 0.16 * sin(dot(dir, vec3(3.1, 2.7, 1.9)) * 2.0 + uT * 1.3 + aSeed.z * 6.28);
    rad += uTurb * 0.05 * sin(aSeed.w * 40.0 + uT * 2.0);
    // Loose motes drift farther out.
    float loose = step(0.84, aSeed.w);
    rad += loose * (0.12 + 0.35 * aSeed.z) * (1.2 - uCoh);
    // Reaching: the particles on one side are thrown out, then return.
    vec2 rd = vec2(cos(uReachDir), sin(uReachDir));
    float facing = smoothstep(0.2, 0.9, dot(normalize(dir.xy + 1e-4), rd));
    rad += uReach * facing * (0.25 + 0.6 * aSeed.z);
    rad += uLevel * 0.07;

    pos = dir.xy * rad * uBody + uAttn * 0.07 * uBody;
    float front = smoothstep(-0.7, 1.0, dir.z);
    alpha = uShell * (0.22 + 0.78 * front) * (0.6 + 0.5 * uEnergy);
    size = max(1.2 * uDpr, uBody * (0.006 + 0.010 * aSeed.z) * (0.7 + 0.4 * front));
    col = mix(palette(aSeed.w), vec3(1.0), 0.45);
  } else if (aKind < 1.5) {
    // Ribbons: strands in a band that twists as it passes through her.
    float strand = floor(aSeed.y * 18.0);
    float u = fract(aSeed.x + uFlow * (0.05 + 0.03 * aSeed.z)) * 2.0 - 1.0;
    float amp = 0.30 + uLevel * 0.45;
    float freq = 2.6 + uLevel * 3.5;
    float wave = sin(u * freq + uT * 0.55 + strand * 0.05) * amp;
    wave += sin(u * freq * 2.7 - uT * 2.6 + strand * 0.11) * uLevel * 0.12;
    float width = 0.20 * cos(u * 2.1 + uT * 0.3 + 0.8);
    float y = wave + (strand / 17.0 - 0.5) * width;
    float halfW = 0.5 * uRes.x * 0.97;
    vec2 local = vec2(u * halfW, y * uBody);
    float c = cos(uRibAng), s = sin(uRibAng);
    pos = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
    alpha = uRibbon * pow(1.0 - smoothstep(0.5, 1.0, abs(u)), 1.5) * (0.6 + 0.4 * aSeed.w);
    size = max(1.1 * uDpr, uBody * (0.005 + 0.007 * aSeed.w));
    col = mix(palette(strand / 18.0 + u * 0.15), vec3(1.0), 0.4);
  } else {
    // Flecks: bits of her that lift off the surface and float away, fading.
    // Each fleck lives one cycle; every new life picks a fresh place, speed
    // and path from its cycle number, so no fleck ever retraces the last.
    float rate = 0.10 + 0.08 * aSeed.w;
    float age = uT * rate + aSeed.x;
    float life = fract(age);
    float cyc = floor(age);
    float h1 = hash1(cyc * 12.9898 + aSeed.y * 78.233);
    float h2 = hash1(cyc * 39.346 + aSeed.z * 11.135);
    float h3 = hash1(cyc * 73.156 + aSeed.w * 52.235);

    float ang = h1 * 6.2831853;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 side = vec2(-dir.y, dir.x);
    // Held close when she is gathered (listening), freer when she is loose,
    // thrown further when she speaks or reaches.
    float travel = (0.35 + 0.8 * h2) * (1.45 - uCoh) * (1.0 + uLevel * 0.9 + uReach * 0.7);
    float r0 = 0.95 + 0.1 * h3;
    vec2 p = dir * (r0 + life * travel)
           + side * sin(life * 5.0 + h3 * 20.0) * 0.07 * (0.5 + h2)
           + vec2(0.0, life * (0.10 + 0.12 * h3));
    pos = p * uBody + uAttn * 0.07 * uBody;

    // Lifts off quickly, lingers as it fades.
    float fade = smoothstep(0.0, 0.12, life) * pow(1.0 - life, 1.3);
    float twinkle = 0.75 + 0.25 * sin(uT * (3.0 + 5.0 * h2) + h1 * 30.0);
    // Most are dust; about one in six is a larger bit you can follow.
    float big = step(0.83, h3);
    alpha = fade * twinkle * (0.6 + 0.4 * h2) * (0.7 + 0.5 * uEnergy) * (1.0 + 0.3 * big);
    size = max(1.3 * uDpr, uBody * (0.012 + 0.02 * h3) * (1.0 + 1.4 * big) * (1.0 - 0.35 * life));
    col = mix(palette(h1 + 0.2), vec3(1.0), 0.55);
  }

  // Nothing gets near the canvas edge.
  float reachOut = max(abs(pos.x) / (0.5 * uRes.x), abs(pos.y) / (0.5 * uRes.y));
  if (aKind < 0.5 || aKind > 1.5) alpha *= 1.0 - smoothstep(0.8, 0.97, reachOut);
  alpha *= 1.0 - smoothstep(0.9, 0.99, abs(pos.y) / (0.5 * uRes.y));

  gl_Position = vec4(pos / (0.5 * uRes), 0.0, 1.0);
  gl_PointSize = size;
  vCol = vec4(col, alpha);
}
`

const MOTE_FS = `
precision mediump float;
varying vec4 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vCol.a;
  gl_FragColor = vec4(vCol.rgb * a, a);
}
`

/* ------------------------------------------------------------- palette */

function parseColor(str) {
  const s = (str || '').trim()
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (m) {
    let h = m[1]
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  }
  m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  if (m) return [m[1], m[2], m[3]].map((v) => Number(v) / 255)
  return null
}

function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function hsl(h, s, l) {
  h = ((h % 360) + 360) % 360
  const k = (n) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0), f(8), f(4)]
}

/**
 * River's colours, built to complement the active universe.
 * A narrow run of neighbouring hues around the theme's primary — darker on
 * one side, lighter on the other — plus one hue a little further along for
 * sparse accents, and a deep tone for her volume. Kept narrow on purpose:
 * spread wide, a gold universe turns her red, lime and magenta at once.
 * A near-grey primary (Giedi Prime) keeps her near-grey.
 */
export function derivePalette(primaryCss) {
  const rgb = parseColor(primaryCss) || [0.36, 0.7, 0.96]
  const [h, s0] = rgbToHsl(rgb)
  const grey = s0 < 0.14
  const s = grey ? 0.12 : Math.min(0.95, Math.max(0.6, s0))
  return {
    c0: hsl(h - 22, s, 0.46),
    c1: hsl(h, s, 0.55),
    c2: hsl(h + 20, s * 0.9, 0.64),
    c3: hsl(h - (grey ? 0 : 46), grey ? 0.1 : s * 0.9, 0.55),
    deep: hsl(h - 12, grey ? 0.06 : s * 0.55, 0.07),
  }
}

const ERROR_PALETTE = derivePalette('#e5484d')

/* ------------------------------------------------------------- renderer */

function compile(gl, type, src) {
  const sh = gl.createShader(type)
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`river orb shader: ${log}`)
  }
  return sh
}

function program(gl, vs, fs) {
  const p = gl.createProgram()
  const v = compile(gl, gl.VERTEX_SHADER, vs)
  const f = compile(gl, gl.FRAGMENT_SHADER, fs)
  gl.attachShader(p, v)
  gl.attachShader(p, f)
  gl.linkProgram(p)
  // Flag the shaders now; they go when the program does.
  gl.deleteShader(v)
  gl.deleteShader(f)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`river orb link: ${gl.getProgramInfoLog(p)}`)
  const u = {}
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS)
  for (let i = 0; i < n; i++) {
    const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '')
    u[name] = gl.getUniformLocation(p, name)
  }
  return { p, u }
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ detail: 'compact'|'full', random?: () => number }} opts
 * Returns null when WebGL is unavailable, so the caller can fall back.
 */
export function createOrbRenderer(canvas, { detail = 'full', random = Math.random } = {}) {
  const gl = canvas.getContext('webgl', {
    alpha: true, premultipliedAlpha: true, antialias: false,
    depth: false, stencil: false, powerPreference: 'low-power',
  })
  if (!gl) return null

  const compact = detail === 'compact'
  const body = program(gl, BODY_VS, BODY_FS)
  const motes = program(gl, MOTE_VS, MOTE_FS)

  const quad = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

  const shellN = compact ? 170 : 2200
  const ribbonN = compact ? 0 : 7200
  const fleckN = compact ? 16 : 360
  const count = shellN + ribbonN + fleckN
  const seeds = new Float32Array(count * 4)
  const kinds = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    for (let j = 0; j < 4; j++) seeds[i * 4 + j] = random()
    kinds[i] = i < shellN ? 0 : i < shellN + ribbonN ? 1 : 2
  }
  const seedBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf)
  gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW)
  const kindBuf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf)
  gl.bufferData(gl.ARRAY_BUFFER, kinds, gl.STATIC_DRAW)

  const aPos = gl.getAttribLocation(body.p, 'aPos')
  const aSeed = gl.getAttribLocation(motes.p, 'aSeed')
  const aKind = gl.getAttribLocation(motes.p, 'aKind')

  let width = 1, height = 1, dpr = 1
  let pal = null, palTarget = null
  const vort = new Float32Array(20)

  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
  const lerpPal = (a, b, t) => ({ c0: lerp3(a.c0, b.c0, t), c1: lerp3(a.c1, b.c1, t), c2: lerp3(a.c2, b.c2, t), c3: lerp3(a.c3, b.c3, t), deep: lerp3(a.deep, b.deep, t) })

  return {
    resize(w, h, ratio) {
      dpr = ratio
      width = Math.max(1, Math.round(w * ratio))
      height = Math.max(1, Math.round(h * ratio))
      if (canvas.width !== width) canvas.width = width
      if (canvas.height !== height) canvas.height = height
    },

    /** New universe: she eases into the new colours rather than switching. */
    setPalette(p) {
      palTarget = p
      if (!pal) pal = p
    },

    render(s, dt) {
      if (!pal) return
      // Ease toward the universe's palette, then toward error red if she is hurt.
      pal = lerpPal(pal, palTarget, Math.min(1, dt * 1.6))
      const P = s.err > 0.01 ? lerpPal(pal, ERROR_PALETTE, s.err * 0.8) : pal

      const bodyPx = (0.5 * Math.min(width, height)) / (compact ? 1.5 : 1.45)
      for (let i = 0; i < 5; i++) {
        const v = s.vortices[i]
        vort[i * 4] = v.x; vort[i * 4 + 1] = v.y; vort[i * 4 + 2] = v.strength; vort[i * 4 + 3] = v.phase
      }

      gl.viewport(0, 0, width, height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.enable(gl.BLEND)

      // --- body
      gl.useProgram(body.p)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      const u = body.u
      gl.uniform2f(u.uRes, width, height)
      gl.uniform1f(u.uBody, bodyPx)
      gl.uniform1f(u.uT, s.time)
      gl.uniform1f(u.uOct, compact ? 3 : 4)
      gl.uniform1f(u.uEnergy, s.energy)
      gl.uniform1f(u.uCoh, s.cohesion)
      gl.uniform1f(u.uTurb, s.turbulence)
      gl.uniform1f(u.uWob, s.wobble)
      gl.uniform1f(u.uLevel, s.level)
      gl.uniform1f(u.uFlare, s.flare)
      gl.uniform1f(u.uSpark, s.spark)
      gl.uniform2f(u.uAttn, s.attnX, s.attnY)
      gl.uniform4fv(u.uV, vort)
      gl.uniform3fv(u.uC0, P.c0); gl.uniform3fv(u.uC1, P.c1); gl.uniform3fv(u.uC2, P.c2)
      gl.uniform3fv(u.uC3, P.c3); gl.uniform3fv(u.uDeep, P.deep)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      gl.disableVertexAttribArray(aPos)

      // --- motes, added as light
      gl.useProgram(motes.p)
      gl.blendFunc(gl.ONE, gl.ONE)
      const m = motes.u
      gl.uniform2f(m.uRes, width, height)
      gl.uniform1f(m.uBody, bodyPx)
      gl.uniform1f(m.uDpr, dpr)
      gl.uniform1f(m.uT, s.time)
      gl.uniform1f(m.uFlow, s.flow)
      gl.uniform1f(m.uShell, s.shell)
      gl.uniform1f(m.uRibbon, s.ribbon)
      gl.uniform1f(m.uCoh, s.cohesion)
      gl.uniform1f(m.uTurb, s.turbulence)
      gl.uniform1f(m.uLevel, s.level)
      gl.uniform1f(m.uReach, s.reach)
      gl.uniform1f(m.uReachDir, s.reachDir)
      gl.uniform1f(m.uRibAng, s.ribbonAngle)
      gl.uniform1f(m.uEnergy, s.energy)
      gl.uniform2f(m.uRotXY, s.rotX, s.rotY)
      gl.uniform2f(m.uAttn, s.attnX, s.attnY)
      gl.uniform3fv(m.uC0, P.c0); gl.uniform3fv(m.uC1, P.c1); gl.uniform3fv(m.uC2, P.c2)
      gl.bindBuffer(gl.ARRAY_BUFFER, seedBuf)
      gl.enableVertexAttribArray(aSeed)
      gl.vertexAttribPointer(aSeed, 4, gl.FLOAT, false, 0, 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, kindBuf)
      gl.enableVertexAttribArray(aKind)
      gl.vertexAttribPointer(aKind, 1, gl.FLOAT, false, 0, 0)
      gl.drawArrays(gl.POINTS, 0, count)
      gl.disableVertexAttribArray(aSeed)
      gl.disableVertexAttribArray(aKind)
    },

    /** Free what this renderer made, but keep the context: the same canvas
     *  may get a new renderer straight away (StrictMode's second mount, a
     *  context restore), and a lost context would make that one fail. */
    destroy() {
      gl.deleteBuffer(quad)
      gl.deleteBuffer(seedBuf)
      gl.deleteBuffer(kindBuf)
      gl.deleteProgram(body.p)
      gl.deleteProgram(motes.p)
    },

    /** Give the context back to the browser. Only once the canvas is gone
     *  for good — browsers cap live contexts, and waiting for GC to free
     *  them can push out one that is still on screen. */
    release() {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }
}
