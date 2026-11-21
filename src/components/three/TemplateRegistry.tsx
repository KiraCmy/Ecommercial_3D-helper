import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Film,
  ImagePlus,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Ruler,
  Sun,
  User,
  Video,
} from 'lucide-react';
import { computeAssemblyStepState, isInteractionActive } from '../../lib/planLogic';
import type { InteractionPlan, ProductData, TemplateId } from '../../types/commerce';
import { RoomSceneStudio } from '../RoomSceneStudio';
import { DimensionMaterialExplorer } from './DimensionMaterialExplorer';
import { LightingExplorer } from './LightingExplorer';

export const templates = {
  lighting_explorer: LightingExplorer,
  dimension_material_explorer: DimensionMaterialExplorer,
} as const satisfies Record<TemplateId, unknown>;

export interface PreviewControlState {
  armAngleDeg: number;
  lightIntensityPct: number;
  selectedVariantId: string;
  showDimensions: boolean;
  showScaleReference: boolean;
}

interface TemplatePreviewStageProps {
  product: ProductData;
  plan: InteractionPlan | null;
  loading: boolean;
  previewState: PreviewControlState;
  onUpdatePreviewState: (patch: Partial<PreviewControlState>) => void;
  initialStageMode?: 'inspect' | 'assembly' | 'room';
  stageResetKey?: number;
}

export function TemplatePreviewStage({
  product,
  plan,
  loading,
  previewState,
  onUpdatePreviewState,
  initialStageMode = 'inspect',
  stageResetKey = 0,
}: TemplatePreviewStageProps) {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<'hero' | 'front' | 'side'>('hero');
  const [stageMode, setStageMode] = useState<'inspect' | 'assembly' | 'room'>(initialStageMode);
  const [assemblyProgress, setAssemblyProgress] = useState(0);
  const [isPlayingAssembly, setIsPlayingAssembly] = useState(initialStageMode === 'assembly');
  const [isRecordingWebm, setIsRecordingWebm] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const activeTemplateId: TemplateId =
    plan?.template_id ??
    (product.modelAsset.geometryArchetype === 'dining_chair'
      ? 'dimension_material_explorer'
      : 'lighting_explorer');

  const rotateZoomEnabled = plan ? isInteractionActive(plan, 'rotate_zoom') : true;
  const dimensionsEnabled = plan ? isInteractionActive(plan, 'dimension_annotations') : true;
  const materialSwitcherEnabled = plan ? isInteractionActive(plan, 'material_switcher') : false;
  const lightSliderEnabled = plan ? isInteractionActive(plan, 'light_intensity_slider') : false;
  const armSliderEnabled = plan ? isInteractionActive(plan, 'lamp_arm_angle_slider') : false;
  const scaleRefEnabled = plan ? isInteractionActive(plan, 'scale_reference') : false;
  const assemblyEnabled = plan ? isInteractionActive(plan, 'assembly_sequence') : false;

  const assemblySteps = plan?.assembly_steps ?? [];
  const totalSteps = Math.max(1, assemblySteps.length);
  const { activeStepIndex } = computeAssemblyStepState(assemblyProgress, totalSteps);
  const currentStep = assemblySteps[activeStepIndex];

  // Reset assembly playback smoothly when switching products or external stage trigger
  useEffect(() => {
    if (initialStageMode === 'assembly' && assemblyEnabled) {
      setStageMode('assembly');
      setAssemblyProgress(0);
      setIsPlayingAssembly(true);
    } else if (initialStageMode === 'room') {
      setStageMode('room');
      setIsPlayingAssembly(false);
    } else {
      setStageMode('inspect');
      setIsPlayingAssembly(false);
      setAssemblyProgress(0);
    }
  }, [product.id, initialStageMode, stageResetKey, assemblyEnabled]);

  useEffect(() => {
    if (!assemblyEnabled && stageMode === 'assembly') {
      setStageMode('inspect');
      setIsPlayingAssembly(false);
    }
  }, [assemblyEnabled, stageMode]);

  // Smooth step-by-step animated playback loop (stops automatically at 100%)
  useEffect(() => {
    if (!isPlayingAssembly || stageMode !== 'assembly') return;
    let rafId = 0;
    let lastTs = performance.now();
    const durationSec = 6.0;

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      setAssemblyProgress((prev) => {
        const next = prev + dt / durationSec;
        if (next >= 1) {
          setIsPlayingAssembly(false);
          return 1;
        }
        return next;
      });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlayingAssembly, stageMode]);

  const handleEnterAssemblyMode = () => {
    setStageMode('assembly');
    setDockCollapsed(false);
    setAssemblyProgress(0);
    setIsPlayingAssembly(true);
  };

  const handleTogglePlay = () => {
    if (assemblyProgress >= 0.99) {
      setAssemblyProgress(0);
    }
    setIsPlayingAssembly((prev) => !prev);
  };

  const handleJumpToStep = (stepIdx: number) => {
    setIsPlayingAssembly(false);
    const targetProgress = (stepIdx + 0.4) / totalSteps;
    setAssemblyProgress(Math.min(1, Math.max(0, targetProgress)));
  };

  const handleExportAssemblyVideo = () => {
    const canvas = canvasRef.current;
    if (!canvas || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
      return;
    }

    try {
      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        setIsRecordingWebm(false);
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${product.handle}-assembly-guide.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };

      setIsRecordingWebm(true);
      setStageMode('assembly');
      setAssemblyProgress(0);
      setIsPlayingAssembly(true);
      recorder.start();

      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 6200);
    } catch {
      setIsRecordingWebm(false);
    }
  };

  const armPlannedItem = plan?.interactions.find((i) => i.type === 'lamp_arm_angle_slider');
  const activeVariant =
    product.variants.find((v) => v.id === previewState.selectedVariantId) ?? product.variants[0];

  const approxLumens = Math.round(
    ((product.lightingSpecs?.maxLumens ?? 850) * previewState.lightIntensityPct) / 100,
  );

  return (
    <section
      aria-label="3D Experience Preview"
      data-testid="three-preview-stage"
      data-template-id={activeTemplateId}
      data-stage-mode={stageMode}
      className="relative flex-1 min-h-[560px] lg:min-h-0 h-full bg-[#f4f3ef] border border-[#e2e1db] rounded-xl overflow-hidden select-none shadow-[0_1px_2px_rgba(20,21,23,0.04)]"
    >
      {/* Non-overlapping Top Studio Header Bar */}
      <div className="absolute top-3.5 inset-x-4 z-10 pointer-events-none flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 pr-2 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 text-[11px] text-[#5f6368] truncate">
            <span className="font-mono font-medium text-[#0f6e66] truncate">{activeTemplateId}</span>
          </div>
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-[#141517] leading-snug truncate">
            {product.title}
          </h2>
          {activeVariant && (
            <p className="text-xs text-[#5f6368] truncate">{activeVariant.label}</p>
          )}
        </div>

        {/* Top-Right View Mode & Camera Angle Switchers */}
        <div className="pointer-events-auto flex items-center gap-1.5 flex-wrap justify-end shrink-0">
          <div className="flex items-center gap-0.5 p-1 bg-white/95 border border-[#e2e1db] rounded-lg shadow-[0_1px_2px_rgba(20,21,23,0.04)]">
            <button
              type="button"
              onClick={() => {
                setStageMode('inspect');
                setIsPlayingAssembly(false);
              }}
              aria-pressed={stageMode === 'inspect'}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                stageMode === 'inspect'
                  ? 'bg-[#141517] text-white'
                  : 'text-[#5f6368] hover:text-[#141517] hover:bg-[#f4f3ef]'
              }`}
            >
              Inspect 3D
            </button>
            {assemblyEnabled && (
              <button
                type="button"
                onClick={handleEnterAssemblyMode}
                aria-pressed={stageMode === 'assembly'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  stageMode === 'assembly'
                    ? 'bg-[#0f6e66] text-white'
                    : 'text-[#5f6368] hover:text-[#141517] hover:bg-[#f4f3ef]'
                }`}
              >
                <Film className="w-3.5 h-3.5" />
                <span>Assembly Video</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setStageMode('room');
                setIsPlayingAssembly(false);
              }}
              aria-pressed={stageMode === 'room'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                stageMode === 'room'
                  ? 'bg-[#0f6e66] text-white'
                  : 'text-[#5f6368] hover:text-[#141517] hover:bg-[#f4f3ef]'
              }`}
            >
              <ImagePlus className="w-3.5 h-3.5" />
              <span>Room Render</span>
            </button>
          </div>

          {stageMode !== 'room' && (
            <div className="flex items-center gap-0.5 p-1 bg-white/95 border border-[#e2e1db] rounded-lg shadow-[0_1px_2px_rgba(20,21,23,0.04)]">
              {(['hero', 'front', 'side'] as const).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCameraPreset(preset)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    cameraPreset === preset
                      ? 'bg-[#0f6e66] text-white'
                      : 'text-[#5f6368] hover:text-[#141517] hover:bg-[#f4f3ef]'
                  }`}
                >
                  {preset === 'hero' ? '3/4 View' : preset === 'front' ? 'Front' : 'Profile'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Stage Content: 3D Explorer OR In-Room AI Scene Render */}
      <div className="w-full h-full">
        {stageMode === 'room' ? (
          <RoomSceneStudio
            product={product}
            selectedVariantId={previewState.selectedVariantId}
          />
        ) : activeTemplateId === 'lighting_explorer' ? (
          <LightingExplorer
            product={product}
            visualProfile={plan?.visual_3d_profile}
            armAngleDeg={previewState.armAngleDeg}
            lightIntensityPct={previewState.lightIntensityPct}
            selectedVariantId={previewState.selectedVariantId}
            showDimensions={dimensionsEnabled && previewState.showDimensions}
            rotateZoomEnabled={rotateZoomEnabled}
            cameraPreset={cameraPreset}
            assemblyMode={stageMode === 'assembly'}
            assemblyProgress={assemblyProgress}
            onCanvasReady={(el) => {
              canvasRef.current = el;
            }}
          />
        ) : (
          <DimensionMaterialExplorer
            product={product}
            visualProfile={plan?.visual_3d_profile}
            selectedVariantId={previewState.selectedVariantId}
            showDimensions={dimensionsEnabled && previewState.showDimensions}
            showScaleReference={scaleRefEnabled && previewState.showScaleReference}
            rotateZoomEnabled={rotateZoomEnabled}
            cameraPreset={cameraPreset}
            assemblyMode={stageMode === 'assembly'}
            assemblyProgress={assemblyProgress}
            onCanvasReady={(el) => {
              canvasRef.current = el;
            }}
          />
        )}
      </div>

      {/* Loading overlay while Gemini plans interaction */}
      {loading && stageMode !== 'room' && (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-20 flex items-center justify-center bg-[#f4f3ef]/80"
        >
          <div className="px-5 py-3.5 bg-white border border-[#e2e1db] rounded-xl shadow-sm text-center">
            <p className="text-sm font-medium text-[#141517]">
              Analyzing product structure &amp; buyer concerns…
            </p>
            <p className="text-xs text-[#5f6368] mt-1">
              Designing 3D controls &amp; step-by-step assembly sequence
            </p>
          </div>
        </div>
      )}

      {/* Collapsible Unified Bottom Control Dock (only shown for 3D Inspect & Assembly modes) */}
      {stageMode !== 'room' && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 w-[calc(100%-2rem)] max-w-[820px] flex flex-col items-center">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          aria-expanded={!dockCollapsed}
          className="mb-1.5 inline-flex items-center gap-1.5 px-3 py-1 bg-white/95 border border-[#e2e1db] rounded-md text-xs font-medium text-[#5f6368] hover:text-[#141517] transition-colors whitespace-nowrap shrink-0"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              <span>Show Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              <span>Hide Controls</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="w-full bg-white/96 border border-[#e2e1db] rounded-xl px-4 py-3 shadow-[0_4px_16px_rgba(20,21,23,0.06)]">
            {stageMode === 'assembly' ? (
              <div className="space-y-2.5">
                {/* Active Step Instruction Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#0f6e66] tabular-nums">
                        Step {activeStepIndex + 1}/{totalSteps}
                      </span>
                      <span aria-hidden="true" className="text-[#c5c4be]">·</span>
                      <span className="font-semibold text-[#141517] truncate">
                        {currentStep?.title ?? 'Assembly Sequence'}
                      </span>
                    </div>
                    <p className="text-xs text-[#5f6368] mt-0.5 leading-snug">
                      {currentStep?.instruction ?? 'Scrub or play to inspect step-by-step assembly.'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleExportAssemblyVideo}
                    disabled={isRecordingWebm}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#141517] bg-[#f4f3ef] hover:bg-[#e9e8e2] border border-[#e2e1db] rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
                  >
                    <Video className="w-3.5 h-3.5 text-[#0f6e66]" />
                    <span>{isRecordingWebm ? 'Recording…' : 'Export .webm'}</span>
                  </button>
                </div>

                {/* Step Selector Tabs + Playback Controls + Scrubber */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      aria-label={isPlayingAssembly ? 'Pause assembly video' : 'Play assembly video'}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0f6e66] hover:bg-[#0c5952] rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      {isPlayingAssembly ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          <span>Play</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAssemblyProgress(0);
                        setIsPlayingAssembly(true);
                      }}
                      aria-label="Replay"
                      title="Replay assembly"
                      className="p-1.5 text-[#5f6368] hover:text-[#141517] bg-[#f4f3ef] hover:bg-[#e9e8e2] border border-[#e2e1db] rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Timeline Scrubber */}
                  <div className="flex-1 min-w-[160px] flex items-center gap-2.5">
                    <label htmlFor="assembly-scrubber" className="sr-only">
                      Assembly timeline progress
                    </label>
                    <input
                      id="assembly-scrubber"
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(assemblyProgress * 100)}
                      onChange={(e) => {
                        setIsPlayingAssembly(false);
                        setAssemblyProgress(Number(e.target.value) / 100);
                      }}
                      className="w-full studio-slider"
                    />
                    <span className="font-mono tabular-nums text-[11px] text-[#5f6368] w-9 text-right shrink-0">
                      {Math.round(assemblyProgress * 100)}%
                    </span>
                  </div>

                  {/* Direct Step Jump Buttons */}
                  <div className="flex items-center gap-1 p-0.5 bg-[#f4f3ef] rounded-lg shrink-0">
                    {assemblySteps.map((st, idx) => (
                      <button
                        key={st.step}
                        type="button"
                        onClick={() => handleJumpToStep(idx)}
                        className={`px-2 py-1 text-[11px] font-mono font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          idx === activeStepIndex
                            ? 'bg-white text-[#141517] shadow-xs'
                            : 'text-[#5f6368] hover:text-[#141517]'
                        }`}
                      >
                        S{idx + 1}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : activeTemplateId === 'lighting_explorer' ? (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex-1 min-w-[185px]">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <label
                      htmlFor="arm-angle-slider"
                      className="font-medium text-[#141517] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      {!armSliderEnabled && <Lock className="w-3 h-3 text-slate-400" />}
                      <span>Arm Angle</span>
                    </label>
                    <span className="font-mono tabular-nums text-[#5f6368] whitespace-nowrap shrink-0">
                      {armSliderEnabled ? `${previewState.armAngleDeg}°` : 'Locked'}
                    </span>
                  </div>
                  <input
                    id="arm-angle-slider"
                    type="range"
                    min={product.lightingSpecs?.adjustableArmRangeDeg?.[0] ?? 15}
                    max={product.lightingSpecs?.adjustableArmRangeDeg?.[1] ?? 75}
                    value={previewState.armAngleDeg}
                    disabled={!armSliderEnabled}
                    onChange={(e) =>
                      onUpdatePreviewState({ armAngleDeg: Number(e.target.value) })
                    }
                    className="w-full studio-slider"
                  />
                  {!armSliderEnabled && armPlannedItem?.reason && (
                    <p className="text-[11px] text-[#5f6368] mt-1 truncate" title={armPlannedItem.reason}>
                      {armPlannedItem.reason}
                    </p>
                  )}
                </div>

                <div className="flex-1 min-w-[205px]">
                  <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                    <label
                      htmlFor="light-intensity-slider"
                      className="font-medium text-[#141517] flex items-center gap-1.5 whitespace-nowrap shrink-0"
                    >
                      <Sun className="w-3.5 h-3.5 text-[#0f6e66]" />
                      <span>Brightness</span>
                      <span className="text-[11px] text-[#80858c] font-normal">(Illustrative)</span>
                    </label>
                    <span className="font-mono tabular-nums text-[#5f6368] whitespace-nowrap shrink-0">
                      {previewState.lightIntensityPct}% · {approxLumens} lm
                    </span>
                  </div>
                  <input
                    id="light-intensity-slider"
                    type="range"
                    min={0}
                    max={100}
                    value={previewState.lightIntensityPct}
                    disabled={!lightSliderEnabled}
                    onChange={(e) =>
                      onUpdatePreviewState({ lightIntensityPct: Number(e.target.value) })
                    }
                    className="w-full studio-slider"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {product.variants.length > 1 && (
                    <div className="flex items-center gap-1.5 pr-2 border-r border-[#e2e1db]">
                      {product.variants.map((variant) => (
                        <button
                          key={variant.id}
                          type="button"
                          aria-label={`Select finish ${variant.label}`}
                          title={variant.label}
                          onClick={() => onUpdatePreviewState({ selectedVariantId: variant.id })}
                          className={`w-6 h-6 rounded-full border transition-transform ${
                            previewState.selectedVariantId === variant.id
                              ? 'border-[#0f6e66] ring-2 ring-[#0f6e66]/25 scale-105'
                              : 'border-slate-300 hover:scale-105'
                          }`}
                          style={{ backgroundColor: variant.colorHex }}
                        />
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={!dimensionsEnabled}
                    aria-pressed={dimensionsEnabled && previewState.showDimensions}
                    onClick={() =>
                      onUpdatePreviewState({ showDimensions: !previewState.showDimensions })
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                      !dimensionsEnabled
                        ? 'border-[#e2e1db] text-slate-400 bg-[#f4f3ef] cursor-not-allowed'
                        : previewState.showDimensions
                          ? 'border-[#0f6e66] bg-[#eef6f5] text-[#0f6e66]'
                          : 'border-[#e2e1db] bg-white text-[#141517] hover:bg-[#f4f3ef]'
                    }`}
                  >
                    <Ruler className="w-3.5 h-3.5" />
                    <span>Dimensions</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-[#5f6368]">
                    Finish{materialSwitcherEnabled ? '' : ' (Locked)'}:
                  </span>
                  <div className="flex items-center gap-1.5">
                    {product.variants.map((variant) => {
                      const active = previewState.selectedVariantId === variant.id;
                      return (
                        <button
                          key={variant.id}
                          type="button"
                          disabled={!materialSwitcherEnabled}
                          aria-label={`Finish ${variant.label}`}
                          aria-pressed={active}
                          onClick={() => onUpdatePreviewState({ selectedVariantId: variant.id })}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition-colors whitespace-nowrap shrink-0 ${
                            !materialSwitcherEnabled
                              ? 'opacity-50 cursor-not-allowed border-[#e2e1db] text-slate-500'
                              : active
                                ? 'border-[#0f6e66] bg-[#eef6f5] text-[#0f6e66] font-medium'
                                : 'border-[#e2e1db] bg-white text-[#141517] hover:border-[#c8c7c0]'
                          }`}
                        >
                          <span
                            className="w-3 h-3 rounded-full border border-black/15 shrink-0"
                            style={{ backgroundColor: variant.colorHex }}
                          />
                          <span>{variant.label.split('·')[0].trim()}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={!dimensionsEnabled}
                    aria-pressed={dimensionsEnabled && previewState.showDimensions}
                    onClick={() =>
                      onUpdatePreviewState({ showDimensions: !previewState.showDimensions })
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                      !dimensionsEnabled
                        ? 'border-[#e2e1db] text-slate-400 bg-[#f4f3ef] cursor-not-allowed'
                        : previewState.showDimensions
                          ? 'border-[#0f6e66] bg-[#eef6f5] text-[#0f6e66]'
                          : 'border-[#e2e1db] bg-white text-[#141517] hover:bg-[#f4f3ef]'
                    }`}
                  >
                    <Ruler className="w-3.5 h-3.5" />
                    <span>Dimensions</span>
                  </button>

                  <button
                    type="button"
                    disabled={!scaleRefEnabled}
                    aria-pressed={scaleRefEnabled && previewState.showScaleReference}
                    onClick={() =>
                      onUpdatePreviewState({ showScaleReference: !previewState.showScaleReference })
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                      !scaleRefEnabled
                        ? 'border-[#e2e1db] text-slate-400 bg-[#f4f3ef] cursor-not-allowed'
                        : previewState.showScaleReference
                          ? 'border-[#0f6e66] bg-[#eef6f5] text-[#0f6e66]'
                          : 'border-[#e2e1db] bg-white text-[#141517] hover:bg-[#f4f3ef]'
                    }`}
                  >
                    <User className="w-3.5 h-3.5" />
                    <span>175 cm Scale</span>
                  </button>
                </div>
              </div>
            )}

            <div className="mt-2 pt-2 border-t border-[#efeeea] flex items-center justify-between text-[11px] text-[#7a7e85]">
              <span>
                {stageMode === 'assembly'
                  ? 'Drag timeline or click S1–S4 · Orbit anytime to inspect joinery'
                  : rotateZoomEnabled
                    ? 'Drag to orbit · Scroll to zoom'
                    : 'Orbit disabled by merchant setting'}
              </span>
              <span className="font-mono tabular-nums">
                {plan?.storefront_cta_copy ?? 'Explore in 3D'}
              </span>
            </div>
          </div>
        )}
        </div>
      )}
    </section>
  );
}
