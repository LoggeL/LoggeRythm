"use client";

import type { RefObject } from "react";
import Cover from "@/components/ui/Cover";
import { ImageIcon, SpinnerIcon } from "@/components/icons";
import styles from "./collection.module.css";

/**
 * Playlist artwork for the hero. Owners get a "change cover" control over it;
 * `inputRef` exposes the file input so other controls (the overflow menu) can
 * open the same picker.
 */
export default function PlaylistCover({
  src,
  editable,
  uploading,
  inputRef,
  onUpload,
}: {
  src?: string;
  editable: boolean;
  uploading: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onUpload: (file: File) => void;
}) {
  return (
    <>
      <Cover src={src} eager />
      {editable && (
        <>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} aria-busy={uploading} aria-label="Cover ändern" className={styles.coverEdit}>
            {uploading ? <SpinnerIcon width={26} height={26} className="animate-spin" /> : <ImageIcon width={26} height={26} />}
            <span>{uploading ? "Wird hochgeladen…" : "Cover ändern"}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onUpload(file);
            }}
          />
        </>
      )}
    </>
  );
}
