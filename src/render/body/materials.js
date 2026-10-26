// Materials for parts that are not skin (part.material + look.materials[name]):
//   { kind: 'glow', color, intensity }            a light source you can see (a core, a lantern)
//   { kind: 'ribbon', color, ink, rows, freq }    a paper-like band printed with lines of "text"
// The text is not words: rows of dashes along the part's arc length, broken into word-sized runs
// with hashed gaps, which reads as writing at any distance without a font.
import * as THREE from 'three';

const C = (c, d) => new THREE.Color(c || d);

// soft: a glow with no hard edge. The surface adds light (additive, no depth write), brightest where it
// faces the camera and fading to nothing at its silhouette, whiter in the middle, like a flame's heart.
export function glowMaterial(m = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: C(m.color, '#ffb35c'), emissive: C(m.color, '#ffb35c'), emissiveIntensity: m.intensity ?? 2.2, roughness: 0.4 });
  if (!m.soft) return mat;
  // Premultiplied blending: light adds over a dark background (additive) but also covers a bright one
  // by `cover`, so the glow still reads as a warm body in daylight.
  mat.color.set(0); mat.transparent = true; mat.depthWrite = false;
  mat.blending = THREE.CustomBlending; mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  const U = { uSoft: { value: m.soft }, uCover: { value: m.cover ?? 0.5 }, uHeart: { value: C(m.heart, '#fff3dc').multiplyScalar(m.intensity ?? 2.2) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uSoft; uniform vec3 uHeart; uniform float uCover;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { float face = abs(dot(normalize(normal), normalize(vViewPosition)));
          totalEmissiveRadiance = mix(totalEmissiveRadiance, uHeart, pow(face, 12.0)) * pow(face, uSoft);
          diffuseColor.a = uCover * pow(face, uSoft); }`)
      // Light only: no reflections, which would add at full strength over the whole disc.
      .replace('#include <opaque_fragment>', 'outgoingLight = totalEmissiveRadiance;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'procedural-body-glow-v3';
  return mat;
}

export function ribbonMaterial(m = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: C(m.color, '#f3e2c7'), roughness: 0.7, side: THREE.DoubleSide, emissive: C(m.glow, '#ffcf96'), emissiveIntensity: m.glowIntensity ?? 0.12 });
  const U = { uInk: { value: C(m.ink, '#9a5236') }, uRows: { value: m.rows ?? 3 }, uFreq: { value: m.freq ?? 160 }, uAcross: { value: m.across === 'sin' ? 1 : 0 } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aUV; varying vec3 vUV;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvUV = aUV;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vUV; uniform vec3 uInk; uniform float uRows; uniform float uFreq; uniform float uAcross;
      float rh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Across the band: -1..1 from the ring angle; rows of text with gaps between them.
        float across = uAcross > 0.5 ? vUV.z : vUV.y, rowF = (across * 0.5 + 0.5) * uRows, row = floor(rowF), inRow = fract(rowF);
        float lineMask = smoothstep(0.18, 0.3, inRow) * smoothstep(0.82, 0.7, inRow) * step(0.5, row) * step(row, uRows - 1.5 + 1.0);
        float sx = vUV.x * uFreq + row * 7.3, letter = floor(sx), wordId = floor(sx / 7.0);
        float word = step(0.22, rh(vec2(wordId, row))) * step(0.12, fract(sx / 7.0)) * step(fract(sx / 7.0), 0.92);
        float glyph = step(0.15, fract(sx)) * step(fract(sx), 0.8) * step(0.18, rh(vec2(letter, row + 3.0)));
        float aa = clamp(1.0 / (fwidth(sx) * 2.5), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uInk, word * mix(0.55, glyph, aa) * lineMask * 0.85);`);
  };
  mat.customProgramCacheKey = () => 'procedural-body-ribbon-v1';
  return mat;
}

// A small studio environment for reflections (glass, wet skin, clearcoat), with no image file: a
// sky-to-floor gradient dome and a few soft light panels, prefiltered once. scene.environment = it.
export function studioEnv(renderer, { sky = '#f4efe8', floor = '#6b5a4a', panel = 6 } = {}) {
  const s = new THREE.Scene(), top = new THREE.Color(sky), bot = new THREE.Color(floor);
  const dome = new THREE.SphereGeometry(10, 32, 16), col = [];
  for (let i = 0; i < dome.attributes.position.count; i++) { const y = dome.attributes.position.getY(i) / 10, c = bot.clone().lerp(top, THREE.MathUtils.smoothstep(y, -0.3, 0.4)); col.push(c.r, c.g, c.b); }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  s.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const [x, y, z, w, h] of [[4, 5, 3, 4, 2], [-5, 3, -2, 2, 3], [0, 6, -5, 5, 1.5]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1).multiplyScalar(panel), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer), env = pm.fromScene(s, 0.04).texture;
  pm.dispose(); return env;
}
