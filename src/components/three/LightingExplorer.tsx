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
  createKnurledKnob,
  createLightPoolTexture,
  createRenderScheduler,
  createRoundedSlabGeometry,
  createStoneSurfaceTexture,
  createStudioEnvironment,
  createStudioRenderer,
  createWoodGrainTexture,
  detectSoftwareGl,
  disposeSceneResources,
  easeOutCubic,
  type RenderScheduler,
} from './threeUtils';

export interface LightingExplorerProps {
  product: ProductData;
  visualProfile?: Visual3DProfile;
  armAngleDeg: number;
  lightIntensityPct: number;
  selectedVariantId: string;
  showDimensions: boolean;
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
  hero: { pos: [1.14, 0.74, 1.42], target: [0.04, 0.32, 0] },
  front: { pos: [0.04, 0.5, 1.58], target: [0.04, 0.32, 0] },
  side: { pos: [1.54, 0.5, 0.05], target: [0.04, 0.32, 0] },
};

const PENDANT_CAMERA_PRESETS: Record<
  'hero' | 'front' | 'side',
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  hero: { pos: [1.12, 0.50, 1.52], target: [0, 0.44, 0] },
  front: { pos: [0, 0.45, 1.62], target: [0, 0.44, 0] },
  side: { pos: [1.58, 0.45, 0.04], target: [0, 0.44, 0] },
};

const _targetCamPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();
const _headWorldPos = new THREE.Vector3();
const _beamDir = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _cordStart = new THREE.Vector3();
const _lastCordStart = new THREE.Vector3(999, 999, 999);

export function LightingExplorer({
  product,
  visualProfile,
  armAngleDeg,
  lightIntensityPct,
  selectedVariantId,
  showDimensions,
  rotateZoomEnabled,
  cameraPreset,
  assemblyMode,
  assemblyProgress,
  onCanvasReady,
}: LightingExplorerProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);

  const profile =
    visualProfile ??
    DEFAULT_VISUAL_PROFILE_BY_ARCHETYPE[product.modelAsset.geometryArchetype] ??
    DEFAULT_VISUAL_PROFILE_BY_ARCHETYPE.cantilever_lamp;

  const stateRef = useRef({
    armAngleDeg,
    lightIntensityPct,
    selectedVariantId,
    showDimensions,
    rotateZoomEnabled,
    cameraPreset,
    assemblyMode,
    assemblyProgress,
    archetype: product.modelAsset.geometryArchetype,
    profile,
  });

  stateRef.current = {
    armAngleDeg,
    lightIntensityPct,
    selectedVariantId,
    showDimensions,
    rotateZoomEnabled,
    cameraPreset,
    assemblyMode,
    assemblyProgress,
    archetype: product.modelAsset.geometryArchetype,
    profile,
  };

  const schedulerRef = useRef<RenderScheduler | null>(null);
  const cameraTransitionRef = useRef(false);
  const applyVariantRef = useRef<((variantId: string) => void) | null>(null);
  const updateDimensionsRef = useRef<((visible: boolean) => void) | null>(null);
  const updateControlsEnabledRef = useRef<((enabled: boolean) => void) | null>(null);

  const profileSignature = `${profile.shade_profile}:${profile.base_profile}:${profile.arm_style}:${profile.finish_glossiness}:${profile.observed_materials.join(',')}`;

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
    scene.fog = new THREE.Fog(0xf4f3ef, 3.8, 8.8);
    const envTexture = createStudioEnvironment(renderer, scene);

    const camera = new THREE.PerspectiveCamera(
      37,
      (container.clientWidth || 800) / (container.clientHeight || 600),
      0.05,
      30,
    );
    const activePresets =
      stateRef.current.archetype === 'pendant_lamp' ? PENDANT_CAMERA_PRESETS : CAMERA_PRESETS;
    const initialPreset = activePresets[stateRef.current.cameraPreset];
    camera.position.set(...initialPreset.pos);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(...initialPreset.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.65;
    controls.maxDistance = 3.2;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.enabled = stateRef.current.rotateZoomEnabled;

    // Studio lighting rig
    const hemiLight = new THREE.HemisphereLight(0xf3f5f8, 0xd8d2c7, 0.92);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e6, 1.42);
    keyLight.position.set(2.2, 3.5, 2.1);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 8;
    keyLight.shadow.camera.left = -1.4;
    keyLight.shadow.camera.right = 1.4;
    keyLight.shadow.camera.top = 1.4;
    keyLight.shadow.camera.bottom = -1.4;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xdcebf2, 0.74);
    rimLight.position.set(-2.0, 2.0, -2.2);
    scene.add(rimLight);

    // Architectural honed limestone studio surface + soft contact shadow + warm light pool
    const deskGroup = new THREE.Group();
    const stoneTex = createStoneSurfaceTexture('#e4dfd4', '#cbc3b4', maxAniso);
    const deskSlab = new THREE.Mesh(
      createRoundedSlabGeometry(1.72, 1.04, 0.044, 0.045, 0.005),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: stoneTex,
        roughness: 0.86,
        metalness: 0.02,
      }),
    );
    deskSlab.position.set(0.02, -0.005, 0);
    deskSlab.receiveShadow = true;
    deskGroup.add(deskSlab);

    const contactShadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.24, 36),
      new THREE.MeshBasicMaterial({
        map: createContactShadowTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.56,
      }),
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.set(-0.14, 0.0015, 0);
    deskGroup.add(contactShadow);

    const lightPool = new THREE.Mesh(
      new THREE.CircleGeometry(0.56, 40),
      new THREE.MeshBasicMaterial({
        map: createLightPoolTexture(),
        transparent: true,
        depthWrite: false,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
      }),
    );
    lightPool.rotation.x = -Math.PI / 2;
    lightPool.position.set(0.18, 0.003, 0);
    deskGroup.add(lightPool);
    scene.add(deskGroup);

    const activeProfile = stateRef.current.profile;
    const isGloss = activeProfile.finish_glossiness === 'gloss';
    const isMatte = activeProfile.finish_glossiness === 'matte';

    // PBR Materials driven by visualProfile + active variant
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(activeProfile.primary_color_hex || '#222629'),
      roughness: isGloss ? 0.16 : isMatte ? 0.66 : 0.36,
      metalness: isGloss ? 0.34 : 0.65,
      clearcoat: isGloss ? 0.88 : isMatte ? 0.0 : 0.22,
      clearcoatRoughness: isGloss ? 0.12 : 0.35,
    });
    const innerReflectorMat = new THREE.MeshStandardMaterial({
      color: 0xe6e2d6,
      roughness: 0.62,
      metalness: 0.0,
      side: THREE.DoubleSide,
    });
    const brassMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(
        activeProfile.secondary_color_hex && !/wood|oak|walnut/i.test(activeProfile.observed_materials.join(' '))
          ? activeProfile.secondary_color_hex
          : '#C5A059',
      ),
      roughness: 0.22,
      metalness: 0.92,
      anisotropy: 0.65,
    });
    const woodToneHex =
      /oak|walnut|wood|birch|ash/i.test(activeProfile.observed_materials.join(' ')) &&
      activeProfile.secondary_color_hex
        ? activeProfile.secondary_color_hex
        : '#C7A67B';
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: createWoodGrainTexture(woodToneHex, '#5c402d', maxAniso),
      roughness: 0.52,
      metalness: 0.04,
    });
    const darkSteelMat = new THREE.MeshStandardMaterial({
      color: 0x1b1d20,
      roughness: 0.42,
      metalness: 0.65,
    });
    const rubberFootMat = new THREE.MeshStandardMaterial({
      color: 0x161719,
      roughness: 0.92,
      metalness: 0.02,
    });
    const cordMat = new THREE.MeshStandardMaterial({
      color: 0x1b1d20,
      roughness: 0.88,
      metalness: 0.05,
    });
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xfff8eb,
      emissive: 0xffd28a,
      emissiveIntensity: 1.85,
      roughness: 0.25,
      metalness: 0,
    });
    const beamConeMat = new THREE.MeshBasicMaterial({
      color: 0xffe4a8,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const taskSpot = new THREE.SpotLight(0xffe1a8, 3.4, 3.2, Math.PI / 4.2, 0.58, 1.4);
    taskSpot.castShadow = !isSoftwareGl;
    taskSpot.shadow.mapSize.width = 512;
    taskSpot.shadow.mapSize.height = 512;
    taskSpot.shadow.bias = -0.0005;
    scene.add(taskSpot);
    scene.add(taskSpot.target);

    const productRoot = new THREE.Group();
    scene.add(productRoot);

    const assemblyGuidesGroup = new THREE.Group();
    scene.add(assemblyGuidesGroup);

    const armPivot = new THREE.Group();
    const elbowPivot = new THREE.Group();
    const headGroup = new THREE.Group();
    let beamConeMesh: THREE.Mesh | null = null;
    let beamEmitterOffset: [number, number, number] = [0.078, -0.02, 0];

    let baseStepGroup = new THREE.Group();
    let lowerStemStepGroup = new THREE.Group();
    let baseKnobGroup = new THREE.Group();
    let upperBoomStepGroup = new THREE.Group();
    let elbowKnobGroup = new THREE.Group();
    let headStepGroup = new THREE.Group();
    let cordStepGroup = new THREE.Group();

    let pendantCanopyGroup = new THREE.Group();
    let pendantScrewsGroup = new THREE.Group();
    let pendantDomeGroup = new THREE.Group();
    let pendantOpalGroup = new THREE.Group();
    let cordTailAnchor: THREE.Object3D | null = null;
    let isaacCordMesh: THREE.Mesh | null = null;
    _lastCordStart.set(999, 999, 999);

    const isSingleTubeStyle = activeProfile.arm_style === 'single_articulated_tube';

    if (stateRef.current.archetype === 'pendant_lamp') {
      contactShadow.position.set(0, 0.002, 0);
      contactShadow.scale.set(1.5, 1.5, 1.5);
      lightPool.position.set(0, 0.012, 0);
      lightPool.scale.set(1.3, 1.3, 1.3);

      const hasWoodCrown = /\b(oak|walnut|birch|ash|timber|hardwood|solid wood|turned wood)\b/i.test(
        `${activeProfile.observed_materials.join(' ')} ${product.description}`,
      );

      // Step 1: Ceiling canopy, slender downrod, and narrow socket barrel (y=0.45..0.80 so canopy is never clipped by top HUD)
      pendantCanopyGroup = new THREE.Group();
      const canopyOuter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.064, 0.064, 0.024, 36),
        bodyMat,
      );
      canopyOuter.position.set(0, 0.80, 0);
      const canopyTrim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.018, 0.014, 20),
        bodyMat,
      );
      canopyTrim.position.set(0, 0.783, 0);

      const downrod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0072, 0.0072, 0.33, 16),
        bodyMat,
      );
      downrod.position.set(0, 0.615, 0);

      // Narrow socket barrel (r=0.013 < shade bore r=0.021) so shade slides up cleanly
      const socketHousing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.014, 0.042, 22),
        brassMat,
      );
      socketHousing.position.set(0, 0.435, 0);
      pendantCanopyGroup.add(canopyOuter, canopyTrim, downrod, socketHousing);
      productRoot.add(pendantCanopyGroup);

      pendantScrewsGroup = new THREE.Group();
      const screw1 = createBrassBolt(brassMat, 0.022);
      screw1.position.set(-0.04, 0.796, 0);
      const screw2 = createBrassBolt(brassMat, 0.022);
      screw2.position.set(0.04, 0.796, 0);
      pendantScrewsGroup.add(screw1, screw2);
      productRoot.add(pendantScrewsGroup);

      // Step 2: Smooth wide spun saucer / dome shade with open center bore (r=0.021) matching ref-atwood.jpg
      pendantDomeGroup = new THREE.Group();
      const strainCollarProfile = [
        new THREE.Vector2(0.019, 0.0),
        new THREE.Vector2(0.024, 0.0),
        new THREE.Vector2(0.020, 0.018),
        new THREE.Vector2(0.015, 0.038),
        new THREE.Vector2(0.011, 0.038),
        new THREE.Vector2(0.013, 0.012),
        new THREE.Vector2(0.019, 0.0),
      ];
      const strainCollar = new THREE.Mesh(
        new THREE.LatheGeometry(strainCollarProfile, 36),
        bodyMat,
      );
      strainCollar.position.set(0, 0.468, 0);
      pendantDomeGroup.add(strainCollar);

      if (hasWoodCrown) {
        const woodCapProfile = [
          new THREE.Vector2(0.019, 0.072),
          new THREE.Vector2(0.075, 0.066),
          new THREE.Vector2(0.145, 0.044),
          new THREE.Vector2(0.188, 0.021),
          new THREE.Vector2(0.178, 0.017),
          new THREE.Vector2(0.08, 0.054),
          new THREE.Vector2(0.019, 0.062),
        ];
        const woodCapMesh = new THREE.Mesh(new THREE.LatheGeometry(woodCapProfile, 56), woodMat);
        woodCapMesh.position.set(0, 0.405, 0);
        woodCapMesh.castShadow = true;
        pendantDomeGroup.add(woodCapMesh);

        const skirtProfile = [
          new THREE.Vector2(0.188, 0.021),
          new THREE.Vector2(0.228, 0.005),
          new THREE.Vector2(0.232, -0.005),
          new THREE.Vector2(0.218, -0.009),
          new THREE.Vector2(0.175, 0.015),
        ];
        bodyMat.side = THREE.DoubleSide;
        const skirtMesh = new THREE.Mesh(new THREE.LatheGeometry(skirtProfile, 56), bodyMat);
        skirtMesh.position.set(0, 0.405, 0);
        skirtMesh.castShadow = true;
        pendantDomeGroup.add(skirtMesh);
      } else if (activeProfile.shade_profile === 'cone') {
        const coneProfile = [
          new THREE.Vector2(0.019, 0.145),
          new THREE.Vector2(0.042, 0.138),
          new THREE.Vector2(0.212, 0.012),
          new THREE.Vector2(0.22, 0.0),
          new THREE.Vector2(0.208, 0.004),
          new THREE.Vector2(0.036, 0.13),
          new THREE.Vector2(0.019, 0.134),
        ];
        bodyMat.side = THREE.DoubleSide;
        const coneMesh = new THREE.Mesh(new THREE.LatheGeometry(coneProfile, 56), bodyMat);
        coneMesh.position.set(0, 0.34, 0);
        coneMesh.castShadow = true;
        pendantDomeGroup.add(coneMesh);
      } else {
        // High-resolution wide shallow saucer dome matching Atwood Pendant ref-atwood.jpg
        const saucerProfile = [
          new THREE.Vector2(0.019, 0.080),
          new THREE.Vector2(0.072, 0.075),
          new THREE.Vector2(0.128, 0.064),
          new THREE.Vector2(0.184, 0.046),
          new THREE.Vector2(0.232, 0.026),
          new THREE.Vector2(0.262, 0.010),
          new THREE.Vector2(0.268, 0.002),
          new THREE.Vector2(0.258, -0.003),
          new THREE.Vector2(0.236, 0.003),
          new THREE.Vector2(0.172, 0.023),
          new THREE.Vector2(0.095, 0.046),
          new THREE.Vector2(0.019, 0.062),
        ];
        bodyMat.side = THREE.DoubleSide;
        const saucerMesh = new THREE.Mesh(new THREE.LatheGeometry(saucerProfile, 64), bodyMat);
        saucerMesh.position.set(0, 0.398, 0);
        saucerMesh.castShadow = true;
        pendantDomeGroup.add(saucerMesh);
      }
      productRoot.add(pendantDomeGroup);

      // Step 3: Silky milky frosted blown opal glass oblate dome matching ref-atwood.jpg
      pendantOpalGroup = new THREE.Group();
      const opalMat = new THREE.MeshPhysicalMaterial({
        color: 0xf7f5ef,
        emissive: 0xffdfad,
        emissiveIntensity: 0.34,
        roughness: 0.28,
        metalness: 0.0,
        clearcoat: 0.28,
        clearcoatRoughness: 0.22,
        sheen: 0.25,
      });
      const innerBulb = new THREE.Mesh(new THREE.SphereGeometry(0.022, 18, 14), bulbMat);
      innerBulb.position.set(0, 0.392, 0);
      const opalMesh = new THREE.Mesh(new THREE.SphereGeometry(0.088, 48, 32), opalMat);
      opalMesh.scale.set(1.0, 0.72, 1.0);
      opalMesh.position.set(0, 0.372, 0);
      // Tucked internal brass fitter collar hidden inside dome cavity
      const opalNeckRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.024, 0.036, 0.012, 24),
        brassMat,
      );
      opalNeckRing.position.set(0, 0.432, 0);
      pendantOpalGroup.add(innerBulb, opalMesh, opalNeckRing);

      const coneGeo = new THREE.ConeGeometry(0.44, 0.36, 32, 1, true);
      coneGeo.translate(0, -0.18, 0);
      beamConeMesh = new THREE.Mesh(coneGeo, beamConeMat);
      beamConeMesh.position.set(0, 0.31, 0);
      pendantOpalGroup.add(beamConeMesh);
      productRoot.add(pendantOpalGroup);

      assemblyGuidesGroup.add(
        createDashedGuideLine(new THREE.Vector3(0, 0.50, 0), new THREE.Vector3(0, 0.14, 0)),
        createDashedGuideLine(new THREE.Vector3(-0.04, 0.80, 0), new THREE.Vector3(-0.04, 0.72, 0)),
        createDashedGuideLine(new THREE.Vector3(0.04, 0.80, 0), new THREE.Vector3(0.04, 0.72, 0)),
      );

      taskSpot.position.set(0, 0.35, 0);
      taskSpot.target.position.set(0, 0, 0);
      taskSpot.angle = Math.PI / 3.1;
    } else {
      // Table / Desk Lamp — centered harmoniously on the stone studio slab
      const baseX = isSingleTubeStyle ? -0.14 : -0.22;
      contactShadow.position.set(baseX, 0.0015, 0);

      // Step 1A: Base stays grounded flush on desk (y = 0)
      baseStepGroup = new THREE.Group();
      baseStepGroup.position.set(baseX, 0, 0);

      if (isSingleTubeStyle) {
        // 4 signature black cylindrical feet under the painted enamel disc base (Isaac Table Lamp ref-isaac.jpg)
        for (let i = 0; i < 4; i++) {
          const ang = (i * Math.PI) / 2 + Math.PI / 4;
          const foot = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0125, 0.0120, 0.011, 20),
            rubberFootMat,
          );
          foot.position.set(Math.cos(ang) * 0.074, 0.0055, Math.sin(ang) * 0.074);
          foot.castShadow = true;
          baseStepGroup.add(foot);
        }

        const isaacBaseProfile = [
          new THREE.Vector2(0.0, 0.010),
          new THREE.Vector2(0.093, 0.010),
          new THREE.Vector2(0.096, 0.014),
          new THREE.Vector2(0.096, 0.021),
          new THREE.Vector2(0.092, 0.0255),
          new THREE.Vector2(0.082, 0.027),
          new THREE.Vector2(0.014, 0.0275),
          new THREE.Vector2(0.0, 0.0275),
        ];
        const discBase = new THREE.Mesh(new THREE.LatheGeometry(isaacBaseProfile, 64), bodyMat);
        discBase.castShadow = true;
        discBase.receiveShadow = true;

        const brassCollar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0105, 0.0135, 0.009, 28),
          brassMat,
        );
        brassCollar.position.y = 0.033;
        baseStepGroup.add(discBase, brassCollar);
      } else {
        const feltFoot = new THREE.Mesh(
          new THREE.CylinderGeometry(0.114, 0.114, 0.004, 40),
          cordMat,
        );
        feltFoot.position.y = 0.002;

        const baseProfile =
          activeProfile.base_profile === 'cone_pedestal'
            ? [
                new THREE.Vector2(0.0, 0.004),
                new THREE.Vector2(0.112, 0.004),
                new THREE.Vector2(0.105, 0.022),
                new THREE.Vector2(0.046, 0.058),
                new THREE.Vector2(0.024, 0.072),
                new THREE.Vector2(0.0, 0.072),
              ]
            : [
                new THREE.Vector2(0.0, 0.004),
                new THREE.Vector2(0.118, 0.004),
                new THREE.Vector2(0.118, 0.015),
                new THREE.Vector2(0.104, 0.024),
                new THREE.Vector2(0.036, 0.028),
                new THREE.Vector2(0.026, 0.07),
                new THREE.Vector2(0.0, 0.07),
              ];
        const baseMesh = new THREE.Mesh(new THREE.LatheGeometry(baseProfile, 52), bodyMat);
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;

        const brassBaseRing = new THREE.Mesh(
          new THREE.TorusGeometry(0.111, 0.0035, 12, 48),
          brassMat,
        );
        brassBaseRing.rotation.x = Math.PI / 2;
        brassBaseRing.position.y = 0.018;

        const dimmerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.017, 0.01, 20), brassMat);
        dimmerBase.position.set(0.062, 0.024, 0.032);
        const dimmerCap = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 20), bodyMat);
        dimmerCap.position.set(0.062, 0.031, 0.032);

        const baseTurret = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.044, 24), brassMat);
        baseTurret.rotation.x = Math.PI / 2;
        baseTurret.position.set(0, 0.082, 0);
        baseTurret.castShadow = true;

        baseStepGroup.add(feltFoot, baseMesh, brassBaseRing, dimmerBase, dimmerCap, baseTurret);
      }
      productRoot.add(baseStepGroup);

      // Step 1B: Vertical Stem / Lower Arm drops straight into base collar (NO base overlap)
      lowerStemStepGroup = new THREE.Group();
      lowerStemStepGroup.position.set(baseX, isSingleTubeStyle ? 0.030 : 0.082, 0);
      productRoot.add(lowerStemStepGroup);

      lowerStemStepGroup.add(armPivot);

      if (isSingleTubeStyle) {
        // Two-tone vertical post matching ref-isaac.jpg: painted lower sleeve + hairline brass step + upper black rod extending past swivel
        const lowerPaintedStem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0074, 0.0074, 0.235, 24),
          bodyMat,
        );
        lowerPaintedStem.position.set(0, 0.1175, 0);
        lowerPaintedStem.castShadow = true;

        const stemDividerRing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0078, 0.0078, 0.003, 22),
          brassMat,
        );
        stemDividerRing.position.set(0, 0.235, 0);

        const upperBlackStem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0064, 0.0064, 0.165, 22),
          darkSteelMat,
        );
        upperBlackStem.position.set(0, 0.235 + 0.0825, 0);
        upperBlackStem.castShadow = true;

        const stemTopCap = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0064, 0.0064, 0.004, 18),
          darkSteelMat,
        );
        stemTopCap.position.set(0, 0.402, 0);

        // Vertical post brass collar & horizontal spacer bridging cleanly to elbowPivot (z = 0.018)
        const postSwivelCollar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0102, 0.0102, 0.024, 24),
          brassMat,
        );
        postSwivelCollar.position.set(0, 0.340, 0);

        const swivelBack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.012, 0.018, 24),
          brassMat,
        );
        swivelBack.rotation.x = Math.PI / 2;
        swivelBack.position.set(0, 0.340, 0.009);
        armPivot.add(
          lowerPaintedStem,
          stemDividerRing,
          upperBlackStem,
          stemTopCap,
          postSwivelCollar,
          swivelBack,
        );

        // Step 2: Boom mounted on +Z side (z = 0.018) cleanly in front of vertical post
        elbowPivot.position.set(0, 0.340, 0.018);
        armPivot.add(elbowPivot);

        upperBoomStepGroup = new THREE.Group();
        elbowPivot.add(upperBoomStepGroup);

        // Brass clamp collar wrapping around the diagonal boom so swivel never gaps
        const boomClampCollar = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0098, 0.0098, 0.022, 24),
          brassMat,
        );
        boomClampCollar.rotation.z = Math.PI / 2;
        boomClampCollar.position.set(0, 0, 0);

        // Front black rod + machined brass tip ferrule + rear black collar + rear painted counterweight sleeve + brass cord bushing
        const boomFrontRod = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0060, 0.0060, 0.248, 22),
          darkSteelMat,
        );
        boomFrontRod.rotation.z = -Math.PI / 2;
        boomFrontRod.position.set(0.124, 0, 0);
        boomFrontRod.castShadow = true;

        const tipFerrule = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0086, 0.0086, 0.030, 22),
          brassMat,
        );
        tipFerrule.rotation.z = Math.PI / 2;
        tipFerrule.position.set(0.254, 0, 0);

        const boomRearBlack = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0060, 0.0060, 0.052, 20),
          darkSteelMat,
        );
        boomRearBlack.rotation.z = Math.PI / 2;
        boomRearBlack.position.set(-0.026, 0, 0);

        const rearHandleSleeve = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0082, 0.0082, 0.118, 24),
          bodyMat,
        );
        rearHandleSleeve.rotation.z = Math.PI / 2;
        rearHandleSleeve.position.set(-0.111, 0, 0);
        rearHandleSleeve.castShadow = true;

        const rearCordBushing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.0065, 0.0084, 0.012, 20),
          brassMat,
        );
        rearCordBushing.rotation.z = Math.PI / 2;
        rearCordBushing.position.set(-0.175, 0, 0);

        cordTailAnchor = new THREE.Object3D();
        cordTailAnchor.position.set(-0.181, 0, 0);

        upperBoomStepGroup.add(
          boomClampCollar,
          boomFrontRod,
          tipFerrule,
          boomRearBlack,
          rearHandleSleeve,
          rearCordBushing,
          cordTailAnchor,
        );

        // Brass flat disc + beveled wing thumbscrew clamp locking onto the boom from +Z
        elbowKnobGroup = new THREE.Group();
        const thumbDisc = new THREE.Mesh(
          new THREE.CylinderGeometry(0.019, 0.019, 0.009, 32),
          brassMat,
        );
        thumbDisc.rotation.x = Math.PI / 2;
        thumbDisc.position.set(0, 0, 0.012);
        const wingShape = new THREE.Shape();
        wingShape.moveTo(-0.0032, -0.016);
        wingShape.lineTo(0.0032, -0.016);
        wingShape.lineTo(0.0026, 0.017);
        wingShape.lineTo(-0.0026, 0.017);
        wingShape.closePath();
        const wingMesh = new THREE.Mesh(
          new THREE.ExtrudeGeometry(wingShape, {
            depth: 0.011,
            bevelEnabled: true,
            bevelThickness: 0.0012,
            bevelSize: 0.0012,
            bevelSegments: 2,
          }),
          brassMat,
        );
        wingMesh.position.set(0, 0, 0.015);
        wingMesh.rotation.z = 0.36;
        elbowKnobGroup.add(thumbDisc, wingMesh);
        elbowPivot.add(elbowKnobGroup);

        // Dynamic live-anchored braided power cord (updates seamlessly as armAngleDeg changes!)
        cordStepGroup = new THREE.Group();
        const initialCordCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(baseX - 0.18, 0.30, 0.018),
          new THREE.Vector3(baseX - 0.24, 0.16, 0.036),
          new THREE.Vector3(baseX - 0.31, 0.032, 0.075),
          new THREE.Vector3(baseX - 0.44, 0.004, 0.145),
        ]);
        isaacCordMesh = new THREE.Mesh(
          new THREE.TubeGeometry(initialCordCurve, 28, 0.0034, 8, false),
          cordMat,
        );
        isaacCordMesh.castShadow = true;
        cordStepGroup.add(isaacCordMesh);
        productRoot.add(cordStepGroup);
      } else {
        baseKnobGroup = createKnurledKnob(0.013, 0.052, brassMat);
        armPivot.add(baseKnobGroup);

        if (activeProfile.arm_style === 'twin_cantilever') {
          const strutShape = new THREE.Shape();
          strutShape.moveTo(-0.006, 0);
          strutShape.lineTo(0.006, 0);
          strutShape.lineTo(0.005, 0.345);
          strutShape.lineTo(-0.005, 0.345);
          strutShape.closePath();
          const strutGeo = new THREE.ExtrudeGeometry(strutShape, {
            depth: 0.007,
            bevelEnabled: true,
            bevelThickness: 0.0012,
            bevelSize: 0.0012,
            bevelSegments: 2,
          });

          const leftStrut = new THREE.Mesh(strutGeo, bodyMat);
          leftStrut.position.set(0, 0, -0.017);
          leftStrut.castShadow = true;

          const rightStrut = new THREE.Mesh(strutGeo, bodyMat);
          rightStrut.position.set(0, 0, 0.01);
          rightStrut.castShadow = true;
          armPivot.add(leftStrut, rightStrut);

          [0.09, 0.19, 0.28].forEach((py) => {
            const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.032, 12), brassMat);
            pin.rotation.x = Math.PI / 2;
            pin.position.set(0, py, 0);
            armPivot.add(pin);
          });

          const tensionRod = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0028, 0.0028, 0.33, 10),
            brassMat,
          );
          tensionRod.position.set(-0.013, 0.175, 0);
          armPivot.add(tensionRod);
        } else {
          const lowerTube = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0095, 0.0115, 0.345, 22),
            bodyMat,
          );
          lowerTube.position.set(0, 0.172, 0);
          lowerTube.castShadow = true;
          armPivot.add(lowerTube);
        }

        elbowPivot.position.set(0, 0.345, 0.02);
        armPivot.add(elbowPivot);

        const elbowHousing = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.038, 24), brassMat);
        elbowHousing.rotation.x = Math.PI / 2;
        elbowHousing.castShadow = true;
        elbowPivot.add(elbowHousing);

        elbowKnobGroup = createKnurledKnob(0.012, 0.05, brassMat);
        elbowPivot.add(elbowKnobGroup);

        upperBoomStepGroup = new THREE.Group();
        elbowPivot.add(upperBoomStepGroup);

        if (activeProfile.arm_style === 'curved_gooseneck') {
          const neckCurve = new THREE.CatmullRomCurve3([
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0.12, 0.055, 0),
            new THREE.Vector3(0.25, 0.045, 0),
            new THREE.Vector3(0.35, -0.01, 0),
          ]);
          const neckTube = new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 28, 0.009, 14, false), bodyMat);
          neckTube.castShadow = true;
          upperBoomStepGroup.add(neckTube);
        } else {
          const upperArmShape = new THREE.Shape();
          upperArmShape.moveTo(0, -0.009);
          upperArmShape.lineTo(0.365, -0.007);
          upperArmShape.lineTo(0.365, 0.007);
          upperArmShape.lineTo(0, 0.009);
          upperArmShape.closePath();
          const upperArmGeo = new THREE.ExtrudeGeometry(upperArmShape, {
            depth: 0.018,
            bevelEnabled: true,
            bevelThickness: 0.002,
            bevelSize: 0.002,
            bevelSegments: 2,
          });
          upperArmGeo.translate(0, 0, -0.009);
          const upperArmMesh = new THREE.Mesh(upperArmGeo, bodyMat);
          upperArmMesh.castShadow = true;

          [0.11, 0.24].forEach((cx) => {
            const clip = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.024, 0.024), brassMat);
            clip.position.set(cx, 0, 0);
            upperBoomStepGroup.add(clip);
          });
          upperBoomStepGroup.add(upperArmMesh);
        }

        cordStepGroup = new THREE.Group();
        const cordCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(baseX - 0.095, 0.012, -0.02),
          new THREE.Vector3(baseX - 0.18, 0.007, -0.05),
          new THREE.Vector3(baseX - 0.28, 0.006, -0.14),
          new THREE.Vector3(baseX - 0.36, 0.006, -0.28),
        ]);
        const cordTube = new THREE.Mesh(
          new THREE.TubeGeometry(cordCurve, 20, 0.0042, 8, false),
          cordMat,
        );
        cordStepGroup.add(cordTube);
        productRoot.add(cordStepGroup);
      }

      // Step 3: Shade Head matched directly to visualProfile.shade_profile with locked watertight joint hierarchy
      const boomTipX = isSingleTubeStyle
        ? 0.264
        : activeProfile.arm_style === 'curved_gooseneck'
          ? 0.35
          : 0.36;
      headGroup.position.set(boomTipX, 0, 0);
      upperBoomStepGroup.add(headGroup);

      headStepGroup = new THREE.Group();
      headGroup.add(headStepGroup);

      // Brass swivel knuckle drum socketed straight onto boomTipX
      const headJoint = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.022, 24), brassMat);
      headJoint.rotation.x = Math.PI / 2;
      headStepGroup.add(headJoint);

      if (activeProfile.shade_profile === 'cone' || activeProfile.shade_profile === 'dome') {
        // Unified tilted shade assembly pivoted strictly around knuckle center so parts NEVER detach at any angle!
        const shadeTiltPivot = new THREE.Group();
        shadeTiltPivot.rotation.z = 0.22;
        headStepGroup.add(shadeTiltPivot);

        // Straight brass neck stem connecting knuckle (0,0,0) directly into dome crown (0, -0.028, 0)
        const neckStem = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0095, 0.032, 22), brassMat);
        neckStem.position.set(0, -0.016, 0);

        const brassCrown = new THREE.Mesh(
          new THREE.CylinderGeometry(0.012, 0.016, 0.014, 24),
          brassMat,
        );
        brassCrown.position.set(0, -0.030, 0);

        const isCone = activeProfile.shade_profile === 'cone';
        // Smooth high-res parabolic bell dome matching Isaac Table Lamp ref-isaac.jpg
        const outerPts = isCone
          ? [
              new THREE.Vector2(0.0, 0.0),
              new THREE.Vector2(0.024, -0.002),
              new THREE.Vector2(0.048, -0.028),
              new THREE.Vector2(0.088, -0.098),
              new THREE.Vector2(0.095, -0.118),
              new THREE.Vector2(0.090, -0.119),
            ]
          : [
              new THREE.Vector2(0.0, 0.0),
              new THREE.Vector2(0.026, -0.002),
              new THREE.Vector2(0.052, -0.012),
              new THREE.Vector2(0.074, -0.030),
              new THREE.Vector2(0.088, -0.054),
              new THREE.Vector2(0.095, -0.082),
              new THREE.Vector2(0.096, -0.108),
              new THREE.Vector2(0.094, -0.120),
              new THREE.Vector2(0.089, -0.120),
            ];

        // Inset cream-white satin inner reflector stopping cleanly inside rolled lip (zero Z-fighting)
        const innerPts = isCone
          ? [
              new THREE.Vector2(0.0, -0.008),
              new THREE.Vector2(0.020, -0.010),
              new THREE.Vector2(0.042, -0.034),
              new THREE.Vector2(0.081, -0.098),
              new THREE.Vector2(0.087, -0.114),
            ]
          : [
              new THREE.Vector2(0.0, -0.008),
              new THREE.Vector2(0.022, -0.010),
              new THREE.Vector2(0.046, -0.019),
              new THREE.Vector2(0.067, -0.036),
              new THREE.Vector2(0.080, -0.058),
              new THREE.Vector2(0.087, -0.083),
              new THREE.Vector2(0.088, -0.114),
            ];

        const outerShade = new THREE.Mesh(new THREE.LatheGeometry(outerPts, 64), bodyMat);
        outerShade.position.set(0, -0.030, 0);
        outerShade.castShadow = true;

        const innerShade = new THREE.Mesh(new THREE.LatheGeometry(innerPts, 56), innerReflectorMat);
        innerShade.position.set(0, -0.030, 0);

        const bulbOrb = new THREE.Mesh(new THREE.SphereGeometry(0.021, 22, 16), bulbMat);
        bulbOrb.position.set(0, -0.082, 0);

        const coneGeo = new THREE.ConeGeometry(0.32, 0.44, 32, 1, true);
        coneGeo.translate(0, -0.22, 0);
        beamConeMesh = new THREE.Mesh(coneGeo, beamConeMat);
        beamConeMesh.position.set(0, -0.145, 0);

        // Local emitter offset converted smoothly in shadeTiltPivot frame
        beamEmitterOffset = [0.054, -0.135, 0];
        shadeTiltPivot.add(neckStem, brassCrown, outerShade, innerShade, bulbOrb, beamConeMesh);
      } else if (activeProfile.shade_profile === 'cylinder') {
        const cylShade = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.052, 0.135, 32), bodyMat);
        cylShade.position.set(0.036, -0.055, 0);
        cylShade.rotation.z = 0.24;
        cylShade.castShadow = true;

        const brassBand = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.014, 32), brassMat);
        brassBand.position.set(0.022, -0.002, 0);
        brassBand.rotation.z = 0.24;

        const diffuserDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.01, 24), bulbMat);
        diffuserDisc.position.set(0.05, -0.118, 0);
        diffuserDisc.rotation.z = 0.24;

        const coneGeo = new THREE.ConeGeometry(0.28, 0.42, 32, 1, true);
        coneGeo.translate(0, -0.21, 0);
        beamConeMesh = new THREE.Mesh(coneGeo, beamConeMat);
        beamConeMesh.position.set(0.052, -0.125, 0);
        beamConeMesh.rotation.z = 0.24;

        beamEmitterOffset = [0.052, -0.125, 0];
        headStepGroup.add(cylShade, brassBand, diffuserDisc, beamConeMesh);
      } else if (activeProfile.shade_profile === 'globe') {
        const galleryCap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.052, 0.024, 24), brassMat);
        galleryCap.position.set(0.03, -0.02, 0);
        const globeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.072, 32, 24), bulbMat);
        globeMesh.position.set(0.03, -0.088, 0);

        const coneGeo = new THREE.ConeGeometry(0.32, 0.4, 32, 1, true);
        coneGeo.translate(0, -0.2, 0);
        beamConeMesh = new THREE.Mesh(coneGeo, beamConeMat);
        beamConeMesh.position.set(0.03, -0.145, 0);

        beamEmitterOffset = [0.03, -0.145, 0];
        headStepGroup.add(galleryCap, globeMesh, beamConeMesh);
      } else {
        // Architectural linear LED bar with cooling fins
        const brassNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.032, 16), brassMat);
        brassNeck.rotation.z = Math.PI / 2;
        brassNeck.position.set(0.012, 0, 0);
        headStepGroup.add(brassNeck);

        const shadeShape = new THREE.Shape();
        shadeShape.moveTo(-0.018, -0.014);
        shadeShape.lineTo(0.145, -0.014);
        shadeShape.lineTo(0.155, 0.004);
        shadeShape.lineTo(0.135, 0.018);
        shadeShape.lineTo(-0.01, 0.018);
        shadeShape.closePath();
        const shadeGeo = new THREE.ExtrudeGeometry(shadeShape, {
          depth: 0.056,
          bevelEnabled: true,
          bevelThickness: 0.003,
          bevelSize: 0.003,
          bevelSegments: 2,
        });
        shadeGeo.translate(0, 0, -0.028);
        const shadeBody = new THREE.Mesh(shadeGeo, bodyMat);
        shadeBody.position.set(0.015, 0, 0);
        shadeBody.castShadow = true;
        headStepGroup.add(shadeBody);

        for (let f = 0; f < 5; f++) {
          const fin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.005, 0.004), brassMat);
          fin.position.set(0.075, 0.021, -0.016 + f * 0.008);
          headStepGroup.add(fin);
        }

        const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.148, 0.004, 0.048), brassMat);
        bezel.position.set(0.078, -0.015, 0);
        headStepGroup.add(bezel);

        const diffuser = new THREE.Mesh(new THREE.BoxGeometry(0.138, 0.007, 0.04), bulbMat);
        diffuser.position.set(0.078, -0.018, 0);
        headStepGroup.add(diffuser);

        const coneGeo = new THREE.ConeGeometry(0.28, 0.42, 32, 1, true);
        coneGeo.translate(0, -0.21, 0);
        beamConeMesh = new THREE.Mesh(coneGeo, beamConeMat);
        beamConeMesh.position.set(0.078, -0.02, 0);
        beamEmitterOffset = [0.078, -0.02, 0];
        headStepGroup.add(beamConeMesh);
      }

      assemblyGuidesGroup.add(
        createDashedGuideLine(new THREE.Vector3(baseX, 0.03, 0), new THREE.Vector3(baseX, 0.24, 0)),
      );
      const elbowGuide = createDashedGuideLine(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0.04, 0.16),
      );
      const headGuide = createDashedGuideLine(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.16, -0.04, 0),
      );
      elbowPivot.add(elbowGuide);
      headGroup.add(headGuide);
      assemblyGuidesGroup.userData.pivotGuides = [elbowGuide, headGuide];
    }

    // Dimension callouts
    const dimensionsGroup = new THREE.Group();
    if (stateRef.current.archetype === 'pendant_lamp') {
      dimensionsGroup.add(
        createDimensionCallout(
          new THREE.Vector3(-0.245, 0.36, 0.27),
          new THREE.Vector3(0.245, 0.36, 0.27),
          `${product.dimensions.widthCm ?? 42} cm Ø`,
        ),
        createDimensionCallout(
          new THREE.Vector3(0.32, 0.37, 0),
          new THREE.Vector3(0.32, 0.54, 0),
          `${product.dimensions.heightCm ?? 18} cm H`,
        ),
      );
    } else {
      const baseDimX = isSingleTubeStyle ? -0.14 : -0.22;
      dimensionsGroup.add(
        createDimensionCallout(
          new THREE.Vector3(baseDimX - 0.11, 0.015, 0.19),
          new THREE.Vector3(baseDimX + 0.11, 0.015, 0.19),
          `${product.dimensions.baseDiameterCm ?? product.dimensions.widthCm ?? 20} cm Ø Base`,
        ),
        createDimensionCallout(
          new THREE.Vector3(baseDimX, 0.54, -0.12),
          new THREE.Vector3(baseDimX + 0.42, 0.54, -0.12),
          `${product.dimensions.reachCm ?? product.dimensions.depthCm ?? 46} cm Reach`,
        ),
        createDimensionCallout(
          new THREE.Vector3(baseDimX - 0.22, 0.0, 0),
          new THREE.Vector3(baseDimX - 0.22, 0.54, 0),
          `${product.dimensions.heightCm ?? 54} cm H`,
        ),
      );
    }
    dimensionsGroup.visible = stateRef.current.showDimensions;
    scene.add(dimensionsGroup);

    const applyVariant = (variantId: string) => {
      const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
      if (!variant) return;
      const useProfileHex =
        variant.label === 'Standard Finish' && stateRef.current.profile.primary_color_hex;
      bodyMat.color.set(useProfileHex ? stateRef.current.profile.primary_color_hex : variant.colorHex);
      const glossOverride =
        variant.label.toLowerCase().includes('gloss') ||
        stateRef.current.profile.finish_glossiness === 'gloss';
      bodyMat.roughness = glossOverride ? 0.16 : variant.roughness;
      bodyMat.metalness = variant.metalness;
      bodyMat.clearcoat = glossOverride ? 0.88 : 0.2;
      if (variant.secondaryHex && stateRef.current.archetype !== 'pendant_lamp') {
        brassMat.color.set(variant.secondaryHex);
      }
      if (stateRef.current.archetype === 'pendant_lamp') {
        const isBlackVariant = /black|obsidian|matte|satin/i.test(variant.label) && !/brass|gold/i.test(variant.label);
        woodMat.color.set(isBlackVariant ? '#232629' : '#ffffff');
      }
      schedulerRef.current?.requestRender();
    };
    applyVariantRef.current = applyVariant;
    applyVariant(stateRef.current.selectedVariantId);

    updateDimensionsRef.current = (visible: boolean) => {
      dimensionsGroup.visible = visible;
      schedulerRef.current?.requestRender();
    };

    updateControlsEnabledRef.current = (enabled: boolean) => {
      controls.enabled = enabled;
      schedulerRef.current?.requestRender();
    };

    let currentArmDeg = stateRef.current.armAngleDeg;
    let currentIntensity = stateRef.current.lightIntensityPct;
    let currentAssembly = stateRef.current.assemblyMode ? stateRef.current.assemblyProgress : 1;

    const scheduler = createRenderScheduler(renderer, scene, camera, controls, isSoftwareGl, (dt) => {
      let needsMore = false;

      const targetArm = stateRef.current.armAngleDeg;
      if (Math.abs(currentArmDeg - targetArm) > 0.08) {
        currentArmDeg = THREE.MathUtils.damp(currentArmDeg, targetArm, 10, dt);
        needsMore = true;
      } else {
        currentArmDeg = targetArm;
      }

      const targetInt = stateRef.current.lightIntensityPct;
      if (Math.abs(currentIntensity - targetInt) > 0.2) {
        currentIntensity = THREE.MathUtils.damp(currentIntensity, targetInt, 10, dt);
        needsMore = true;
      } else {
        currentIntensity = targetInt;
      }

      const targetAssembly = stateRef.current.assemblyMode ? stateRef.current.assemblyProgress : 1;
      if (Math.abs(currentAssembly - targetAssembly) > 0.002) {
        currentAssembly = THREE.MathUtils.damp(currentAssembly, targetAssembly, 12, dt);
        needsMore = true;
      } else {
        currentAssembly = targetAssembly;
      }

      const normInt = THREE.MathUtils.clamp(currentIntensity / 100, 0, 1);
      const isAssembling = stateRef.current.assemblyMode && currentAssembly < 0.99;
      assemblyGuidesGroup.visible = isAssembling;
      const pivotGuides = assemblyGuidesGroup.userData.pivotGuides as THREE.Line[] | undefined;
      pivotGuides?.forEach((g) => {
        g.visible = isAssembling;
      });

      const s1 = easeOutCubic(getStepProgress(currentAssembly, 0, 3));
      const s2 = easeOutCubic(getStepProgress(currentAssembly, 1, 3));
      const s3 = easeOutCubic(getStepProgress(currentAssembly, 2, 3));

      if (stateRef.current.archetype === 'pendant_lamp') {
        pendantCanopyGroup.position.y = (1 - s1) * 0.08;
        pendantScrewsGroup.position.y = (1 - s1) * -0.07;
        pendantDomeGroup.position.y = (1 - s2) * -0.16;
        pendantOpalGroup.position.y = (1 - s3) * -0.20;
        pendantOpalGroup.rotation.y = (1 - s3) * Math.PI * 0.5;
      } else {
        // Base sits flush on desk; vertical post drops cleanly INTO collar (no base/floor clipping)
        baseStepGroup.position.y = 0;
        lowerStemStepGroup.position.y = (isSingleTubeStyle ? 0.03 : 0.082) + (1 - s1) * 0.16;
        baseKnobGroup.position.z = (1 - s1) * 0.09;

        // Boom seats horizontally (-Z) onto side brass swivel without touching vertical post
        upperBoomStepGroup.position.z = (1 - s2) * 0.16;
        upperBoomStepGroup.position.y = (1 - s2) * 0.04;
        elbowKnobGroup.position.z = (1 - s2) * 0.23;

        // Shade slides axially along boom tip forward axis away from knuckle
        headStepGroup.position.x = (1 - s3) * 0.16;
        headStepGroup.position.y = (1 - s3) * -0.04;

        cordStepGroup.visible = !stateRef.current.assemblyMode || s3 > 0.65;

        const t = THREE.MathUtils.clamp((currentArmDeg - 15) / 60, 0, 1);
        if (isSingleTubeStyle) {
          armPivot.rotation.z = 0;
          elbowPivot.rotation.z = THREE.MathUtils.lerp(0.10, 0.48, t);
          headGroup.rotation.z = -elbowPivot.rotation.z * 0.72;
        } else {
          armPivot.rotation.z = THREE.MathUtils.lerp(0.36, -0.18, t);
          elbowPivot.rotation.z = THREE.MathUtils.lerp(-0.52, 0.24, t);
          headGroup.rotation.z = -(armPivot.rotation.z + elbowPivot.rotation.z) * 0.85;
        }

        productRoot.updateMatrixWorld(true);

        // Keep power cord physically welded to moving rear brass bushing at all angles 15°..75°
        if (isSingleTubeStyle && cordTailAnchor && isaacCordMesh) {
          _cordStart.set(0, 0, 0).applyMatrix4(cordTailAnchor.matrixWorld);
          if (_cordStart.distanceToSquared(_lastCordStart) > 2e-7) {
            _lastCordStart.copy(_cordStart);
            const startY = Math.max(0.02, _cordStart.y);
            const dynamicCurve = new THREE.CatmullRomCurve3([
              new THREE.Vector3(_cordStart.x, startY, _cordStart.z),
              new THREE.Vector3(_cordStart.x - 0.032, startY * 0.58, _cordStart.z + 0.015),
              new THREE.Vector3(_cordStart.x - 0.088, Math.max(0.016, startY * 0.14), _cordStart.z + 0.044),
              new THREE.Vector3(_cordStart.x - 0.20, 0.004, _cordStart.z + 0.095),
              new THREE.Vector3(_cordStart.x - 0.34, 0.004, _cordStart.z + 0.155),
            ]);
            isaacCordMesh.geometry.dispose();
            isaacCordMesh.geometry = new THREE.TubeGeometry(dynamicCurve, 28, 0.0034, 8, false);
          }
        }

        _headWorldPos.set(...beamEmitterOffset).applyMatrix4(headGroup.matrixWorld);
        _beamDir.set(0, -1, 0).transformDirection(headGroup.matrixWorld).normalize();

        const denom = Math.min(-0.15, _beamDir.y);
        const rayDist = Math.max(0.1, (0.01 - _headWorldPos.y) / denom);
        _rayOrigin.copy(_headWorldPos).addScaledVector(_beamDir, rayDist);

        taskSpot.position.copy(_headWorldPos);
        taskSpot.target.position.set(_rayOrigin.x, 0, _rayOrigin.z);
        taskSpot.target.updateMatrixWorld();

        lightPool.position.set(_rayOrigin.x, 0.003, _rayOrigin.z);
        const spreadScale = THREE.MathUtils.clamp(0.75 + _headWorldPos.y * 0.85, 0.65, 1.35);
        lightPool.scale.set(spreadScale, spreadScale, 1);
      }

      const powerFactor = stateRef.current.assemblyMode
        ? THREE.MathUtils.clamp((currentAssembly - 0.82) / 0.18, 0.08, 1)
        : 1;

      taskSpot.intensity = normInt * 4.5 * powerFactor;
      bulbMat.emissiveIntensity = (0.15 + normInt * 2.4) * powerFactor;
      beamConeMat.opacity = normInt * 0.16 * powerFactor;
      (lightPool.material as THREE.MeshBasicMaterial).opacity = normInt * 0.74 * powerFactor;
      if (beamConeMesh) {
        beamConeMesh.visible = normInt * powerFactor > 0.04;
      }
      lightPool.visible = normInt * powerFactor > 0.04;

      if (cameraTransitionRef.current) {
        const presets =
          stateRef.current.archetype === 'pendant_lamp' ? PENDANT_CAMERA_PRESETS : CAMERA_PRESETS;
        const preset = presets[stateRef.current.cameraPreset];
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
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
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
  }, [product.id, product.modelAsset.geometryArchetype, profileSignature]);

  useEffect(() => {
    schedulerRef.current?.requestRender();
  }, [armAngleDeg, lightIntensityPct, assemblyMode, assemblyProgress]);

  useEffect(() => {
    applyVariantRef.current?.(selectedVariantId);
  }, [selectedVariantId]);

  useEffect(() => {
    updateDimensionsRef.current?.(showDimensions && !assemblyMode);
  }, [showDimensions, assemblyMode]);

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
        data-testid="lighting-explorer-canvas"
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
