import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_VISUAL_PROFILE_BY_ARCHETYPE } from '../../data/catalog';
import { getStepProgress } from '../../lib/planLogic';
import type { ProductData, Visual3DProfile } from '../../types/commerce';
import {
  createBrassBolt,
  createContactShadowTexture,
  createDashedGuideLine,
  createDimensionCallout,
  createDimensionSprite,
  createFabricWeaveTexture,
  createRenderScheduler,
  createStudioEnvironment,
  createStudioRenderer,
  createWoodGrainTexture,
  detectSoftwareGl,
  disposeSceneResources,
  easeOutCubic,
  type RenderScheduler,
} from './threeUtils';

export interface DimensionMaterialExplorerProps {
  product: ProductData;
  visualProfile?: Visual3DProfile;
  selectedVariantId: string;
  showDimensions: boolean;
  showScaleReference: boolean;
  rotateZoomEnabled: boolean;
  cameraPreset: 'hero' | 'front' | 'side';
  assemblyMode: boolean;
  assemblyProgress: number;
  onCanvasReady?: (canvas: HTMLCanvasElement | null) => void;
}

const CAMERA_PRESETS: Record<
  'hero' | 'front' | 'side',
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  hero: { pos: [1.82, 1.32, 3.24], target: [-0.16, 0.72, 0] },
  front: { pos: [-0.2, 0.96, 3.35], target: [-0.2, 0.78, 0] },
  side: { pos: [2.75, 0.96, 0.08], target: [-0.1, 0.78, 0] },
};

const _targetCamPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();

function buildArchitecturalHumanFigure(): THREE.Group {
  const group = new THREE.Group();
  const figureMat = new THREE.MeshPhysicalMaterial({
    color: 0x6b7280,
    roughness: 0.55,
    metalness: 0.05,
    transparent: true,
    opacity: 0.36,
    clearcoat: 0.15,
  });

  const profile = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.068, 0.0),
    new THREE.Vector2(0.055, 0.18),
    new THREE.Vector2(0.072, 0.45),
    new THREE.Vector2(0.095, 0.78),
    new THREE.Vector2(0.145, 0.95),
    new THREE.Vector2(0.125, 1.12),
    new THREE.Vector2(0.175, 1.38),
    new THREE.Vector2(0.14, 1.46),
    new THREE.Vector2(0.048, 1.49),
    new THREE.Vector2(0.045, 1.56),
    new THREE.Vector2(0.088, 1.62),
    new THREE.Vector2(0.092, 1.69),
    new THREE.Vector2(0.056, 1.74),
    new THREE.Vector2(0.0, 1.75),
  ];
  const bodyGeo = new THREE.LatheGeometry(profile, 32);
  const bodyMesh = new THREE.Mesh(bodyGeo, figureMat);
  bodyMesh.scale.set(1, 1, 0.66);

  const label = createDimensionSprite('175 cm Ref');
  label.position.set(0.26, 1.46, 0);
  label.scale.set(0.26, 0.064, 1);

  group.add(bodyMesh, label);
  return group;
}

export function DimensionMaterialExplorer({
  product,
  visualProfile,
  selectedVariantId,
  showDimensions,
  showScaleReference,
  rotateZoomEnabled,
  cameraPreset,
  assemblyMode,
  assemblyProgress,
  onCanvasReady,
}: DimensionMaterialExplorerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const profile =
    visualProfile ??
    DEFAULT_VISUAL_PROFILE_BY_ARCHETYPE[product.modelAsset.geometryArchetype] ??
    DEFAULT_VISUAL_PROFILE_BY_ARCHETYPE.dining_chair;

  const stateRef = useRef({
    selectedVariantId,
    showDimensions,
    showScaleReference,
    rotateZoomEnabled,
    cameraPreset,
    assemblyMode,
    assemblyProgress,
    profile,
  });

  stateRef.current = {
    selectedVariantId,
    showDimensions,
    showScaleReference,
    rotateZoomEnabled,
    cameraPreset,
    assemblyMode,
    assemblyProgress,
    profile,
  };

  const schedulerRef = useRef<RenderScheduler | null>(null);
  const cameraTransitionRef = useRef(false);
  const applyVariantRef = useRef<((variantId: string) => void) | null>(null);
  const updateDimensionsRef = useRef<((visible: boolean) => void) | null>(null);
  const updateScaleRef = useRef<((visible: boolean) => void) | null>(null);
  const updateControlsEnabledRef = useRef<((enabled: boolean) => void) | null>(null);

  const profileSignature = `${profile.chair_back_style}:${profile.chair_leg_style}:${profile.has_armrests}:${profile.has_cushion}:${profile.finish_glossiness}`;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    const renderer = createStudioRenderer(container, isSoftwareGl);
    onCanvasReady?.(renderer.domElement);
    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const onContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf4f3ef);
    scene.fog = new THREE.Fog(0xf4f3ef, 4.6, 11.2);
    const envTexture = createStudioEnvironment(renderer, scene);

    const camera = new THREE.PerspectiveCamera(
      36,
      (container.clientWidth || 800) / (container.clientHeight || 600),
      0.05,
      40,
    );
    const initialPreset = CAMERA_PRESETS[stateRef.current.cameraPreset];
    camera.position.set(...initialPreset.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...initialPreset.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.9;
    controls.maxDistance = 4.6;
    controls.maxPolarAngle = Math.PI / 2 - 0.03;
    controls.enabled = stateRef.current.rotateZoomEnabled;

    const hemiLight = new THREE.HemisphereLight(0xf3f5f8, 0xd4cec2, 0.72);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.12);
    keyLight.position.set(2.5, 3.9, 2.2);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 10;
    keyLight.shadow.camera.left = -1.6;
    keyLight.shadow.camera.right = 1.6;
    keyLight.shadow.camera.top = 2.0;
    keyLight.shadow.camera.bottom = -1.6;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xd9eaf2, 0.72);
    rimLight.position.set(-2.2, 2.1, -2.0);
    scene.add(rimLight);

    // Studio floor & grid
    const floorMesh = new THREE.Mesh(
      new THREE.CircleGeometry(2.8, 64),
      new THREE.MeshStandardMaterial({ color: 0xeae8e2, roughness: 0.92, metalness: 0.0 }),
    );
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const gridHelper = new THREE.GridHelper(3.4, 18, 0xcac8c0, 0xdedcd5);
    gridHelper.position.y = 0.003;
    scene.add(gridHelper);

    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.52, 36),
      new THREE.MeshBasicMaterial({
        map: createContactShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.68,
      }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(0, 0.015, 0);
    scene.add(contactShadow);

    const activeProfile = stateRef.current.profile;
    const isLounge = activeProfile.chair_back_style === 'upholstered_shell';
    const isStool = activeProfile.chair_back_style === 'backless_stool';

    const initialVariant =
      product.variants.find((v) => v.id === stateRef.current.selectedVariantId) ?? product.variants[0];
    const startColor =
      initialVariant?.label === 'Standard Finish'
        ? activeProfile.primary_color_hex
        : initialVariant?.colorHex ?? activeProfile.primary_color_hex;

    const initialFabric = createFabricWeaveTexture(startColor || '#B4AB9E', maxAniso);
    const upholsteryMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: initialFabric.map,
      bumpMap: initialFabric.bumpMap,
      bumpScale: 0.0042,
      roughness: Math.max(0.86, initialVariant?.roughness ?? 0.92),
      metalness: 0.0,
      sheen: 0.20,
      sheenRoughness: 0.92,
      sheenColor: new THREE.Color(startColor || '#B4AB9E').lerp(new THREE.Color('#ffffff'), 0.22),
      side: THREE.DoubleSide,
    });

    const stitchColor = new THREE.Color(activeProfile.accent_color_hex || startColor || '#B4AB9E').multiplyScalar(0.76);
    const weltMat = new THREE.MeshStandardMaterial({
      color: stitchColor,
      roughness: 0.88,
      metalness: 0.0,
    });

    const woodTone = initialVariant?.secondaryHex ?? activeProfile.secondary_color_hex ?? '#C7A67B';
    const initialWood = createWoodGrainTexture(woodTone, '#5b422d', maxAniso);
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: initialWood,
      roughness: activeProfile.chair_leg_style === 'cylindrical_metal' ? 0.32 : 0.56,
      metalness: activeProfile.chair_leg_style === 'cylindrical_metal' ? 0.68 : 0.04,
    });

    const metalLegMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(activeProfile.secondary_color_hex || '#2c3034'),
      roughness: 0.34,
      metalness: 0.72,
    });

    const brassMat = new THREE.MeshPhysicalMaterial({
      color: 0xc5a059,
      roughness: 0.24,
      metalness: 0.92,
      anisotropy: 0.6,
    });

    const feltMat = new THREE.MeshStandardMaterial({
      color: 0x222426,
      roughness: 0.95,
    });

    const defaultW = isLounge ? 76 : isStool ? 40 : 54;
    const defaultD = isLounge ? 74 : isStool ? 40 : 52;
    const defaultH = isLounge ? 74 : isStool ? 46 : 78;
    const defaultSeatH = isLounge ? 41 : isStool ? 46 : 45;

    const w = (product.dimensions.widthCm ?? defaultW) / 100;
    const d = (product.dimensions.depthCm ?? defaultD) / 100;
    const h = (product.dimensions.heightCm ?? defaultH) / 100;
    const seatH = (product.dimensions.seatHeightCm ?? defaultSeatH) / 100;

    const chairGroup = new THREE.Group();

    // Base Sub-frame (core assembly anchor for 4-leg chairs; hidden for monolithic barrel chairs)
    const frameGroup = new THREE.Group();
    const apronY = seatH - 0.056;
    if (!isLounge && !isStool) {
      const frontRail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.78, 0.036, 0.024), frameMat);
      frontRail.position.set(0, apronY, d * 0.34);
      frontRail.castShadow = true;

      const rearRail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.74, 0.036, 0.024), frameMat);
      rearRail.position.set(0, apronY, -d * 0.39);
      rearRail.castShadow = true;

      const leftRail = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.036, d * 0.74), frameMat);
      leftRail.position.set(-w * 0.38, apronY, -d * 0.025);
      leftRail.castShadow = true;

      const rightRail = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.036, d * 0.74), frameMat);
      rightRail.position.set(w * 0.38, apronY, -d * 0.025);
      rightRail.castShadow = true;

      frameGroup.add(frontRail, rearRail, leftRail, rightRail);

      const cornerPositions: Array<[number, number]> = [
        [-w * 0.34, d * 0.3],
        [w * 0.34, d * 0.3],
        [-w * 0.33, -d * 0.35],
        [w * 0.33, -d * 0.35],
      ];
      cornerPositions.forEach(([cx, cz]) => {
        const block = new THREE.Mesh(new THREE.BoxGeometry(0.044, 0.032, 0.044), frameMat);
        block.position.set(cx, apronY, cz);
        frameGroup.add(block);
      });
    }
    chairGroup.add(frameGroup);

    // Step 1 Group: Legs OR Recessed Thin Black Base Ring (for lounge barrel chairs like Floyd Gere Easy Chair)
    const legsGroup = new THREE.Group();
    const legOffsets: Array<{ x: number; z: number; rx: number; rz: number }> = [
      { x: -w * 0.39, z: d * 0.34, rx: 0.05, rz: -0.045 },
      { x: w * 0.39, z: d * 0.34, rx: 0.05, rz: 0.045 },
      { x: -w * 0.38, z: -d * 0.38, rx: -0.06, rz: -0.04 },
      { x: w * 0.38, z: -d * 0.38, rx: -0.06, rz: 0.04 },
    ];

    const hasRingPlinth =
      isLounge ||
      activeProfile.base_profile === 'ring_frame' ||
      /ring|plinth|tub|drum|barrel/i.test(activeProfile.visual_details_summary);

    const shellOuterR = w * 0.485;
    const wallThick = 0.078;
    const shellInnerR = shellOuterR - wallThick;

    const legH = Math.max(0.14, apronY + 0.026);
    const activeLegMat =
      activeProfile.chair_leg_style === 'cylindrical_metal' ||
      activeProfile.chair_leg_style === 'sled_frame'
        ? metalLegMat
        : frameMat;

    if (hasRingPlinth) {
      // Sleek, low-profile recessed glossy black steel ring base + 4 tiny glides matching ref-gere.png
      const plinthMat = new THREE.MeshPhysicalMaterial({
        color: 0x16181a,
        roughness: 0.28,
        metalness: 0.72,
        clearcoat: 0.45,
      });
      const ringRadius = shellOuterR - 0.042;
      const plinthRing = new THREE.Mesh(
        new THREE.CylinderGeometry(ringRadius, ringRadius + 0.008, 0.024, 52),
        plinthMat,
      );
      plinthRing.position.set(0, 0.020, 0);
      plinthRing.castShadow = true;
      plinthRing.receiveShadow = true;

      const bevelLip = new THREE.Mesh(
        new THREE.TorusGeometry(ringRadius + 0.004, 0.006, 14, 52),
        plinthMat,
      );
      bevelLip.rotation.x = Math.PI / 2;
      bevelLip.position.y = 0.011;

      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2 + Math.PI / 4;
        const glide = new THREE.Mesh(
          new THREE.CylinderGeometry(0.011, 0.011, 0.008, 16),
          metalLegMat,
        );
        glide.position.set(
          Math.cos(ang) * (ringRadius - 0.012),
          0.004,
          Math.sin(ang) * (ringRadius - 0.012),
        );
        legsGroup.add(glide);
      }

      legsGroup.add(plinthRing, bevelLip);
    } else {
      legOffsets.forEach((leg) => {
        const legPivot = new THREE.Group();
        legPivot.position.set(leg.x, 0, leg.z);
        if (activeProfile.chair_leg_style !== 'block_plinth') {
          legPivot.rotation.set(leg.rx, 0, leg.rz);
        }

        if (activeProfile.chair_leg_style === 'block_plinth') {
          const blockLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.03, legH, 24), activeLegMat);
          blockLeg.position.y = legH / 2;
          blockLeg.castShadow = true;
          const glide = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.029, 0.005, 20), feltMat);
          glide.position.y = 0.0025;
          legPivot.add(blockLeg, glide);
        } else if (activeProfile.chair_leg_style === 'cylindrical_metal') {
          const tubeLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.014, legH, 20), activeLegMat);
          tubeLeg.position.y = legH / 2;
          tubeLeg.castShadow = true;
          const brassTip = new THREE.Mesh(new THREE.CylinderGeometry(0.0145, 0.0135, 0.028, 18), brassMat);
          brassTip.position.y = 0.014;
          legPivot.add(tubeLeg, brassTip);
        } else {
          const shoulder = new THREE.Mesh(
            new THREE.CylinderGeometry(0.022, 0.0195, 0.042, 20),
            activeLegMat,
          );
          shoulder.position.y = legH - 0.021;
          const legMesh = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0195, 0.013, Math.max(0.08, legH - 0.04), 22),
            activeLegMat,
          );
          legMesh.position.y = Math.max(0.04, (legH - 0.04) / 2);
          legMesh.castShadow = true;

          const ferrule = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.0128, 0.042, 20), brassMat);
          ferrule.position.y = 0.023;
          const glide = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.004, 16), feltMat);
          glide.position.y = 0.002;

          legPivot.add(shoulder, legMesh, ferrule, glide);
        }

        legsGroup.add(legPivot);
      });
    }
    chairGroup.add(legsGroup);

    // Step 2 Group:
    // - For Lounge Barrel Chair: Continuous Sloped 360° Cylindrical Upholstered Drum Shell!
    // - For Standard Dining Chair: Twin Side Stretchers + 4 Brass Mounting Bolts
    const stretchersGroup = new THREE.Group();
    const stretcherY = Math.max(0.11, apronY * 0.42);
    const leftStretcher = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, d * 0.72, 16),
      activeLegMat,
    );
    leftStretcher.rotation.x = Math.PI / 2;
    leftStretcher.position.set(-w * 0.39, stretcherY, -d * 0.02);
    leftStretcher.castShadow = true;
    leftStretcher.visible = !hasRingPlinth && !isStool;

    const rightStretcher = new THREE.Mesh(
      new THREE.CylinderGeometry(0.011, 0.011, d * 0.72, 16),
      activeLegMat,
    );
    rightStretcher.rotation.x = Math.PI / 2;
    rightStretcher.position.set(w * 0.39, stretcherY, -d * 0.02);
    rightStretcher.castShadow = true;
    rightStretcher.visible = !hasRingPlinth && !isStool;

    const boltsSubGroup = new THREE.Group();
    if (!hasRingPlinth && !isStool) {
      const boltCoords: Array<[number, number]> = [
        [-w * 0.34, d * 0.3],
        [w * 0.34, d * 0.3],
        [-w * 0.33, -d * 0.35],
        [w * 0.33, -d * 0.35],
      ];
      boltCoords.forEach(([cx, cz]) => {
        const bolt = createBrassBolt(brassMat, 0.036);
        bolt.position.set(cx, apronY - 0.014, cz);
        boltsSubGroup.add(bolt);
      });
    }

    const barrelShellGroup = new THREE.Group();
    const yDeck = seatH - 0.072;
    const yBottomDrum = 0.030;

    if (isLounge) {
      // Single unified smooth sculptural 360° upholstered barrel drum matching Floyd Gere Easy Chair (ref-gere.png)
      const segs = 72;
      const yFront = seatH + 0.012;
      const yBack = h - 0.004;
      const rimHeight = (theta: number) => {
        const backFactor = (1 - Math.cos(theta)) * 0.5;
        return yFront + (yBack - yFront) * Math.pow(backFactor, 0.76);
      };

      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      const rMid = (shellOuterR + shellInnerR) * 0.5;
      const rHalf = wallThick * 0.5;

      // 13 cross-sectional profile points from underside tuck -> soft outer swell -> curved rolled crest -> inner wall -> deck
      const ringCount = 13;
      for (let i = 0; i <= segs; i++) {
        const u = i / segs;
        const theta = u * Math.PI * 2;
        const sx = Math.sin(theta);
        const cz = Math.cos(theta);
        const yRim = rimHeight(theta);
        const yCrestBase = yRim - rHalf;
        const wallSpan = Math.max(0.12, yCrestBase - (yBottomDrum + 0.032));

        const profilePts: Array<[number, number, number]> = [
          // 0: underside inner edge
          [shellInnerR - 0.015, yBottomDrum, 0.0],
          // 1: underside tuck start
          [shellOuterR - 0.028, yBottomDrum, 0.08],
          // 2: lower soft rounded skirt curve
          [shellOuterR - 0.007, yBottomDrum + 0.014, 0.14],
          // 3: lower-outer wall
          [shellOuterR + 0.002, yBottomDrum + 0.042, 0.25],
          // 4: mid-outer wall gentle plump fullness
          [shellOuterR + 0.004, yBottomDrum + 0.042 + wallSpan * 0.52, 0.65],
          // 5: upper-outer crest base
          [shellOuterR, yCrestBase, 1.05],
          // 6: outer-top 45° rolled crest shoulder
          [rMid + rHalf * 0.707, yCrestBase + rHalf * 0.707, 1.15],
          // 7: top apex of rolled lip
          [rMid, yRim, 1.24],
          // 8: inner-top 45° rolled crest shoulder
          [rMid - rHalf * 0.707, yCrestBase + rHalf * 0.707, 1.33],
          // 9: inner-top crest base
          [shellInnerR, yCrestBase, 1.43],
          // 10: mid inner wall
          [shellInnerR - 0.002, (yCrestBase + yDeck) * 0.5, 1.75],
          // 11: inner seat deck junction
          [shellInnerR, yDeck, 2.05],
          // 12: inner deck inset
          [shellInnerR - 0.025, yDeck, 2.15],
        ];

        for (let p = 0; p < ringCount; p++) {
          const [rad, py, vCoord] = profilePts[p];
          positions.push(sx * rad, py, cz * rad);
          uvs.push(u * 4.5, vCoord);
        }
      }

      for (let i = 0; i < segs; i++) {
        const a = i * ringCount;
        const b = (i + 1) * ringCount;
        for (let p = 0; p < ringCount - 1; p++) {
          indices.push(a + p, b + p, b + p + 1, a + p, b + p + 1, a + p + 1);
        }
      }

      const drumGeo = new THREE.BufferGeometry();
      drumGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      drumGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      drumGeo.setIndex(indices);
      drumGeo.computeVertexNormals();

      const drumUpholsteryMat = upholsteryMat.clone();
      drumUpholsteryMat.side = THREE.DoubleSide;
      const drumMesh = new THREE.Mesh(drumGeo, drumUpholsteryMat);
      drumMesh.castShadow = true;
      drumMesh.receiveShadow = true;

      // Solid bottom underside cap + inner well seat deck cap
      const bottomCap = new THREE.Mesh(
        new THREE.CylinderGeometry(shellOuterR - 0.024, shellOuterR - 0.024, 0.008, 48),
        upholsteryMat,
      );
      bottomCap.position.y = yBottomDrum + 0.004;

      const innerDeck = new THREE.Mesh(
        new THREE.CylinderGeometry(shellInnerR + 0.002, shellInnerR + 0.002, 0.018, 48),
        upholsteryMat,
      );
      innerDeck.position.y = yDeck - 0.007;
      innerDeck.receiveShadow = true;

      // Delicate inset stitched seam along top outer crest (ref-gere.png)
      const weltPoints: THREE.Vector3[] = [];
      for (let i = 0; i < segs; i++) {
        const theta = (i / segs) * Math.PI * 2;
        const sx = Math.sin(theta);
        const cz = Math.cos(theta);
        const yRim = rimHeight(theta);
        const yCrestBase = yRim - rHalf;
        weltPoints.push(
          new THREE.Vector3(
            sx * (rMid + rHalf * 0.73),
            yCrestBase + rHalf * 0.73,
            cz * (rMid + rHalf * 0.73),
          ),
        );
      }
      const topStitchCurve = new THREE.CatmullRomCurve3(weltPoints, true);
      const topStitch = new THREE.Mesh(
        new THREE.TubeGeometry(topStitchCurve, 96, 0.0024, 8, true),
        weltMat,
      );

      barrelShellGroup.add(drumMesh, bottomCap, innerDeck, topStitch);
      chairGroup.add(barrelShellGroup);
    }

    stretchersGroup.add(leftStretcher, rightStretcher, boltsSubGroup);
    chairGroup.add(stretchersGroup);

    // Step 3 Group:
    // - For Lounge Barrel Chair: Inset Plump Circular Seat Cushion fitting snugly inside barrel cavity
    // - For Dining Chair: Contoured Upholstered Seat Pad trimmed cleanly in front of rear backrest posts
    const seatGroup = new THREE.Group();
    const sw = w * 0.455;
    const sdFront = d * 0.43;
    const sdBack = d * 0.34;
    const cr = 0.062;
    const seatDepth = 0.034;

    if (isLounge) {
      const padRadius = shellInnerR - 0.004;
      const padProfile = [
        new THREE.Vector2(0.0, yDeck + 0.002),
        new THREE.Vector2(padRadius * 0.94, yDeck + 0.002),
        new THREE.Vector2(padRadius, yDeck + 0.024),
        new THREE.Vector2(padRadius, seatH - 0.008),
        new THREE.Vector2(padRadius * 0.95, seatH + 0.014),
        new THREE.Vector2(padRadius * 0.78, seatH + 0.026),
        new THREE.Vector2(padRadius * 0.42, seatH + 0.032),
        new THREE.Vector2(0.0, seatH + 0.034),
      ];
      const loungeSeatMesh = new THREE.Mesh(
        new THREE.LatheGeometry(padProfile, 56),
        upholsteryMat,
      );
      loungeSeatMesh.castShadow = true;
      loungeSeatMesh.receiveShadow = true;

      // Subtle inset seam defining the cushion edge inside the barrel cavity
      const seatSeam = new THREE.Mesh(
        new THREE.TorusGeometry(padRadius * 0.96, 0.0024, 8, 64),
        weltMat,
      );
      seatSeam.rotation.x = Math.PI / 2;
      seatSeam.position.y = seatH + 0.012;
      seatGroup.add(loungeSeatMesh, seatSeam);
    } else if (isStool) {
      const roundSeat = new THREE.Mesh(
        new THREE.CylinderGeometry(sw * 0.96, sw * 0.92, 0.048, 40),
        upholsteryMat,
      );
      roundSeat.position.set(0, seatH - 0.015, 0);
      roundSeat.castShadow = true;
      roundSeat.receiveShadow = true;
      const weltRing = new THREE.Mesh(
        new THREE.TorusGeometry(sw * 0.95, 0.0055, 10, 48),
        weltMat,
      );
      weltRing.rotation.x = Math.PI / 2;
      weltRing.position.set(0, seatH - 0.01, 0);
      seatGroup.add(roundSeat, weltRing);
    } else {
      const seatShape = new THREE.Shape();
      seatShape.moveTo(-sw + cr, -sdBack);
      seatShape.lineTo(sw - cr, -sdBack);
      seatShape.quadraticCurveTo(sw, -sdBack, sw, -sdBack + cr);
      seatShape.lineTo(sw, sdFront - cr);
      seatShape.quadraticCurveTo(sw, sdFront, sw - cr, sdFront);
      seatShape.lineTo(-sw + cr, sdFront);
      seatShape.quadraticCurveTo(-sw, sdFront, -sw, sdFront - cr);
      seatShape.lineTo(-sw, -sdBack + cr);
      seatShape.quadraticCurveTo(-sw, -sdBack, -sw + cr, -sdBack);

      const seatGeo = new THREE.ExtrudeGeometry(seatShape, {
        depth: seatDepth,
        bevelEnabled: true,
        bevelThickness: 0.014,
        bevelSize: 0.013,
        bevelSegments: 5,
      });
      seatGeo.rotateX(Math.PI / 2);
      const seatMesh = new THREE.Mesh(seatGeo, upholsteryMat);
      seatMesh.position.set(0, seatH, 0.02);
      seatMesh.castShadow = true;
      seatMesh.receiveShadow = true;
      seatGroup.add(seatMesh);

      const weltPoints = seatShape
        .getPoints(36)
        .map((p) => new THREE.Vector3(p.x, seatH - 0.008, p.y + 0.02));
      const weltCurve = new THREE.CatmullRomCurve3(weltPoints, true);
      const weltMesh = new THREE.Mesh(new THREE.TubeGeometry(weltCurve, 64, 0.006, 8, true), weltMat);
      seatGroup.add(weltMesh);
    }
    chairGroup.add(seatGroup);

    // Step 4 Group:
    // - For Lounge Barrel Chair: Plump Half-Moon Lumbar Back Cushion resting on seat deck inside rear wall
    // - For Dining Chair: Backrest posts & sculpted rail anchored cleanly behind seat pad (z = -d*0.415)
    const backrestGroup = new THREE.Group();

    if (isLounge) {
      // Cylindrically curved half-moon lumbar cushion that hugs the curved inner backrest wall smoothly
      const cW = shellInnerR * 0.95;
      const cH = (h - seatH) * 0.72;
      const cushionShape = new THREE.Shape();
      cushionShape.moveTo(-cW, 0);
      cushionShape.lineTo(cW, 0);
      cushionShape.bezierCurveTo(cW * 0.96, cH * 0.76, cW * 0.48, cH, 0, cH);
      cushionShape.bezierCurveTo(-cW * 0.48, cH, -cW * 0.96, cH * 0.76, -cW, 0);
      cushionShape.closePath();

      const cushionGeo = new THREE.ExtrudeGeometry(cushionShape, {
        depth: 0.056,
        bevelEnabled: true,
        bevelThickness: 0.026,
        bevelSize: 0.020,
        bevelSegments: 6,
        curveSegments: 28,
      });
      cushionGeo.translate(0, 0, -0.028);

      // Bend cushion vertices smoothly along the barrel radius (back face hugs shellInnerR - 0.010)
      const posAttr = cushionGeo.attributes.position;
      const arcRadius = shellInnerR - 0.044;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const vy = posAttr.getY(i);
        const vz = posAttr.getZ(i);
        const angle = THREE.MathUtils.clamp(vx / arcRadius, -1.18, 1.18);
        // Slightly fuller pillow belly toward the middle
        const crownPush = Math.cos(angle * 0.9) * 0.014 * Math.sin(Math.min(1, vy / cH) * Math.PI);
        const r = arcRadius - vz + crownPush;
        const curvedX = Math.sin(angle) * r;
        const curvedZ = -Math.cos(angle) * r;
        posAttr.setXYZ(i, curvedX, vy, curvedZ);
      }
      posAttr.needsUpdate = true;
      cushionGeo.computeVertexNormals();

      const lumbarMesh = new THREE.Mesh(cushionGeo, upholsteryMat);
      lumbarMesh.position.set(0, seatH + 0.012, 0.008);
      lumbarMesh.castShadow = true;
      lumbarMesh.receiveShadow = true;
      backrestGroup.add(lumbarMesh);
    } else if (activeProfile.chair_back_style === 'slatted_spindle') {
      const uprightH = h - seatH + 0.045;
      [-w * 0.33, w * 0.33].forEach((ux) => {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0145, 0.0175, uprightH, 20),
          frameMat,
        );
        post.position.set(ux, seatH + uprightH / 2 - 0.035, -d * 0.415);
        post.rotation.x = -0.13;
        post.castShadow = true;
        backrestGroup.add(post);
      });
      for (let s = -2; s <= 2; s++) {
        const spindle = new THREE.Mesh(
          new THREE.CylinderGeometry(0.007, 0.008, uprightH * 0.86, 14),
          frameMat,
        );
        spindle.position.set(s * (w * 0.11), seatH + uprightH * 0.41, -d * 0.435);
        spindle.rotation.x = -0.13;
        spindle.castShadow = true;
        backrestGroup.add(spindle);
      }
      const topRail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.74, 0.052, 0.028), frameMat);
      topRail.position.set(0, h - 0.02, -d * 0.465);
      topRail.rotation.x = -0.13;
      topRail.castShadow = true;
      backrestGroup.add(topRail);
    } else if (!isStool) {
      // Classic Steam-Bent Crescent Arch Dining Chair (posts socket cleanly down into rear rail at apronY)
      const uprightBottomY = apronY - 0.012;
      const uprightH = h - uprightBottomY + 0.005;
      [-w * 0.33, w * 0.33].forEach((ux) => {
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0145, 0.0175, uprightH, 22),
          frameMat,
        );
        post.position.set(ux, uprightBottomY + uprightH * 0.5, -d * 0.385);
        post.rotation.x = -0.12;
        post.castShadow = true;
        backrestGroup.add(post);
      });

      const arcRadius = w * 0.72;
      const arcThickness = 0.022;
      const startAng = Math.PI * 0.24;
      const endAng = Math.PI * 0.76;
      const backArcShape = new THREE.Shape();
      const steps = 28;
      for (let i = 0; i <= steps; i++) {
        const a = THREE.MathUtils.lerp(startAng, endAng, i / steps);
        const x = Math.cos(a) * (arcRadius + arcThickness * 0.5);
        const y = Math.sin(a) * (arcRadius + arcThickness * 0.5);
        if (i === 0) backArcShape.moveTo(x, y);
        else backArcShape.lineTo(x, y);
      }
      for (let i = steps; i >= 0; i--) {
        const a = THREE.MathUtils.lerp(startAng, endAng, i / steps);
        const x = Math.cos(a) * (arcRadius - arcThickness * 0.5);
        const y = Math.sin(a) * (arcRadius - arcThickness * 0.5);
        backArcShape.lineTo(x, y);
      }
      backArcShape.closePath();

      const solidBackGeo = new THREE.ExtrudeGeometry(backArcShape, {
        depth: 0.145,
        bevelEnabled: true,
        bevelThickness: 0.009,
        bevelSize: 0.007,
        bevelSegments: 4,
      });
      solidBackGeo.rotateX(Math.PI / 2);
      const solidBackMesh = new THREE.Mesh(solidBackGeo, frameMat);
      solidBackMesh.position.set(0, h - 0.02, -d * 0.395 - arcRadius * 0.72);
      solidBackMesh.rotation.x = -0.12;
      solidBackMesh.castShadow = true;
      backrestGroup.add(solidBackMesh);
    }
    chairGroup.add(backrestGroup);

    scene.add(chairGroup);

    // Assembly alignment guide lines matched to chair type
    const assemblyGuidesGroup = new THREE.Group();
    if (isLounge) {
      assemblyGuidesGroup.add(
        createDashedGuideLine(new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, h + 0.26, 0)),
        createDashedGuideLine(
          new THREE.Vector3(-shellOuterR * 0.85, 0.03, 0),
          new THREE.Vector3(-shellOuterR * 0.85, seatH + 0.28, 0),
        ),
        createDashedGuideLine(
          new THREE.Vector3(shellOuterR * 0.85, 0.03, 0),
          new THREE.Vector3(shellOuterR * 0.85, seatH + 0.28, 0),
        ),
      );
    } else {
      legOffsets.forEach((leg) => {
        assemblyGuidesGroup.add(
          createDashedGuideLine(
            new THREE.Vector3(leg.x, 0.02, leg.z),
            new THREE.Vector3(leg.x, seatH + 0.06, leg.z),
          ),
        );
      });
      assemblyGuidesGroup.add(
        createDashedGuideLine(new THREE.Vector3(-w * 0.56, 0.28, 0), new THREE.Vector3(-w * 0.34, 0.28, 0)),
        createDashedGuideLine(new THREE.Vector3(w * 0.34, 0.28, 0), new THREE.Vector3(w * 0.56, 0.28, 0)),
        createDashedGuideLine(new THREE.Vector3(-w * 0.33, seatH, -d * 0.415), new THREE.Vector3(-w * 0.33, h + 0.24, -d * 0.415)),
        createDashedGuideLine(new THREE.Vector3(w * 0.33, seatH, -d * 0.415), new THREE.Vector3(w * 0.33, h + 0.24, -d * 0.415)),
      );
    }
    scene.add(assemblyGuidesGroup);

    // Illustrative 175 cm Human Scale Reference
    const humanFigure = buildArchitecturalHumanFigure();
    humanFigure.position.set(-0.82, 0, -0.05);
    humanFigure.visible = stateRef.current.showScaleReference;
    scene.add(humanFigure);

    // Dimension callouts
    const dimensionsGroup = new THREE.Group();
    dimensionsGroup.add(
      createDimensionCallout(
        new THREE.Vector3(-w / 2, 0.03, d / 2 + 0.14),
        new THREE.Vector3(w / 2, 0.03, d / 2 + 0.14),
        `${Math.round(w * 100)} cm W`,
      ),
      createDimensionCallout(
        new THREE.Vector3(w / 2 + 0.14, 0, -d / 2),
        new THREE.Vector3(w / 2 + 0.14, h, -d / 2),
        `${Math.round(h * 100)} cm H`,
      ),
      createDimensionCallout(
        new THREE.Vector3(-w / 2 - 0.12, 0, d * 0.15),
        new THREE.Vector3(-w / 2 - 0.12, seatH, d * 0.15),
        `${Math.round(seatH * 100)} cm Seat`,
      ),
    );
    dimensionsGroup.visible = stateRef.current.showDimensions;
    scene.add(dimensionsGroup);

    const applyVariant = (variantId: string) => {
      const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
      if (!variant) return;

      const colorToUse =
        variant.label === 'Standard Finish'
          ? stateRef.current.profile.primary_color_hex
          : variant.colorHex;

      const nextFabric = createFabricWeaveTexture(colorToUse, maxAniso);
      upholsteryMat.map?.dispose();
      upholsteryMat.bumpMap?.dispose();
      upholsteryMat.map = nextFabric.map;
      upholsteryMat.bumpMap = nextFabric.bumpMap;
      upholsteryMat.roughness = Math.max(0.80, variant.roughness);
      upholsteryMat.roughness = Math.max(0.86, variant.roughness);
      upholsteryMat.metalness = 0.0;
      upholsteryMat.sheenColor.set(colorToUse).lerp(new THREE.Color('#ffffff'), 0.22);
      upholsteryMat.needsUpdate = true;

      barrelShellGroup.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mat = (child as THREE.Mesh).material;
          if (mat instanceof THREE.MeshPhysicalMaterial && mat !== upholsteryMat) {
            mat.map = nextFabric.map;
            mat.bumpMap = nextFabric.bumpMap;
            mat.roughness = Math.max(0.86, variant.roughness);
            mat.metalness = 0.0;
            mat.sheen = 0.20;
            mat.sheenRoughness = 0.92;
            mat.sheenColor.set(colorToUse).lerp(new THREE.Color('#ffffff'), 0.22);
            mat.needsUpdate = true;
          }
        }
      });

      weltMat.color.set(colorToUse).multiplyScalar(0.76);

      const woodBase = variant.secondaryHex ?? stateRef.current.profile.secondary_color_hex ?? '#C7A67B';
      const nextWood = createWoodGrainTexture(woodBase, '#3d2c1e', maxAniso);
      frameMat.map?.dispose();
      frameMat.map = nextWood;
      frameMat.needsUpdate = true;

      schedulerRef.current?.requestRender();
    };
    applyVariantRef.current = applyVariant;

    updateDimensionsRef.current = (visible: boolean) => {
      dimensionsGroup.visible = visible;
      schedulerRef.current?.requestRender();
    };

    updateScaleRef.current = (visible: boolean) => {
      humanFigure.visible = visible;
      schedulerRef.current?.requestRender();
    };

    updateControlsEnabledRef.current = (enabled: boolean) => {
      controls.enabled = enabled;
      schedulerRef.current?.requestRender();
    };

    let currentAssembly = stateRef.current.assemblyMode ? stateRef.current.assemblyProgress : 1;

    const scheduler = createRenderScheduler(renderer, scene, camera, controls, isSoftwareGl, (dt) => {
      let needsMore = false;

      const targetAssembly = stateRef.current.assemblyMode ? stateRef.current.assemblyProgress : 1;
      if (Math.abs(currentAssembly - targetAssembly) > 0.002) {
        currentAssembly = THREE.MathUtils.damp(currentAssembly, targetAssembly, 12, dt);
        needsMore = true;
      } else {
        currentAssembly = targetAssembly;
      }

      const isAssembling = stateRef.current.assemblyMode && currentAssembly < 0.99;
      assemblyGuidesGroup.visible = isAssembling;

      const s1 = easeOutCubic(getStepProgress(currentAssembly, 0, 4));
      const s2 = easeOutCubic(getStepProgress(currentAssembly, 1, 4));
      const s3 = easeOutCubic(getStepProgress(currentAssembly, 2, 4));
      const s4 = easeOutCubic(getStepProgress(currentAssembly, 3, 4));

      if (isLounge) {
        // Non-clipping bottom-to-top barrel assembly:
        // Step 1: Black Base Ring settles onto floor
        // Step 2: Sloped Upholstered Barrel Shell drops onto Base Ring
        // Step 3: Inset Circular Seat Cushion drops inside barrel cavity (8mm clearance)
        // Step 4: Half-Moon Lumbar Pillow lowers forward of rear wall onto seat deck
        chairGroup.position.y = 0;
        legsGroup.position.y = (1 - s1) * 0.09;
        barrelShellGroup.position.y = (1 - s2) * 0.28;
        seatGroup.position.y = (1 - s3) * 0.34;
        backrestGroup.position.y = (1 - s4) * 0.30;
        backrestGroup.position.z = (1 - s4) * 0.06;
      } else {
        const assemblyLift = stateRef.current.assemblyMode ? (1 - s4) * 0.14 : 0;
        chairGroup.position.y = assemblyLift;
        legsGroup.position.y = (1 - s1) * -0.11;
        leftStretcher.position.x = -w * 0.39 - (1 - s2) * 0.16;
        rightStretcher.position.x = w * 0.39 + (1 - s2) * 0.16;
        boltsSubGroup.position.y = (1 - s2) * -0.08;
        seatGroup.position.y = (1 - s3) * 0.22;
        backrestGroup.position.y = (1 - s4) * 0.26;
        backrestGroup.position.z = 0;
      }

      if (cameraTransitionRef.current) {
        const preset = CAMERA_PRESETS[stateRef.current.cameraPreset];
        _targetCamPos.set(...preset.pos);
        _targetLook.set(...preset.target);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, 8, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, 8, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, 8, dt);
        controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetLook.x, 8, dt);
        controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetLook.y, 8, dt);
        controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetLook.z, 8, dt);

        if (
          camera.position.distanceTo(_targetCamPos) < 0.01 &&
          controls.target.distanceTo(_targetLook) < 0.01
        ) {
          camera.position.copy(_targetCamPos);
          controls.target.copy(_targetLook);
          cameraTransitionRef.current = false;
        } else {
          needsMore = true;
        }
      }

      return needsMore;
    });

    schedulerRef.current = scheduler;

    const onControlsStart = () => {
      cameraTransitionRef.current = false;
    };
    const onControlsChange = () => {
      scheduler.requestRender();
    };
    controls.addEventListener('start', onControlsStart);
    controls.addEventListener('change', onControlsChange);

    const resizeObserver = new ResizeObserver(() => {
      const cw = container.clientWidth || 800;
      const ch = container.clientHeight || 600;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
      scheduler.requestRender();
    });
    resizeObserver.observe(container);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }
    scheduler.requestRender();

    return () => {
      onCanvasReady?.(null);
      resizeObserver.disconnect();
      controls.removeEventListener('start', onControlsStart);
      controls.removeEventListener('change', onControlsChange);
      controls.dispose();
      scheduler.dispose();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
      disposeSceneResources(scene);
      envTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [product.id, profileSignature]);

  useEffect(() => {
    schedulerRef.current?.requestRender();
  }, [assemblyMode, assemblyProgress]);

  useEffect(() => {
    applyVariantRef.current?.(selectedVariantId);
  }, [selectedVariantId]);

  useEffect(() => {
    updateDimensionsRef.current?.(showDimensions && !assemblyMode);
  }, [showDimensions, assemblyMode]);

  useEffect(() => {
    updateScaleRef.current?.(showScaleReference && !assemblyMode);
  }, [showScaleReference, assemblyMode]);

  useEffect(() => {
    updateControlsEnabledRef.current?.(rotateZoomEnabled);
  }, [rotateZoomEnabled]);

  useEffect(() => {
    cameraTransitionRef.current = true;
    schedulerRef.current?.requestRender();
  }, [cameraPreset]);

  return (
    <div className="relative w-full h-full">
      <div
        ref={mountRef}
        data-testid="dimension-material-explorer-canvas"
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />
      {contextLost && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#f4f3ef]/95 text-slate-700 text-sm">
          3D WebGL context paused — restoring studio viewport...
        </div>
      )}
    </div>
  );
}
