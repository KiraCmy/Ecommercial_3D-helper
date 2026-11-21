import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import type { InteractionPlan, ProductData } from '../types/commerce';
import { validateAndNormalizePlan } from './planLogic';

const SYSTEM_INSTRUCTION = `You are an AI Interaction Designer & Visual 3D Reconstruction Architect for Shopify 3D Commerce.
Your core question: "What does a customer need to understand about this specific product before deciding to buy it?"
You will receive BOTH structured Shopify product data AND the real product photography.

Execute four strict stages:
1. Understand & Inspect Visuals:
   - Carefully examine the provided product photo(s) alongside title, vendor, materials, dimensions, and variants.
   - Extract an accurate "visual_3d_profile" strictly from what you visually observe in the photos so our procedural 3D stage reconstructs the real silhouette, proportions, shade/backrest shape, base/leg geometry, finish glossiness, and true colors.
   - Only include materials in observed_materials if they are actually visible in the photos or explicitly listed in specs (never infer wood from product names like "Atwood").
   - Never invent unverified numeric specs; only cite dimensions or specs present in the input.
2. Reason:
   - Formulate 1 clear Purchase Decision Hypothesis and 2-3 prioritized customer concerns explaining what uncertainty blocks purchase (referencing real visual features and self-assembly clarity).
3. Plan:
   - Choose the best template_id from ["lighting_explorer", "dimension_material_explorer"] and select interactions ONLY from:
     - rotate_zoom
     - dimension_annotations
     - material_switcher
     - light_intensity_slider
     - lamp_arm_angle_slider
     - scale_reference
     - assembly_sequence (animated step-by-step 3D assembly guide replacing static paper diagrams)
4. Validate:
   - Check modelAsset.supportsArmArticulation, dimensions, and variant counts.
   - If supportsArmArticulation is false, set lamp_arm_angle_slider enabled=false and explain why in reason and missing_data.
   - For lighting fixtures (desk/table lamps, pendants, sconces), choose "lighting_explorer".
   - For furniture, seating, stools, and dimensional objects, choose "dimension_material_explorer".
   - Mark illustrative simulations (light spread visualization, 175 cm human scale reference, and assembly_sequence) with mode="illustrative".
   - Output assembly_steps in exact physical bottom-to-top / base-to-detail installation order (3 steps for lamps/pendants: Base/Canopy -> Stem/Boom or Shade -> Shade/Diffuser; 4 steps for barrel lounge chairs: Base Ring -> Upholstered Barrel Shell -> Seat Cushion -> Lumbar Cushion; 4 steps for 4-leg chairs: Legs -> Stretchers/Hardware -> Seat -> Backrest).
Keep copy concise, editorial, and merchant-ready.`;

const INTERACTION_PLAN_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    product_type: {
      type: Type.STRING,
      description: 'Concise snake_case product category such as table_lamp, desk_lamp, lounge_chair, dining_chair, pendant_lamp.',
    },
    purchase_decision_hypothesis: {
      type: Type.STRING,
      description: '1-2 sentence hypothesis about what buyers struggle to judge from static photos before buying.',
    },
    customer_concerns: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          concern: { type: Type.STRING },
          label: { type: Type.STRING },
          priority: { type: Type.INTEGER },
          reason: { type: Type.STRING },
        },
        required: ['concern', 'label', 'priority', 'reason'],
      },
    },
    template_id: {
      type: Type.STRING,
      enum: ['lighting_explorer', 'dimension_material_explorer'],
    },
    visual_3d_profile: {
      type: Type.OBJECT,
      description: 'Visual geometry, materials, and exact colors observed directly in the product photography.',
      properties: {
        shade_profile: {
          type: Type.STRING,
          enum: ['dome', 'cone', 'cylinder', 'linear_bar', 'globe'],
        },
        base_profile: {
          type: Type.STRING,
          enum: ['tiered_disc', 'cone_pedestal', 'cylindrical_weighted', 'ring_frame'],
        },
        arm_style: {
          type: Type.STRING,
          enum: ['twin_cantilever', 'single_articulated_tube', 'curved_gooseneck', 'fixed_stem'],
        },
        chair_back_style: {
          type: Type.STRING,
          enum: ['crescent_arch', 'slatted_spindle', 'upholstered_shell', 'backless_stool'],
        },
        chair_leg_style: {
          type: Type.STRING,
          enum: ['tapered_round', 'cylindrical_metal', 'sled_frame', 'block_plinth'],
        },
        has_armrests: { type: Type.BOOLEAN },
        has_cushion: { type: Type.BOOLEAN },
        finish_glossiness: {
          type: Type.STRING,
          enum: ['gloss', 'satin', 'matte', 'woven_fabric', 'raw_wood'],
        },
        primary_color_hex: {
          type: Type.STRING,
          description: 'Primary body/shade/upholstery #RRGGBB hex color observed in the hero photo.',
        },
        secondary_color_hex: {
          type: Type.STRING,
          description: 'Secondary trim/frame/hardware #RRGGBB hex color observed in the hero photo.',
        },
        accent_color_hex: {
          type: Type.STRING,
          description: 'Accent detail/piping/diffuser #RRGGBB hex color observed in the hero photo.',
        },
        observed_materials: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
        visual_details_summary: {
          type: Type.STRING,
          description: '1 crisp sentence summarizing physical design details observed in the real product photo.',
        },
      },
      required: [
        'shade_profile',
        'base_profile',
        'arm_style',
        'chair_back_style',
        'chair_leg_style',
        'has_armrests',
        'has_cushion',
        'finish_glossiness',
        'primary_color_hex',
        'secondary_color_hex',
        'accent_color_hex',
        'observed_materials',
        'visual_details_summary',
      ],
    },
    interactions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: {
            type: Type.STRING,
            enum: [
              'rotate_zoom',
              'dimension_annotations',
              'material_switcher',
              'light_intensity_slider',
              'lamp_arm_angle_slider',
              'scale_reference',
              'assembly_sequence',
            ],
          },
          label: { type: Type.STRING },
          enabled: { type: Type.BOOLEAN },
          mode: {
            type: Type.STRING,
            enum: ['verified', 'illustrative'],
          },
          reason: { type: Type.STRING },
        },
        required: ['type', 'label', 'enabled', 'mode', 'reason'],
      },
    },
    assembly_steps: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          step: { type: Type.INTEGER },
          title: { type: Type.STRING },
          instruction: { type: Type.STRING },
          partGroup: { type: Type.STRING },
        },
        required: ['step', 'title', 'instruction', 'partGroup'],
      },
    },
    required_data: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    known_data: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    missing_data: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    merchant_explanation: {
      type: Type.STRING,
      description: 'Why this interaction setup was selected over a generic 360 viewer.',
    },
    storefront_cta_copy: {
      type: Type.STRING,
      description: 'Short buyer-facing button copy for the Shopify PDP, max 6 words.',
    },
  },
  required: [
    'product_type',
    'purchase_decision_hypothesis',
    'customer_concerns',
    'template_id',
    'visual_3d_profile',
    'interactions',
    'assembly_steps',
    'required_data',
    'known_data',
    'missing_data',
    'merchant_explanation',
    'storefront_cta_copy',
  ],
};

export class MissingGeminiKeyError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not configured in server environment.');
    this.name = 'MissingGeminiKeyError';
  }
}

interface InlineImagePart {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

function optimizeShopifyImageUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    if (u.hostname.includes('cdn.shopify.com') && !u.searchParams.has('width')) {
      u.searchParams.set('width', '900');
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}

async function fetchProductImageParts(product: ProductData): Promise<InlineImagePart[]> {
  const candidates = (
    product.images && product.images.length > 0 ? product.images : [product.thumbnailUrl]
  )
    .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
    .slice(0, 2);

  const parts: InlineImagePart[] = [];

  for (const url of candidates) {
    try {
      if (url.startsWith('/')) {
        const localPath = path.resolve(process.cwd(), url.replace(/^\//, ''));
        if (fs.existsSync(localPath)) {
          const buf = fs.readFileSync(localPath);
          const ext = path.extname(localPath).toLowerCase();
          const mimeType =
            ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          parts.push({
            inlineData: {
              mimeType,
              data: buf.toString('base64'),
            },
          });
        }
        continue;
      }

      if (!/^https?:\/\//i.test(url)) continue;
      const targetUrl = optimizeShopifyImageUrl(url);
      const res = await fetch(targetUrl, {
        signal: AbortSignal.timeout(4500),
        headers: { 'User-Agent': 'Adaptive3DCommerce/1.0' },
      });
      if (!res.ok) continue;

      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(contentType)) {
        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > 4 * 1024 * 1024) continue;

      parts.push({
        inlineData: {
          mimeType: contentType === 'image/jpg' ? 'image/jpeg' : contentType,
          data: buf.toString('base64'),
        },
      });
    } catch {
      // Skip unreachable image cleanly and continue with remaining images/text
    }
  }

  return parts;
}

export async function generateInteractionPlan(product: ProductData): Promise<InteractionPlan> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingGeminiKeyError();
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const promptPayload = {
    title: product.title,
    vendor: product.vendor,
    productType: product.productType,
    price: `${product.price} ${product.currency}`,
    description: product.description,
    dimensions: product.dimensions,
    specs: product.specs,
    variants: product.variants.map((v) => ({
      id: v.id,
      label: v.label,
      materialType: v.materialType,
      colorHex: v.colorHex,
    })),
    modelAsset: {
      status: product.modelAsset.status,
      supportsArmArticulation: product.modelAsset.supportsArmArticulation,
      note: product.modelAsset.note,
    },
    lightingSpecs: product.lightingSpecs ?? null,
  };

  const imageParts = await fetchProductImageParts(product);
  const textPart = {
    text:
      `Analyze the attached real Shopify product photo(s) (${imageParts.length} image(s)) together with the structured product metadata below. ` +
      `Return a structured 3D InteractionPlan JSON with visual_3d_profile grounded directly in what you see in the product photo(s):\n\n` +
      `${JSON.stringify(promptPayload, null, 2)}`,
  };

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [...imageParts, textPart],
    },
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: INTERACTION_PLAN_SCHEMA,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error('Gemini returned an empty response body.');
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Gemini returned malformed JSON that failed schema parsing.');
  }

  return validateAndNormalizePlan(
    {
      ...parsed,
      analyzed_image_count: imageParts.length,
      source: 'gemini_live',
    },
    product,
  );
}
