import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import path from 'path';
import type { ProductDimensions } from '../types/commerce';
import { MissingGeminiKeyError } from './geminiPlanner';

export type SceneLightingMood = 'match_room' | 'warm_evening' | 'bright_daylight';

export interface SceneRenderRequest {
  productTitle: string;
  productVendor: string;
  productType: string;
  productDescription?: string;
  dimensions?: ProductDimensions;
  variantLabel: string;
  variantHex: string;
  productImageUrl?: string;
  roomImageInput: string;
  placementHint: string;
  lightingMood?: SceneLightingMood;
  customPromptNote?: string;
}

export interface SceneRenderResult {
  imageDataUrl: string;
  modelUsed: string;
  note?: string;
}

interface InlineImageData {
  mimeType: string;
  data: string;
}

const ALLOWED_IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

export function parseDataUrlImage(dataUrl: string): InlineImageData {
  const match = dataUrl.trim().match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    throw new Error('Room photo must be a valid PNG, JPEG, or WebP image.');
  }
  const rawMime = match[1].toLowerCase();
  const mimeType = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;
  if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new Error('Unsupported image format. Please upload PNG, JPEG, or WebP.');
  }
  return {
    mimeType,
    data: match[2],
  };
}

async function resolveImageToInlineData(source: string): Promise<InlineImageData | null> {
  const trimmed = source.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('data:')) {
    return parseDataUrlImage(trimmed);
  }

  // Safe local public or src asset resolution (no directory traversal)
  if (trimmed.startsWith('/')) {
    const cleanRel = trimmed.replace(/^\/+/, '');
    const publicRoot = path.resolve(process.cwd(), 'public');
    const srcRoot = path.resolve(process.cwd(), 'src');

    const candidatePublic = path.resolve(publicRoot, cleanRel);
    const candidateRoot = path.resolve(process.cwd(), cleanRel);

    const safeFile =
      candidatePublic.startsWith(publicRoot + path.sep) && fs.existsSync(candidatePublic)
        ? candidatePublic
        : (candidateRoot.startsWith(srcRoot + path.sep) ||
              candidateRoot.startsWith(publicRoot + path.sep)) &&
            fs.existsSync(candidateRoot)
          ? candidateRoot
          : null;

    if (!safeFile) return null;
    const buf = fs.readFileSync(safeFile);
    const ext = path.extname(safeFile).toLowerCase();
    const mimeType =
      ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return {
      mimeType,
      data: buf.toString('base64'),
    };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname.includes('cdn.shopify.com') && !url.searchParams.has('width')) {
        url.searchParams.set('width', '960');
      }
      const res = await fetch(url.toString(), {
        signal: AbortSignal.timeout(5500),
        headers: { 'User-Agent': 'Adaptive3DCommerce/1.0' },
      });
      if (!res.ok) return null;
      const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_IMAGE_MIMES.has(contentType)) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength === 0 || buf.byteLength > 8 * 1024 * 1024) return null;
      return {
        mimeType: contentType === 'image/jpg' ? 'image/jpeg' : contentType,
        data: buf.toString('base64'),
      };
    } catch {
      return null;
    }
  }

  return null;
}

export function buildSceneCompositePrompt(req: SceneRenderRequest, hasProductRef: boolean): string {
  const dimParts: string[] = [];
  if (req.dimensions?.widthCm) dimParts.push(`${req.dimensions.widthCm} cm wide`);
  if (req.dimensions?.depthCm) dimParts.push(`${req.dimensions.depthCm} cm deep`);
  if (req.dimensions?.heightCm) dimParts.push(`${req.dimensions.heightCm} cm tall`);
  if (req.dimensions?.reachCm) dimParts.push(`${req.dimensions.reachCm} cm reach`);
  const dimSummary = dimParts.length > 0 ? dimParts.join(', ') : 'standard furniture/lighting proportions';

  const moodGuidance =
    req.lightingMood === 'warm_evening'
      ? 'Make the scene feel slightly warmer and switch any lamp product ON so it casts a soft realistic warm pool of light onto nearby surfaces.'
      : req.lightingMood === 'bright_daylight'
        ? 'Keep crisp natural daylight balance across the room with clean contact shadows under the placed product.'
        : 'Strictly match the exact existing ambient light direction, color temperature, and window shadows already in the room photograph.';

  const customNote = req.customPromptNote?.trim()
    ? `Additional styling note from buyer: ${req.customPromptNote.trim()}.`
    : '';

  return [
    'Edit the first image (the user’s interior room photograph) to photorealistically place the furniture or lighting product shown in the second reference image into the room.',
    `Product to integrate: "${req.productTitle}" by ${req.productVendor} (${req.productType}), in finish "${req.variantLabel}" (${req.variantHex}). Physical scale: ${dimSummary}.`,
    hasProductRef
      ? 'Match the exact silhouette, materials, proportions, hardware, and finish color of the product shown in the second reference image.'
      : `Render an authentic architectural likeness of "${req.productTitle}" in ${req.variantLabel} (${req.variantHex}).`,
    `Placement instruction: ${req.placementHint}.`,
    'If another similar lamp or chair already occupies that exact target placement spot, cleanly replace it with this product so there is no awkward collision or overlap; otherwise place it naturally without disturbing other furniture, framed art, rugs, or architectural lines.',
    'Keep the rest of the room photograph completely intact—same camera framing, lens perspective, walls, posters, desk, floor, and props.',
    moodGuidance,
    'Ensure physically accurate scale relative to surrounding objects (standard ~75 cm desk height, realistic seat/lamp height), grounded contact shadows, subtle surface reflections, and natural photographic grain.',
    customNote,
  ]
    .filter(Boolean)
    .join(' ');
}

export async function renderProductInRoomScene(
  req: SceneRenderRequest,
): Promise<SceneRenderResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new MissingGeminiKeyError();
  }

  const roomInline = await resolveImageToInlineData(req.roomImageInput);
  if (!roomInline) {
    throw new Error('Could not load the selected room photograph.');
  }

  const productInline = req.productImageUrl
    ? await resolveImageToInlineData(req.productImageUrl)
    : null;

  const promptText = buildSceneCompositePrompt(req, Boolean(productInline));

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const parts: Array<{ inlineData: InlineImageData } | { text: string }> = [
    { inlineData: roomInline },
  ];
  if (productInline) {
    parts.push({ inlineData: productInline });
  }
  parts.push({ text: promptText });

  const modelUsed = 'gemini-3.1-flash-lite-image';

  const response = await ai.models.generateContent({
    model: modelUsed,
    contents: { parts },
  });

  let imageDataUrl: string | null = null;
  let textNote: string | undefined;

  for (const part of response.candidates?.[0]?.content?.parts ?? []) {
    if (part.inlineData?.data) {
      const mime = part.inlineData.mimeType ?? 'image/png';
      imageDataUrl = `data:${mime};base64,${part.inlineData.data}`;
    } else if (part.text) {
      textNote = part.text.trim();
    }
  }

  if (!imageDataUrl) {
    throw new Error(
      textNote || 'Gemini image renderer did not return an image output. Please try another placement note.',
    );
  }

  return {
    imageDataUrl,
    modelUsed,
    note: textNote,
  };
}
