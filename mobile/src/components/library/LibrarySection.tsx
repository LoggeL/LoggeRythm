import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { libraryStrings } from '../../screens/libraryStrings';
import { colors, metrics } from '../../theme';
import {
  resolveLibrarySectionVisualState,
  type LibrarySectionState,
} from './librarySectionState';

interface SharedSectionProps {
  id: string;
  title: string;
  state: LibrarySectionState;
  action?: React.ReactNode;
  children: React.ReactNode;
}

interface QuerySectionProps extends SharedSectionProps {
  state: Extract<LibrarySectionState, { kind: 'query' }>;
  emptyText: string;
  onRetry: () => void;
}

interface PolicySectionProps extends SharedSectionProps {
  state: Extract<LibrarySectionState, { kind: 'policy' }>;
  emptyText?: never;
  onRetry?: never;
}

export type LibrarySectionProps = QuerySectionProps | PolicySectionProps;

type WithoutChildren<T> = T extends unknown ? Omit<T, 'children'> : never;

/** State/title/action contract shared by the virtualized and legacy section owners. */
export type LibrarySectionPresentationProps = WithoutChildren<LibrarySectionProps>;

function retryButton(id: string, title: string, busy: boolean, onRetry: () => void) {
  return (
    <Pressable
      testID={`library-section-${id}-retry`}
      accessibilityRole="button"
      accessibilityLabel={libraryStrings.library.retrySection(title)}
      accessibilityState={{ disabled: busy, busy }}
      disabled={busy}
      onPress={onRetry}
      style={({ pressed }) => [styles.retry, pressed && styles.pressed, busy && styles.disabled]}
    >
      <Text style={styles.retryText}>{libraryStrings.common.retry}</Text>
    </Pressable>
  );
}

/** Whether a section's item rows are safe to expose for its current remote state. */
export function librarySectionShowsContent(
  state: LibrarySectionState,
): boolean {
  return state.kind === 'policy' || resolveLibrarySectionVisualState(state).body === 'content';
}

/**
 * Shared section heading/body-state presenter. SectionList uses this as its
 * header so row data remains virtualized without changing loading/error/empty
 * semantics.
 */
export function LibrarySectionHeader(props: LibrarySectionPresentationProps) {
  const { id, title, action } = props;
  const sectionId = `library-section-${id}`;

  if (props.state.kind === 'policy') {
    return (
      <View testID={sectionId} style={[styles.heading, styles.contentHeading]}>
        <Text accessibilityRole="header" style={styles.title}>{title}</Text>
        {action}
      </View>
    );
  }

  const onRetry = props.onRetry;
  if (onRetry === undefined) {
    throw new Error('Remote Library sections require an onRetry callback');
  }
  const visual = resolveLibrarySectionVisualState(props.state);
  const retryBusy = props.state.fetching;
  return (
    <View
      testID={sectionId}
      style={[styles.heading, visual.body === 'content' && styles.contentHeading]}
    >
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      {action}

      {visual.body === 'loading' ? (
        <View
          testID={`${sectionId}-loading`}
          accessibilityRole="progressbar"
          accessibilityLabel={libraryStrings.library.loadingSection(title)}
          accessibilityLiveRegion="polite"
          style={styles.inlineState}
        >
          <ActivityIndicator color={colors.accent} />
          <Text style={styles.status}>{libraryStrings.library.loadingSection(title)}</Text>
        </View>
      ) : null}

      {visual.body === 'offline' ? (
        <View
          testID={`${sectionId}-offline`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorBox}
        >
          <Text style={styles.errorText}>{libraryStrings.common.offline}</Text>
          {retryButton(id, title, retryBusy, onRetry)}
        </View>
      ) : null}

      {visual.body === 'hard-error' ? (
        <View
          testID={`${sectionId}-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={styles.errorBox}
        >
          <Text style={styles.errorText}>{libraryStrings.common.loadFailed}</Text>
          {retryButton(id, title, retryBusy, onRetry)}
        </View>
      ) : null}

      {visual.body === 'empty' ? (
        <Text testID={`${sectionId}-empty`} accessibilityLiveRegion="polite" style={styles.status}>
          {props.emptyText}
        </Text>
      ) : null}

    </View>
  );
}

/** Shared last-good/stale notice presenter placed after virtualized rows. */
export function LibrarySectionFooter(props: LibrarySectionPresentationProps) {
  if (props.state.kind === 'policy') return null;

  const { id, title } = props;
  const sectionId = `library-section-${id}`;
  const visual = resolveLibrarySectionVisualState(props.state);
  const retryBusy = props.state.fetching;
  const onRetry = props.onRetry;
  if (onRetry === undefined) {
    throw new Error('Remote Library sections require an onRetry callback');
  }

  if (visual.notice === null) return null;

  return (
    <View testID={`${sectionId}-footer`} style={styles.footer}>
      {visual.notice === 'cached-offline' ? (
        <View
          testID={`${sectionId}-cached-offline`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.notice}
        >
          <Text style={styles.warning}>{libraryStrings.common.cachedOffline}</Text>
          {retryButton(id, title, retryBusy, onRetry)}
        </View>
      ) : null}

      {visual.notice === 'cached-refresh-error' ? (
        <View
          testID={`${sectionId}-cached-error`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.notice}
        >
          <Text style={styles.warning}>{libraryStrings.common.cachedRefreshFailed}</Text>
          {retryButton(id, title, retryBusy, onRetry)}
        </View>
      ) : null}

      {visual.notice === 'refreshing' ? (
        <Text
          testID={`${sectionId}-refreshing`}
          accessibilityRole="progressbar"
          accessibilityLabel={libraryStrings.common.refreshing}
          accessibilityLiveRegion="polite"
          style={styles.status}
        >
          {libraryStrings.common.refreshing}
        </Text>
      ) : null}

      {visual.notice === 'stale' ? (
        <Text testID={`${sectionId}-stale`} accessibilityLiveRegion="polite" style={styles.status}>
          {libraryStrings.common.stale}
        </Text>
      ) : null}
    </View>
  );
}

/** Shared state contract for every remote Library collection and static policy section. */
export function LibrarySection(props: LibrarySectionProps) {
  return (
    <View style={styles.section}>
      {LibrarySectionHeader(props)}
      {librarySectionShowsContent(props.state) ? props.children : null}
      {LibrarySectionFooter(props)}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 0 },
  heading: { gap: 9 },
  contentHeading: { paddingBottom: 9 },
  footer: { gap: 8, paddingTop: 9 },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    paddingHorizontal: 16,
  },
  inlineState: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  status: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: 16 },
  notice: { gap: 8, paddingHorizontal: 16 },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  errorBox: {
    marginHorizontal: 16,
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    backgroundColor: colors.surfaceElevated,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  retry: {
    alignSelf: 'flex-start',
    minHeight: metrics.minimumTouchTarget,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: colors.accent,
  },
  retryText: { color: colors.onAccent, fontWeight: '800' },
  pressed: { opacity: 0.74, backgroundColor: colors.surfacePressed },
  disabled: { opacity: 0.5 },
});
