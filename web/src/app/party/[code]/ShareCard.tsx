import { QRCodeSVG } from "qrcode.react";
import { CheckCircleIcon, CopyIcon } from "@/components/feedbackIcons";

/** Invitation: QR code for phones in the room, link to send to everyone else. */
export default function ShareCard({
  code,
  shareUrl,
  copied,
  onCopy,
}: {
  code: string;
  /** Empty until the page runs in the browser and knows its own origin. */
  shareUrl: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <section aria-labelledby="party-share-title" className="min-w-0">
      <div className="section-heading">
        <h2 id="party-share-title">Einladen</h2>
        <p className="label-mono shrink-0 pb-1">
          Code <span className="normal-case text-foreground">{code}</span>
        </p>
      </div>
      <div className="flex items-center gap-4">
        {shareUrl ? (
          <div className="shrink-0 rounded-[var(--radius-card)] bg-white p-2">
            <QRCodeSVG
              value={shareUrl}
              size={176}
              level="M"
              marginSize={1}
              title={`QR-Code für die Party ${code}`}
              className="h-auto w-32"
            />
          </div>
        ) : (
          <div role="status" aria-label="QR-Code wird erstellt" className="skeleton aspect-square w-36 shrink-0 rounded-[var(--radius-card)]" />
        )}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <input
          readOnly
          value={shareUrl}
          aria-label="Einladungslink"
          onFocus={(event) => event.currentTarget.select()}
          className="field-input min-w-0 flex-1 font-mono text-xs"
        />
        <button type="button" onClick={onCopy} disabled={!shareUrl} aria-label="Einladungslink kopieren" className="action-secondary shrink-0 px-4">
          {copied ? <CheckCircleIcon width={16} height={16} className="text-success" /> : <CopyIcon width={16} height={16} />}
          <span>{copied ? "Kopiert" : "Kopieren"}</span>
        </button>
      </div>
    </section>
  );
}
