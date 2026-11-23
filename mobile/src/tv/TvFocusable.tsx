import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  findNodeHandle,
  Pressable,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import { opacity, type radii } from '../theme';
import { isTvMode } from './tvEnvironment';
import {
  TvFocusScope,
  tvFocusRegistry,
  useTvFocusReturn,
  useTvFocusScope,
  type TvFocusRegistry,
} from './TvFocusRegistry';
import {
  TV_DEFAULT_FOCUS_SCALE,
  TvFocusRing,
  type TvFocusRingTone,
} from './TvFocusRing';

export interface TvNextFocusProps {
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
  nextFocusForward?: number;
}

export interface TvFocusableRenderState {
  readonly pressed: boolean;
  readonly focused: boolean;
}

export interface TvFocusableProps
  extends Omit<PressableProps, 'children' | 'style'>,
    TvNextFocusProps {
  children: React.ReactNode | ((state: TvFocusableRenderState) => React.ReactNode);
  style?: StyleProp<ViewStyle> | ((state: TvFocusableRenderState) => StyleProp<ViewStyle>);
  /** Optional logical focus ID registered in `TvFocusRegistry` for focus memory & return. */
  focusKey?: string;
  /** Optional focus-memory scope override; defaults to the enclosing `TvFocusScope`. */
  focusScope?: string;
  /** Request initial TV focus on mount. Strictly ignored on touch phones so touch mode is unaffected. */
  preferredFocus?: boolean;
  /** Resolve directional Android D-Pad targets by registered `focusKey` instead of raw node handles. */
  nextFocusUpKey?: string;
  nextFocusDownKey?: string;
  nextFocusLeftKey?: string;
  nextFocusRightKey?: string;
  /** Focus ring border radius token or number. Defaults to `'card'`. */
  ringRadius?: keyof typeof radii | number;
  /** Focus ring colour tone. Defaults to `'brand'`. */
  ringTone?: TvFocusRingTone;
  /** Subtle TV focus scale (automatically disabled when reduced motion is enabled). */
  focusScale?: number;
  /** Apply elevation shadow while focused. Defaults to `true`. */
  elevateOnFocus?: boolean;
  /** Render the high-contrast `TvFocusRing` when focused. Defaults to `true`. */
  showFocusRing?: boolean;
  /** Apply translucent highlight fill inside the focus ring. Defaults to `true`. */
  showFocusHighlight?: boolean;
  /** Optional outer container style applied to `TvFocusRing`. */
  containerStyle?: StyleProp<ViewStyle>;
  /** Optional testID for the focus ring overlay element. */
  ringTestID?: string;
  /** Optional registry override for isolated tests. */
  registry?: TvFocusRegistry;
  ref?: React.Ref<View>;
}

type FocusableViewHandle = View & { focus?: () => void };

function assignRef(ref: React.Ref<View> | undefined, value: View | null): void {
  if (!ref) return;
  if (typeof ref === 'function') {
    ref(value);
  } else {
    (ref as React.MutableRefObject<View | null>).current = value;
  }
}

function resolveHandle(
  explicitHandle: number | undefined,
  logicalKey: string | undefined,
  registry: TvFocusRegistry,
): number | undefined {
  if (explicitHandle !== undefined) return explicitHandle;
  if (!logicalKey) return undefined;
  return registry.getNodeHandle(logicalKey) ?? undefined;
}

/**
 * RN 0.86 core D-Pad focusable interactive wrapper with high-contrast focus ring,
 * reduced-motion respect, directional `nextFocus*` linking, and `TvFocusRegistry`
 * focus-memory / focus-return support.
 *
 * Phone safety: `hasTVPreferredFocus` is strictly gated on `isTvMode()` because
 * RN 0.86's Android `ReactViewManager.setTVPreferredFocus` enables
 * `isFocusableInTouchMode`, which must never activate on touch phones.
 */
export function TvFocusable({
  children,
  style,
  focusKey,
  focusScope,
  preferredFocus = false,
  hasTVPreferredFocus,
  nextFocusUp,
  nextFocusDown,
  nextFocusLeft,
  nextFocusRight,
  nextFocusForward,
  nextFocusUpKey,
  nextFocusDownKey,
  nextFocusLeftKey,
  nextFocusRightKey,
  ringRadius = 'card',
  ringTone = 'brand',
  focusScale = TV_DEFAULT_FOCUS_SCALE,
  elevateOnFocus = true,
  showFocusRing = true,
  showFocusHighlight = true,
  containerStyle,
  ringTestID,
  registry: explicitRegistry,
  disabled,
  focusable,
  onFocus,
  onBlur,
  ref,
  ...rest
}: TvFocusableProps) {
  const scopeContext = useTvFocusScope();
  const registry = explicitRegistry ?? scopeContext.registry ?? tvFocusRegistry;
  const effectiveScope = focusScope ?? scopeContext.scope ?? undefined;
  const isTv = isTvMode();

  const innerRef = useRef<FocusableViewHandle | null>(null);
  const [focused, setFocused] = useState(false);
  const [requestedFocusPulse, setRequestedFocusPulse] = useState(false);

  const mergedRef = useCallback(
    (node: View | null) => {
      innerRef.current = node as FocusableViewHandle | null;
      assignRef(ref, node);
    },
    [ref],
  );

  const triggerProgrammaticFocus = useCallback(() => {
    if (!isTvMode() || disabled) return;
    setRequestedFocusPulse(true);
    if (typeof innerRef.current?.focus === 'function') {
      innerRef.current.focus();
    }
  }, [disabled]);

  useEffect(() => {
    if (!focusKey) return undefined;
    return registry.register(
      focusKey,
      {
        requestFocus: triggerProgrammaticFocus,
        getNodeHandle: () => {
          if (!innerRef.current || typeof findNodeHandle !== 'function') return null;
          return findNodeHandle(innerRef.current);
        },
      },
      effectiveScope,
    );
  }, [effectiveScope, focusKey, registry, triggerProgrammaticFocus]);

  const handleFocus = useCallback<NonNullable<PressableProps['onFocus']>>(
    (event) => {
      setFocused(true);
      setRequestedFocusPulse(false);
      if (focusKey) {
        registry.recordFocus(focusKey, effectiveScope);
      }
      onFocus?.(event);
    },
    [effectiveScope, focusKey, onFocus, registry],
  );

  const handleBlur = useCallback<NonNullable<PressableProps['onBlur']>>(
    (event) => {
      setFocused(false);
      if (focusKey) {
        registry.recordBlur(focusKey);
      }
      onBlur?.(event);
    },
    [focusKey, onBlur, registry],
  );

  // Never set hasTVPreferredFocus on non-TV touch phones (avoids Android focusableInTouchMode),
  // and only include the prop when actively requesting focus.
  const shouldRequestPreferredFocus =
    isTv && !disabled && Boolean(preferredFocus || hasTVPreferredFocus || requestedFocusPulse);

  const resolvedFocusable = disabled ? false : focusable !== false;

  // Omit undefined nextFocus* keys cleanly so Fabric never receives empty override attributes.
  const androidFocusProps: TvNextFocusProps = {};
  const resolvedUp = resolveHandle(nextFocusUp, nextFocusUpKey, registry);
  const resolvedDown = resolveHandle(nextFocusDown, nextFocusDownKey, registry);
  const resolvedLeft = resolveHandle(nextFocusLeft, nextFocusLeftKey, registry);
  const resolvedRight = resolveHandle(nextFocusRight, nextFocusRightKey, registry);
  if (resolvedUp !== undefined) androidFocusProps.nextFocusUp = resolvedUp;
  if (resolvedDown !== undefined) androidFocusProps.nextFocusDown = resolvedDown;
  if (resolvedLeft !== undefined) androidFocusProps.nextFocusLeft = resolvedLeft;
  if (resolvedRight !== undefined) androidFocusProps.nextFocusRight = resolvedRight;
  if (nextFocusForward !== undefined) androidFocusProps.nextFocusForward = nextFocusForward;

  const pressableProps = {
    ...rest,
    ...androidFocusProps,
    ...(shouldRequestPreferredFocus ? { hasTVPreferredFocus: true } : {}),
    ref: mergedRef,
    disabled,
    focusable: resolvedFocusable,
    onFocus: handleFocus,
    onBlur: handleBlur,
  } as PressableProps & TvNextFocusProps & { ref: React.Ref<View> };

  const renderPressable = () => (
    <Pressable
      {...pressableProps}
      style={({ pressed }) => {
        const resolved =
          typeof style === 'function' ? style({ pressed, focused }) : style;
        return [
          resolved,
          disabled ? { opacity: opacity.disabled } : pressed ? { opacity: opacity.pressed } : null,
        ];
      }}
    >
      {({ pressed }) =>
        typeof children === 'function' ? children({ pressed, focused }) : children
      }
    </Pressable>
  );

  if (!showFocusRing) {
    return renderPressable();
  }

  return (
    <TvFocusRing
      focused={focused && !disabled}
      radius={ringRadius}
      tone={ringTone}
      scale={isTv ? focusScale : 1}
      elevate={elevateOnFocus}
      showHighlight={showFocusHighlight}
      style={containerStyle}
      ringTestID={ringTestID}
    >
      {renderPressable()}
    </TvFocusRing>
  );
}

export { TvFocusScope, tvFocusRegistry, useTvFocusReturn };
