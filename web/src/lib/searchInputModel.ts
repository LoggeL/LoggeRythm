export type SearchInputState = {
  source: string;
  scope: string;
  input: string;
  query: string;
  composing: boolean;
};
export type SearchInputAction =
  | { type: "source"; source: string; scope: string }
  | { type: "input"; value: string }
  | { type: "submit"; value?: string }
  | { type: "debounce"; expected: string }
  | { type: "composing"; value: boolean }
  | { type: "clear" };

export function createSearchInput(source: string, scope = ""): SearchInputState {
  return { source, scope, input: source, query: source.trim(), composing: false };
}

export function searchInputReducer(state: SearchInputState, action: SearchInputAction): SearchInputState {
  switch (action.type) {
    case "source":
      if (action.source === state.query && (action.scope === state.scope || (action.scope === "/search" && state.query.length > 0)))
        return { ...state, source: action.source, scope: action.scope };
      return createSearchInput(action.source, action.scope);
    case "input":
      return { ...state, input: action.value };
    case "submit": {
      const input = action.value ?? state.input;
      return { ...state, input, query: input.trim(), composing: false };
    }
    case "debounce":
      return state.input === action.expected && !state.composing
        ? { ...state, query: state.input.trim() }
        : state;
    case "composing":
      return { ...state, composing: action.value };
    case "clear":
      return { ...state, input: "", query: "", composing: false };
  }
}
