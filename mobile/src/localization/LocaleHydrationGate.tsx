import React, { type ReactNode } from 'react';
import { useLocale } from './LocaleProvider';

export interface LocaleHydrationGateProps {
  children: ReactNode;
  fallback: ReactNode;
}

/**
 * Locale-dependent providers mount only after the persisted device locale has
 * either hydrated or reached its bounded German fallback.
 */
export default function LocaleHydrationGate({
  children,
  fallback,
}: LocaleHydrationGateProps) {
  const { ready } = useLocale();
  return <>{ready ? children : fallback}</>;
}
