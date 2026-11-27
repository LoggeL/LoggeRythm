"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { exportCanvasToPngBlob, type WrappedCardOptions, type WrappedReport } from "@/lib/wrapped";
import {
  getWrappedCanvasDimensions,
  loadWrappedAssets,
  renderWrappedCard,
  type WrappedAssets,
} from "@/lib/wrappedCanvas";
import { SpinnerIcon } from "@/components/icons";
import { AlertCircleIcon } from "@/components/feedbackIcons";
import {
  errorMessage,
  findWrappedTheme,
  usePrefersReducedMotion,
} from "./WrappedExperience";

export interface WrappedCardPreviewHandle {
  exportPngBlob: () => Promise<Blob>;
  getCanvas: () => HTMLCanvasElement | null;
}

export interface WrappedCardPreviewProps {
  report: WrappedReport;
  options: WrappedCardOptions;
  enableTilt?: boolean;
  className?: string;
}

type AssetLoadState = {
  report: WrappedReport;
  assets: WrappedAssets | null;
  error: string | null;
};

type RenderState = {
  key: string;
  error: string | null;
};

const WrappedCardPreview = forwardRef<WrappedCardPreviewHandle, WrappedCardPreviewProps>(
  function WrappedCardPreview({ report, options, enableTilt = false, className = "" }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const renderPromiseRef = useRef<Promise<{ error: string | null }> | null>(null);
    const prefersReducedMotion = usePrefersReducedMotion();

    const [assetState, setAssetState] = useState<AssetLoadState | null>(null);
    const [renderState, setRenderState] = useState<RenderState | null>(null);
    const [tilt, setTilt] = useState<{ rx: number; ry: number }>({ rx: 0, ry: 0 });

    const dimensions = getWrappedCanvasDimensions(options.format);
    const isStory = options.format === "story";

    useEffect(() => {
      let cancelled = false;
      loadWrappedAssets(report)
        .then((assets) => {
          if (cancelled) return;
          setAssetState({ report, assets, error: null });
        })
        .catch((cause) => {
          if (cancelled) return;
          setAssetState({
            report,
            assets: null,
            error: `Artwork-Assets konnten nicht geladen werden: ${errorMessage(cause)}`,
          });
        });
      return () => {
        cancelled = true;
      };
    }, [report]);

    const currentAssetState = assetState && assetState.report === report ? assetState : null;
    const assetsLoading = currentAssetState === null;
    const assets = currentAssetState?.assets ?? null;
    const assetsError = currentAssetState?.error ?? null;

    const renderKey = useMemo(
      () =>
        `${report.range}:${report.generated_at}:${report.totals.play_count}:${options.template}:${options.theme}:${options.format}:${options.showUser}:${options.showCounts}:${assets ? assets.images.size : "none"}:${assets ? assets.failedUrls.length : 0}`,
      [report, options, assets],
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas || !assets) return;
      let cancelled = false;
      const promise = renderWrappedCard(canvas, report, options, assets)
        .then(() => {
          if (!cancelled) setRenderState({ key: renderKey, error: null });
          return { error: null };
        })
        .catch((cause) => {
          const message = `Share-Card konnte nicht gerendert werden: ${errorMessage(cause)}`;
          if (!cancelled) {
            setRenderState({ key: renderKey, error: message });
          }
          return { error: message };
        });
      renderPromiseRef.current = promise;
      return () => {
        cancelled = true;
      };
    }, [report, options, assets, renderKey]);

    const isRendering = Boolean(assets) && renderState?.key !== renderKey;
    const renderError = renderState?.key === renderKey ? renderState.error : null;

    useImperativeHandle(
      ref,
      () => ({
        getCanvas: () => canvasRef.current,
        exportPngBlob: async () => {
          if (assetsError) {
            throw new Error(assetsError);
          }
          if (assetsLoading || !assets) {
            throw new Error("Artwork-Assets werden noch geladen. Bitte einen Moment warten.");
          }
          if (renderPromiseRef.current) {
            const outcome = await renderPromiseRef.current;
            if (outcome.error) {
              throw new Error(outcome.error);
            }
          }
          if (renderError) {
            throw new Error(renderError);
          }
          const canvas = canvasRef.current;
          if (!canvas) {
            throw new Error("Die Share-Card-Canvas ist nicht mehr verfügbar.");
          }
          return await exportCanvasToPngBlob(canvas);
        },
      }),
      [assets, assetsError, assetsLoading, renderError],
    );

    const activeTheme = findWrappedTheme(options.theme)?.palette;
    const glowPalette =
      options.theme === "cover" && assets?.coverPalette ? assets.coverPalette : activeTheme;
    const glowAccent = glowPalette?.accent ?? "#d6ff4b";
    const glowSecondary = glowPalette?.accentAlt ?? glowPalette?.bgSecondary ?? "#2a2735";

    const canTilt = enableTilt && !prefersReducedMotion;

    function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
      if (!canTilt) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = (event.clientX - rect.left) / rect.width - 0.5;
      const ny = (event.clientY - rect.top) / rect.height - 0.5;
      setTilt({ rx: Number((-ny * 6).toFixed(2)), ry: Number((nx * 6).toFixed(2)) });
    }

    function handleMouseLeave() {
      if (tilt.rx !== 0 || tilt.ry !== 0) {
        setTilt({ rx: 0, ry: 0 });
      }
    }

    return (
      <div className={`flex flex-col items-center gap-3 ${className}`}>
        <div
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className={`relative flex items-center justify-center ${
            isStory
              ? "w-[min(100%,calc(60dvh*9/16),350px)] aspect-[9/16]"
              : "w-[min(100%,60dvh,440px)] aspect-square"
          }`}
          style={{ perspective: canTilt ? "1100px" : undefined }}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -inset-6 rounded-[28px] opacity-45 blur-3xl transition-colors duration-300"
            style={{
              background: `radial-gradient(circle at 30% 25%, ${glowAccent}, transparent 65%), radial-gradient(circle at 75% 80%, ${glowSecondary}, transparent 65%)`,
            }}
          />

          <div
            className="relative h-full w-full overflow-hidden rounded-[var(--radius-panel)] border border-white/15 bg-[#0b0a0e] shadow-[0_26px_70px_rgb(0_0_0/0.68)] transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={
              canTilt
                ? { transform: `rotateX(${tilt.rx}deg) rotateY(${tilt.ry}deg)` }
                : undefined
            }
          >
            <canvas
              ref={canvasRef}
              width={dimensions.width}
              height={dimensions.height}
              aria-label={`Vorschau der Share-Card (${options.template}, ${options.format})`}
              className="block h-full w-full"
            />

            {(assetsLoading || isRendering) && !assetsError && !renderError && (
              <div
                role="status"
                aria-label="Share-Card wird gerendert"
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-backdrop/75 backdrop-blur-sm"
              >
                <SpinnerIcon width={26} height={26} className="animate-spin text-accent motion-reduce:animate-none" />
                <p className="label-mono text-center text-foreground">
                  {assetsLoading ? "Artwork wird geladen…" : "Card wird gerendert…"}
                </p>
              </div>
            )}
          </div>
        </div>

        {(assetsError || renderError) && (
          <div role="alert" className="error-panel w-full max-w-md text-left">
            <p className="font-semibold text-foreground">Vorschau fehlgeschlagen</p>
            <p className="mt-1 text-xs [overflow-wrap:anywhere]">{assetsError ?? renderError}</p>
          </div>
        )}

        {assets && assets.failedUrls.length > 0 && (
          <div
            role="alert"
            className="w-full max-w-md rounded-[var(--radius-control)] border border-amber-400/35 bg-amber-500/10 px-3.5 py-2.5 text-xs leading-relaxed text-amber-100"
          >
            <div className="flex items-start gap-2">
              <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-amber-300" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-amber-200">
                  {assets.failedUrls.length === 1
                    ? "1 Cover-/Profilbild konnte nicht geladen werden"
                    : `${assets.failedUrls.length} Cover-/Profilbilder konnten nicht geladen werden`}
                </p>
                <p className="mt-0.5 text-amber-100/85">
                  Für fehlgeschlagene Artwork-URLs wird das Monogramm gezeichnet:
                </p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 font-mono text-[11px] text-amber-200/80">
                  {assets.failedUrls.slice(0, 3).map((url) => (
                    <li key={url} className="truncate">
                      {url}
                    </li>
                  ))}
                  {assets.failedUrls.length > 3 && (
                    <li>… und {assets.failedUrls.length - 3} weitere</li>
                  )}
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  },
);

export default WrappedCardPreview;
