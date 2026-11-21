import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

export function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function createStudioRenderer(
  container: HTMLElement,
  isSoftwareGl: boolean,
): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: !isSoftwareGl,
    powerPreference: 'high-performance',
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = !isSoftwareGl;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 600);
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createStudioEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
): THREE.Texture {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  pmremGenerator.dispose();
  return envTexture;
}

export function createWoodGrainTexture(
  baseHex: string,
  grainHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  ctx.strokeStyle = grainHex;
  ctx.globalAlpha = 0.24;
  for (let i = 0; i < 72; i++) {
    const y = (i / 72) * 256;
    ctx.lineWidth = 0.7 + (i % 4) * 0.45;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 24) {
      const wave = Math.sin(x * 0.045 + i * 0.65) * 2.2;
      ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createStoneSurfaceTexture(
  baseHex: string,
  fleckHex: string,
  maxAnisotropy: number,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 256, 256);

  // Deterministic honed limestone/travertine strata and subtle mineral flecks
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  ctx.strokeStyle = fleckHex;
  for (let i = 0; i < 42; i++) {
    ctx.globalAlpha = 0.04 + rand() * 0.05;
    ctx.lineWidth = 1 + rand() * 3.5;
    const y = rand() * 256;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 256; x += 32) {
      ctx.lineTo(x, y + (rand() - 0.5) * 4);
    }
    ctx.stroke();
  }

  for (let i = 0; i < 650; i++) {
    ctx.globalAlpha = 0.03 + rand() * 0.05;
    ctx.fillStyle = rand() > 0.45 ? fleckHex : '#ffffff';
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 1.5);
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 2);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function createRoundedSlabGeometry(
  width: number,
  depth: number,
  thickness: number,
  cornerRadius: number,
  bevelSize = 0.005,
): THREE.BufferGeometry {
  const hw = width * 0.5 - bevelSize;
  const hd = depth * 0.5 - bevelSize;
  const r = Math.min(cornerRadius, hw * 0.5, hd * 0.5);
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r);
  shape.lineTo(hw, hd - r);
  shape.quadraticCurveTo(hw, hd, hw - r, hd);
  shape.lineTo(-hw + r, hd);
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r);
  shape.lineTo(-hw, -hd + r);
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd);

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.002, thickness - bevelSize * 2),
    bevelEnabled: true,
    bevelThickness: bevelSize,
    bevelSize,
    bevelSegments: 4,
    curveSegments: 16,
  });
  geo.rotateX(Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}

export function createFabricWeaveTexture(
  baseHex: string,
  maxAnisotropy: number,
): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 256;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cctx = colorCanvas.getContext('2d')!;
  cctx.fillStyle = baseHex;
  cctx.fillRect(0, 0, size, size);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);

  // Fine organic heathered bouclé / wool weave (avoids artificial grid checkerboard)
  let seed = 4242;
  const rand = () => {
    seed = (seed * 48271) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 2) {
      const thread = ((x >> 1) + (y >> 1)) % 2 === 0;
      const noise = (rand() - 0.5) * 0.08;
      const shade = thread ? 0.03 + noise : -0.03 + noise;
      cctx.fillStyle =
        shade >= 0
          ? `rgba(255,255,255,${Math.min(0.11, shade).toFixed(3)})`
          : `rgba(20,18,16,${Math.min(0.11, -shade).toFixed(3)})`;
      cctx.fillRect(x, y, 2, 2);

      const bumpVal = Math.round(128 + (thread ? 22 : -22) + (rand() - 0.5) * 28);
      bctx.fillStyle = `rgb(${bumpVal},${bumpVal},${bumpVal})`;
      bctx.fillRect(x, y, 2, 2);
    }
  }

  // Subtle horizontal & vertical slub yarns
  for (let i = 0; i < 64; i++) {
    const pos = Math.floor(rand() * (size / 2)) * 2;
    const isHoriz = i % 2 === 0;
    cctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
    if (isHoriz) {
      cctx.fillRect(0, pos, size, 1);
    } else {
      cctx.fillRect(pos, 0, 1, size);
    }
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(5, 5);
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(5, 5);
  bumpMap.anisotropy = maxAnisotropy;

  return { map, bumpMap };
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
  grad.addColorStop(0, 'rgba(20, 21, 23, 0.36)');
  grad.addColorStop(0.55, 'rgba(20, 21, 23, 0.14)');
  grad.addColorStop(1, 'rgba(20, 21, 23, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createLightPoolTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 6, 128, 128, 126);
  grad.addColorStop(0, 'rgba(255, 240, 204, 0.96)');
  grad.addColorStop(0.42, 'rgba(255, 224, 168, 0.55)');
  grad.addColorStop(0.78, 'rgba(255, 210, 145, 0.16)');
  grad.addColorStop(1, 'rgba(255, 210, 145, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createKnurledKnob(
  radius: number,
  depth: number,
  brassMat: THREE.Material,
): THREE.Group {
  const knob = new THREE.Group();
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, depth, 24),
    brassMat,
  );
  cap.rotation.x = Math.PI / 2;
  knob.add(cap);

  const chamfer = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.72, radius * 0.96, depth * 0.35, 24),
    brassMat,
  );
  chamfer.rotation.x = Math.PI / 2;
  chamfer.position.z = depth * 0.62;
  knob.add(chamfer);

  // Fluted knurl ribs around perimeter
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.16, radius * 0.16, depth * 0.9),
      brassMat,
    );
    rib.position.set(Math.cos(angle) * radius * 0.96, Math.sin(angle) * radius * 0.96, 0);
    rib.rotation.z = angle;
    knob.add(rib);
  }
  return knob;
}

export function createBrassBolt(brassMat: THREE.Material, length = 0.032): THREE.Group {
  const bolt = new THREE.Group();
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.006, 6), brassMat);
  head.position.y = -length * 0.5;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.0038, 0.0038, length, 10), brassMat);
  bolt.add(head, shaft);
  return bolt;
}

export function createDashedGuideLine(
  start: THREE.Vector3,
  end: THREE.Vector3,
  color = 0x0f6e66,
): THREE.Line {
  const geo = new THREE.BufferGeometry().setFromPoints([start, end]);
  const mat = new THREE.LineDashedMaterial({
    color,
    dashSize: 0.018,
    gapSize: 0.014,
    transparent: true,
    opacity: 0.78,
  });
  const line = new THREE.Line(geo, mat);
  line.computeLineDistances();
  line.renderOrder = 14;
  return line;
}

export function createDimensionSprite(text: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 84;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = 'rgba(15, 110, 102, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(14, 14, 292, 56, 8);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#141517';
  ctx.font = '600 24px "IBM Plex Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 160, 43);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.24, 0.063, 1);
  sprite.renderOrder = 20;
  return sprite;
}

export function createDimensionCallout(
  start: THREE.Vector3,
  end: THREE.Vector3,
  label: string,
  color = 0x0f6e66,
): THREE.Group {
  const group = new THREE.Group();
  const lineMat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });

  const mainGeo = new THREE.BufferGeometry().setFromPoints([start, end]);
  const mainLine = new THREE.Line(mainGeo, lineMat);
  mainLine.renderOrder = 18;
  group.add(mainLine);

  const dir = new THREE.Vector3().subVectors(end, start).normalize();
  const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const tickVec = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(0.022);

  const startTickGeo = new THREE.BufferGeometry().setFromPoints([
    start.clone().sub(tickVec),
    start.clone().add(tickVec),
  ]);
  const endTickGeo = new THREE.BufferGeometry().setFromPoints([
    end.clone().sub(tickVec),
    end.clone().add(tickVec),
  ]);
  const tick1 = new THREE.Line(startTickGeo, lineMat);
  const tick2 = new THREE.Line(endTickGeo, lineMat);
  tick1.renderOrder = 18;
  tick2.renderOrder = 18;
  group.add(tick1, tick2);

  const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
  mid.y += 0.04;
  const sprite = createDimensionSprite(label);
  sprite.position.copy(mid);
  group.add(sprite);

  return group;
}

export interface RenderScheduler {
  requestRender: () => void;
  dispose: () => void;
}

export function createRenderScheduler(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  isSoftwareGl: boolean,
  onStep: (deltaSec: number) => boolean,
): RenderScheduler {
  let frameId = 0;
  let timerId = 0;
  let renderBusy = false;
  let renderDirty = false;
  let disposed = false;
  let lastTime = performance.now();

  const afterDraw = (cb: () => void) => {
    if (disposed) return;
    const gl = renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          timerId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          timerId = window.setTimeout(cb, 80);
        }
      };
      timerId = window.setTimeout(poll, 5);
    } else {
      timerId = window.setTimeout(cb, 80);
    }
  };

  const requestRender = () => {
    if (disposed) return;
    if (renderBusy) {
      renderDirty = true;
      return;
    }
    renderBusy = true;
    frameId = requestAnimationFrame((now) => {
      if (disposed) return;
      renderDirty = false;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const keepAnimating = onStep(dt);
      controls.update();
      renderer.render(scene, camera);

      const done = () => {
        renderBusy = false;
        if (!disposed && (renderDirty || keepAnimating)) {
          requestRender();
        }
      };

      if (isSoftwareGl) {
        afterDraw(done);
      } else {
        done();
      }
    });
  };

  return {
    requestRender,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(timerId);
    },
  };
}

export function disposeSceneResources(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh || obj instanceof THREE.Line) {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => disposeMaterial(m));
      } else if (obj.material) {
        disposeMaterial(obj.material);
      }
    } else if (obj instanceof THREE.Sprite) {
      obj.material.map?.dispose();
      obj.material.dispose();
    }
  });
}

function disposeMaterial(mat: THREE.Material) {
  const m = mat as THREE.MeshStandardMaterial;
  m.map?.dispose();
  m.bumpMap?.dispose();
  m.roughnessMap?.dispose();
  mat.dispose();
}
