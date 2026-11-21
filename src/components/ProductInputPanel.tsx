import { useState, type FormEvent } from 'react';
import { Globe, Link2, Sparkles } from 'lucide-react';
import type { ProductData } from '../types/commerce';

interface ProductInputPanelProps {
  products: ProductData[];
  selectedProduct: ProductData;
  onSelectProduct: (product: ProductData) => void;
  onImportShopifyProducts: (importedList: ProductData[]) => void;
  onAnalyzeSelected: () => void;
  isAnalyzing: boolean;
  shopifyLoading: boolean;
  shopifyConnectionLabel: string;
}

export function ProductInputPanel({
  products,
  selectedProduct,
  onSelectProduct,
  onImportShopifyProducts,
  onAnalyzeSelected,
  isAnalyzing,
  shopifyLoading,
  shopifyConnectionLabel,
}: ProductInputPanelProps) {
  const [urlInput, setUrlInput] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});

  const handleFetchSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setFetchError('Enter a Shopify store or product URL (e.g. https://www.schoolhouse.com/products/isaac-desk-lamp).');
      return;
    }

    setFetchingUrl(true);
    setFetchError(null);

    try {
      const response = await fetch('/api/shopify/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const data = (await response.json()) as {
        product?: ProductData;
        catalogProducts?: ProductData[];
        error?: string;
      };
      const items =
        data.catalogProducts && data.catalogProducts.length > 0
          ? data.catalogProducts
          : data.product
            ? [data.product]
            : [];
      if (!response.ok || items.length === 0) {
        setFetchError(data.error || 'Unable to read product data from that Shopify URL.');
        return;
      }
      onImportShopifyProducts(items);
      setUrlInput('');
    } catch {
      setFetchError('Network error while contacting the Shopify API proxy.');
    } finally {
      setFetchingUrl(false);
    }
  };

  const dims = selectedProduct.dimensions;
  const dimensionSummary = [
    dims.widthCm ? `${dims.widthCm}W` : null,
    dims.depthCm ? `${dims.depthCm}D` : null,
    dims.heightCm ? `${dims.heightCm}H` : null,
  ]
    .filter(Boolean)
    .join(' × ');

  return (
    <aside
      aria-label="Product Input"
      className="w-full lg:w-[300px] xl:w-[320px] shrink-0 flex flex-col bg-white border border-[#e2e1db] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(20,21,23,0.03)]"
    >
      <div className="px-5 pt-4 pb-3 border-b border-[#efeeea]">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-[#141517]">Product Input</h2>
        <p className="text-xs text-[#5f6368] mt-0.5">
          Import a live Shopify URL or select a catalog product
        </p>
      </div>

      {/* Shopify Live URL Importer */}
      <form onSubmit={handleFetchSubmit} className="px-5 py-3.5 border-b border-[#efeeea]">
        <label htmlFor="shopify-url-input" className="block text-xs font-medium text-[#3b3f45] mb-1.5">
          Shopify Store or Product URL
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Link2 className="w-3.5 h-3.5 text-[#8a8e95] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="shopify-url-input"
              type="text"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                if (fetchError) setFetchError(null);
              }}
              placeholder="https://store.com/products/..."
              className="w-full pl-8 pr-2.5 py-1.5 text-xs bg-[#f7f6f3] border border-[#e2e1db] rounded-lg text-[#141517] placeholder:text-[#9a9ea5] focus:outline-none focus:border-[#0f6e66] focus:bg-white transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={fetchingUrl}
            className="px-3 py-1.5 text-xs font-medium text-[#141517] bg-[#f4f3ef] hover:bg-[#e9e8e2] border border-[#e2e1db] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            {fetchingUrl ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {fetchError && (
          <p role="alert" className="mt-1.5 text-[11px] text-rose-700 leading-snug">
            {fetchError}
          </p>
        )}
      </form>

      {/* Product Selector List */}
      <div className="px-5 py-3.5 border-b border-[#efeeea] flex-1 overflow-y-auto">
        <div className="flex items-center justify-between mb-2.5 gap-2">
          <span className="text-xs font-medium text-[#3b3f45]">
            {shopifyLoading ? 'Syncing Shopify API…' : shopifyConnectionLabel}
          </span>
          <span className="text-[11px] text-[#8a8e95] tabular-nums shrink-0">{products.length} loaded</span>
        </div>

        <div className="flex flex-col gap-2">
          {products.map((item) => {
            const isSelected = item.id === selectedProduct.id;
            const imgBroken = failedImages[item.id];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectProduct(item)}
                aria-pressed={isSelected}
                className={`w-full text-left p-2.5 rounded-lg border transition-colors flex items-start gap-3 ${
                  isSelected
                    ? 'border-[#0f6e66] bg-[#eef6f5]/55'
                    : 'border-[#e2e1db] bg-white hover:border-[#c8c7c0] hover:bg-[#faf9f6]'
                }`}
              >
                <div className="w-16 h-12 rounded-md overflow-hidden bg-[#f4f3ef] shrink-0 border border-[#e2e1db] flex items-center justify-center">
                  {!imgBroken ? (
                    <img
                      src={item.thumbnailUrl}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      onError={() => setFailedImages((prev) => ({ ...prev, [item.id]: true }))}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Globe className="w-4 h-4 text-[#8a8e95]" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-[#141517] truncate">{item.title}</div>
                  <div className="text-[11px] text-[#5f6368] mt-0.5 flex items-center gap-1.5 truncate">
                    <span>{item.productType}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums">${item.price}</span>
                  </div>
                  <div className="text-[11px] text-[#8a8e95] mt-0.5 truncate">
                    {item.source === 'shopify_live'
                      ? `${item.vendor} · Live Shopify`
                      : 'Curated Test Data'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Product Specs Breakdown */}
        <div className="mt-4 pt-4 border-t border-[#efeeea]">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold text-[#141517]">Selected Product Specs</h3>
            <span className="text-[11px] text-[#8a8e95]">
              {selectedProduct.source === 'shopify_live' ? 'Live Shopify API' : 'Test Fixture'}
            </span>
          </div>
          <p className="text-xs text-[#5f6368] leading-relaxed mb-3">{selectedProduct.description}</p>

          <dl className="grid grid-cols-1 gap-1.5 text-xs">
            <div className="flex items-baseline justify-between gap-3 py-1 border-b border-[#f1f0ec]">
              <dt className="text-[#7a7e85] shrink-0">Dimensions</dt>
              <dd className="font-mono tabular-nums text-[#141517] text-right truncate">
                {dimensionSummary ? `${dimensionSummary} cm` : 'Not specified'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1 border-b border-[#f1f0ec]">
              <dt className="text-[#7a7e85] shrink-0">Variants</dt>
              <dd className="font-mono tabular-nums text-[#141517] text-right">
                {selectedProduct.variants.length} finishes
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 py-1 border-b border-[#f1f0ec]">
              <dt className="text-[#7a7e85] shrink-0">3D Rig</dt>
              <dd className="text-[#141517] text-right truncate">
                {selectedProduct.modelAsset.supportsArmArticulation
                  ? 'Articulated pivot'
                  : 'Modular rigid'}
              </dd>
            </div>
            {Object.entries(selectedProduct.specs)
              .slice(0, 3)
              .map(([k, v]) => (
                <div
                  key={k}
                  className="flex items-baseline justify-between gap-3 py-1 border-b border-[#f1f0ec] last:border-b-0"
                >
                  <dt className="text-[#7a7e85] shrink-0">{k}</dt>
                  <dd className="text-[#141517] text-right truncate">{v}</dd>
                </div>
              ))}
          </dl>
        </div>
      </div>

      {/* Primary Action to trigger Gemini Interaction Design */}
      <div className="p-4 border-t border-[#efeeea] bg-[#faf9f6]">
        <button
          type="button"
          onClick={onAnalyzeSelected}
          disabled={isAnalyzing}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#0f6e66] hover:bg-[#0c5952] rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isAnalyzing ? 'Designing 3D Experience…' : 'Analyze & Design 3D'}</span>
        </button>
      </div>
    </aside>
  );
}
