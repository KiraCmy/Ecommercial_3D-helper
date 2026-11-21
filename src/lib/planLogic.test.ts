import test from 'node:test';
import assert from 'node:assert/strict';
import { CURATED_TEST_PRODUCTS } from '../data/catalog';
import {
  applyMerchantOverrides,
  buildShopifyEmbedConfig,
  computeAssemblyStepState,
  getStepProgress,
  parseShopifyProductJson,
  validateAndNormalizePlan,
} from './planLogic';
import { buildSceneCompositePrompt, parseDataUrlImage } from './sceneRenderer';

const lampProduct = CURATED_TEST_PRODUCTS[0];
const chairProduct = CURATED_TEST_PRODUCTS[1];
const pendantProduct = CURATED_TEST_PRODUCTS[2];

test('validateAndNormalizePlan disables arm articulation on non-articulated products even if AI tries to enable it', () => {
  const normalized = validateAndNormalizePlan(
    {
      product_type: 'dining_chair',
      template_id: 'dimension_material_explorer',
      purchase_decision_hypothesis: 'Buyers need dimensions and material swatches.',
      customer_concerns: [
        { concern: 'dimensions', label: 'Fit', priority: 1, reason: 'Check table clearance' },
      ],
      interactions: [
        {
          type: 'lamp_arm_angle_slider',
          label: 'Arm Slider',
          enabled: true,
          mode: 'verified',
          reason: 'Hallucinated arm control',
        },
        {
          type: 'material_switcher',
          label: 'Finishes',
          enabled: true,
          mode: 'verified',
          reason: '4 finishes available',
        },
      ],
    },
    chairProduct,
  );

  const arm = normalized.interactions.find((i) => i.type === 'lamp_arm_angle_slider');
  const assembly = normalized.interactions.find((i) => i.type === 'assembly_sequence');
  assert.ok(arm);
  assert.equal(arm.enabled, false);
  assert.ok(assembly?.enabled);
  assert.equal(normalized.assembly_steps.length, 4);
  assert.ok(normalized.missing_data.includes('arm_joint_structure'));
  assert.equal(normalized.template_id, 'dimension_material_explorer');
});

test('validateAndNormalizePlan disables arm slider on fixed pendant lamp and filters invalid interaction types', () => {
  const normalized = validateAndNormalizePlan(
    {
      template_id: 'lighting_explorer',
      interactions: [
        { type: 'unknown_hack_widget' as never, label: 'Bad', enabled: true, mode: 'verified', reason: 'Bad' },
        { type: 'lamp_arm_angle_slider', label: 'Arm', enabled: true, mode: 'verified', reason: 'Should disable' },
        { type: 'light_intensity_slider', label: 'Dimmer', enabled: true, mode: 'verified', reason: 'Dimming' },
      ],
    },
    pendantProduct,
  );

  assert.equal(normalized.interactions.some((i) => (i.type as string) === 'unknown_hack_widget'), false);
  const arm = normalized.interactions.find((i) => i.type === 'lamp_arm_angle_slider');
  const dimmer = normalized.interactions.find((i) => i.type === 'light_intensity_slider');
  assert.equal(arm?.enabled, false);
  assert.equal(dimmer?.enabled, true);
  assert.equal(dimmer?.mode, 'illustrative');
});

test('applyMerchantOverrides respects hardware locks while honoring merchant toggles', () => {
  const basePlan = validateAndNormalizePlan(
    {
      template_id: 'lighting_explorer',
      interactions: [
        { type: 'rotate_zoom', label: 'Orbit', enabled: true, mode: 'verified', reason: 'Orbit' },
        { type: 'lamp_arm_angle_slider', label: 'Arm', enabled: true, mode: 'verified', reason: 'Arm' },
        { type: 'light_intensity_slider', label: 'Dimmer', enabled: true, mode: 'illustrative', reason: 'Dimmer' },
        { type: 'assembly_sequence', label: 'Assembly', enabled: true, mode: 'illustrative', reason: 'Assembly' },
      ],
    },
    lampProduct,
  );

  const overridden = applyMerchantOverrides(
    basePlan,
    {
      disabledTypes: { light_intensity_slider: true },
      enabledTypes: {},
      customCtaCopy: 'Preview Lamp Reach Now',
    },
    lampProduct,
  );

  assert.equal(overridden.interactions.find((i) => i.type === 'light_intensity_slider')?.enabled, false);
  assert.equal(overridden.interactions.find((i) => i.type === 'lamp_arm_angle_slider')?.enabled, true);
  assert.equal(overridden.storefront_cta_copy, 'Preview Lamp Reach Now');
});

test('computeAssemblyStepState and getStepProgress accurately partition multi-step playback', () => {
  const start = computeAssemblyStepState(0.0, 4);
  assert.equal(start.activeStepIndex, 0);
  assert.equal(start.isComplete, false);
  assert.equal(getStepProgress(0.0, 0, 4), 0);
  assert.equal(getStepProgress(0.0, 2, 4), 0);

  const mid = computeAssemblyStepState(0.625, 4);
  assert.equal(mid.activeStepIndex, 2);
  assert.ok(Math.abs(mid.stepLocalProgress - 0.5) < 1e-6);
  assert.equal(getStepProgress(0.625, 0, 4), 1);
  assert.equal(getStepProgress(0.625, 1, 4), 1);
  assert.ok(Math.abs(getStepProgress(0.625, 2, 4) - 0.5) < 1e-6);
  assert.equal(getStepProgress(0.625, 3, 4), 0);

  const end = computeAssemblyStepState(1.0, 4);
  assert.equal(end.activeStepIndex, 3);
  assert.equal(end.isComplete, true);
});

test('parseShopifyProductJson extracts title, variants, dimensions and flags missing GLB', () => {
  const parsed = parseShopifyProductJson(
    {
      product: {
        id: 98765,
        title: 'Studio Brass Task Lamp',
        vendor: 'Nordic Light Co',
        product_type: 'Lighting',
        handle: 'studio-brass-task-lamp',
        body_html: '<p>Adjustable arm desk lamp. Height: 48 cm, Width: 16 cm.</p>',
        variants: [
          { id: 1, title: 'Matte Black', price: '189.00' },
          { id: 2, title: 'Brushed Brass', price: '209.00' },
        ],
      },
    },
    'https://demo.myshopify.com/products/studio-brass-task-lamp',
  );

  assert.equal(parsed.source, 'shopify_live');
  assert.equal(parsed.title, 'Studio Brass Task Lamp');
  assert.equal(parsed.dimensions.heightCm, 48);
  assert.equal(parsed.dimensions.widthCm, 16);
  assert.equal(parsed.variants.length, 2);
  assert.equal(parsed.modelAsset.supportsArmArticulation, true);
  assert.equal(parsed.modelAsset.status, 'missing');
});

test('buildShopifyEmbedConfig outputs valid export configuration including assembly steps', () => {
  const plan = validateAndNormalizePlan(
    {
      template_id: 'lighting_explorer',
      interactions: [
        { type: 'rotate_zoom', label: 'Orbit', enabled: true, mode: 'verified', reason: 'Orbit' },
        { type: 'light_intensity_slider', label: 'Dimmer', enabled: true, mode: 'illustrative', reason: 'Dim' },
        { type: 'assembly_sequence', label: 'Assembly', enabled: true, mode: 'illustrative', reason: 'Steps' },
      ],
    },
    lampProduct,
  );

  const exported = buildShopifyEmbedConfig(lampProduct, plan, {
    armAngleDeg: 45,
    lightIntensityPct: 80,
    selectedVariantId: 'slate-brass',
    showDimensions: true,
    showScaleReference: false,
  });

  assert.equal(exported.template_id, 'lighting_explorer');
  assert.ok('arm_angle_deg' in exported.initial_state);
  assert.equal(exported.initial_state.arm_angle_deg, 45);
  assert.equal(exported.active_interactions.length, 3);
  assert.equal(exported.assembly_steps.length, 3);
});

test('parseShopifyProductJson converts US inch dimensions and maps variant images, and validateAndNormalizePlan validates visual_3d_profile', () => {
  const parsed = parseShopifyProductJson(
    {
      product: {
        id: 55501,
        title: 'Isaac Table Lamp',
        vendor: 'Schoolhouse',
        product_type: 'Table Lamp',
        handle: 'isaac-desk-lamp',
        body_html: '<p>Adjustable brass swivels. Dimensions: 18" H, 10" W.</p>',
        images: [
          { id: 101, src: 'https://cdn.shopify.com/isaac-juniper.jpg' },
          { id: 102, src: 'https://cdn.shopify.com/isaac-laurel.jpg' },
        ],
        variants: [
          { id: 11, title: 'Juniper Gloss', price: '399.00', image_id: 101 },
          { id: 12, title: 'Laurel Gloss', price: '399.00', image_id: 102 },
        ],
      },
    },
    'https://www.schoolhouse.com/products/isaac-desk-lamp',
  );

  assert.equal(parsed.dimensions.heightCm, 46);
  assert.equal(parsed.dimensions.widthCm, 25);
  assert.equal(parsed.images.length, 2);
  assert.equal(parsed.variants[0].imageUrl, 'https://cdn.shopify.com/isaac-juniper.jpg');
  assert.equal(parsed.variants[0].roughness, 0.16);

  const normalized = validateAndNormalizePlan(
    {
      template_id: 'lighting_explorer',
      visual_3d_profile: {
        shade_profile: 'cone',
        base_profile: 'tiered_disc',
        arm_style: 'single_articulated_tube',
        chair_back_style: 'crescent_arch',
        chair_leg_style: 'tapered_round',
        has_armrests: false,
        has_cushion: false,
        finish_glossiness: 'gloss',
        primary_color_hex: '#2e5244',
        secondary_color_hex: '#c5a059',
        accent_color_hex: '#fff8eb',
        observed_materials: ['Gloss Painted Steel', 'Brass Swivels'],
        visual_details_summary: 'Conical gloss green shade with brass swivel knuckles.',
      },
      analyzed_image_count: 2,
    },
    parsed,
  );

  assert.equal(normalized.visual_3d_profile?.shade_profile, 'cone');
  assert.equal(normalized.visual_3d_profile?.finish_glossiness, 'gloss');
  assert.equal(normalized.analyzed_image_count, 2);
});

test('parseDataUrlImage parses valid base64 image URLs and rejects invalid formats', () => {
  const parsed = parseDataUrlImage('data:image/jpg;base64,QUJDRA==');
  assert.equal(parsed.mimeType, 'image/jpeg');
  assert.equal(parsed.data, 'QUJDRA==');

  const png = parseDataUrlImage('data:image/png;base64,aGVsbG8=');
  assert.equal(png.mimeType, 'image/png');
  assert.equal(png.data, 'aGVsbG8=');

  assert.throws(() => parseDataUrlImage('data:image/svg+xml;base64,PHN2Zz4='), /Unsupported image format/);
  assert.throws(() => parseDataUrlImage('not-a-data-url'), /valid PNG, JPEG, or WebP/);
});

test('buildSceneCompositePrompt embeds dimensions, lighting mood, custom note, and product ref wording', () => {
  const promptWithRef = buildSceneCompositePrompt(
    {
      productTitle: 'Isaac Table Lamp',
      productVendor: 'Schoolhouse',
      productType: 'Table Lamp',
      dimensions: { widthCm: 25, depthCm: 38, heightCm: 46, reachCm: 34 },
      variantLabel: 'Juniper',
      variantHex: '#2e6b3e',
      roomImageInput: '/assets/aistudio/image_6265c9ec.png',
      placementHint: 'Placed neatly on the back-right surface of the wooden desk',
      lightingMood: 'warm_evening',
      customPromptNote: 'Angle shade slightly toward the laptop',
    },
    true,
  );

  assert.match(promptWithRef, /Isaac Table Lamp/);
  assert.match(promptWithRef, /25 cm wide, 38 cm deep, 46 cm tall, 34 cm reach/);
  assert.match(promptWithRef, /switch any lamp product ON/i);
  assert.match(promptWithRef, /second reference image/i);
  assert.match(promptWithRef, /Angle shade slightly toward the laptop/);

  const promptNoRef = buildSceneCompositePrompt(
    {
      productTitle: 'The Gere Easy Chair',
      productVendor: 'Floyd',
      productType: 'Lounge Chair',
      variantLabel: 'Chalk',
      variantHex: '#c8c0b4',
      roomImageInput: '/assets/aistudio/image_6265c9ec.png',
      placementHint: 'Placed on the floor rug',
      lightingMood: 'match_room',
    },
    false,
  );

  assert.match(promptNoRef, /Render an authentic architectural likeness/i);
  assert.match(promptNoRef, /Strictly match the exact existing ambient light/i);
});


