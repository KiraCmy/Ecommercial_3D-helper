export type TemplateId = 'lighting_explorer' | 'dimension_material_explorer';

export type InteractionType =
  | 'rotate_zoom'
  | 'dimension_annotations'
  | 'material_switcher'
  | 'light_intensity_slider'
  | 'lamp_arm_angle_slider'
  | 'scale_reference'
  | 'assembly_sequence';

export const TEMPLATE_IDS: readonly TemplateId[] = [
  'lighting_explorer',
  'dimension_material_explorer',
] as const;

export const INTERACTION_TYPES: readonly InteractionType[] = [
  'rotate_zoom',
  'dimension_annotations',
  'material_switcher',
  'light_intensity_slider',
  'lamp_arm_angle_slider',
  'scale_reference',
  'assembly_sequence',
] as const;

export interface ProductDimensions {
  widthCm?: number;
  depthCm?: number;
  heightCm?: number;
  seatHeightCm?: number;
  reachCm?: number;
  baseDiameterCm?: number;
}

export interface ProductVariant {
  id: string;
  label: string;
  colorHex: string;
  secondaryHex?: string;
  materialType: string;
  roughness: number;
  metalness: number;
  imageUrl?: string;
  price?: string;
}

export interface ProductModelAsset {
  status: 'procedural_verified' | 'shopify_glb' | 'missing';
  url?: string;
  supportsArmArticulation: boolean;
  geometryArchetype: 'cantilever_lamp' | 'dining_chair' | 'pendant_lamp';
  note: string;
}

export interface ProductLightingSpecs {
  maxLumens?: number;
  colorTempK?: number;
  beamAngleDeg?: number;
  adjustableArmRangeDeg?: [number, number];
}

export interface ProductData {
  id: string;
  source: 'shopify_live' | 'curated_test';
  shopifyUrl?: string;
  shopifyDomain?: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  price: string;
  currency: string;
  description: string;
  thumbnailUrl: string;
  images: string[];
  dimensions: ProductDimensions;
  specs: Record<string, string>;
  variants: ProductVariant[];
  modelAsset: ProductModelAsset;
  lightingSpecs?: ProductLightingSpecs;
}

export interface Visual3DProfile {
  shade_profile: 'dome' | 'cone' | 'cylinder' | 'linear_bar' | 'globe';
  base_profile: 'tiered_disc' | 'cone_pedestal' | 'cylindrical_weighted' | 'ring_frame';
  arm_style: 'twin_cantilever' | 'single_articulated_tube' | 'curved_gooseneck' | 'fixed_stem';
  chair_back_style: 'crescent_arch' | 'slatted_spindle' | 'upholstered_shell' | 'backless_stool';
  chair_leg_style: 'tapered_round' | 'cylindrical_metal' | 'sled_frame' | 'block_plinth';
  has_armrests: boolean;
  has_cushion: boolean;
  finish_glossiness: 'gloss' | 'satin' | 'matte' | 'woven_fabric' | 'raw_wood';
  primary_color_hex: string;
  secondary_color_hex: string;
  accent_color_hex: string;
  observed_materials: string[];
  visual_details_summary: string;
}

export interface CustomerConcern {
  concern: string;
  label: string;
  priority: number;
  reason: string;
}

export interface PlannedInteraction {
  type: InteractionType;
  label: string;
  enabled: boolean;
  mode: 'verified' | 'illustrative';
  reason: string;
}

export interface AssemblyStep {
  step: number;
  title: string;
  instruction: string;
  partGroup: string;
}

export interface InteractionPlan {
  product_type: string;
  purchase_decision_hypothesis: string;
  customer_concerns: CustomerConcern[];
  template_id: TemplateId;
  interactions: PlannedInteraction[];
  assembly_steps: AssemblyStep[];
  visual_3d_profile?: Visual3DProfile;
  analyzed_image_count?: number;
  required_data: string[];
  known_data: string[];
  missing_data: string[];
  merchant_explanation: string;
  storefront_cta_copy: string;
  source?: 'gemini_live' | 'snapshot_fallback';
}

export interface MerchantOverrides {
  disabledTypes: Record<string, boolean>;
  enabledTypes: Record<string, boolean>;
  customCtaCopy?: string;
}
