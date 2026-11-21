import { useState } from 'react';
import { Check, Copy, Download, X } from 'lucide-react';
import { buildShopifyEmbedConfig } from '../lib/planLogic';
import type { InteractionPlan, ProductData } from '../types/commerce';
import type { PreviewControlState } from './three/TemplateRegistry';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  product: ProductData;
  plan: InteractionPlan;
  previewState: PreviewControlState;
}

export function ExportModal({
  open,
  onClose,
  product,
  plan,
  previewState,
}: ExportModalProps) {
  const [activeTab, setActiveTab] = useState<'json' | 'liquid'>('json');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const configObject = buildShopifyEmbedConfig(product, plan, previewState);
  const jsonString = JSON.stringify(configObject, null, 2);

  const liquidString = `{% comment %}
  Adaptive 3D Commerce — Shopify Theme App Block
  Product: ${product.title} (${product.handle})
  Template: ${plan.template_id}
{% endcomment %}
<div
  class="adaptive-3d-widget"
  data-shopify-handle="{{ product.handle }}"
  data-template="${plan.template_id}"
  data-cta-label="${plan.storefront_cta_copy.replace(/"/g, '&quot;')}"
>
  <script type="application/json" data-adaptive-3d-config>
${jsonString}
  </script>
  <button type="button" class="button button--secondary" data-adaptive-3d-trigger>
    ${plan.storefront_cta_copy}
  </button>
</div>`;

  const activeContent = activeTab === 'json' ? jsonString : liquidString;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${product.handle}-3d-interaction-plan.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/45"
    >
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden flex flex-col max-h-[88vh]">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 id="export-modal-title" className="text-base font-semibold text-slate-900">
              Export Storefront Configuration
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {product.title} · {plan.template_id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close export modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 pt-3 pb-2 border-b border-slate-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('json')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'json'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              InteractionPlan JSON
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('liquid')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'liquid'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Shopify Liquid Embed
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadJson}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download JSON</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-700 hover:bg-teal-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy Code'}</span>
            </button>
          </div>
        </div>

        <div className="p-6 overflow-auto bg-slate-50 flex-1">
          <pre className="text-xs font-mono text-slate-800 leading-relaxed whitespace-pre-wrap break-words">
            <code>{activeContent}</code>
          </pre>
        </div>
      </div>
    </div>
  );
}
