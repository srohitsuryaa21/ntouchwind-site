/* The pinned "turbine comes alive" scene.
   Modelled on the real site: 250 kW machines on four legged lattice towers, about 30 m hub height, 29 m rotor.
   site.ts drives `state` from the scroll position; this file only draws it. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export interface SceneState {
  cx: number; cy: number; cz: number; // camera position
  lx: number; ly: number; lz: number; // camera target
  spin: number; // 0..1 rotor speed
  time: number; // time of day: 0 night, 0.5 sunrise or sunset, 1 full day
  arc: number; // 0..1 how far through the story; the sun (day mode) or the moon (night mode) travels with it
  dayMode: boolean;
  flow: number; // 0..1 power flowing to the client
  others: number; // 0..1 the other two turbines light up
}

const HUB_Y = 30;
const ROTOR_R = 14.5;

/* Terrain height: a gentle ridge running across the scene, with low hills. Turbines sit on it. */
function ground(x: number, z: number) {
  const ridge = 7 * Math.exp(-(((z + 40) / 70) ** 2));
  const hills = 2.4 * Math.sin(x * 0.028 + 1.3) * Math.cos(z * 0.022) + 1.2 * Math.sin(x * 0.07 + z * 0.05);
  return ridge + hills - 4;
}

/* one unit cylinder, stretched and pointed between two points for every lattice member */
function member(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.Matrix4) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m.compose(mid, q, new THREE.Vector3(r, len, r));
}

export function latticeTower(material: THREE.Material) {
  const legs: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const levels = [0, 5.2, 9.8, 13.9, 17.5, 20.7, 23.5, 25.9, 27.9, 29.2];
  const half = (y: number) => 3.3 - (3.3 - 0.8) * Math.pow(y / 29.2, 0.85);
  const pts = levels.map((y) => legs.map(([sx, sz]) => new THREE.Vector3(sx * half(y), y, sz * half(y))));
  const mats: THREE.Matrix4[] = [];
  for (let l = 0; l < levels.length - 1; l++) {
    for (let k = 0; k < 4; k++) {
      const a = pts[l][k], b = pts[l + 1][k], c = pts[l][(k + 1) % 4], d = pts[l + 1][(k + 1) % 4];
      mats.push(member(a, b, 0.16 - l * 0.009, new THREE.Matrix4())); // leg
      mats.push(member(a, d, 0.055, new THREE.Matrix4())); // X brace
      mats.push(member(c, b, 0.055, new THREE.Matrix4()));
      mats.push(member(b, d, 0.06, new THREE.Matrix4())); // horizontal ring
    }
  }
  const geo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  // every turbine gets its own instanced mesh over the same geometry and member layout
  return () => {
    const mesh = new THREE.InstancedMesh(geo, material, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    return mesh;
  };
}

/* Transmission pylon: tapering four legged lattice with two cross arms. Local z runs along the line. */
const PYLON_H = 24;
const PYLON_ARMS: [number, number][] = [[-6, 16.4], [6, 16.4], [-4.4, 20.4], [4.4, 20.4]];
function pylonBuilder(material: THREE.Material) {
  const legs: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const levels = [0, 4.5, 8.5, 12, 15, 16.4, 18.4, 20.4, 22.4, PYLON_H];
  const half = (y: number) => (y < 15 ? 3 - (2.1 * y) / 15 : 0.9 - (0.35 * (y - 15)) / (PYLON_H - 15));
  const pts = levels.map((y) => legs.map(([sx, sz]) => new THREE.Vector3(sx * half(y), y, sz * half(y))));
  const mats: THREE.Matrix4[] = [];
  for (let l = 0; l < levels.length - 1; l++) {
    for (let k = 0; k < 4; k++) {
      const a = pts[l][k], b = pts[l + 1][k], c = pts[l][(k + 1) % 4], d = pts[l + 1][(k + 1) % 4];
      mats.push(member(a, b, 0.13, new THREE.Matrix4()));
      mats.push(member(a, d, 0.05, new THREE.Matrix4()));
      mats.push(member(c, b, 0.05, new THREE.Matrix4()));
      mats.push(member(b, d, 0.05, new THREE.Matrix4()));
    }
  }
  // cross arms: a lower and an upper pair of triangular brackets
  for (const y of [16.4, 20.4]) {
    const span = y < 18 ? 6 : 4.4, h = half(y);
    for (const sx of [-1, 1]) {
      const tip = new THREE.Vector3(sx * span, y, 0);
      for (const sz of [-1, 1]) {
        mats.push(member(new THREE.Vector3(sx * h, y, sz * h), tip, 0.07, new THREE.Matrix4()));
        mats.push(member(new THREE.Vector3(sx * h, y - 1.6, sz * h), tip, 0.05, new THREE.Matrix4()));
      }
    }
  }
  const geo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
  return () => {
    const mesh = new THREE.InstancedMesh(geo, material, mats.length);
    mats.forEach((m, i) => mesh.setMatrixAt(i, m));
    return mesh;
  };
}

/* A sagging conductor through a list of attachment points, sampled as a polyline with lookup by length */
function catenary(points: THREE.Vector3[], sagFactor = 0.04) {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const sag = a.distanceTo(b) * sagFactor;
    for (let k = 0; k < 18; k++) {
      const t = k / 18;
      out.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)));
    }
  }
  out.push(points[points.length - 1].clone());
  const acc = [0];
  for (let i = 1; i < out.length; i++) acc.push(acc[i - 1] + out[i].distanceTo(out[i - 1]));
  const total = acc[acc.length - 1];
  return {
    points: out,
    at(u: number, target: THREE.Vector3) {
      const d = u * total;
      let lo = 0, hi = acc.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (acc[m] < d) lo = m; else hi = m; }
      const f = (d - acc[lo]) / (acc[hi] - acc[lo] || 1);
      return target.copy(out[lo]).lerp(out[hi], f);
    },
  };
}

/* Blade: a lofted, twisted, tapering slab along +Y with a red tip band (vertex colours). */
export function bladeGeometry() {
  const segs = 22;
  const L = ROTOR_R - 0.9;
  const chord = (t: number) => (t < 0.12 ? 0.55 + t * 4.4 : 1.08 - (t - 0.12) * 0.86);
  const thick = (t: number) => (t < 0.12 ? 0.4 : 0.22 - t * 0.16);
  const twist = (t: number) => (1 - t) * 0.32;
  const ring = [[-0.5, 0], [-0.2, 0.5], [0.5, 0.06], [0.5, -0.06], [-0.2, -0.32]]; // rough airfoil, x along chord
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const white = new THREE.Color('#e9eef2');
  const red = new THREE.Color('#d8452f');
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    const y = 0.9 + t * L;
    const c = chord(t), th = thick(t), tw = twist(t);
    const color = t > 0.9 ? red : white;
    for (const [px, pz] of ring) {
      const x = px * c, z = pz * th;
      pos.push(x * Math.cos(tw) - z * Math.sin(tw), y, x * Math.sin(tw) + z * Math.cos(tw));
      col.push(color.r, color.g, color.b);
    }
  }
  const n = ring.length;
  for (let s = 0; s < segs; s++) {
    for (let k = 0; k < n; k++) {
      const a = s * n + k, b = s * n + ((k + 1) % n), c = a + n, d = b + n;
      idx.push(a, c, b, b, c, d);
    }
  }
  // cap the tip
  const tip = segs * n;
  for (let k = 1; k < n - 1; k++) idx.push(tip, tip + k, tip + k + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function glowTextureEarly() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.16, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.2, 'rgba(255,255,255,0.25)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Turbine { group: THREE.Group; rotor: THREE.Group; beacon: THREE.Sprite; phase: number }

export function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTurbineScene(canvas: HTMLCanvasElement, opts: { mobile: boolean }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, opts.mobile ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const nightFog = new THREE.Color('#0a1626');
  const dawnFog = new THREE.Color('#5a4a4e');
  const dayFog = new THREE.Color('#bcd2e3');
  scene.fog = new THREE.FogExp2(nightFog.clone(), 0.0062);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 2000);

  /* Sky dome: one gradient across the day. Night, a warm horizon at sunrise or sunset, then a clear blue day. */
  const skyU = { time: { value: 0 }, sunDir: { value: new THREE.Vector3(0.25, 0.02, -1).normalize() } };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float time; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 nightTop = vec3(0.012, 0.03, 0.065), nightHor = vec3(0.07, 0.16, 0.26);
          vec3 dawnTop = vec3(0.06, 0.13, 0.26), dawnHor = vec3(0.98, 0.56, 0.32);
          vec3 dayTop = vec3(0.16, 0.42, 0.78), dayHor = vec3(0.72, 0.86, 0.96);
          float a = clamp(time * 2.0, 0.0, 1.0), b = clamp(time * 2.0 - 1.0, 0.0, 1.0);
          vec3 top = mix(mix(nightTop, dawnTop, a), dayTop, b), hor = mix(mix(nightHor, dawnHor, a), dayHor, b);
          float dawn = 1.0 - abs(time - 0.5) * 2.0;
          vec3 col = mix(hor, top, pow(smoothstep(-0.02, 0.55, h), 0.7));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          col += max(dawn, 0.0) * (vec3(1.0, 0.78, 0.42) * pow(s, 380.0) * 3.0 + vec3(1.0, 0.62, 0.35) * pow(s, 9.0) * 0.45);
          col += b * vec3(1.0, 0.95, 0.85) * pow(s, 14.0) * 0.3;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  /* Stars */
  const starCount = opts.mobile ? 700 : 1600;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const u = Math.random() * Math.PI * 2, v = 0.06 + Math.random() * 0.94;
    const r = 800;
    starPos.set([Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r], i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: '#cfe6ff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85, fog: false, depthWrite: false });
  scene.add(new THREE.Points(starGeo, starMat));

  /* A low moon behind the site: gives the turbines a silhouette at night, fades out at dawn */
  const moonTex = glowTextureEarly();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, color: '#dfeeff', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  moon.position.set(-120, 210, -600);
  moon.scale.setScalar(90);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, color: '#3d7fb8', transparent: true, opacity: 0.55, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  halo.position.copy(moon.position);
  halo.scale.setScalar(420);
  scene.add(halo, moon);

  /* Day mode: a sun in the same corner of the sky, which sinks to the horizon as the story goes on */
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, color: '#fff7e6', transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sunDisc.scale.setScalar(110);
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, color: '#ffd59a', transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sunHalo.scale.setScalar(760);
  scene.add(sunHalo, sunDisc);

  /* Lights */
  const hemi = new THREE.HemisphereLight('#4b78a8', '#05090f', 0.9);
  const key = new THREE.DirectionalLight('#9fd3ff', 1.6);
  key.position.set(-40, 60, 50);
  const rim = new THREE.DirectionalLight('#22b2ea', 1.2);
  rim.position.set(30, 20, -80);
  const sun = new THREE.DirectionalLight('#ffb36b', 0);
  sun.position.set(220, 30, -900);
  scene.add(hemi, key, rim, sun);

  /* Terrain: solid dark land plus a faint sky blue survey grid on top */
  const size = 900, segs = opts.mobile ? 90 : 140;
  const terrainGeo = new THREE.PlaneGeometry(size, size, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);
  const tp = terrainGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) tp.setY(i, ground(tp.getX(i), tp.getZ(i)));
  terrainGeo.computeVertexNormals();
  const landMat = new THREE.MeshStandardMaterial({ color: '#0b1724', roughness: 1, metalness: 0, flatShading: true });
  const land = new THREE.Mesh(terrainGeo, landMat);
  const gridMat = new THREE.MeshBasicMaterial({ color: '#22b2ea', wireframe: true, transparent: true, opacity: 0.07, depthWrite: false });
  const grid = new THREE.Mesh(terrainGeo, gridMat);
  grid.position.y = 0.05;
  scene.add(land, grid);

  /* Turbines */
  const steel = new THREE.MeshStandardMaterial({ color: '#7f8b96', roughness: 0.55, metalness: 0.6 });
  const shell = new THREE.MeshStandardMaterial({ color: '#e6ebef', roughness: 0.4, metalness: 0.1 });
  const bladeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05 });
  const makeTower = latticeTower(steel);
  const nacelleGeo = new RoundedBoxGeometry(1.7, 1.9, 4.4, 3, 0.45);
  // spinner: a short nose cone pointing into the wind
  const cone: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; cone.push(new THREE.Vector2(0.78 * Math.sqrt(1 - t * t), t * 1.45)); }
  const hubGeo = new THREE.LatheGeometry(cone, 28);
  hubGeo.rotateX(Math.PI / 2);
  const blade = bladeGeometry();
  const glow = glowTexture();

  const turbines: Turbine[] = [];
  const makeTurbine = (x: number, z: number, yaw: number) => {
    const group = new THREE.Group();
    group.position.set(x, ground(x, z) - 0.3, z);
    group.rotation.y = yaw;
    group.add(makeTower());
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 0.25, 12), steel);
    platform.position.y = 29.3;
    const nacelle = new THREE.Mesh(nacelleGeo, shell);
    nacelle.position.set(0, HUB_Y, -0.4);
    const rotor = new THREE.Group();
    rotor.position.set(0, HUB_Y, 2.35);
    const hub = new THREE.Mesh(hubGeo, shell);
    hub.position.z = -0.1;
    rotor.add(hub);
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(blade, bladeMat);
      b.rotation.z = (i * Math.PI * 2) / 3;
      rotor.add(b);
    }
    const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: '#ff3b2f', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    beacon.position.set(0, HUB_Y + 1.25, -1.6);
    beacon.scale.setScalar(2.4);
    group.add(platform, nacelle, rotor, beacon);
    scene.add(group);
    const t = { group, rotor, beacon, phase: Math.random() * 6 };
    turbines.push(t);
    return t;
  };
  makeTurbine(0, 0, 0);
  makeTurbine(-46, -58, 0.12);
  makeTurbine(40, -92, -0.1);
  turbines.forEach((t, i) => (t.rotor.rotation.z = i * 0.7));

  /* The client: a factory with a sawtooth roof, off to the right. Its windows glow amber as the power arrives. */
  const AMBER = '#ffb340';
  const factory = new THREE.Group();
  const fx = 178, fz = -72;
  factory.position.set(fx, ground(fx, fz) - 0.6, fz);
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#4a5563', roughness: 0.75, metalness: 0.15 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#7d8a99', roughness: 0.5, metalness: 0.4 });
  const winMat = new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.12 });
  const hallW = 34, hallD = 22, hallH = 8;
  const hall = new THREE.Mesh(new THREE.BoxGeometry(hallW, hallH, hallD), bodyMat);
  hall.position.y = hallH / 2;
  factory.add(hall);
  const tooth = new THREE.Shape();
  const teeth = 5, tw = hallD / teeth;
  tooth.moveTo(0, 0);
  for (let i = 0; i < teeth; i++) { tooth.lineTo(i * tw + tw * 0.75, 4); tooth.lineTo(i * tw + tw * 0.78, 0.01); tooth.lineTo((i + 1) * tw, 0); }
  const roofGeo = new THREE.ExtrudeGeometry(tooth, { depth: hallW, bevelEnabled: false });
  roofGeo.rotateY(Math.PI / 2);
  roofGeo.translate(-hallW / 2, hallH, hallD / 2);
  factory.add(new THREE.Mesh(roofGeo, roofMat));
  const office = new THREE.Mesh(new THREE.BoxGeometry(12, 13, 10), bodyMat);
  office.position.set(hallW / 2 + 6, 6.5, 4);
  factory.add(office);
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 16, 20), roofMat);
  silo.position.set(-hallW / 2 - 4, 8, -5);
  factory.add(silo);
  const band = (w: number, x: number, y: number, z: number, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), winMat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    factory.add(m);
  };
  band(hallW * 0.86, 0, hallH * 0.6, hallD / 2 + 0.05);
  band(hallD * 0.8, -hallW / 2 - 0.05, hallH * 0.6, 0, -Math.PI / 2);
  for (const y of [4, 7.5, 11]) band(9, hallW / 2 + 6, y, 9.05);
  factory.rotation.y = -0.5;
  const factoryGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: AMBER, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  factoryGlow.position.set(0, 12, 0);
  factoryGlow.scale.set(90, 44, 1);
  factory.add(factoryGlow);
  scene.add(factory);

  /* The grid: collector lines on wooden poles from each turbine to a substation, then a transmission line on
     lattice pylons from the substation to the factory. Pulses of power run along every conductor. */
  const wireMat = new THREE.LineBasicMaterial({ color: '#a9bccd', transparent: true, opacity: 0.6 });
  const wireCol = new THREE.Color('#a9bccd');
  const wireHot = new THREE.Color(AMBER);
  const conductors: ReturnType<typeof catenary>[] = [];
  const addWire = (pts: THREE.Vector3[], sag?: number) => {
    const c = catenary(pts, sag);
    conductors.push(c);
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.points), wireMat));
  };
  const place = (obj: THREE.Object3D, x: number, z: number, yaw: number) => {
    obj.position.set(x, ground(x, z) - 0.2, z);
    obj.rotation.y = yaw;
    scene.add(obj);
    obj.updateMatrixWorld();
    return obj;
  };
  const local = (obj: THREE.Object3D, x: number, y: number) => new THREE.Vector3(x, y, 0).applyMatrix4(obj.matrixWorld);

  // substation yard with transformers, a gantry and a fence
  const sx = 82, sz = -34;
  const yard = new THREE.Group();
  const pad = new THREE.Mesh(new THREE.BoxGeometry(18, 0.5, 13), new THREE.MeshStandardMaterial({ color: '#2a333d', roughness: 1 }));
  pad.position.y = 0.25;
  yard.add(pad);
  for (const [x, z] of [[-4, -2], [3, -2], [-4, 3.5], [3, 3.5]]) {
    const tr = new THREE.Mesh(new THREE.BoxGeometry(3.2, 3.4, 2.4), roofMat);
    tr.position.set(x, 2.2, z);
    yard.add(tr);
  }
  const gantry = (width: number, height: number) => {
    const g = new THREE.Group();
    for (const x of [-width / 2, width / 2]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, height, 6), steel);
      p.position.set(x, height / 2, 0);
      g.add(p);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.45, 0.45), steel);
    beam.position.y = height - 0.4;
    g.add(beam);
    return g;
  };
  yard.add(gantry(14, 12));
  const fence = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(20, 2.2, 15)), new THREE.LineBasicMaterial({ color: '#5c7186', transparent: true, opacity: 0.6 }));
  fence.position.y = 1.1;
  yard.add(fence);
  const endX = fx - 22, endZ = fz + 8;
  const yaw = Math.atan2(endX - sx, endZ - sz);
  place(yard, sx, sz, yaw);

  // transmission line: pylons evenly spaced between the substation and the factory gantry
  const makePylon = pylonBuilder(new THREE.MeshStandardMaterial({ color: '#b8c6d4', roughness: 0.45, metalness: 0.55, emissive: '#1b2b3b' }));
  const pylons: THREE.Object3D[] = [];
  const n = 3;
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    pylons.push(place(makePylon(), sx + (endX - sx) * t, sz + (endZ - sz) * t, yaw));
  }
  const factoryEnd = place(gantry(12, 14), endX, endZ, yaw);
  PYLON_ARMS.forEach(([ax, ay], i) => {
    const gx = i < 2 ? ax : ax * 0.7;
    addWire([local(yard, gx, 11.6), ...pylons.map((p) => local(p, ax, ay)), local(factoryEnd, gx * 0.9, 13.6)], 0.035);
  });

  // collector lines: two conductors on wooden poles from each turbine to the substation
  const poleMat = new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.9 });
  const poleGeo = new THREE.CylinderGeometry(0.16, 0.22, 9, 6);
  const armGeo = new THREE.BoxGeometry(3.4, 0.22, 0.22);
  turbines.forEach((tb) => {
    const a = tb.group.position, dx = sx - a.x, dz = sz - a.z;
    const steps = Math.max(2, Math.round(Math.hypot(dx, dz) / 24));
    const cyaw = Math.atan2(dx, dz);
    const poles: THREE.Object3D[] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.35) / steps;
      if (t > 0.9) break;
      const pole = new THREE.Group();
      const shaft = new THREE.Mesh(poleGeo, poleMat);
      shaft.position.y = 4.5;
      const arm = new THREE.Mesh(armGeo, poleMat);
      arm.position.y = 8.4;
      pole.add(shaft, arm);
      poles.push(place(pole, a.x + dx * t, a.z + dz * t, cyaw));
    }
    for (const side of [-1.4, 1.4]) {
      const startPt = new THREE.Vector3(a.x + side, a.y + 3, a.z + 3.2);
      addWire([startPt, ...poles.map((p) => local(p, side, 8.5)), local(yard, side * 2.5, 11.6)], 0.03);
    }
  });

  const perWire = opts.mobile ? 10 : 16;
  const pulseGeo = new THREE.BufferGeometry();
  const pulsePos = new Float32Array(conductors.length * perWire * 3);
  pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
  const pulseMat = new THREE.PointsMaterial({ map: glow, color: '#ffd27a', size: 3.4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(pulseGeo, pulseMat));
  const tmp = new THREE.Vector3();

  /* State, driven from outside */
  const state: SceneState = { cx: 4, cy: 30.6, cz: 15, lx: 0, ly: 30, lz: 0, spin: 0.15, time: 0, arc: 0, dayMode: false, flow: 0, others: 0 };
  const nightLand = new THREE.Color('#0b1724'), dayLand = new THREE.Color('#71885c');
  const nightGrid = new THREE.Color('#22b2ea'), dayGrid = new THREE.Color('#1d4a66');
  const nightSkyLight = new THREE.Color('#4b78a8'), daySkyLight = new THREE.Color('#d4e8ff');
  const nightGround = new THREE.Color('#05090f'), dayGround = new THREE.Color('#56603f');
  const sunLow = new THREE.Vector3(0.25, 0.02, -1).normalize();
  const moonStart = moon.position.clone().normalize(), moonEnd = new THREE.Vector3(-0.42, 0.07, -0.9).normalize();
  const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
  const sunWhite = new THREE.Color('#fff7e6'), sunOrange = new THREE.Color('#ff9a4a');
  let velocity = 0;
  const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
  let angle = 0;
  let clock = 0;
  let w = 0, h = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (r.width === w && r.height === h) return;
    w = r.width; h = r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // narrow screens: widen the lens so the rotor still fits
    camera.fov = w / h < 0.8 ? 62 : 42;
    camera.updateProjectionMatrix();
  }

  const fogCol = new THREE.Color();
  function render(dt: number) {
    resize();
    clock += dt;
    const s = state;
    // rotor: scroll sets the base speed, scrolling faster gives the wind a gust
    const gust = Math.min(1.6, Math.abs(velocity) / 40);
    const omega = (0.25 + s.spin * 1.6) * (1 + gust);
    angle += omega * dt;
    turbines.forEach((t, i) => {
      t.rotor.rotation.z = -(angle * (i === 0 ? 1 : 0.92 + i * 0.05)) - i * 0.7;
      const blink = Math.sin(clock * 2.2 + t.phase) > 0.35 ? 1 : 0.15;
      const vis = i === 0 ? 1 : s.others;
      (t.beacon.material as THREE.SpriteMaterial).opacity = blink * vis * Math.max(0, 1 - s.time * 1.3);
    });

    // power flow along the conductors
    wireMat.color.copy(wireCol).lerp(wireHot, s.flow * 0.85);
    wireMat.opacity = 0.6 + s.flow * 0.4;
    (factoryGlow.material as THREE.SpriteMaterial).opacity = s.flow * 0.85;
    pulseMat.opacity = s.flow;
    winMat.opacity = 0.1 + s.flow * 0.9;
    if (s.flow > 0.01) {
      conductors.forEach((c, ci) => {
        for (let k = 0; k < perWire; k++) {
          c.at((k / perWire + clock * 0.06 + ci * 0.071) % 1, tmp);
          pulsePos.set([tmp.x, tmp.y, tmp.z], (ci * perWire + k) * 3);
        }
      });
      (pulseGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // time of day
    const t = s.time;
    const dawn = Math.max(0, 1 - Math.abs(t - 0.5) * 2); // strongest at sunrise or sunset
    const day = Math.max(0, t * 2 - 1);
    const night = Math.max(0, 1 - t * 2);
    skyU.time.value = t;
    if (s.dayMode) {
      // the sun starts high beside the turbine and reaches the horizon just as the sky turns to sunset (arc 0.817)
      const k = s.arc / 0.817;
      sunDir.set(-0.12 + 0.37 * Math.min(k, 1.15), 0.34 * (1 - k), -0.95).normalize();
      const up = Math.max(0, Math.min(1, (sunDir.y + 0.015) * 14));
      sunDisc.position.copy(sunDir).multiplyScalar(650);
      sunHalo.position.copy(sunDisc.position);
      (sunDisc.material as THREE.SpriteMaterial).color.copy(sunWhite).lerp(sunOrange, 1 - Math.min(1, sunDir.y / 0.2));
      (sunDisc.material as THREE.SpriteMaterial).opacity = up;
      (sunHalo.material as THREE.SpriteMaterial).opacity = up * 0.4;
      skyU.sunDir.value.copy(sunDir);
      moon.position.copy(moonStart).multiplyScalar(647);
    } else {
      // night mode: the moon sinks as you scroll, the sun comes up on the right at the end
      moonDir.copy(moonStart).lerp(moonEnd, Math.min(1, s.arc / 0.76)).normalize();
      moon.position.copy(moonDir).multiplyScalar(647);
      (sunDisc.material as THREE.SpriteMaterial).opacity = 0;
      (sunHalo.material as THREE.SpriteMaterial).opacity = 0;
      skyU.sunDir.value.copy(sunLow);
    }
    halo.position.copy(moon.position);
    sun.position.copy(skyU.sunDir.value).multiplyScalar(900);
    starMat.opacity = 0.85 * Math.max(0, 1 - t * 2.4);
    (moon.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - t * 2.6);
    (halo.material as THREE.SpriteMaterial).opacity = 0.55 * Math.max(0, 1 - t * 2.6);
    fogCol.copy(nightFog).lerp(dawnFog, Math.min(1, t * 2)).lerp(dayFog, day);
    (scene.fog as THREE.FogExp2).color.copy(fogCol);
    // thin the haze in daylight and for the wide aerial view so the line to the client stays readable
    (scene.fog as THREE.FogExp2).density = 0.0062 * (1 - 0.5 * s.flow) * (1 - 0.45 * day);
    sun.color.set(day > 0.5 ? '#fff1dc' : '#ffb36b');
    sun.intensity = dawn * 2.4 + day * 2.2;
    key.intensity = 1.6 * night + 0.9 * dawn + 0.8 * day + s.flow * 0.5 * (1 - day);
    hemi.color.copy(nightSkyLight).lerp(daySkyLight, day);
    hemi.groundColor.copy(nightGround).lerp(dayGround, day);
    hemi.intensity = 0.9 + dawn * 0.4 + day * 0.9;
    landMat.color.copy(nightLand).lerp(dayLand, day);
    gridMat.color.copy(nightGrid).lerp(dayGrid, day);
    gridMat.opacity = 0.07 * (1 - dawn * 0.5) + s.flow * 0.04;

    // pointer parallax: the camera drifts a little toward the cursor, scaled to how far away it is
    ptr.x += (ptr.tx - ptr.x) * Math.min(1, dt * 3);
    ptr.y += (ptr.ty - ptr.y) * Math.min(1, dt * 3);
    const reach = Math.hypot(s.cx - s.lx, s.cy - s.ly, s.cz - s.lz) * 0.035;
    camera.position.set(s.cx + ptr.x * reach, s.cy - ptr.y * reach * 0.5, s.cz);
    camera.lookAt(s.lx, s.ly, s.lz);
    renderer.render(scene, camera);
  }

  return {
    state,
    setVelocity(v: number) { velocity = v; },
    setPointer(x: number, y: number) { ptr.tx = x; ptr.ty = y; },
    render,
    resize,
    dispose() { renderer.dispose(); },
  };
}

export type TurbineScene = ReturnType<typeof createTurbineScene>;
