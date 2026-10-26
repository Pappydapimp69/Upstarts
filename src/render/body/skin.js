// Surface detail in the shader, not the mesh: countershading by facing, transverse stripes along
// the part's arc length, fbm mottling, Voronoi scales with bump, darkened dents, and shell fuzz.
// Every input is a `look` field (see README.md); colours are linear RGB hex strings.
import * as THREE from 'three';

const col = (h, d) => (Array.isArray(h) ? new THREE.Color().setRGB(h[0], h[1], h[2]) : new THREE.Color(h || d));
const uniformsFor = (look, frames = []) => {
  const s = look.stripe || {}, sc = look.scales || {}, f = look.fuzz || {};
  // Up to 16 mark frames (8 marks, each mirrored): centre + radius a, direction + radius b, u axis + darkness.
  const F = (i, f) => { const m = frames[i]; return m ? f(m) : new THREE.Vector4(0, -99, 0, 1); };
  return {
    uBack: { value: col(look.back, '#2a2016') }, uFlank: { value: col(look.flank, '#6b4a2a') },
    uBelly: { value: col(look.belly, '#b8a27e') }, uLimb: { value: col(look.limb, '#2c2620') },
    uStripe: { value: new THREE.Vector3(s.freq ?? 2.5, s.depth ?? 0, s.width ?? 0.23) },
    uScale: { value: new THREE.Vector3(sc.size ?? 64, sc.depth ?? 0.35, look.mottle ?? 0.4) },
    uMarkC: { value: [...Array(16).keys()].map((i) => F(i, (m) => new THREE.Vector4(m.c.x, m.c.y, m.c.z, m.r[0]))) },
    uMarkD: { value: [...Array(16).keys()].map((i) => F(i, (m) => new THREE.Vector4(m.D.x, m.D.y, m.D.z, m.r[1]))) },
    uMarkU: { value: [...Array(16).keys()].map((i) => F(i, (m) => new THREE.Vector4(m.U.x, m.U.y, m.U.z, m.dark))).map((v, i) => (frames[i] ? v : new THREE.Vector4(1, 0, 0, 0))) },
    uFurRoot: { value: col(f.root, '#120c07') }, uFurA: { value: col(f.tipA, '#5a3a1e') }, uFurB: { value: col(f.tipB, '#1e140b') },
    uFurLen: { value: f.len ?? 0.06 }, uFurDensity: { value: f.density ?? 0.0105 },
    // Surface state (Dlist): wet below a water line, mud below a mud line drying to cracked plates,
    // and a bulge (a swallowed mouthful) pushed out under the skin. Set with setSurface().
    uWater: { value: new THREE.Vector2(-99, 0) }, uMud: { value: new THREE.Vector3(-99, 0, 0) },
    uGulp: { value: new THREE.Vector4(0, 0, 0, 0) }, uGulpR: { value: 0.08 },
    // An opening mouth: skin inside this bind-space ellipse (x, y, half width, half height), in front of
    // z = uMouthZ and not tinted (lips), is cut away to show the mouth interior. Height 0 = shut.
    uMouth: { value: new THREE.Vector4(0, 0, 0, 0) }, uMouthZ: { value: 0 },
    // look.shell: a see-through skin, opaque at grazing angles, with a coloured rim (glass, jelly, light).
    uShellO: { value: look.shell ? look.shell.opacity ?? 0.35 : 1 }, uRim: { value: look.shell ? look.shell.rim ?? 0.8 : 0 }, uRimColor: { value: col(look.shell?.rimColor, '#ffd6a0') },
    // inner: light scattered inside the shell from a glowing core; strongest where you look straight in.
    uInner: { value: look.shell ? look.shell.inner ?? 0 : 0 }, uInnerColor: { value: col(look.shell?.innerColor, '#ffb35c') },
    // A light inside a see-through skin (look.light): its view-space position and strength, set per frame.
    uGlowPos: { value: new THREE.Vector3() }, uGlowI: { value: 0 },
    // Baked ambient occlusion (aOcc): how strongly it darkens ambient light and, a little, direct light.
    uAO: { value: look.ao === false ? 0 : (look.ao?.strength ?? 0.85) },
    // look.sss: { color, wrap }: light that scatters under thin, fleshy skin. Lit areas stay as they are;
    // past the shadow line the light wraps a little further round and comes out tinted (red for blood).
    uSssColor: { value: look.sss ? col(look.sss.color, '#c8503c').multiplyScalar(look.sss.strength ?? 1) : new THREE.Color(0) }, uSssWrap: { value: look.sss?.wrap ?? 0.5 },
  };
};

const commonGLSL = /* glsl */`
  attribute vec4 aEx; attribute vec4 aTint; varying vec4 vTint; attribute float aOcc; varying float vOcc;
`;
const sharedFrag = /* glsl */`
  varying vec3 vBindPos; varying vec3 vBindN; varying vec4 vEx;
  uniform vec3 uBack; uniform vec3 uFlank; uniform vec3 uBelly; uniform vec3 uLimb;
  uniform vec3 uStripe; uniform vec3 uScale; uniform vec4 uMarkC[16]; uniform vec4 uMarkD[16]; uniform vec4 uMarkU[16];
  float skH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float skNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(skH(i), skH(i + vec3(1,0,0)), f.x), mix(skH(i + vec3(0,1,0)), skH(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(skH(i + vec3(0,0,1)), skH(i + vec3(1,0,1)), f.x), mix(skH(i + vec3(0,1,1)), skH(i + vec3(1,1,1)), f.x), f.y), f.z); }
  float skFbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * skNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.9375; }
  vec3 skHash3(vec3 p){ p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6))); return fract(sin(p) * 43758.5453123); }
  vec3 skVor(vec3 x){ vec3 p = floor(x); vec3 f = fract(x); float d1 = 8.0, d2 = 8.0, id = 0.0;
    for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec3 b = vec3(float(i), float(j), float(k)); vec3 h = skHash3(p + b); vec3 r = b + h - f; float d = dot(r, r);
      if (d < d1) { d2 = d1; d1 = d; id = h.x; } else if (d < d2) { d2 = d; } }
    return vec3(sqrt(d1), sqrt(d2), id); }
  float stripeAt(vec3 P, float s){ float bc = s * uStripe.x + skFbm(P * 3.0) * 0.9; return smoothstep(uStripe.z + 0.11, uStripe.z - 0.11, abs(fract(bc) - 0.5)); }
  uniform vec2 uWater; uniform vec3 uMud;
  // Wetness and mud cover at a bind-space point: a ragged line, then patchy coverage below it.
  float wetAt(vec3 P){ float yj = P.y + (skNoise(P * 7.0) - 0.5) * 0.05; return uWater.y * (1.0 - smoothstep(uWater.x - 0.02, uWater.x + 0.02, yj)); }
  float mudAt(vec3 P){ float yj = P.y + (skNoise(P * 6.0 + 2.0) - 0.5) * 0.06; return uMud.y * (1.0 - smoothstep(uMud.x - 0.02, uMud.x + 0.02, yj)); }
  float markAt(vec3 P, vec3 BN){ float m = 0.0;
    for (int i = 0; i < 16; i++){ vec4 C = uMarkC[i], D = uMarkD[i], U = uMarkU[i]; if (U.w <= 0.0) continue;
      vec3 q = P - C.xyz; if (abs(dot(q, D.xyz)) > 1.5 * max(C.w, D.w)) continue;
      vec2 e = vec2(dot(q, U.xyz) / C.w, dot(q, cross(D.xyz, U.xyz)) / D.w);
      m = max(m, (1.0 - smoothstep(0.6, 1.0, dot(e, e))) * smoothstep(0.2, 0.55, dot(BN, D.xyz)) * U.w); }
    return m; }
`;

// Skin: MeshPhysicalMaterial patched in place, so lights, shadows and skinning stay three.js's own.
export function skinMaterial(look = {}, markFrames = []) {
  const mat = new THREE.MeshPhysicalMaterial({ roughness: look.roughness ?? 0.72, metalness: 0, envMapIntensity: 0.9, clearcoat: look.gloss ?? 0.05, clearcoatRoughness: 0.12, specularIntensity: 0.6 });
  const U = uniformsFor(look, markFrames);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + commonGLSL + 'varying vec3 vBindPos; varying vec3 vBindN; varying vec4 vEx;')
      .replace('#include <common>', '#include <common>\nuniform vec4 uGulp; uniform float uGulpR;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBindPos = position; vBindN = normal; vEx = aEx; vTint = aTint; vOcc = aOcc;\n{ vec3 dg = position - uGulp.xyz; transformed += normal * uGulp.w * exp(-dot(dg, dg) / (uGulpR * uGulpR)); }');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + sharedFrag + 'varying vec4 vTint; uniform vec3 uFurRoot; uniform vec4 uMouth; uniform float uMouthZ; uniform float uShellO; uniform float uRim; uniform vec3 uRimColor; uniform float uInner; uniform vec3 uInnerColor; uniform vec3 uGlowPos; uniform float uGlowI; varying float vOcc; uniform float uAO; uniform vec3 uSssColor; uniform float uSssWrap;' + /* glsl */`
      vec3 skPerturb(vec3 sp, vec3 sn, float h){ vec3 sx = dFdx(sp); vec3 sy = dFdy(sp); vec3 r1 = cross(sy, sn); vec3 r2 = cross(sn, sx);
        float det = dot(sx, r1); vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2); float gl = length(g), lim = abs(det) * 0.45;
        if (gl > lim) g *= lim / gl; vec3 n2 = abs(det) * sn - g; return dot(n2, n2) > 1e-20 ? normalize(n2) : sn; }`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        vec3 P = vBindPos; vec3 BN = normalize(vBindN);
        float fw = length(fwidth(P)), viewD = length(vViewPosition);
        float detail = (1.0 - smoothstep(6.0, 24.0, viewD)) * (1.0 - smoothstep(0.006, 0.014, fw));
        // Countershading: dark back, paler flanks, pale belly; limbs take their own scuffed tint.
        float dors = smoothstep(-0.15, 0.75, BN.y), vent = smoothstep(0.05, -0.65, BN.y);
        vec3 skin = mix(uFlank, uBack, dors);
        skin = mix(skin, uBelly, vent * (1.0 - vEx.z));
        skin = mix(skin, uLimb, vEx.z * 0.8);
        skin *= mix(1.0, 1.0 - uStripe.y, stripeAt(P, vEx.w) * vEx.y * (1.0 - vent));
        skin *= 1.0 - uScale.z * 0.5 + uScale.z * skFbm(P * 11.0);
        // Tint (clothing, markings): replaces the skin colour, with a fine weave of its own and no scales.
        float tn = smoothstep(0.35, 0.65, vTint.a); // crisp edges, as hems and markings are
        skin = mix(skin, vTint.rgb * (0.9 + 0.2 * skFbm(P * 90.0)), tn);
        vec3 vo = skVor(P * uScale.x);
        float scaleH = smoothstep(0.0, 0.42, vo.y - vo.x);
        // Fade scales out once a cell is only a few pixels wide, or they read as noise, not scales.
        float cellAA = (1.0 - smoothstep(0.12, 0.3, fw * uScale.x)) * (1.0 - tn);
        skin *= mix(1.0, mix(1.0 - uScale.y, 1.05, scaleH) * (0.9 + 0.18 * vo.z), (0.35 + 0.65 * detail) * cellAA);
        float mk = markAt(P, BN);
        skin *= 1.0 - mk;
        float gH = scaleH * (1.0 - mk) * cellAA;
        // Under fuzz the skin takes the dark root colour, so gaps between filaments don't show scales.
        skin = mix(skin, uFurRoot, smoothstep(0.05, 0.4, vEx.x));
        // Wet skin darkens and turns glossy; mud covers it, drying from dark and slick to pale cracked plates.
        float wetV = clamp(wetAt(P) * 1.3 - skNoise(P * 4.0 + 3.1) * 0.3, 0.0, 1.0);
        vec3 pl = skVor(P * 17.0 + 7.3);
        float mudM = smoothstep(0.3, 0.7, mudAt(P)), dryV = uMud.z;
        vec3 mudWetC = vec3(0.055, 0.036, 0.022) * (0.85 + 0.3 * skNoise(P * 18.0));
        vec3 mudDryC = vec3(0.13, 0.094, 0.06) * (0.82 + 0.3 * pl.z) * mix(1.0, 0.3, 1.0 - smoothstep(0.008, 0.035, pl.y - pl.x));
        skin = mix(skin, pow(skin, vec3(1.12)) * 0.42, wetV);
        skin = mix(skin, mix(mudWetC, mudDryC, dryV), mudM);
        float gRough = mix(mix(roughness, 0.3, wetV), mix(0.3, 0.97, dryV), mudM), gCoat = mix(wetV * 0.9, (1.0 - dryV) * 0.45, mudM);
        diffuseColor.rgb = skin;
        if (uMouth.w > 0.0 && P.z > uMouthZ && vTint.a < 0.5) { vec2 mq = vec2((P.x - uMouth.x) / uMouth.z, (P.y - uMouth.y) / uMouth.w); if (dot(mq, mq) < 1.0) discard; }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{ float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 2.5); diffuseColor.a = mix(uShellO, 1.0, fres); totalEmissiveRadiance += uRimColor * fres * uRim + uInnerColor * uInner * (1.0 - fres);\n  // Glass lit from inside: brighter where it is close to the light, falling off with distance.\n  vec3 gd = -vViewPosition - uGlowPos; float glow = uGlowI * 0.012 / (dot(gd, gd) + 0.012); totalEmissiveRadiance += uInnerColor * glow; diffuseColor.a = max(diffuseColor.a, min(0.6, glow * 0.25)); }')
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace('reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        'reflectedLight.directDiffuse += ( irradiance + directLight.color * uSssColor * max( 0.0, saturate( ( dot( geometryNormal, directLight.direction ) + uSssWrap ) / ( 1.0 + uSssWrap ) ) - dotNL ) ) * BRDF_Lambert( material.diffuseColor );'))
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n{ float aoK = 1.0 - min(uAO, 1.0) * vOcc; if (uAO > 9.0) { reflectedLight.directDiffuse = vec3(0.0); reflectedLight.indirectDiffuse = vec3(1.0 - vOcc); reflectedLight.directSpecular = vec3(0.0); reflectedLight.indirectSpecular = vec3(0.0); } reflectedLight.indirectDiffuse *= uAO > 9.0 ? 1.0 : aoK; reflectedLight.indirectSpecular *= mix(1.0, aoK, 0.7); reflectedLight.directDiffuse *= mix(1.0, aoK, 0.3); }')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nmaterial.clearcoat = max(material.clearcoat, gCoat); material.clearcoatRoughness = max(mix(0.06, 0.2, mudM), 0.0525);\n#endif')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = skPerturb(-vViewPosition, normal, gH * 0.003 * detail * smoothstep(0.12, 0.45, abs(dot(normal, normalize(vViewPosition)))));');
  };
  if (look.shell) { mat.transparent = true; mat.depthWrite = false; }
  mat.customProgramCacheKey = () => 'procedural-body-skin-v8';
  mat.userData.uniforms = U;
  return mat;
}

// Fuzz: per-layer alpha-tested strands; length follows coverage, colour runs root -> tip and darkens up the back.
export function fuzzMaterial(look = {}) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, envMapIntensity: 0.55, alphaToCoverage: true });
  const U = uniformsFor(look);
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + commonGLSL + 'attribute float aH; uniform float uFurLen; uniform vec2 uWater; uniform vec3 uMud; uniform vec4 uGulp; uniform float uGulpR; varying vec3 vBindPos; varying vec3 vBindN; varying vec4 vEx; varying float vH;')
      .replace('#include <begin_vertex>', /* glsl */`vec3 transformed = vec3(position);
        vBindPos = position; vBindN = normal; vEx = aEx; vH = aH;
        float wv = uWater.y * (1.0 - smoothstep(uWater.x - 0.02, uWater.x + 0.02, position.y)), mv = uMud.y * (1.0 - smoothstep(uMud.x - 0.02, uMud.x + 0.02, position.y));
        float fl = uFurLen * smoothstep(0.0, 0.5, aEx.x) * mix(1.0, 0.55, wv) * mix(1.0, 0.35, mv);
        { vec3 dg = position - uGulp.xyz; transformed += normal * uGulp.w * exp(-dot(dg, dg) / (uGulpR * uGulpR)); }
        transformed += normal * fl * aH + vec3(0.0, -0.35, -1.0) * fl * aH * aH * 0.7;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + sharedFrag + 'varying float vH; uniform vec3 uFurRoot; uniform vec3 uFurA; uniform vec3 uFurB; uniform float uFurDensity;')
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        vec3 P = vBindPos; float h = vH;
        vec3 g = P / uFurDensity, gi = floor(g), rn = skHash3(gi);
        vec3 f = fract(g) - 0.5 - (rn - 0.5) * 0.45;
        float sl = mix(0.5, 1.0, rn.z), rad = 0.5 * (1.0 - h / sl);
        float d = length(f), aa = max(fwidth(d), 0.02);
        float strand = h < sl ? 1.0 - smoothstep(rad - aa, rad + aa, d) : 0.0;
        // Far away the strands are sub-pixel: fade to a soft coat instead of shimmering.
        strand = mix(strand, 0.5 * max(0.0, 1.0 - h / 0.8), smoothstep(0.9, 2.2, max(max(fwidth(g.x), fwidth(g.y)), fwidth(g.z)))) * smoothstep(0.02, 0.25, vEx.x);
        if (strand < 0.04) discard;
        diffuseColor.a = strand;
        vec3 fc = mix(uFurA, uFurB, smoothstep(-0.1, 0.8, vBindN.y));
        fc *= mix(1.0, 1.0 - uStripe.y * 0.8, stripeAt(P, vEx.w) * vEx.y);
        fc = mix(uFurRoot, fc * (0.7 + 0.6 * rn.x), smoothstep(0.0, 0.6, h / sl));
        fc = mix(fc, pow(fc, vec3(1.15)) * 0.42, clamp(wetAt(P), 0.0, 1.0));
        fc = mix(fc, mix(vec3(0.05, 0.034, 0.021), vec3(0.13, 0.094, 0.06), uMud.z), smoothstep(0.3, 0.7, mudAt(P)));
        diffuseColor.rgb = fc;`);
  };
  mat.customProgramCacheKey = () => 'procedural-body-fuzz-v2';
  mat.userData.uniforms = U;
  return mat;
}

// Surface state for a built creature (both skin and fur): water and mud lines are bind-space heights
// (m), `wet` and `mud` how strongly they apply (0..1), `dry` how dried the mud is (0 slick .. 1 cracked).
// gulp: { at: [x, y, z] bind space, amount (m), radius (m) } pushes a bulge out under the skin.
export function setSurface(c, { water = -99, wet = 0, mudLine = -99, mud = 0, dry = 0, gulp } = {}) {
  for (const m of [c.meshes.body, c.meshes.fuzz]) {
    const U = m?.material.userData.uniforms; if (!U) continue;
    U.uWater.value.set(water, wet); U.uMud.value.set(mudLine, mud, dry);
    if (gulp) { U.uGulp.value.set(gulp.at[0], gulp.at[1], gulp.at[2], gulp.amount); U.uGulpR.value = gulp.radius ?? 0.08; } else U.uGulp.value.w = 0;
  }
}
