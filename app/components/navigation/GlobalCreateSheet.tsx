import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTranslation} from 'react-i18next';

import {palette, radii, shadows} from '../../../src/constants/theme';

type GlobalCreateSheetProps = {
  visible: boolean;
  onClose: () => void;
  onCreateSpot: () => void;
  onCreateDronePost: () => void;
  onCreateEvent: () => void;
};

type CreateActionCardProps = {
  color: string;
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
};

const CreateActionCard = ({
  color,
  icon,
  title,
  subtitle,
  onPress,
}: CreateActionCardProps) => (
  <TouchableOpacity style={styles.actionCard} activeOpacity={0.9} onPress={onPress}>
    <View style={[styles.actionIconWrap, {backgroundColor: color}]}>
      <Icon name={icon} size={22} color="#fff" />
    </View>
    <View style={styles.actionTextWrap}>
      <Text style={styles.actionTitle}>{title}</Text>
      <Text style={styles.actionSubtitle}>{subtitle}</Text>
    </View>
    <Icon name="chevron-right" size={22} color={palette.textMuted} />
  </TouchableOpacity>
);

const GlobalCreateSheet = ({
  visible,
  onClose,
  onCreateSpot,
  onCreateDronePost,
  onCreateEvent,
}: GlobalCreateSheetProps) => {
  const {t} = useTranslation();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{t('feed.publishMenuTitle')}</Text>

          <CreateActionCard
            color="#0f766e"
            icon="map-marker-plus"
            title={t('feed.publishSpot')}
            subtitle={t('events.createSpotHint')}
            onPress={onCreateSpot}
          />
          <CreateActionCard
            color="#0369a1"
            icon="drone"
            title={t('feed.publishDronePost')}
            subtitle={t('events.createDronePostHint')}
            onPress={onCreateDronePost}
          />
          <CreateActionCard
            color="#f59e0b"
            icon="calendar-star"
            title={t('feed.publishEvent')}
            subtitle={t('events.createEventHint')}
            onPress={onCreateEvent}
          />

          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>{t('common.cancel')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
  },
  sheet: {
    backgroundColor: palette.backgroundCard,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 26,
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  handle: {
    alignSelf: 'center',
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: palette.borderMuted,
    marginBottom: 14,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.textPrimary,
    marginBottom: 14,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radii.lg,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    marginBottom: 10,
  },
  actionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionTextWrap: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  actionSubtitle: {
    fontSize: 13,
    color: palette.textSecondary,
    marginTop: 2,
  },
  closeButton: {
    marginTop: 6,
    paddingVertical: 12,
    borderRadius: radii.lg,
    alignItems: 'center',
    backgroundColor: '#eef2ff',
  },
  closeButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.textPrimary,
  },
});

export default GlobalCreateSheet;
