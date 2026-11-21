import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Camera,
  Download,
  ImagePlus,
  Loader2,
  Sun,
  Upload,
} from 'lucide-react';
import type { ProductData } from '../types/commerce';

export const SAMPLE_ROOM_SCENES = [
  {
    id: 'sunny-studio-desk',
    label: 'Sunny Studio Desk (Sample)',
    url: '/assets/aistudio/image_6265c9ec.png',
  },
] as const;

type LightingMood = 'match_room' | 'warm_evening' | 'bright_daylight';

interface RoomSceneStudioProps {
  product: ProductData;
  selectedVariantId: string;
}

function getPlacementPresets(archetype: ProductData['modelAsset']['geometryArchetype']) {
  if (archetype === 'pendant_lamp') {
    return [
      {
        id: 'above-desk',
        label: 'Hung Above Desk',
        hint: 'Suspended on a straight ceiling downrod hanging centered above the wooden desk surface, well clear of the wall shelf',
      },
      {
        id: 'corner-drop',
        label: 'Over Side Cart',
        hint: 'Suspended gracefully from the ceiling over the yellow rolling cart on the left side of the room',
      },
    ];
  }
  if (archetype === 'dining_chair') {
    return [
      {
        id: 'desk-chair',
        label: 'Beside Desk',
        hint: 'Placed naturally on the patterned rug beside the front-right edge of the desk, angled three-quarters toward the desk',
      },
      {
        id: 'replace-chair',
        label: 'Replace Desk Chair',
        hint: 'Tucked cleanly in front of the desk replacing the existing dining chair in natural studio scale',
      },
      {
        id: 'reading-corner',
        label: 'Reading Corner',
        hint: 'Placed on the floor rug on the right side of the room facing slightly inward as an accent lounge seat',
      },
    ];
  }
  return [
    {
      id: 'desk-right',
      label: 'On Desk (Right)',
      hint: 'Placed neatly on the back-right surface of the wooden desk next to the laptop, replacing any existing desk lamp cleanly',
    },
    {
      id: 'desk-left',
      label: 'On Desk (Left)',
      hint: 'Placed on the left side of the wooden desk beside the open magazine and coffee cup',
    },
    {
      id: 'side-cart',
      label: 'On Yellow Cart',
      hint: 'Placed cleanly on the top shelf of the yellow rolling cart on the left side of the room',
    },
  ];
}

async function downscaleImageFile(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to read uploaded image file.'));
      el.src = objectUrl;
    });

    const maxEdge = 1400;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable.');
    ctx.drawImage(img, 0, 0, width, height);

    const preferPng = file.type === 'image/png' && width * height <= 900_000;
    return preferPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function RoomSceneStudio({ product, selectedVariantId }: RoomSceneStudioProps) {
  const presets = useMemo(
    () => getPlacementPresets(product.modelAsset.geometryArchetype),
    [product.modelAsset.geometryArchetype],
  );

  const [roomImageSource, setRoomImageSource] = useState<string>(SAMPLE_ROOM_SCENES[0].url);
  const [customUploadLabel, setCustomUploadLabel] = useState<string | null>(null);
  const [selectedPlacementId, setSelectedPlacementId] = useState<string>(presets[0].id);
  const [lightingMood, setLightingMood] = useState<LightingMood>('match_room');
  const [customPromptNote, setCustomPromptNote] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);

  const [renderedImageUrl, setRenderedImageUrl] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<'rendered' | 'split' | 'original'>('rendered');
  const [splitPercent, setSplitPercent] = useState<number>(52);
  const [isRendering, setIsRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setSelectedPlacementId(presets[0].id);
    setRenderedImageUrl(null);
    setRenderError(null);
    setCompareMode('rendered');
  }, [product.id, presets]);

  const activeVariant =
    product.variants.find((v) => v.id === selectedVariantId) ?? product.variants[0];

  const activePlacement =
    presets.find((p) => p.id === selectedPlacementId) ?? presets[0];

  const handleUploadFile = async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setRenderError('Please upload a PNG, JPEG, or WebP photograph of your room.');
      return;
    }
    try {
      setRenderError(null);
      const dataUrl = await downscaleImageFile(file);
      setRoomImageSource(dataUrl);
      setCustomUploadLabel(file.name);
      setRenderedImageUrl(null);
      setCompareMode('rendered');
    } catch (err) {
      setRenderError(err instanceof Error ? err.message : 'Failed to load room photograph.');
    }
  };

  const handleRenderScene = async () => {
    setIsRendering(true);
    setRenderError(null);

    try {
      const response = await fetch('/api/scene/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productTitle: product.title,
          productVendor: product.vendor,
          productType: product.productType,
          productDescription: product.description,
          dimensions: product.dimensions,
          variantLabel: activeVariant?.label ?? 'Standard Finish',
          variantHex: activeVariant?.colorHex ?? '#3a3e42',
          productImageUrl: activeVariant?.imageUrl || product.thumbnailUrl,
          roomImageInput: roomImageSource,
          placementHint: activePlacement.hint,
          lightingMood,
          customPromptNote: customPromptNote.trim() || undefined,
        }),
      });

      const data = (await response.json()) as {
        imageDataUrl?: string;
        code?: string;
        error?: string;
      };

      if (!response.ok || !data.imageDataUrl) {
        if (data.code === 'PAID_KEY_REQUIRED') {
          setRenderError(
            'In-room image compositing uses Gemini image generation (gemini-3.1-flash-lite-image), which requires a billing-enabled Gemini API key configured in Settings > Secrets.',
          );
        } else {
          setRenderError(
            data.error || 'Could not generate in-room render. Check your Gemini API key or retry.',
          );
        }
        return;
      }

      setRenderedImageUrl(data.imageDataUrl);
      setCompareMode('rendered');
    } catch {
      setRenderError('Network error communicating with /api/scene/render.');
    } finally {
      setIsRendering(false);
    }
  };

  const handleDownloadResult = () => {
    if (!renderedImageUrl) return;
    const link = document.createElement('a');
    link.href = renderedImageUrl;
    link.download = `${product.handle}-in-room-render.png`;
    link.click();
  };

  return (
    <div
      data-testid="room-scene-studio"
      className="w-full h-full flex flex-col bg-[#f4f3ef]"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files?.[0];
        void handleUploadFile(file);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        aria-label="Upload room photo"
        onChange={(e) => {
          void handleUploadFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {/* Main Preview Canvas (clears top header bar cleanly) */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-4 pt-[72px] pb-3">
        <div
          className={`relative w-full h-full max-w-[780px] rounded-xl overflow-hidden border bg-[#eae8e2] flex items-center justify-center shadow-[0_1px_3px_rgba(20,21,23,0.06)] transition-colors ${
            isDragging ? 'border-[#0f6e66] ring-2 ring-[#0f6e66]/25' : 'border-[#dbd9d2]'
          }`}
        >
          {/* Image View / Before-After Split */}
          {renderedImageUrl && compareMode === 'split' ? (
            <div className="relative w-full h-full select-none overflow-hidden">
              <img
                src={roomImageSource}
                alt="Original room"
                className="w-full h-full object-contain"
              />
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
              >
                <img
                  src={renderedImageUrl}
                  alt={`${product.title} placed in room`}
                  className="w-full h-full object-contain"
                />
              </div>
              <div
                className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px_rgba(0,0,0,0.45)] pointer-events-none"
                style={{ left: `${splitPercent}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-white border border-[#e2e1db] shadow-md flex items-center justify-center">
                  <ArrowLeftRight className="w-3.5 h-3.5 text-[#0f6e66]" />
                </div>
              </div>
              <input
                type="range"
                aria-label="Before and after comparison slider"
                min={5}
                max={95}
                value={splitPercent}
                onChange={(e) => setSplitPercent(Number(e.target.value))}
                className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize"
              />
              <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-[#0f6e66]/90 text-[10px] font-medium text-white pointer-events-none">
                Rendered
              </span>
              <span className="absolute top-2.5 right-2.5 px-2 py-0.5 rounded bg-[#141517]/75 text-[10px] font-medium text-white pointer-events-none">
                Original Room
              </span>
            </div>
          ) : (
            <img
              src={
                renderedImageUrl && compareMode === 'rendered' ? renderedImageUrl : roomImageSource
              }
              alt={
                renderedImageUrl && compareMode === 'rendered'
                  ? `${product.title} placed inside room`
                  : 'Selected room photograph'
              }
              data-testid={
                renderedImageUrl && compareMode === 'rendered'
                  ? 'rendered-room-image'
                  : 'source-room-image'
              }
              className="w-full h-full object-contain"
            />
          )}

          {/* Top Floating Compare / Download Toolbar once rendered */}
          {renderedImageUrl && !isRendering && (
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 pointer-events-none">
              <div className="pointer-events-auto inline-flex items-center gap-0.5 p-1 bg-white/95 border border-[#e2e1db] rounded-lg shadow-sm">
                {(
                  [
                    { id: 'rendered', label: 'Rendered' },
                    { id: 'split', label: 'Split Compare' },
                    { id: 'original', label: 'Original' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => setCompareMode(mode.id)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                      compareMode === mode.id
                        ? 'bg-[#0f6e66] text-white'
                        : 'text-[#5f6368] hover:text-[#141517]'
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={handleDownloadResult}
                className="pointer-events-auto inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[#141517] bg-white/95 hover:bg-white border border-[#e2e1db] rounded-lg shadow-sm transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 text-[#0f6e66]" />
                <span>Download PNG</span>
              </button>
            </div>
          )}

          {/* Drag-Drop Hover Hint */}
          {isDragging && (
            <div className="absolute inset-0 bg-[#0f6e66]/12 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
              <div className="px-4 py-2.5 rounded-xl bg-white border border-[#0f6e66] text-xs font-semibold text-[#0f6e66] shadow-md">
                Drop your room photo here
              </div>
            </div>
          )}

          {/* Active Rendering Overlay */}
          {isRendering && (
            <div
              role="status"
              aria-live="polite"
              className="absolute inset-0 bg-[#141517]/40 backdrop-blur-[2px] flex items-center justify-center p-4"
            >
              <div className="bg-white border border-[#e2e1db] rounded-xl px-5 py-4 shadow-lg flex items-center gap-3 max-w-sm">
                <Loader2 className="w-5 h-5 text-[#0f6e66] animate-spin shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-[#141517]">
                    Rendering {product.title} in your room…
                  </p>
                  <p className="text-[11px] text-[#5f6368] mt-0.5">
                    Matching perspective, {activeVariant?.label ?? 'finish'}, scale &amp; shadows
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Compact Scene Composer Controls */}
      <div className="bg-white border-t border-[#e2e1db] px-4 py-3 space-y-2.5 shrink-0">
        {renderError && (
          <div
            role="alert"
            className="px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start justify-between gap-2"
          >
            <span className="leading-snug">{renderError}</span>
            <button
              type="button"
              onClick={() => setRenderError(null)}
              className="text-[11px] font-semibold underline shrink-0 mt-0.5"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Row 1: Room Source + Placement + Lighting */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Room Source */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#141517] bg-[#f4f3ef] hover:bg-[#e8e7e0] border border-[#e2e1db] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-[#0f6e66]" />
              <span>Upload Room Photo</span>
            </button>

            {SAMPLE_ROOM_SCENES.map((scene) => {
              const active = roomImageSource === scene.url;
              return (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => {
                    setRoomImageSource(scene.url);
                    setCustomUploadLabel(null);
                    setRenderedImageUrl(null);
                    setRenderError(null);
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-[#0f6e66] bg-[#eef6f5] text-[#0f6e66] font-medium'
                      : 'border-[#e2e1db] bg-white text-[#5f6368] hover:text-[#141517]'
                  }`}
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>{scene.label}</span>
                </button>
              );
            })}

            {customUploadLabel && roomImageSource.startsWith('data:') && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-[#0f6e66] bg-[#eef6f5] text-[#0f6e66] font-medium max-w-[160px] truncate">
                {customUploadLabel}
              </span>
            )}
          </div>

          {/* Placement Presets */}
          <div className="flex items-center gap-1 p-0.5 bg-[#f4f3ef] border border-[#e2e1db] rounded-lg overflow-x-auto">
            {presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedPlacementId(preset.id)}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  activePlacement.id === preset.id
                    ? 'bg-white text-[#141517] shadow-xs'
                    : 'text-[#5f6368] hover:text-[#141517]'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Lighting Mood */}
          <div className="flex items-center gap-1 p-0.5 bg-[#f4f3ef] border border-[#e2e1db] rounded-lg shrink-0">
            <Sun className="w-3.5 h-3.5 text-[#0f6e66] ml-1.5" />
            {(
              [
                { id: 'match_room', label: 'Match Room' },
                { id: 'warm_evening', label: 'Lamp On' },
                { id: 'bright_daylight', label: 'Daylight' },
              ] as const
            ).map((mood) => (
              <button
                key={mood.id}
                type="button"
                onClick={() => setLightingMood(mood.id)}
                className={`px-2 py-1 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  lightingMood === mood.id
                    ? 'bg-white text-[#141517] shadow-xs'
                    : 'text-[#5f6368] hover:text-[#141517]'
                }`}
              >
                {mood.label}
              </button>
            ))}
          </div>
        </div>

        {/* Row 2: Custom Instruction + Active Finish + Primary Render Trigger */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#faf9f6] border border-[#e2e1db] text-[11px] text-[#5f6368] shrink-0">
            <span
              className="w-3 h-3 rounded-full border border-black/15 shrink-0"
              style={{ backgroundColor: activeVariant?.colorHex ?? '#3a3e42' }}
            />
            <span className="truncate max-w-[120px] font-medium text-[#141517]">
              {activeVariant?.label ?? 'Standard'}
            </span>
          </div>

          <input
            type="text"
            value={customPromptNote}
            onChange={(e) => setCustomPromptNote(e.target.value)}
            placeholder="Optional note (e.g. 'Place next to the laptop, facing left')"
            aria-label="Custom placement note"
            className="flex-1 min-w-0 px-3 py-1.5 text-xs bg-[#faf9f6] border border-[#e2e1db] rounded-lg text-[#141517] placeholder:text-[#8a8e95] focus:outline-none focus:border-[#0f6e66]"
          />

          <button
            type="button"
            disabled={isRendering}
            onClick={() => void handleRenderScene()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-[#0f6e66] hover:bg-[#0c5952] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {isRendering ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Rendering…</span>
              </>
            ) : (
              <>
                <Camera className="w-3.5 h-3.5" />
                <span>Render in Room</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
