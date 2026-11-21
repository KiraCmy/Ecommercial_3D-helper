import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Store, Wrench } from 'lucide-react';
import { CURATED_TEST_PRODUCTS, SNAPSHOT_FALLBACK_PLANS } from './data/catalog';
import { applyMerchantOverrides } from './lib/planLogic';
import { ExportModal } from './components/ExportModal';
import { InteractionPlanPanel } from './components/InteractionPlanPanel';
import { ProductInputPanel } from './components/ProductInputPanel';
import { StorefrontPage } from './components/StorefrontPage';
import { TemplatePreviewStage, type PreviewControlState } from './components/three/TemplateRegistry';
import type {
  InteractionPlan,
  InteractionType,
  MerchantOverrides,
  ProductData,
} from './types/commerce';

const EMPTY_OVERRIDES: MerchantOverrides = {
  disabledTypes: {},
  enabledTypes: {},
};

export default function App() {
  const [viewMode, setViewMode] = useState<'merchant' | 'storefront'>('merchant');
  const [products, setProducts] = useState<ProductData[]>(CURATED_TEST_PRODUCTS);
  const [selectedProductId, setSelectedProductId] = useState<string>(
    CURATED_TEST_PRODUCTS[0].id,
  );
  const [shopifyLoading, setShopifyLoading] = useState<boolean>(true);
  const [shopifyConnectionMode, setShopifyConnectionMode] = useState<string>('syncing');

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? products[0],
    [products, selectedProductId],
  );

  const [plansByProductId, setPlansByProductId] = useState<Record<string, InteractionPlan>>({});
  const [overridesByProductId, setOverridesByProductId] = useState<
    Record<string, MerchantOverrides>
  >({});
  const [previewStateByProductId, setPreviewStateByProductId] = useState<
    Record<string, PreviewControlState>
  >({});

  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState<boolean>(false);

  const analyzeAbortRef = useRef<AbortController | null>(null);
  const userInteractedRef = useRef<boolean>(false);

  // Sync live real Shopify catalog on mount
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/shopify/catalog');
        if (!res.ok) throw new Error('Catalog fetch failed');
        const data = (await res.json()) as {
          products?: ProductData[];
          connectionMode?: string;
        };
        if (!active) return;
        if (data.products && data.products.length > 0) {
          setProducts(data.products);
          if (!userInteractedRef.current) {
            setSelectedProductId(data.products[0].id);
          }
          setShopifyConnectionMode(data.connectionMode ?? 'shopify_public_json');
        } else {
          setShopifyConnectionMode('fallback_fixture');
        }
      } catch {
        if (!active) return;
        setShopifyConnectionMode('fallback_fixture');
      } finally {
        if (active) setShopifyLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const runGeminiAnalysis = useCallback(async (product: ProductData, forceRefresh = false) => {
    analyzeAbortRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortRef.current = controller;

    if (forceRefresh) {
      setPlansByProductId((prev) => {
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
    }

    setIsAnalyzing(true);
    setAnalyzeError(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ product }),
      });

      const data = (await response.json()) as {
        plan?: InteractionPlan;
        error?: string;
      };

      if (!response.ok || !data.plan) {
        setAnalyzeError(
          data.error || 'Gemini interaction analysis failed. Review product data or load snapshot.',
        );
        return;
      }

      setPlansByProductId((prev) => ({
        ...prev,
        [product.id]: data.plan!,
      }));
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setAnalyzeError('Network error reaching /api/analyze. Check server connection.');
    } finally {
      if (analyzeAbortRef.current === controller) {
        setIsAnalyzing(false);
      }
    }
  }, []);

  // Automatically analyze active product once initial Shopify catalog sync settles
  useEffect(() => {
    if (shopifyLoading) return;
    if (!plansByProductId[selectedProduct.id]) {
      void runGeminiAnalysis(selectedProduct);
    }
  }, [shopifyLoading, selectedProduct, plansByProductId, runGeminiAnalysis]);

  const basePlan = plansByProductId[selectedProduct.id] ?? null;
  const overrides = overridesByProductId[selectedProduct.id] ?? EMPTY_OVERRIDES;

  const effectivePlan = useMemo(() => {
    if (!basePlan) return null;
    return applyMerchantOverrides(basePlan, overrides, selectedProduct);
  }, [basePlan, overrides, selectedProduct]);

  const previewState: PreviewControlState = useMemo(() => {
    const existing = previewStateByProductId[selectedProduct.id];
    if (existing) return existing;
    return {
      armAngleDeg: 42,
      lightIntensityPct: 78,
      selectedVariantId: selectedProduct.variants[0]?.id ?? 'default',
      showDimensions: true,
      showScaleReference: true,
    };
  }, [previewStateByProductId, selectedProduct]);

  const handleUpdatePreviewState = (patch: Partial<PreviewControlState>) => {
    setPreviewStateByProductId((prev) => ({
      ...prev,
      [selectedProduct.id]: {
        ...previewState,
        ...patch,
      },
    }));
  };

  const handleSelectProduct = (product: ProductData) => {
    userInteractedRef.current = true;
    setAnalyzeError(null);
    setSelectedProductId(product.id);
  };

  const handleImportShopifyProducts = (importedList: ProductData[]) => {
    if (importedList.length === 0) return;
    userInteractedRef.current = true;
    setProducts((prev) => {
      const importedIds = new Set(importedList.map((i) => i.id));
      return [...importedList, ...prev.filter((p) => !importedIds.has(p.id))];
    });
    setAnalyzeError(null);
    setSelectedProductId(importedList[0].id);
    void runGeminiAnalysis(importedList[0], true);
  };

  const handleToggleInteraction = (type: InteractionType, nextEnabled: boolean) => {
    setOverridesByProductId((prev) => {
      const curr = prev[selectedProduct.id] ?? EMPTY_OVERRIDES;
      const nextDisabled = { ...curr.disabledTypes };
      const nextEnabledMap = { ...curr.enabledTypes };
      if (nextEnabled) {
        delete nextDisabled[type];
        nextEnabledMap[type] = true;
      } else {
        delete nextEnabledMap[type];
        nextDisabled[type] = true;
      }
      return {
        ...prev,
        [selectedProduct.id]: {
          ...curr,
          disabledTypes: nextDisabled,
          enabledTypes: nextEnabledMap,
        },
      };
    });
  };

  const handleUpdateCtaCopy = (copy: string) => {
    setOverridesByProductId((prev) => {
      const curr = prev[selectedProduct.id] ?? EMPTY_OVERRIDES;
      return {
        ...prev,
        [selectedProduct.id]: {
          ...curr,
          customCtaCopy: copy,
        },
      };
    });
  };

  const snapshotFallback = SNAPSHOT_FALLBACK_PLANS[selectedProduct.id];
  const handleLoadSnapshotFallback = () => {
    if (!snapshotFallback) return;
    setPlansByProductId((prev) => ({
      ...prev,
      [selectedProduct.id]: snapshotFallback,
    }));
    setAnalyzeError(null);
  };

  const shopifyConnectionLabel =
    shopifyConnectionMode === 'storefront_graphql'
      ? 'Shopify Storefront API'
      : shopifyConnectionMode === 'shopify_public_json'
        ? 'Shopify Live Catalog'
        : 'Catalog Items';

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#f6f5f2] text-[#141517]">
      {/* 3-Zone Top Bar Contract */}
      <header className="h-14 px-6 border-b border-[#e2e1db] flex items-center justify-between gap-6 shrink-0 bg-white">
        {/* Zone 1: Single-element wordmark */}
        <a
          href="/"
          className="text-[15px] font-bold tracking-[-0.02em] text-[#141517] whitespace-nowrap shrink-0"
        >
          Adaptive 3D Commerce
        </a>

        {/* Zone 2: Merchant Studio vs Consumer Storefront Demo Mode Switcher */}
        <nav
          aria-label="Workspace View Switcher"
          className="flex items-center gap-1 p-1 bg-[#f4f3ef] border border-[#e2e1db] rounded-lg"
        >
          <button
            type="button"
            onClick={() => setViewMode('merchant')}
            aria-pressed={viewMode === 'merchant'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'merchant'
                ? 'bg-white text-[#141517] shadow-xs font-semibold'
                : 'text-[#5f6368] hover:text-[#141517]'
            }`}
          >
            <Wrench className="w-3.5 h-3.5 text-[#0f6e66]" />
            <span>Merchant Studio</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('storefront')}
            aria-pressed={viewMode === 'storefront'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              viewMode === 'storefront'
                ? 'bg-[#0f6e66] text-white shadow-xs font-semibold'
                : 'text-[#5f6368] hover:text-[#141517]'
            }`}
          >
            <Store className="w-3.5 h-3.5" />
            <span>Storefront Demo</span>
          </button>
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            disabled={!effectivePlan}
            onClick={() => setExportOpen(true)}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0f6e66] hover:bg-[#0c5952] rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            Export Config
          </button>
        </div>
      </header>

      {viewMode === 'merchant' ? (
        <main className="flex-1 min-h-0 p-4 lg:p-5 flex flex-col lg:flex-row gap-4 lg:gap-5 bg-[#f6f5f2]">
          <ProductInputPanel
            products={products}
            selectedProduct={selectedProduct}
            onSelectProduct={handleSelectProduct}
            onImportShopifyProducts={handleImportShopifyProducts}
            onAnalyzeSelected={() => void runGeminiAnalysis(selectedProduct, true)}
            isAnalyzing={isAnalyzing}
            shopifyLoading={shopifyLoading}
            shopifyConnectionLabel={shopifyConnectionLabel}
          />

          <TemplatePreviewStage
            product={selectedProduct}
            plan={effectivePlan}
            loading={isAnalyzing || shopifyLoading}
            previewState={previewState}
            onUpdatePreviewState={handleUpdatePreviewState}
          />

          <InteractionPlanPanel
            product={selectedProduct}
            basePlan={basePlan}
            effectivePlan={effectivePlan}
            overrides={overrides}
            isAnalyzing={isAnalyzing || shopifyLoading}
            analyzeError={analyzeError}
            hasSnapshotFallback={Boolean(snapshotFallback)}
            onLoadSnapshotFallback={handleLoadSnapshotFallback}
            onRetryAnalyze={() => void runGeminiAnalysis(selectedProduct, true)}
            onToggleInteraction={handleToggleInteraction}
            onUpdateCtaCopy={handleUpdateCtaCopy}
          />
        </main>
      ) : (
        <StorefrontPage
          products={products}
          selectedProduct={selectedProduct}
          plan={effectivePlan}
          isAnalyzing={isAnalyzing || shopifyLoading}
          previewState={previewState}
          onSelectProduct={handleSelectProduct}
          onUpdatePreviewState={handleUpdatePreviewState}
          onBackToStudio={() => setViewMode('merchant')}
        />
      )}

      {effectivePlan && (
        <ExportModal
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          product={selectedProduct}
          plan={effectivePlan}
          previewState={previewState}
        />
      )}
    </div>
  );
}
