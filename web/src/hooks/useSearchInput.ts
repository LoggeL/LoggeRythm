"use client";

import { useCallback, useEffect, useReducer } from "react";
import { SEARCH_DEBOUNCE_MS } from "@/lib/catalogQueries";
import { createSearchInput, searchInputReducer } from "@/lib/searchInputModel";

export function useSearchInput(source = "", scope = "") {
  const [state, dispatch] = useReducer(searchInputReducer, createSearchInput(source, scope));
  // An external navigation replaces the draft. Our own URL commit keeps any
  // newer typing that happened before the router acknowledged the URL.
  if (state.source !== source || state.scope !== scope)
    dispatch({ type: "source", source, scope });

  useEffect(() => {
    if (state.composing || state.input.trim() === state.query) return;
    const timer = setTimeout(() => dispatch({ type: "debounce", expected: state.input }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [state.input, state.query, state.composing, state.scope]);

  return {
    input: state.input,
    query: state.query,
    preparing: state.composing || state.input.trim() !== state.query,
    setInput: useCallback((value: string) => dispatch({ type: "input", value }), []),
    submit: useCallback((value?: string) => dispatch({ type: "submit", value }), []),
    clear: useCallback(() => dispatch({ type: "clear" }), []),
    setComposing: useCallback((value: boolean) => dispatch({ type: "composing", value }), []),
  };
}
