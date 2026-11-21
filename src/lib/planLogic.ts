import {
  DEFAULT_ASSEMBLY_STEPS_BY_ARCHETYPE,
  DEFAULT_VISUAL_PROFILE_BY_ARCHETYPE,
} from '../data/catalog';
import {
  INTERACTION_TYPES,
  TEMPLATE_IDS,
  type AssemblyStep,
  type InteractionPlan,
  type InteractionType,
  type MerchantOverrides,
  type PlannedInteraction,
  type ProductData,
  type ProductVariant,
  type TemplateId,
  type Visual3DProfile,
} from '../types/commerce';

const DEFAULT_INTERACTION_LABELS: Record<InteractionType, string> = {
  rotate_zoom: '360° Orbit & Zoom',
  dimension_annotations: 'Dimension Callouts',
  material_switcher: 'Material & Finish Switcher',
  light_intensity_slider: 'Light Intensity & Spread',
  lamp_arm_angle_slider: 'Arm Articulation Angle',
  scale_reference: 'Human Scale Reference (175 cm)',
  assembly_sequence: 'Step-by-Step 3D Assembly',
};

export function isValidTemplateId(value: unknown): value is TemplateId {
  return typeof value === 'string' && (TEMPLATE_IDS as readonly string[]).includes(value);
}

export function isValidInteractionType(value: unknown): value is InteractionType {
  return typeof value === 'string' && (INTERACTION_TYPES as readonly string[]).includes(value);
}

export function inferFallbackTemplateId(product: ProductData): TemplateId {
  const haystack = `${product.productType} ${product.title} ${product.description}`.toLowerCase();
  if (
    product.lightingSpecs ||
    /\b(lamp|light|lighting|sconce|pendant|chandelier|luminaire)\b/.test(haystack)
  ) {
    return 'lighting_explorer';
  }
  return 'dimension_material_explorer';
}

/**
 * Computes active step index and normalized local progress [0..1] within the current step
 * for smooth multi-step animated 3D assembly playback.
 */
export function computeAssemblyStepState(
  progress01: number,
  totalSteps: number,
): { activeStepIndex: number; stepLocalProgress: number; isComplete: boolean } {
  const safeSteps = Math.max(1, totalSteps);
  const clamped = Math.min(1, Math.max(0, progress01));
  if (clamped >= 0.999) {
    return { activeStepIndex: safeSteps - 1, stepLocalProgress: 1, isComplete: true };
  }
  const scaled = clamped * safeSteps;
  const activeStepIndex = Math.min(safeSteps - 1, Math.floor(scaled));
  const stepLocalProgress = scaled - activeStepIndex;
  return { activeStepIndex, stepLocalProgress, isComplete: false };
}

/**
 * Returns local progress [0..1] for a specific 0-based step index given global assembly progress.
 */
export function getStepProgress(
  globalProgress01: number,
  stepIndex: number,
  totalSteps: number,
): number {
  const safeSteps = Math.max(1, totalSteps);
  const start = stepIndex / safeSteps;
  const span = 1 / safeSteps;
  return Math.min(1, Math.max(0, (globalProgress01 - start) / span));
}

/**
 * Stage 4 Validation: Enforces schema whitelists and physical/data constraints so Gemini
 * never enables unsupported 3D capabilities (e.g., arm angle on a chair or fixed pendant).
 */
export function validateAndNormalizePlan(
  raw: Partial<InteractionPlan> | Record<string, unknown>,
  product: ProductData,
): InteractionPlan {
  const templateId: TemplateId = isValidTemplateId(raw.template_id)
    ? raw.template_id
    : inferFallbackTemplateId(product);

  const missingDataSet = new Set<string>(
    Array.isArray(raw.missing_data)
      ? raw.missing_data.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
  );

  const knownDataSet = new Set<string>(
    Array.isArray(raw.known_data)
      ? raw.known_data.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [],
  );

  if (product.dimensions.widthCm) knownDataSet.add(`widthCm: ${product.dimensions.widthCm} cm`);
  if (product.dimensions.depthCm) knownDataSet.add(`depthCm: ${product.dimensions.depthCm} cm`);
  if (product.dimensions.heightCm) knownDataSet.add(`heightCm: ${product.dimensions.heightCm} cm`);
  if (product.dimensions.seatHeightCm) knownDataSet.add(`seatHeightCm: ${product.dimensions.seatHeightCm} cm`);
  if (product.lightingSpecs?.maxLumens) knownDataSet.add(`maxLumens: ${product.lightingSpecs.maxLumens} lm`);
  if (product.modelAsset.status === 'missing') {
    missingDataSet.add('verified_3d_glb_asset');
  }

  const hasDimensions = Boolean(
    product.dimensions.widthCm || product.dimensions.heightCm || product.dimensions.depthCm,
  );
  if (!hasDimensions) {
    missingDataSet.add('verified_product_dimensions');
  }

  const rawInteractions = Array.isArray(raw.interactions) ? raw.interactions : [];
  const seenTypes = new Set<InteractionType>();
  const normalizedInteractions: PlannedInteraction[] = [];

  for (const item of rawInteractions) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (!isValidInteractionType(candidate.type)) continue;
    if (seenTypes.has(candidate.type)) continue;
    seenTypes.add(candidate.type);

    let enabled = Boolean(candidate.enabled);
    let mode: 'verified' | 'illustrative' =
      candidate.mode === 'illustrative' ? 'illustrative' : 'verified';
    let reason =
      typeof candidate.reason === 'string' && candidate.reason.trim().length > 0
        ? candidate.reason.trim()
        : 'Recommended based on product structure.';
    const label =
      typeof candidate.label === 'string' && candidate.label.trim().length > 0
        ? candidate.label.trim()
        : DEFAULT_INTERACTION_LABELS[candidate.type];

    // Enforce capability guardrails against actual product data
    if (candidate.type === 'lamp_arm_angle_slider' && !product.modelAsset.supportsArmArticulation) {
      enabled = false;
      mode = 'verified';
      reason = 'Disabled: product asset has no verified articulated arm joint structure.';
      missingDataSet.add('arm_joint_structure');
    }

    if (candidate.type === 'material_switcher' && product.variants.length < 2) {
      enabled = false;
      reason = 'Disabled: fewer than 2 finish variants provided in product data.';
      missingDataSet.add('additional_variant_swatches');
    }

    if (candidate.type === 'dimension_annotations' && !hasDimensions) {
      enabled = false;
      reason = 'Disabled: verified physical dimensions are missing from product specifications.';
    }

    if (candidate.type === 'light_intensity_slider') {
      if (templateId !== 'lighting_explorer') {
        enabled = false;
        reason = 'Disabled: light exploration applies only to lighting fixtures.';
      } else {
        mode = 'illustrative';
      }
    }

    if (candidate.type === 'scale_reference' && enabled) {
      mode = 'illustrative';
    }

    if (candidate.type === 'assembly_sequence' && enabled) {
      mode = 'illustrative';
    }

    normalizedInteractions.push({
      type: candidate.type,
      label,
      enabled,
      mode,
      reason,
    });
  }

  // Ensure rotate_zoom always exists as baseline inspection capability
  if (!seenTypes.has('rotate_zoom')) {
    normalizedInteractions.unshift({
      type: 'rotate_zoom',
      label: DEFAULT_INTERACTION_LABELS.rotate_zoom,
      enabled: true,
      mode: 'verified',
      reason: 'Baseline 3D orbit and zoom inspection.',
    });
  }

  // Ensure assembly_sequence is available for multi-part modular hardware/furniture
  if (!seenTypes.has('assembly_sequence')) {
    normalizedInteractions.push({
      type: 'assembly_sequence',
      label: DEFAULT_INTERACTION_LABELS.assembly_sequence,
      enabled: true,
      mode: 'illustrative',
      reason: 'Interactive step-by-step 3D assembly guide replaces static printed instructions.',
    });
  }

  const defaultSteps =
    DEFAULT_ASSEMBLY_STEPS_BY_ARCHETYPE[product.modelAsset.geometryArchetype] ??
    DEFAULT_ASSEMBLY_STEPS_BY_ARCHETYPE.dining_chair;

  const rawAssemblySteps = Array.isArray(raw.assembly_steps) ? raw.assembly_steps : [];
  const parsedAssemblySteps: AssemblyStep[] = rawAssemblySteps
    .filter((s): s is Record<string, unknown> => Boolean(s && typeof s === 'object'))
    .map((s, idx) => ({
      step: typeof s.step === 'number' && Number.isFinite(s.step) ? s.step : idx + 1,
      title:
        typeof s.title === 'string' && s.title.trim()
          ? s.title.trim()
          : defaultSteps[idx]?.title ?? `Assembly Step ${idx + 1}`,
      instruction:
        typeof s.instruction === 'string' && s.instruction.trim()
          ? s.instruction.trim()
          : defaultSteps[idx]?.instruction ?? 'Align and fasten component.',
      partGroup:
        typeof s.partGroup === 'string' && s.partGroup.trim()
          ? s.partGroup.trim()
          : defaultSteps[idx]?.partGroup ?? `part_${idx + 1}`,
    }))
    .sort((a, b) => a.step - b.step)
    .slice(0, defaultSteps.length);

  const assemblySteps =
    parsedAssemblySteps.length >= 2 ? parsedAssemblySteps : defaultSteps;

  const rawConcerns = Array.isArray(raw.customer_concerns) ? raw.customer_concerns : [];
  const customerConcerns = rawConcerns
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
    .map((c, index) => ({
      concern: typeof c.concern === 'string' && c.concern.trim() ? c.concern.trim() : `concern_${index + 1}`,
      label:
        typeof c.label === 'string' && c.label.trim()
          ? c.label.trim()
          : typeof c.concern === 'string'
            ? c.concern.replace(/_/g, ' ')
            : `Buyer Concern ${index + 1}`,
      priority: typeof c.priority === 'number' && Number.isFinite(c.priority) ? c.priority : index + 1,
      reason:
        typeof c.reason === 'string' && c.reason.trim()
          ? c.reason.trim()
          : 'Impacts pre-purchase confidence.',
    }))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 4);

  const requiredData = Array.isArray(raw.required_data)
    ? raw.required_data.filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    : ['3d_model', 'dimensions'];

  const defaultProfile =
    DEFAULT_VISUAL_PROFILE_BY_ARCHETYPE[product.modelAsset.geometryArchetype] ??
    DEFAULT_VISUAL_PROFILE_BY_ARCHETYPE.dining_chair;

  const rawProfile =
    raw.visual_3d_profile && typeof raw.visual_3d_profile === 'object'
      ? (raw.visual_3d_profile as Record<string, unknown>)
      : null;

  const pickEnum = <T extends string>(val: unknown, allowed: readonly T[], fallback: T): T =>
    typeof val === 'string' && (allowed as readonly string[]).includes(val) ? (val as T) : fallback;

  const pickHex = (val: unknown, fallback: string): string =>
    typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val.trim()) ? val.trim() : fallback;

  const visualProfile: Visual3DProfile = {
    shade_profile: pickEnum(
      rawProfile?.shade_profile,
      ['dome', 'cone', 'cylinder', 'linear_bar', 'globe'] as const,
      defaultProfile.shade_profile,
    ),
    base_profile: pickEnum(
      rawProfile?.base_profile,
      ['tiered_disc', 'cone_pedestal', 'cylindrical_weighted', 'ring_frame'] as const,
      defaultProfile.base_profile,
    ),
    arm_style: pickEnum(
      rawProfile?.arm_style,
      ['twin_cantilever', 'single_articulated_tube', 'curved_gooseneck', 'fixed_stem'] as const,
      defaultProfile.arm_style,
    ),
    chair_back_style: pickEnum(
      rawProfile?.chair_back_style,
      ['crescent_arch', 'slatted_spindle', 'upholstered_shell', 'backless_stool'] as const,
      defaultProfile.chair_back_style,
    ),
    chair_leg_style: pickEnum(
      rawProfile?.chair_leg_style,
      ['tapered_round', 'cylindrical_metal', 'sled_frame', 'block_plinth'] as const,
      defaultProfile.chair_leg_style,
    ),
    has_armrests:
      typeof rawProfile?.has_armrests === 'boolean'
        ? rawProfile.has_armrests
        : defaultProfile.has_armrests,
    has_cushion:
      typeof rawProfile?.has_cushion === 'boolean'
        ? rawProfile.has_cushion
        : defaultProfile.has_cushion,
    finish_glossiness: pickEnum(
      rawProfile?.finish_glossiness,
      ['gloss', 'satin', 'matte', 'woven_fabric', 'raw_wood'] as const,
      defaultProfile.finish_glossiness,
    ),
    primary_color_hex: pickHex(rawProfile?.primary_color_hex, defaultProfile.primary_color_hex),
    secondary_color_hex: pickHex(rawProfile?.secondary_color_hex, defaultProfile.secondary_color_hex),
    accent_color_hex: pickHex(rawProfile?.accent_color_hex, defaultProfile.accent_color_hex),
    observed_materials: Array.isArray(rawProfile?.observed_materials)
      ? rawProfile.observed_materials
          .filter((m): m is string => typeof m === 'string' && m.trim().length > 0)
          .slice(0, 5)
      : defaultProfile.observed_materials,
    visual_details_summary:
      typeof rawProfile?.visual_details_summary === 'string' &&
      rawProfile.visual_details_summary.trim().length > 0
        ? rawProfile.visual_details_summary.trim()
        : defaultProfile.visual_details_summary,
  };

  return {
    product_type:
      typeof raw.product_type === 'string' && raw.product_type.trim()
        ? raw.product_type.trim()
        : product.productType.toLowerCase().replace(/\s+/g, '_'),
    purchase_decision_hypothesis:
      typeof raw.purchase_decision_hypothesis === 'string' && raw.purchase_decision_hypothesis.trim()
        ? raw.purchase_decision_hypothesis.trim()
        : 'Customers need spatial, functional, and assembly clarity before purchasing.',
    customer_concerns: customerConcerns,
    template_id: templateId,
    interactions: normalizedInteractions,
    assembly_steps: assemblySteps,
    visual_3d_profile: visualProfile,
    analyzed_image_count:
      typeof raw.analyzed_image_count === 'number' && Number.isFinite(raw.analyzed_image_count)
        ? raw.analyzed_image_count
        : 0,
    required_data: requiredData,
    known_data: Array.from(knownDataSet),
    missing_data: Array.from(missingDataSet),
    merchant_explanation:
      typeof raw.merchant_explanation === 'string' && raw.merchant_explanation.trim()
        ? raw.merchant_explanation.trim()
        : 'Selected the 3D interaction template that directly addresses top buyer uncertainty.',
    storefront_cta_copy:
      typeof raw.storefront_cta_copy === 'string' && raw.storefront_cta_copy.trim()
        ? raw.storefront_cta_copy.trim()
        : 'Explore Product in Interactive 3D',
    source: raw.source === 'snapshot_fallback' ? 'snapshot_fallback' : 'gemini_live',
  };
}

/**
 * Applies merchant toggle overrides cleanly without mutating the underlying AI plan.
 */
export function applyMerchantOverrides(
  plan: InteractionPlan,
  overrides: MerchantOverrides,
  product: ProductData,
): InteractionPlan {
  const interactions = plan.interactions.map((item) => {
    const hardwareBlocked =
      (item.type === 'lamp_arm_angle_slider' && !product.modelAsset.supportsArmArticulation) ||
      (item.type === 'material_switcher' && product.variants.length < 2);

    if (hardwareBlocked) {
      return { ...item, enabled: false };
    }

    if (overrides.disabledTypes[item.type]) {
      return { ...item, enabled: false };
    }
    if (overrides.enabledTypes[item.type]) {
      return { ...item, enabled: true };
    }
    return item;
  });

  return {
    ...plan,
    interactions,
    storefront_cta_copy:
      overrides.customCtaCopy !== undefined && overrides.customCtaCopy.trim().length > 0
        ? overrides.customCtaCopy.trim()
        : plan.storefront_cta_copy,
  };
}

export function isInteractionActive(plan: InteractionPlan | null, type: InteractionType): boolean {
  if (!plan) return false;
  const found = plan.interactions.find((i) => i.type === type);
  return Boolean(found?.enabled);
}

export function buildShopifyEmbedConfig(
  product: ProductData,
  effectivePlan: InteractionPlan,
  previewState: {
    armAngleDeg: number;
    lightIntensityPct: number;
    selectedVariantId: string;
    showDimensions: boolean;
    showScaleReference: boolean;
  },
) {
  return {
    schema_version: '1.1',
    shopify_product_handle: product.handle,
    shopify_product_url: product.shopifyUrl ?? null,
    template_id: effectivePlan.template_id,
    storefront_cta_copy: effectivePlan.storefront_cta_copy,
    purchase_decision_hypothesis: effectivePlan.purchase_decision_hypothesis,
    active_interactions: effectivePlan.interactions
      .filter((i) => i.enabled)
      .map((i) => ({ type: i.type, mode: i.mode })),
    assembly_steps: isInteractionActive(effectivePlan, 'assembly_sequence')
      ? effectivePlan.assembly_steps
      : [],
    initial_state: {
      variant_id: previewState.selectedVariantId,
      show_dimensions: previewState.showDimensions,
      ...(effectivePlan.template_id === 'lighting_explorer'
        ? {
            arm_angle_deg: previewState.armAngleDeg,
            light_intensity_pct: previewState.lightIntensityPct,
          }
        : {
            show_scale_reference: previewState.showScaleReference,
          }),
    },
    missing_data_warnings: effectivePlan.missing_data,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const COLOR_MAP: Record<string, string> = {
  black: '#1f2326',
  obsidian: '#222629',
  charcoal: '#3a3e42',
  granite: '#565a5f',
  slate: '#4b5563',
  white: '#f4f4f0',
  chalk: '#b4ab9e',
  candlenut: '#e4dccb',
  ivory: '#f5f0e6',
  cream: '#efe8d8',
  oatmeal: '#dfd6c7',
  beige: '#d8cbb8',
  oak: '#c7a67b',
  walnut: '#5c402d',
  birch: '#d8be98',
  ash: '#ccb799',
  brass: '#c5a059',
  gold: '#c8a454',
  bronze: '#8c6844',
  cognac: '#9a5b32',
  tan: '#b67d50',
  persimmon: '#c45136',
  claycourt: '#c76444',
  terracotta: '#b85c42',
  port: '#73292d',
  red: '#9b3634',
  juniper: '#2e6b3e',
  laurel: '#6f8564',
  olive: '#5c6648',
  sage: '#7e8f85',
  emerald: '#2d5c4a',
  green: '#4c6b58',
  pool: '#4c8ca0',
  cobalt: '#2e5180',
  blue: '#3d5a73',
  navy: '#253447',
  posset: '#dfc477',
  yellow: '#d8b44e',
  pink: '#d49a9c',
  grey: '#868c91',
  gray: '#868c91',
  silver: '#b8bec4',
  steel: '#8e959c',
  chrome: '#cfd4da',
};

function inferHexFromVariantName(name: string, index: number): string {
  const lower = name.toLowerCase();
  for (const [key, hex] of Object.entries(COLOR_MAP)) {
    if (lower.includes(key)) return hex;
  }
  const palette = ['#2c3034', '#c7a67b', '#7e8f85', '#9a5b32'];
  return palette[index % palette.length];
}

function inferMaterialRoughness(label: string, isLighting: boolean): { roughness: number; metalness: number } {
  const lower = label.toLowerCase();
  if (lower.includes('gloss')) return { roughness: 0.16, metalness: isLighting ? 0.35 : 0.08 };
  if (lower.includes('brass') || lower.includes('chrome') || lower.includes('steel')) {
    return { roughness: 0.24, metalness: 0.88 };
  }
  if (lower.includes('satin')) return { roughness: 0.38, metalness: isLighting ? 0.45 : 0.05 };
  if (lower.includes('leather')) return { roughness: 0.5, metalness: 0.04 };
  if (lower.includes('boucl') || lower.includes('linen') || lower.includes('wool') || lower.includes('fabric')) {
    return { roughness: 0.86, metalness: 0.0 };
  }
  return { roughness: isLighting ? 0.44 : 0.68, metalness: isLighting ? 0.45 : 0.04 };
}

function extractDimensionsFromText(text: string): ProductData['dimensions'] {
  const dims: ProductData['dimensions'] = {};
  const hMatch = text.match(/(?:height|h)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\s*cm/i);
  const wMatch = text.match(/(?:width|w|diameter|dia)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\s*cm/i);
  const dMatch = text.match(/(?:depth|d)\s*[:=]?\s*(\d{2,3}(?:\.\d+)?)\s*cm/i);
  if (hMatch) dims.heightCm = Math.round(Number(hMatch[1]));
  if (wMatch) dims.widthCm = Math.round(Number(wMatch[1]));
  if (dMatch) dims.depthCm = Math.round(Number(dMatch[1]));

  // Also parse US Shopify inch dimensions (e.g. 18" H x 12" W or 29.5" H)
  if (!dims.heightCm) {
    const hIn = text.match(/(\d{1,2}(?:\.\d+)?)\s*(?:"|”|in\.?|inches)\s*(?:H|height|tall)/i)
      ?? text.match(/(?:height|H)\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|”|in\.?|inches)/i);
    if (hIn) dims.heightCm = Math.round(Number(hIn[1]) * 2.54);
  }
  if (!dims.widthCm) {
    const wIn = text.match(/(\d{1,2}(?:\.\d+)?)\s*(?:"|”|in\.?|inches)\s*(?:W|width|Dia|diameter)/i)
      ?? text.match(/(?:width|diameter|W)\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|”|in\.?|inches)/i);
    if (wIn) dims.widthCm = Math.round(Number(wIn[1]) * 2.54);
  }
  if (!dims.depthCm) {
    const dIn = text.match(/(\d{1,2}(?:\.\d+)?)\s*(?:"|”|in\.?|inches)\s*(?:D|depth)/i)
      ?? text.match(/(?:depth|D)\s*[:=]?\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|”|in\.?|inches)/i);
    if (dIn) dims.depthCm = Math.round(Number(dIn[1]) * 2.54);
  }
  return dims;
}

export interface ShopifyRawProductNode {
  id?: number | string;
  title?: string;
  body_html?: string;
  vendor?: string;
  product_type?: string;
  handle?: string;
  tags?: string[] | string;
  images?: Array<{ id?: number | string; src?: string }>;
  variants?: Array<{
    id?: number | string;
    title?: string;
    price?: string;
    option1?: string | null;
    option2?: string | null;
    image_id?: number | string | null;
    featured_image?: { src?: string } | null;
  }>;
}

export interface ShopifyRawProductPayload {
  product?: ShopifyRawProductNode;
}

export function parseShopifyProductItem(
  p: ShopifyRawProductNode,
  sourceUrl: string,
): ProductData {
  if (!p || !p.title) {
    throw new Error('Shopify product payload is missing required title field.');
  }

  let domain = '';
  try {
    domain = new URL(sourceUrl).hostname.replace(/^www\./, '');
  } catch {
    domain = 'shopify-store';
  }

  const description = stripHtml(p.body_html ?? '').slice(0, 700);
  const combinedText = `${p.title} ${p.product_type ?? ''} ${description}`;
  const isPendant = /\b(pendant|chandelier|suspension)\b/i.test(combinedText);
  const isLighting =
    isPendant || /\b(lamp|light|lighting|sconce|luminaire|desk lamp|table lamp)\b/i.test(combinedText);
  const hasArticulatedArm =
    isLighting &&
    !isPendant &&
    /\b(articulated|cantilever|adjustable|swivel|swing arm|pivot|task lamp|desk lamp)\b/i.test(
      combinedText,
    );

  const imageMapById = new Map<string, string>();
  const galleryImages: string[] = [];
  for (const img of p.images ?? []) {
    if (img?.src && typeof img.src === 'string') {
      if (img.id !== undefined) {
        imageMapById.set(String(img.id), img.src);
      }
      if (!galleryImages.includes(img.src)) {
        galleryImages.push(img.src);
      }
    }
  }

  const rawVariants = Array.isArray(p.variants) && p.variants.length > 0 ? p.variants : [];
  const variants: ProductVariant[] =
    rawVariants.length > 0
      ? rawVariants.slice(0, 6).map((v, idx) => {
          const label = v.title && v.title !== 'Default Title' ? v.title : 'Standard Finish';
          const finishProps = inferMaterialRoughness(label, isLighting);
          const matchedImage =
            v.featured_image?.src ||
            (v.image_id ? imageMapById.get(String(v.image_id)) : undefined) ||
            galleryImages[idx];
          return {
            id: String(v.id ?? `variant-${idx}`),
            label,
            colorHex: inferHexFromVariantName(label, idx),
            secondaryHex: isLighting ? '#c5a059' : '#c7a67b',
            materialType: p.product_type || 'Catalog Material',
            roughness: finishProps.roughness,
            metalness: finishProps.metalness,
            imageUrl: matchedImage,
            price: v.price,
          };
        })
      : [
          {
            id: 'default',
            label: 'Standard Catalog Finish',
            colorHex: '#3a3e42',
            secondaryHex: '#c7a67b',
            materialType: p.product_type || 'Standard',
            roughness: 0.6,
            metalness: 0.1,
            imageUrl: galleryImages[0],
          },
        ];

  const dimensions = extractDimensionsFromText(description);
  const price = rawVariants[0]?.price ?? '0.00';
  const fallbackThumb = isLighting
    ? '/src/assets/images/product_desk_lamp_1795283498660.jpg'
    : '/src/assets/images/product_dining_chair_1795283500087.jpg';
  const thumbnailUrl = galleryImages[0] || fallbackThumb;
  const images = galleryImages.length > 0 ? galleryImages.slice(0, 6) : [fallbackThumb];

  return {
    id: `shopify-${p.id ?? p.handle ?? Date.now()}`,
    source: 'shopify_live',
    shopifyUrl: sourceUrl,
    shopifyDomain: domain,
    handle: p.handle || 'shopify-product',
    title: p.title,
    vendor: p.vendor || 'Shopify Merchant',
    productType: p.product_type || (isLighting ? 'Lighting' : 'Furniture & Home'),
    price,
    currency: 'USD',
    description: description || 'Imported directly from live Shopify Storefront API.',
    thumbnailUrl,
    images,
    dimensions,
    specs: {
      Source: `Shopify API (${domain})`,
      Vendor: p.vendor || 'Merchant',
      Variants: `${rawVariants.length || variants.length} finishes`,
      Photos: `${images.length} product photos`,
    },
    variants,
    modelAsset: {
      status: 'missing',
      supportsArmArticulation: hasArticulatedArm,
      geometryArchetype: isLighting
        ? isPendant
          ? 'pendant_lamp'
          : 'cantilever_lamp'
        : 'dining_chair',
      note: 'Reconstructed from live Shopify product specs & photography via Gemini Vision.',
    },
    lightingSpecs: isLighting
      ? {
          maxLumens: isPendant ? 1100 : 800,
          colorTempK: isPendant ? 2700 : 3000,
          ...(hasArticulatedArm ? { adjustableArmRangeDeg: [15, 75] as [number, number] } : {}),
        }
      : undefined,
  };
}

export function parseShopifyProductJson(
  payload: ShopifyRawProductPayload,
  sourceUrl: string,
): ProductData {
  if (!payload.product) {
    throw new Error('Shopify product payload is missing required product object.');
  }
  return parseShopifyProductItem(payload.product, sourceUrl);
}
