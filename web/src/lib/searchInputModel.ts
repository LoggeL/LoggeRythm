const MAX_PENDING_ACKS = 16;

export type SearchInputState = {
  source: string;
  scope: string;
  input: string;
  query: string;
  composing: boolean;
  /** Queries committed locally whose async URL acknowledgement has not arrived yet. */
  pending: readonly string[];
};
export type SearchInputAction =
  | { type: "source"; source: string; scope: string }
  | { type: "input"; value: string }
  | { type: "submit"; value?: string }
  | { type: "debounce"; expected: string }
  | { type: "composing"; value: boolean }
  | { type: "clear" };

function trackPending(pending: readonly string[], previousQuery: string, nextQuery: string): readonly string[] {
  if (nextQuery === previousQuery) return pending;
  if (pending[pending.length - 1] === nextQuery) return pending;
  const next = [...pending, nextQuery];
  return next.length > MAX_PENDING_ACKS ? next.slice(next.length - MAX_PENDING_ACKS) : next;
}

export function createSearchInput(source: string, scope = ""): SearchInputState {
  return { source, scope, input: source, query: source.trim(), composing: false, pending: [] };
}

export function searchInputReducer(state: SearchInputState, action: SearchInputAction): SearchInputState {
  switch (action.type) {
    case "source": {
      const sameSearchScope =
        action.scope === state.scope || (action.scope === "/search" && state.query.length > 0);
      if (sameSearchScope) {
        if (action.source === state.query) {
          return { ...state, source: action.source, scope: action.scope, pending: [] };
        }
        const ackIndex = state.pending.indexOf(action.source);
        if (ackIndex !== -1) {
          // A stale asynchronous URL ack for an earlier local commit must never
          // clobber a newer draft or a newer committed query.
          return {
            ...state,
            source: action.source,
            scope: action.scope,
            pending: state.pending.slice(ackIndex + 1),
          };
        }
      }
      return createSearchInput(action.source, action.scope);
    }
    case "input":
      return { ...state, input: action.value };
    case "submit": {
      const input = action.value ?? state.input;
      const query = input.trim();
      return {
        ...state,
        input,
        query,
        composing: false,
        pending: trackPending(state.pending, state.query, query),
      };
    }
    case "debounce": {
      if (state.input !== action.expected || state.composing) return state;
      const query = state.input.trim();
      return {
        ...state,
        query,
        pending: trackPending(state.pending, state.query, query),
      };
    }
    case "composing":
      return { ...state, composing: action.value };
    case "clear":
      return {
        ...state,
        input: "",
        query: "",
        composing: false,
        pending: trackPending(state.pending, state.query, ""),
      };
  }
}
