"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "@/store/toast";
import { partyFailureMessage } from "../requests";

const subscribeNever = () => () => {};
const onClient = () => true;
const onServer = () => false;

/** The party's invitation URL (known only in the browser) and its copy action. */
export function useShareLink(code: string) {
  const isClient = useSyncExternalStore(subscribeNever, onClient, onServer);
  const shareUrl = isClient ? new URL(`/party/${encodeURIComponent(code)}`, window.location.origin).toString() : "";
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      toast.error(partyFailureMessage("Link konnte nicht kopiert werden", error));
    }
  };

  return { shareUrl, copied, copy };
}
