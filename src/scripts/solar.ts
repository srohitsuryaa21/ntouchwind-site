/* The pinned solar expansion scene: an empty plot, tracker rows rising and turning to the sun,
   the planned wind turbines appearing on the ridge, then power flowing out.
   site.ts drives `state` from the scroll position; this file only draws it. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { latticeTower, bladeGeometry, glowTexture, glowTextureEarly } from './turbine';

export interface SolarState {
  cx: number; cy: number; cz: number;
  lx: number; ly: number; lz: number;
  build: number; // 0..1 rows rising out of the ground
  tilt: number; // 0..1 trackers turning to face the sun
  wind: number; // 0..1 planned turbines appearing on the ridge
  flow: number; // 0..1 power running to the grid
  time: number; // time of day, as in the turbine scene: 0.5 sunrise, 1 day
  sunElev: number; // sun height above the horizon (direction y)
  dayMode: boolean;
}

const HUB_Y = 30;
// the plot sits flat; the land rolls gently around it and rises to a ridge behind, where the turbines stand
function ground(x: number, z: number) {
  const ridge = 9 * Math.exp(-(((z + 118) / 40) ** 2));
  const away = Math.max(0, Math.abs(x) - 30, Math.abs(z + 17) - 28);
  const roll = (1.4 * Math.sin(x * 0.03 + 0.4) * Math.cos(z * 0.025) + 0.6 * Math.sin(x * 0.08 + z * 0.06)) * Math.min(1, away / 25);
  return ridge + roll - 2;
}

/* panel face: dark cells with fine silver lines */
function cellTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 128, 512);
  grd.addColorStop(0, '#163d6b');
  grd.addColorStop(1, '#0a2242');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 512);
  g.strokeStyle = 'rgba(190, 210, 230, 0.55)';
  g.lineWidth = 2;
  for (let x = 0; x <= 128; x += 128 / 4) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
  for (let y = 0; y <= 512; y += 512 / 20) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function polyline(points: THREE.Vector3[]) {
  const acc = [0];
  for (let i = 1; i < points.length; i++) acc.push(acc[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = acc[acc.length - 1];
  return {
    points,
    at(u: number, target: THREE.Vector3) {
      const d = u * total;
      let i = 1;
      while (i < acc.length - 1 && acc[i] < d) i++;
      const f = (d - acc[i - 1]) / (acc[i] - acc[i - 1] || 1);
      return target.copy(points[i - 1]).lerp(points[i], f);
    },
  };
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function createSolarScene(canvas: HTMLCanvasElement, opts: { mobile: boolean }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, opts.mobile ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 2000);
  const dawnFog = new THREE.Color('#6b5a5e'), dayFog = new THREE.Color('#bcd2e3');
  scene.fog = new THREE.FogExp2(dawnFog.clone(), 0.005);

  /* Sky: the same palette as the turbine scene, from sunrise to a clear day */
  const skyU = { time: { value: 0.5 }, sunDir: { value: new THREE.Vector3(1, 0.05, -0.8).normalize() } };
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float time; uniform vec3 sunDir; varying vec3 vDir;
        void main(){
          float h = clamp(vDir.y, -0.2, 1.0);
          vec3 nightTop = vec3(0.012, 0.03, 0.065), nightHor = vec3(0.07, 0.16, 0.26);
          vec3 dawnTop = vec3(0.07, 0.15, 0.3), dawnHor = vec3(0.98, 0.58, 0.34);
          vec3 dayTop = vec3(0.16, 0.42, 0.78), dayHor = vec3(0.72, 0.86, 0.96);
          float a = clamp(time * 2.0, 0.0, 1.0), b = clamp(time * 2.0 - 1.0, 0.0, 1.0);
          vec3 top = mix(mix(nightTop, dawnTop, a), dayTop, b), hor = mix(mix(nightHor, dawnHor, a), dayHor, b);
          vec3 col = mix(hor, top, pow(smoothstep(-0.02, 0.55, h), 0.7));
          float s = max(dot(normalize(vDir), sunDir), 0.0);
          float dawn = 1.0 - abs(time - 0.5) * 2.0;
          col += max(dawn, 0.0) * vec3(1.0, 0.62, 0.35) * pow(s, 8.0) * 0.5;
          col += b * vec3(1.0, 0.95, 0.85) * pow(s, 14.0) * 0.3;
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  ));
  const discTex = glowTextureEarly();
  const glow = glowTexture();
  const sunDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex, color: '#fff3d6', transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sunDisc.scale.setScalar(120);
  const sunHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTex, color: '#ffc985', transparent: true, opacity: 0.45, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  sunHalo.scale.setScalar(700);
  scene.add(sunHalo, sunDisc);

  /* Lights */
  const hemi = new THREE.HemisphereLight('#9fc4ea', '#3a3a2c', 0.8);
  const sun = new THREE.DirectionalLight('#ffd1a0', 2.4);
  scene.add(hemi, sun);

  /* Land, a gravel pad for the plot and a dashed boundary that says "planned" */
  const size = 900, segs = opts.mobile ? 90 : 140;
  const terrainGeo = new THREE.PlaneGeometry(size, size, segs, segs);
  terrainGeo.rotateX(-Math.PI / 2);
  const tp = terrainGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) tp.setY(i, ground(tp.getX(i), tp.getZ(i)));
  terrainGeo.computeVertexNormals();
  const dawnLand = new THREE.Color('#3b4a33'), dayLand = new THREE.Color('#71885c');
  const landMat = new THREE.MeshStandardMaterial({ color: dayLand.clone(), roughness: 1, flatShading: true, envMapIntensity: 0.2 });
  scene.add(new THREE.Mesh(terrainGeo, landMat));
  const pad = new THREE.Mesh(new THREE.PlaneGeometry(56, 52), new THREE.MeshStandardMaterial({ color: '#8c7b62', roughness: 1, envMapIntensity: 0.2 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(0, ground(0, -17) + 0.04, -17);
  scene.add(pad);
  const bx = 27, bz0 = 8, bz1 = -42, by = ground(0, -17) + 0.15;
  const boundary = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-bx, by, bz0), new THREE.Vector3(bx, by, bz0), new THREE.Vector3(bx, by, bz1), new THREE.Vector3(-bx, by, bz1), new THREE.Vector3(-bx, by, bz0)]),
    new THREE.LineDashedMaterial({ color: '#ffb340', dashSize: 2, gapSize: 1.4, transparent: true }),
  );
  boundary.computeLineDistances();
  scene.add(boundary);

  /* Tracker rows: rows run north to south, each a line of tables on posts that turn east toward the sun */
  const ROWS = opts.mobile ? 7 : 8, TABLES = 3;
  const pv = new THREE.MeshPhysicalMaterial({ map: cellTexture(), metalness: 0.25, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.2 });
  const frame = new THREE.MeshStandardMaterial({ color: '#c3ccd5', metalness: 0.75, roughness: 0.35 });
  const tableGeo = new THREE.BoxGeometry(2.6, 0.12, 10.4);
  const tables = new THREE.InstancedMesh(tableGeo, [frame, frame, pv, frame, frame, frame], ROWS * TABLES);
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.18, 1, 0.18), frame, ROWS * TABLES * 2);
  const torque = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 6), frame, ROWS);
  scene.add(tables, posts, torque);
  const slots: { x: number; z: number; row: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let t = 0; t < TABLES; t++) slots.push({ x: (r - (ROWS - 1) / 2) * 5.6, z: -5 - t * 11.4, row: r });
  const baseY = ground(0, -17);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();
  let lastBuild = -1, lastTilt = -1;
  const layoutRows = (build: number, tiltAngle: number) => {
    slots.forEach((s, i) => {
      // each row rises a moment after the one before it
      const k = ease(clamp01(build * (ROWS + 1.5) - s.row));
      const h = 1.6 * k;
      const hidden = k < 0.005 ? 0.0001 : 1;
      e3.set(0, 0, -tiltAngle * k);
      q.setFromEuler(e3);
      m4.compose(v3.set(s.x, baseY + h + 0.15 - (1 - k) * 0.8, s.z), q, sc.set(hidden, hidden, hidden));
      tables.setMatrixAt(i, m4);
      for (const [j, dz] of [[0, 3.6], [1, -3.6]] as const) {
        m4.compose(v3.set(s.x, baseY + h / 2, s.z + dz), q.identity(), sc.set(1, Math.max(0.0001, h), hidden));
        posts.setMatrixAt(i * 2 + j, m4);
      }
    });
    for (let r = 0; r < ROWS; r++) {
      const k = ease(clamp01(build * (ROWS + 1.5) - r));
      const len = TABLES * 11.4;
      m4.compose(v3.set((r - (ROWS - 1) / 2) * 5.6, baseY + 1.6 * k + 0.05, -5 - (TABLES - 1) * 5.7), q.setFromEuler(e3.set(Math.PI / 2, 0, 0)), sc.set(k < 0.005 ? 0.0001 : 1, len, k < 0.005 ? 0.0001 : 1));
      torque.setMatrixAt(r, m4);
    }
    tables.instanceMatrix.needsUpdate = posts.instanceMatrix.needsUpdate = torque.instanceMatrix.needsUpdate = true;
  };

  /* Inverter station beside the plot, cable trenches from every row, and an export line toward the ridge */
  const box = new THREE.MeshStandardMaterial({ color: '#d9dee3', roughness: 0.5, metalness: 0.2 });
  const inverter = new THREE.Mesh(new RoundedBoxGeometry(4, 2.6, 2.6, 2, 0.2), box);
  inverter.position.set(33, baseY + 1.3, -17);
  const tx = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2), new THREE.MeshStandardMaterial({ color: '#7d8a99', roughness: 0.5, metalness: 0.4 }));
  tx.position.set(33, baseY + 1, -21.5);
  scene.add(inverter, tx);
  const AMBER = '#ffb340';
  const cableMat = new THREE.LineBasicMaterial({ color: AMBER, transparent: true, opacity: 0 });
  const routes: ReturnType<typeof polyline>[] = [];
  const y0 = baseY + 0.25;
  for (let r = 0; r < ROWS; r++) {
    const x = (r - (ROWS - 1) / 2) * 5.6;
    routes.push(polyline([new THREE.Vector3(x, y0, 4), new THREE.Vector3(x, y0, 6), new THREE.Vector3(30, y0, 6), new THREE.Vector3(30, y0, -17), new THREE.Vector3(33, y0 + 1, -17)]));
  }
  const exportLine = polyline([new THREE.Vector3(33, y0, -21.5), new THREE.Vector3(48, ground(48, -50) + 0.3, -50), new THREE.Vector3(50, ground(50, -90) + 0.3, -90), new THREE.Vector3(30, ground(30, -112) + 0.3, -112)]);
  routes.push(exportLine);
  routes.forEach((rt) => scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(rt.points), cableMat)));
  const per = opts.mobile ? 6 : 9;
  const pulsePos = new Float32Array(routes.length * per * 3);
  const pulseGeo = new THREE.BufferGeometry();
  pulseGeo.setAttribute('position', new THREE.BufferAttribute(pulsePos, 3));
  const pulseMat = new THREE.PointsMaterial({ map: glow, color: '#ffd27a', size: 2.2, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  scene.add(new THREE.Points(pulseGeo, pulseMat));

  /* Turbines on the ridge: our three, plus the three planned ones drawn as holograms that rise into place */
  const steel = new THREE.MeshStandardMaterial({ color: '#8b97a2', roughness: 0.5, metalness: 0.6 });
  const shell = new THREE.MeshStandardMaterial({ color: '#eef2f5', roughness: 0.4, metalness: 0.1 });
  const bladeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.05 });
  const holo = new THREE.MeshBasicMaterial({ color: '#22b2ea', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const nacelleGeo = new RoundedBoxGeometry(1.7, 1.9, 4.4, 3, 0.45);
  const cone: THREE.Vector2[] = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; cone.push(new THREE.Vector2(0.78 * Math.sqrt(1 - t * t), t * 1.45)); }
  const hubGeo = new THREE.LatheGeometry(cone, 24);
  hubGeo.rotateX(Math.PI / 2);
  const blade = bladeGeometry();
  const towerSolid = latticeTower(steel), towerHolo = latticeTower(holo);
  const rotors: THREE.Group[] = [];
  const makeTurbine = (x: number, z: number, planned: boolean) => {
    const g = new THREE.Group();
    g.position.set(x, ground(x, z) - 0.3, z);
    g.add(planned ? towerHolo() : towerSolid());
    const nacelle = new THREE.Mesh(nacelleGeo, planned ? holo : shell);
    nacelle.position.set(0, HUB_Y, -0.4);
    const rotor = new THREE.Group();
    rotor.position.set(0, HUB_Y, 2.35);
    rotor.add(new THREE.Mesh(hubGeo, planned ? holo : shell));
    for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(blade, planned ? holo : bladeMat); b.rotation.z = (i * Math.PI * 2) / 3; rotor.add(b); }
    rotor.rotation.z = Math.random() * 6;
    g.add(nacelle, rotor);
    scene.add(g);
    rotors.push(rotor);
    return g;
  };
  [-42, 0, 42].forEach((x) => makeTurbine(x, -118, false));
  const planned = [-86, 84, 124].map((x, i) => makeTurbine(x, -112 - i * 4, true));
  const ringMat = new THREE.MeshBasicMaterial({ color: '#22b2ea', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const rings = planned.map((g) => {
    const ring = new THREE.Mesh(new THREE.RingGeometry(5, 6, 40), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(g.position).setY(g.position.y + 0.5);
    scene.add(ring);
    return ring;
  });

  const state: SolarState = { cx: -38, cy: 10, cz: 40, lx: 4, ly: 0, lz: -20, build: 0, tilt: 0, wind: 0, flow: 0, time: 0.5, sunElev: 0.03, dayMode: false };
  const sunDir = new THREE.Vector3(), fogCol = new THREE.Color(), tmp = new THREE.Vector3();
  let w = 0, h = 0, clock = 0, angle = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    if (r.width === w && r.height === h) return;
    w = r.width; h = r.height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 66 : 50;
    camera.updateProjectionMatrix();
  }

  function render(dt: number) {
    resize();
    clock += dt;
    const s = state;
    const t = s.time, day = clamp01(t * 2 - 1), dawn = clamp01(1 - Math.abs(t - 0.5) * 2);

    // sun to the east, low at sunrise in night mode, high in day mode
    sunDir.set(1, s.sunElev, -0.8).normalize();
    skyU.sunDir.value.copy(sunDir);
    skyU.time.value = t;
    sunDisc.position.copy(sunDir).multiplyScalar(650);
    sunHalo.position.copy(sunDisc.position);
    sun.position.copy(sunDir).multiplyScalar(300);
    sun.color.set(day > 0.5 ? '#fff4e2' : '#ffc890');
    sun.intensity = 1.6 + dawn * 0.8 + day * 1.0;
    hemi.intensity = 0.55 + day * 0.9 + dawn * 0.2;
    scene.environmentIntensity = 0.35 + day * 0.4;
    fogCol.copy(dawnFog).lerp(dayFog, day);
    (scene.fog as THREE.FogExp2).color.copy(fogCol);
    (scene.fog as THREE.FogExp2).density = 0.0045 - day * 0.0015;
    landMat.color.copy(dawnLand).lerp(dayLand, Math.max(day, 0.35 + dawn * 0.1));

    // trackers face the sun: the lower the sun, the steeper they turn
    const elevAngle = Math.atan2(sunDir.y, Math.hypot(sunDir.x, sunDir.z));
    const tiltAngle = Math.min(0.95, Math.PI / 2 - elevAngle) * 0.85 * ease(s.tilt);
    if (Math.abs(s.build - lastBuild) > 1e-4 || Math.abs(tiltAngle - lastTilt) > 1e-4) {
      layoutRows(s.build, tiltAngle);
      lastBuild = s.build; lastTilt = tiltAngle;
    }
    (boundary.material as THREE.LineDashedMaterial).opacity = 0.9 * (1 - s.build * 0.7);

    // planned turbines rise one after another
    planned.forEach((g, i) => {
      const k = ease(clamp01(s.wind * 3.2 - i * 0.9));
      g.scale.set(1, Math.max(0.0001, k), 1);
      g.visible = k > 0.002;
    });
    ringMat.opacity = 0.7 * clamp01(s.wind * 2) * (0.6 + 0.4 * Math.sin(clock * 3));
    rings.forEach((r) => (r.visible = s.wind > 0.01));
    holo.opacity = 0.32 + 0.1 * Math.sin(clock * 4);

    // rotors keep turning
    angle += dt * 1.2;
    rotors.forEach((r, i) => (r.rotation.z = -angle * (0.9 + i * 0.04) - i));

    // power flow
    cableMat.opacity = s.flow * 0.8;
    pulseMat.opacity = s.flow;
    if (s.flow > 0.01) {
      routes.forEach((rt, ri) => {
        for (let k = 0; k < per; k++) {
          rt.at((k / per + clock * 0.12 + ri * 0.09) % 1, tmp);
          pulsePos.set([tmp.x, tmp.y + 0.2, tmp.z], (ri * per + k) * 3);
        }
      });
      (pulseGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    camera.position.set(s.cx, s.cy, s.cz);
    camera.lookAt(s.lx, s.ly, s.lz);
    renderer.render(scene, camera);
  }

  return { state, render, resize, dispose() { renderer.dispose(); pmrem.dispose(); } };
}

export type SolarScene = ReturnType<typeof createSolarScene>;
