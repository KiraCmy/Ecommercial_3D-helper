import { AlertCircle, Check, Eye, Lock, RefreshCw } from 'lucide-react';
import type {
  InteractionPlan,
  InteractionType,
  MerchantOverrides,
  ProductData,
} from '../types/commerce';

interface InteractionPlanPanelProps {
  product: ProductData;
  basePlan: InteractionPlan | null;
  effectivePlan: InteractionPlan | null;
  overrides: MerchantOverrides;
  isAnalyzing: boolean;
  analyzeError: string | null;
  hasSnapshotFallback: boolean;
  onLoadSnapshotFallback: () => void;
  onRetryAnalyze: () => void;
  onToggleInteraction: (type: InteractionType, nextEnabled: boolean) => void;
  onUpdateCtaCopy: (copy: string) => void;
}

export function InteractionPlanPanel({
  product,
  basePlan,
  effectivePlan,
  overrides,
  isAnalyzing,
  analyzeError,
  hasSnapshotFallback,
  onLoadSnapshotFallback,
  onRetryAnalyze,
  onToggleInteraction,
  onUpdateCtaCopy,
}: InteractionPlanPanelProps) {
  return (
    <aside
      aria-label="AI Interaction Plan"
      className="w-full lg:w-[340px] xl:w-[370px] shrink-0 flex flex-col bg-white border border-[#e2e1db] rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(20,21,23,0.03)]"
    >
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-[#efeeea] flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold tracking-[-0.01em] text-[#141517]">
            AI Interaction Plan
          </h2>
          <p className="text-xs text-[#5f6368] mt-0.5 truncate">
            {effectivePlan
              ? `${effectivePlan.source === 'snapshot_fallback' ? 'Snapshot' : 'Gemini Live'} · ${effectivePlan.template_id}`
              : 'Awaiting interaction reasoning'}
          </p>
        </div>
        <button
          type="button"
          onClick={onRetryAnalyze}
          disabled={isAnalyzing}
          aria-label="Regenerate AI interaction plan"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#141517] bg-[#f4f3ef] hover:bg-[#e9e8e2] border border-[#e2e1db] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${isAnalyzing ? 'animate-spin' : ''}`} />
          <span>Re-plan</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Transparent Error & Snapshot Fallback Banner */}
        {analyzeError && (
          <div
            role="alert"
            className="p-3.5 rounded-lg border border-amber-200 bg-amber-50/70 text-xs text-amber-950 space-y-2.5"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Live AI Planning Unavailable</p>
                <p className="text-amber-900/90 mt-0.5 leading-relaxed">{analyzeError}</p>
              </div>
            </div>
            {hasSnapshotFallback && (
              <button
                type="button"
                onClick={onLoadSnapshotFallback}
                className="w-full py-1.5 px-3 text-xs font-semibold text-amber-950 bg-white border border-amber-300 hover:bg-amber-100/70 rounded-md transition-colors"
              >
                Load Verified Snapshot Plan
              </button>
            )}
          </div>
        )}

        {/* Loading Skeleton */}
        {isAnalyzing && !effectivePlan && (
          <div className="space-y-4 animate-pulse" aria-busy="true">
            <div className="h-4 bg-[#f1f0ec] rounded w-2/3" />
            <div className="h-16 bg-[#f1f0ec] rounded" />
            <div className="h-24 bg-[#f1f0ec] rounded" />
          </div>
        )}

        {effectivePlan && (
          <>
            {/* 00. Multimodal Visual Inspection from Product Photography */}
            {effectivePlan.visual_3d_profile && (
              <section className="p-3 rounded-lg bg-[#eef6f5]/60 border border-[#0f6e66]/20 space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#0f6e66]">
                    <Eye className="w-3.5 h-3.5" />
                    <span>Photo-to-3D Inspection</span>
                  </span>
                  <span className="font-mono text-[11px] text-[#5f6368]">
                    {effectivePlan.analyzed_image_count
                      ? `${effectivePlan.analyzed_image_count} photo(s) analyzed`
                      : 'Spec profile'}
                  </span>
                </div>
                <p className="text-xs text-[#2a2d32] leading-relaxed">
                  {effectivePlan.visual_3d_profile.visual_details_summary}
                </p>
                {effectivePlan.visual_3d_profile.observed_materials.length > 0 && (
                  <p className="text-[11px] font-mono text-[#5f6368] truncate">
                    {effectivePlan.visual_3d_profile.observed_materials.join(' · ')}
                  </p>
                )}
              </section>
            )}

            {/* 01. Purchase Decision Hypothesis */}
            <section>
              <h3 className="text-xs font-semibold text-[#141517] mb-1.5">
                01. Purchase Decision Hypothesis
              </h3>
              <p className="text-[13px] text-[#2a2d32] leading-relaxed bg-[#faf9f6] border border-[#e6e5df] rounded-lg p-3">
                {effectivePlan.purchase_decision_hypothesis}
              </p>
              <p className="text-xs text-[#5f6368] mt-2 leading-relaxed">
                <span className="font-medium text-[#141517]">Why this template: </span>
                {effectivePlan.merchant_explanation}
              </p>
            </section>

            {/* 02. Prioritized Customer Concerns */}
            <section className="pt-4 border-t border-[#efeeea]">
              <h3 className="text-xs font-semibold text-[#141517] mb-2.5">
                02. Key Buyer Concerns
              </h3>
              <ol className="space-y-2.5">
                {effectivePlan.customer_concerns.map((concern) => (
                  <li key={concern.concern} className="flex items-start gap-2.5 text-xs">
                    <span className="font-mono tabular-nums text-[11px] font-semibold text-[#0f6e66] mt-0.5 shrink-0">
                      0{concern.priority}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-[#141517]">{concern.label}</div>
                      <p className="text-[#5f6368] mt-0.5 leading-snug">{concern.reason}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            {/* 03. Planned Capabilities & Merchant Toggles */}
            <section className="pt-4 border-t border-[#efeeea]">
              <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-xs font-semibold text-[#141517]">
                  03. 3D Controls &amp; Validation
                </h3>
                <span className="text-[11px] font-mono tabular-nums text-[#7a7e85]">
                  {effectivePlan.interactions.filter((i) => i.enabled).length}/
                  {effectivePlan.interactions.length} active
                </span>
              </div>

              <div className="space-y-2">
                {effectivePlan.interactions.map((interaction) => {
                  const hardwareLocked =
                    (interaction.type === 'lamp_arm_angle_slider' &&
                      !product.modelAsset.supportsArmArticulation) ||
                    (interaction.type === 'material_switcher' && product.variants.length < 2);

                  return (
                    <div
                      key={interaction.type}
                      className={`p-2.5 rounded-lg border transition-colors ${
                        hardwareLocked
                          ? 'border-[#e2e1db] bg-[#faf9f6]'
                          : interaction.enabled
                            ? 'border-[#e2e1db] bg-white'
                            : 'border-[#efeeea] bg-[#faf9f6]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            {hardwareLocked && (
                              <Lock className="w-3 h-3 text-[#8a8e95] shrink-0" />
                            )}
                            <span className="text-xs font-medium text-[#141517] truncate">
                              {interaction.label}
                            </span>
                          </div>
                          <div className="text-[11px] text-[#7a7e85] mt-0.5 flex items-center gap-1.5">
                            <span className="font-mono">{interaction.type}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {interaction.mode === 'illustrative' ? 'Illustrative' : 'Verified'}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={interaction.enabled}
                          aria-label={`Toggle ${interaction.label}`}
                          disabled={hardwareLocked}
                          onClick={() =>
                            onToggleInteraction(interaction.type, !interaction.enabled)
                          }
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f6e66] ${
                            hardwareLocked
                              ? 'bg-[#d7d6d0] cursor-not-allowed'
                              : interaction.enabled
                                ? 'bg-[#0f6e66]'
                                : 'bg-[#c9c8c2]'
                          }`}
                        >
                          <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                              interaction.enabled ? 'translate-x-4.5' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                      <p className="text-[11px] text-[#5f6368] mt-1.5 leading-snug">
                        {interaction.reason}
                      </p>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 04. Planned Step-by-Step Assembly Script */}
            {effectivePlan.assembly_steps.length > 0 && (
              <section className="pt-4 border-t border-[#efeeea]">
                <h3 className="text-xs font-semibold text-[#141517] mb-2">
                  04. Dynamic Assembly Script
                </h3>
                <ol className="space-y-2">
                  {effectivePlan.assembly_steps.map((st) => (
                    <li key={st.step} className="text-xs flex items-start gap-2">
                      <span className="font-mono tabular-nums text-[11px] font-semibold text-[#0f6e66] mt-0.5 shrink-0">
                        S{st.step}
                      </span>
                      <div className="min-w-0">
                        <div className="font-medium text-[#141517]">{st.title}</div>
                        <p className="text-[11px] text-[#5f6368] leading-snug">{st.instruction}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            {/* 05. Data Grounding & Storefront Copy */}
            <section className="pt-4 border-t border-[#efeeea] space-y-3">
              <h3 className="text-xs font-semibold text-[#141517]">
                05. Data Grounding &amp; Storefront Copy
              </h3>

              <div className="grid grid-cols-1 gap-2.5 text-xs">
                <div>
                  <div className="text-[11px] font-medium text-[#3b3f45] mb-1">Known Data</div>
                  <ul className="space-y-1 text-[11px] text-[#5f6368]">
                    {effectivePlan.known_data.map((item) => (
                      <li key={item} className="flex items-start gap-1.5">
                        <Check className="w-3.5 h-3.5 text-[#0f6e66] shrink-0 mt-0.5" />
                        <span className="font-mono">{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <div className="text-[11px] font-medium text-[#3b3f45] mb-1">
                    Missing / Unverified Data
                  </div>
                  {effectivePlan.missing_data.length === 0 ? (
                    <p className="text-[11px] text-[#5f6368]">All required fields verified.</p>
                  ) : (
                    <ul className="space-y-1 text-[11px] text-amber-900">
                      {effectivePlan.missing_data.map((item) => (
                        <li key={item} className="flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <span className="font-mono">{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="pt-2">
                <label
                  htmlFor="storefront-cta-input"
                  className="block text-[11px] font-medium text-[#3b3f45] mb-1"
                >
                  Storefront Button Label
                </label>
                <input
                  id="storefront-cta-input"
                  type="text"
                  value={overrides.customCtaCopy ?? basePlan?.storefront_cta_copy ?? ''}
                  onChange={(e) => onUpdateCtaCopy(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs bg-[#f7f6f3] border border-[#e2e1db] rounded-lg text-[#141517] focus:outline-none focus:border-[#0f6e66] focus:bg-white transition-colors"
                />
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
