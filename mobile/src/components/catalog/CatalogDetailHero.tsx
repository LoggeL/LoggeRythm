import React from 'react';
import { StyleSheet, View } from 'react-native';

interface CatalogDetailHeroProps {
  artwork: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

/** A compact detail header keeps artwork, identity, and playback within one viewport. */
export function CatalogDetailHero({ artwork, children, actions }: CatalogDetailHeroProps) {
  return (
    <View style={styles.hero}>
      <View style={styles.identity}>
        <View style={styles.artwork}>{artwork}</View>
        <View style={styles.copy}>{children}</View>
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 20, paddingHorizontal: 20 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  artwork: { flexShrink: 0 },
  copy: { flex: 1, minWidth: 0, gap: 7 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
});
