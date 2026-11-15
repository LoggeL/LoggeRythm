import type React from 'react';

/**
 * Helpers for the house component-test style: there is no renderer, so a
 * test calls the component as a plain function and walks the returned
 * element tree. Host components are mocked as strings (`View: 'View'`).
 */
export type ElementProps = Record<string, unknown> & { children?: React.ReactNode };
export type TestElement = React.ReactElement<ElementProps>;

/**
 * Every element in the tree, depth first. Function components that were not
 * mocked as strings are called with their props and expanded, so hook-free
 * primitives (ActionButton, AppText, ...) can stay unmocked.
 */
export function elements(node: React.ReactNode): TestElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (node === null || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as TestElement;
  if (typeof element.type === 'function') {
    const rendered = (element.type as (props: ElementProps) => React.ReactNode)(element.props);
    return [element, ...elements(rendered)];
  }
  return [element, ...elements(element.props.children)];
}

/** The host element (not the function wrapper) carrying `testID`. Throws when absent. */
export function byTestId(node: React.ReactNode, testID: string): TestElement {
  const found = queryByTestId(node, testID);
  if (found === null) throw new Error(`No element has testID ${testID}`);
  return found;
}

export function queryByTestId(node: React.ReactNode, testID: string): TestElement | null {
  return (
    elements(node).find(
      (element) => element.props.testID === testID && typeof element.type !== 'function',
    ) ?? null
  );
}

export function byType(node: React.ReactNode, type: string): TestElement[] {
  return elements(node).filter((element) => element.type === type);
}

/** Concatenated string children of every `Text` host element. */
export function textContent(node: React.ReactNode): string[] {
  return byType(node, 'Text')
    .map((element) => element.props.children)
    .flatMap((child) => (Array.isArray(child) ? child : [child]))
    .filter((child): child is string => typeof child === 'string');
}

/** Resolves a style prop (object, nested array, or Pressable style function) to one object. */
export function flatStyle(
  style: unknown,
  state: { pressed: boolean } = { pressed: false },
): Record<string, unknown> {
  if (typeof style === 'function') return flatStyle((style as (s: typeof state) => unknown)(state), state);
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (merged, entry) => ({ ...merged, ...flatStyle(entry, state) }),
      {},
    );
  }
  if (style === null || typeof style !== 'object') return {};
  return style as Record<string, unknown>;
}
