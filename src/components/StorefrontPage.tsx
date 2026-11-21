import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Box,
  Check,
  Film,
  ImagePlus,
  Minus,
  Plus,
  Ruler,
  ShieldCheck,
  ShoppingBag,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import type { InteractionPlan, ProductData } from '../types/commerce';
import { isInteractionActive } from '../lib/planLogic';
import { TemplatePreviewStage, type PreviewControlState } from './three/TemplateRegistry';

export interface CartItem {
  productId: string;
  variantId: string;
  title: string;
  vendor: string;
  variantLabel: string;
  price: number;
  thumbnailUrl: string;
  quantity: number;
}

interface StorefrontPageProps {
  products: ProductData[];
  selectedProduct: ProductData;
  plan: InteractionPlan | null;
  isAnalyzing: boolean;
  previewState: PreviewControlState;
  onSelectProduct: (product: ProductData) => void;
  onUpdatePreviewState: (patch: Partial<PreviewControlState>) => void;
  onBackToStudio: () => void;
}

export function StorefrontPage({
  products,
  selectedProduct,
  plan,
  isAnalyzing,
  previewState,
  onSelectProduct,
  onUpdatePreviewState,
  onBackToStudio,
}: StorefrontPageProps) {
  const [mediaMode, setMediaMode] = useState<'3d' | 'photo'>('3d');
  const [stageModeReq, setStageModeReq] = useState<'inspect' | 'assembly' | 'room'>('inspect');
  const [stageResetKey, setStageResetKey] = useState(0);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [cartOpen, setCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [orderPlacedId, setOrderPlacedId] = useState<string | null>(null);

  const photos =
    selectedProduct.images && selectedProduct.images.length > 0
      ? selectedProduct.images
      : [selectedProduct.thumbnailUrl];

  const activeVariant =
    selectedProduct.variants.find((v) => v.id === previewState.selectedVariantId) ??
    selectedProduct.variants[0];

  const displayPrice = activeVariant?.price ?? selectedProduct.price;
  const numericPrice = Number.parseFloat(displayPrice) || 0;
  const assemblyEnabled = plan ? isInteractionActive(plan, 'assembly_sequence') : false;

  useEffect(() => {
    setActivePhotoIndex(0);
    setQuantity(1);
    setStageModeReq('inspect');
    setMediaMode('3d');
  }, [selectedProduct.id]);

  // Sync variant photo when user selects a swatch in photo mode
  const handleSelectVariant = (variantId: string) => {
    onUpdatePreviewState({ selectedVariantId: variantId });
    const matched = selectedProduct.variants.find((v) => v.id === variantId);
    if (matched?.imageUrl) {
      const idx = photos.indexOf(matched.imageUrl);
      if (idx >= 0) setActivePhotoIndex(idx);
    }
  };

  const handleOpenAssembly = () => {
    setMediaMode('3d');
    setStageModeReq('assembly');
    setStageResetKey((k) => k + 1);
  };

  const handleAddToBag = () => {
    const varLabel = activeVariant?.label ?? 'Standard Finish';
    const thumb = activeVariant?.imageUrl || photos[0] || selectedProduct.thumbnailUrl;
    setOrderPlacedId(null);
    setCartItems((prev) => {
      const existing = prev.find(
        (item) => item.productId === selectedProduct.id && item.variantId === (activeVariant?.id ?? 'default'),
      );
      if (existing) {
        return prev.map((item) =>
          item.productId === selectedProduct.id && item.variantId === (activeVariant?.id ?? 'default')
            ? { ...item, quantity: item.quantity + quantity }
            : item,
        );
      }
      return [
        ...prev,
        {
          productId: selectedProduct.id,
          variantId: activeVariant?.id ?? 'default',
          title: selectedProduct.title,
          vendor: selectedProduct.vendor,
          variantLabel: varLabel,
          price: numericPrice,
          thumbnailUrl: thumb,
          quantity,
        },
      ];
    });
    setCartOpen(true);
  };

  const totalBagCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const bagSubtotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const dims = selectedProduct.dimensions;
  const dimText = [
    dims.widthCm ? `${dims.widthCm} cm W` : null,
    dims.depthCm ? `${dims.depthCm} cm D` : null,
    dims.heightCm ? `${dims.heightCm} cm H` : null,
  ]
    .filter(Boolean)
    .join(' × ');

  const ctaLabel = plan?.storefront_cta_copy || 'Explore Product in 3D';

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-[#faf9f6] text-[#141517]">
      {/* Storefront Sub-Navigation Bar */}
      <div className="border-b border-[#e2e1db] bg-white">
        <div className="max-w-[1360px] mx-auto px-6 h-12 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <button
              type="button"
              onClick={onBackToStudio}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#5f6368] hover:text-[#141517] transition-colors whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Merchant Studio</span>
            </button>
            <span aria-hidden="true" className="text-[#d3d2cc]">|</span>
            <nav aria-label="Storefront Catalog" className="hidden sm:flex items-center gap-5 overflow-x-auto">
              {products.slice(0, 4).map((item) => {
                const isActive = item.id === selectedProduct.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectProduct(item)}
                    className={`text-xs transition-colors whitespace-nowrap shrink-0 ${
                      isActive
                        ? 'font-semibold text-[#141517]'
                        : 'text-[#5f6368] hover:text-[#141517]'
                    }`}
                  >
                    {item.title}
                  </button>
                );
              })}
            </nav>
          </div>

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            aria-label="Open shopping bag"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-[#141517] bg-[#f4f3ef] hover:bg-[#e9e8e2] border border-[#e2e1db] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <ShoppingBag className="w-3.5 h-3.5 text-[#0f6e66]" />
            <span>Bag</span>
            <span className="font-mono tabular-nums font-semibold text-[#0f6e66]">
              ({totalBagCount})
            </span>
          </button>
        </div>
      </div>

      {/* Main 2-Column Consumer PDP */}
      <div className="max-w-[1360px] mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-start">
        {/* Left: Interactive 3D Stage + Real Shopify Photo Gallery */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          {/* Media Mode Bar */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="inline-flex items-center gap-1 p-1 bg-white border border-[#e2e1db] rounded-lg">
              <button
                type="button"
                onClick={() => {
                  setMediaMode('3d');
                  setStageModeReq('inspect');
                  setStageResetKey((k) => k + 1);
                }}
                aria-pressed={mediaMode === '3d' && stageModeReq === 'inspect'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mediaMode === '3d' && stageModeReq === 'inspect'
                    ? 'bg-[#141517] text-white'
                    : 'text-[#5f6368] hover:text-[#141517]'
                }`}
              >
                <Box className="w-3.5 h-3.5" />
                <span>{ctaLabel}</span>
              </button>
              {assemblyEnabled && (
                <button
                  type="button"
                  onClick={handleOpenAssembly}
                  aria-pressed={mediaMode === '3d' && stageModeReq === 'assembly'}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    mediaMode === '3d' && stageModeReq === 'assembly'
                      ? 'bg-[#0f6e66] text-white'
                      : 'text-[#5f6368] hover:text-[#141517]'
                  }`}
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Assembly Guide ({plan?.assembly_steps.length ?? 3} Steps)</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setMediaMode('3d');
                  setStageModeReq('room');
                  setStageResetKey((k) => k + 1);
                }}
                aria-pressed={mediaMode === '3d' && stageModeReq === 'room'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mediaMode === '3d' && stageModeReq === 'room'
                    ? 'bg-[#0f6e66] text-white'
                    : 'text-[#5f6368] hover:text-[#141517]'
                }`}
              >
                <ImagePlus className="w-3.5 h-3.5" />
                <span>See in Room</span>
              </button>
              <button
                type="button"
                onClick={() => setMediaMode('photo')}
                aria-pressed={mediaMode === 'photo'}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  mediaMode === 'photo'
                    ? 'bg-[#141517] text-white'
                    : 'text-[#5f6368] hover:text-[#141517]'
                }`}
              >
                Photos ({photos.length})
              </button>
            </div>

            {selectedProduct.shopifyDomain && (
              <span className="text-[11px] font-mono text-[#5f6368]">
                Live from {selectedProduct.shopifyDomain}
              </span>
            )}
          </div>

          {/* Primary Stage Frame */}
          <div className="h-[520px] sm:h-[580px] w-full rounded-xl overflow-hidden border border-[#e2e1db] bg-white">
            {mediaMode === '3d' ? (
              <TemplatePreviewStage
                product={selectedProduct}
                plan={plan}
                loading={isAnalyzing}
                previewState={previewState}
                onUpdatePreviewState={onUpdatePreviewState}
                initialStageMode={stageModeReq}
                stageResetKey={stageResetKey}
              />
            ) : (
              <div className="relative w-full h-full bg-[#f4f3ef] flex items-center justify-center p-6">
                <img
                  src={photos[activePhotoIndex] ?? selectedProduct.thumbnailUrl}
                  alt={`${selectedProduct.title} — photo ${activePhotoIndex + 1}`}
                  referrerPolicy="no-referrer"
                  className="max-w-full max-h-full object-contain rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => {
                    setMediaMode('3d');
                    setStageModeReq('inspect');
                  }}
                  className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0f6e66] hover:bg-[#0c5952] rounded-lg shadow-sm transition-colors"
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>Switch to Interactive 3D</span>
                </button>
              </div>
            )}
          </div>

          {/* Thumbnail Strip: 3D Tile + Real Shopify Product Photos */}
          <div className="flex items-center gap-2.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => {
                setMediaMode('3d');
                setStageModeReq('inspect');
              }}
              className={`w-20 h-16 rounded-lg border shrink-0 flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                mediaMode === '3d'
                  ? 'border-[#0f6e66] bg-[#eef6f5] text-[#0f6e66]'
                  : 'border-[#e2e1db] bg-white text-[#5f6368] hover:text-[#141517]'
              }`}
            >
              <Box className="w-4 h-4" />
              <span>3D View</span>
            </button>
            {photos.map((imgUrl, idx) => {
              const selected = mediaMode === 'photo' && activePhotoIndex === idx;
              return (
                <button
                  key={`${imgUrl}-${idx}`}
                  type="button"
                  onClick={() => {
                    setMediaMode('photo');
                    setActivePhotoIndex(idx);
                  }}
                  aria-label={`View product photo ${idx + 1}`}
                  className={`w-20 h-16 rounded-lg overflow-hidden border shrink-0 bg-white transition-colors ${
                    selected
                      ? 'border-[#0f6e66] ring-1 ring-[#0f6e66]'
                      : 'border-[#e2e1db] hover:border-[#b9b8b0]'
                  }`}
                >
                  <img
                    src={imgUrl}
                    alt={`${selectedProduct.title} thumbnail ${idx + 1}`}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Contiguous Purchase Module */}
        <div className="lg:col-span-5 lg:sticky lg:top-6 bg-white border border-[#e2e1db] rounded-xl p-6 sm:p-7 space-y-5 shadow-[0_1px_3px_rgba(20,21,23,0.04)]">
          {/* Vendor & Title & Price */}
          <div>
            <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-[#5f6368] font-medium">
              <span>{selectedProduct.vendor}</span>
              <span>{selectedProduct.productType}</span>
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[#141517] mt-1.5 leading-snug">
              {selectedProduct.title}
            </h1>
            <div className="mt-2.5 flex items-baseline justify-between gap-4">
              <span className="text-xl font-semibold font-mono tabular-nums text-[#141517]">
                ${numericPrice.toFixed(2)}
              </span>
              <span className="text-xs font-medium text-[#0f6e66]">In Stock · Ships in 2–4 Days</span>
            </div>
          </div>

          <p className="text-sm text-[#4a4e54] leading-relaxed">{selectedProduct.description}</p>

          {/* Finish Swatches (Synced live to 3D Canvas) */}
          <div className="pt-2 border-t border-[#efeeea]">
            <div className="flex items-center justify-between text-xs mb-2.5">
              <span className="font-medium text-[#141517]">Finish</span>
              <span className="text-[#5f6368]">{activeVariant?.label ?? 'Standard Finish'}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {selectedProduct.variants.map((variant) => {
                const isSelected = variant.id === activeVariant?.id;
                return (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => handleSelectVariant(variant.id)}
                    aria-label={`Choose finish ${variant.label}`}
                    aria-pressed={isSelected}
                    title={variant.label}
                    className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs transition-colors ${
                      isSelected
                        ? 'border-[#0f6e66] bg-[#eef6f5]/60 text-[#141517] font-medium'
                        : 'border-[#e2e1db] bg-white text-[#5f6368] hover:border-[#b9b8b0]'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-black/15 shrink-0"
                      style={{ backgroundColor: variant.colorHex }}
                    />
                    <span className="truncate max-w-[130px]">{variant.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quantity + Add to Bag CTA */}
          <div className="flex items-center gap-3 pt-1">
            <div className="inline-flex items-center border border-[#e2e1db] rounded-lg bg-[#faf9f6] shrink-0">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                aria-label="Decrease quantity"
                className="p-2.5 text-[#5f6368] hover:text-[#141517] transition-colors"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="w-8 text-center text-xs font-mono tabular-nums font-semibold text-[#141517]">
                {quantity}
              </span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                aria-label="Increase quantity"
                className="p-2.5 text-[#5f6368] hover:text-[#141517] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleAddToBag}
              className="flex-1 inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#0f6e66] hover:bg-[#0c5952] rounded-lg transition-colors whitespace-nowrap"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>Add to Bag · ${(numericPrice * quantity).toFixed(2)}</span>
            </button>
          </div>

          {/* Assembly Quick Launch */}
          {assemblyEnabled && (
            <div className="p-3.5 rounded-lg bg-[#f6f5f2] border border-[#e2e1db] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-semibold text-[#141517]">
                  Interactive {plan?.assembly_steps.length}-Step 3D Assembly Guide
                </div>
                <div className="text-[11px] text-[#5f6368] mt-0.5">
                  Preview how components lock together before it arrives.
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenAssembly}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0f6e66] bg-white hover:bg-[#eef6f5] border border-[#0f6e66]/30 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Film className="w-3.5 h-3.5" />
                <span>Play Steps</span>
              </button>
            </div>
          )}

          {/* Key Product Specifications */}
          <div className="pt-3 border-t border-[#efeeea]">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#5f6368] mb-2.5">
              Specifications &amp; Fit
            </h2>
            <dl className="divide-y divide-[#f1f0ec] text-xs">
              <div className="py-2 flex items-baseline justify-between gap-4">
                <dt className="text-[#5f6368] inline-flex items-center gap-1.5">
                  <Ruler className="w-3.5 h-3.5 text-[#8a8e95]" />
                  <span>Dimensions</span>
                </dt>
                <dd className="font-mono tabular-nums text-[#141517] text-right">
                  {dimText || 'See product description'}
                </dd>
              </div>
              {plan?.visual_3d_profile?.observed_materials &&
                plan.visual_3d_profile.observed_materials.length > 0 && (
                  <div className="py-2 flex items-baseline justify-between gap-4">
                    <dt className="text-[#5f6368] shrink-0">Materials</dt>
                    <dd className="text-[#141517] text-right">
                      {plan.visual_3d_profile.observed_materials.join(' · ')}
                    </dd>
                  </div>
                )}
              <div className="py-2 flex items-baseline justify-between gap-4">
                <dt className="text-[#5f6368] inline-flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-[#8a8e95]" />
                  <span>Delivery</span>
                </dt>
                <dd className="text-[#141517] text-right">Free shipping over $150</dd>
              </div>
              <div className="py-2 flex items-baseline justify-between gap-4">
                <dt className="text-[#5f6368] inline-flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#8a8e95]" />
                  <span>Warranty</span>
                </dt>
                <dd className="text-[#141517] text-right">30-day studio trial</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      {/* Slide-Over Shopping Bag Drawer */}
      {cartOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Shopping Bag"
          className="fixed inset-0 z-50 flex justify-end bg-black/35 backdrop-blur-[1px]"
        >
          <div className="w-full max-w-md bg-white h-full flex flex-col border-l border-[#e2e1db] shadow-2xl">
            <div className="px-6 py-4 border-b border-[#efeeea] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-4 h-4 text-[#0f6e66]" />
                <h2 className="text-sm font-semibold text-[#141517]">
                  Shopping Bag ({totalBagCount})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                aria-label="Close shopping bag"
                className="p-1.5 text-[#5f6368] hover:text-[#141517] rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {orderPlacedId && (
                <div className="p-4 rounded-xl bg-[#eef6f5] border border-[#0f6e66]/25 flex items-start gap-3">
                  <Check className="w-4 h-4 text-[#0f6e66] shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-[#141517]">
                      Order #{orderPlacedId} Confirmed — Preparing Shipment
                    </p>
                    <p className="text-[11px] text-[#5f6368] mt-1">
                      Includes link to your interactive 3D step-by-step assembly guide upon delivery.
                    </p>
                  </div>
                </div>
              )}

              {cartItems.length === 0 ? (
                <p className="text-xs text-[#5f6368] py-12 text-center">
                  Your bag is currently empty. Select a finish and add an item to test checkout.
                </p>
              ) : (
                cartItems.map((item) => (
                  <div
                    key={`${item.productId}-${item.variantId}`}
                    className="flex gap-3.5 pb-4 border-b border-[#f1f0ec]"
                  >
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-16 h-16 rounded-lg object-cover border border-[#e2e1db] shrink-0 bg-[#f4f3ef]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-semibold text-[#141517] truncate">
                          {item.title}
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setCartItems((prev) =>
                              prev.filter(
                                (c) =>
                                  !(c.productId === item.productId && c.variantId === item.variantId),
                              ),
                            )
                          }
                          aria-label={`Remove ${item.title}`}
                          className="text-[#8a8e95] hover:text-rose-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="text-[11px] text-[#5f6368] mt-0.5">{item.variantLabel}</div>
                      <div className="mt-2 flex items-center justify-between">
                        <div className="inline-flex items-center border border-[#e2e1db] rounded-md">
                          <button
                            type="button"
                            onClick={() =>
                              setCartItems((prev) =>
                                prev
                                  .map((c) =>
                                    c.productId === item.productId && c.variantId === item.variantId
                                      ? { ...c, quantity: c.quantity - 1 }
                                      : c,
                                  )
                                  .filter((c) => c.quantity > 0),
                              )
                            }
                            aria-label="Decrease bag item quantity"
                            className="px-2 py-1 text-xs text-[#5f6368]"
                          >
                            -
                          </button>
                          <span className="px-2 text-xs font-mono tabular-nums">{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setCartItems((prev) =>
                                prev.map((c) =>
                                  c.productId === item.productId && c.variantId === item.variantId
                                    ? { ...c, quantity: c.quantity + 1 }
                                    : c,
                                ),
                              )
                            }
                            aria-label="Increase bag item quantity"
                            className="px-2 py-1 text-xs text-[#5f6368]"
                          >
                            +
                          </button>
                        </div>
                        <span className="text-xs font-mono tabular-nums font-semibold text-[#141517]">
                          ${(item.price * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {cartItems.length > 0 && (
              <div className="p-6 border-t border-[#efeeea] bg-[#faf9f6] space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#5f6368]">Subtotal</span>
                  <span className="font-mono tabular-nums font-semibold text-sm text-[#141517]">
                    ${bagSubtotal.toFixed(2)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOrderPlacedId('1042');
                    setCartItems([]);
                  }}
                  className="w-full py-2.5 text-xs font-semibold text-white bg-[#0f6e66] hover:bg-[#0c5952] rounded-lg transition-colors"
                >
                  Complete Demo Checkout
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
