import React, {useMemo} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTranslation} from 'react-i18next';

import {palette, radii, shadows} from '../../../src/constants/theme';
import {ActivityItem} from '../../../src/services/activityService';

type ActivityCenterSheetProps = {
  visible: boolean;
  loading: boolean;
  items: ActivityItem[];
  unreadCount: number;
  onClose: () => void;
  onPressItem: (item: ActivityItem) => void;
  onMarkAllRead: () => void;
};

const getActivityIcon = (type: string) => {
  if (type === 'post_like') {
    return {name: 'heart', color: '#dc2626', backgroundColor: '#fee2e2'};
  }
  if (type === 'post_comment' || type === 'spot_review') {
    return {name: 'comment-text-outline', color: '#2563eb', backgroundColor: '#dbeafe'};
  }
  if (type === 'event_invite' || type === 'event_approved') {
    return {name: 'calendar-check-outline', color: '#ca8a04', backgroundColor: '#fef3c7'};
  }
  if (type === 'event_request') {
    return {name: 'account-question-outline', color: '#7c3aed', backgroundColor: '#ede9fe'};
  }
  if (type === 'event_attending') {
    return {name: 'account-check-outline', color: '#15803d', backgroundColor: '#dcfce7'};
  }
  if (type === 'event_declined') {
    return {name: 'account-cancel-outline', color: '#b91c1c', backgroundColor: '#fee2e2'};
  }
  return {name: 'information-outline', color: palette.highlight, backgroundColor: '#dbeafe'};
};

const formatActivityTimestamp = (createdAtMs: number, language: string) => {
  if (!createdAtMs) {
    return '';
  }

  return new Intl.DateTimeFormat(language, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(createdAtMs));
};

const ActivityCenterSheet = ({
  visible,
  loading,
  items,
  unreadCount,
  onClose,
  onPressItem,
  onMarkAllRead,
}: ActivityCenterSheetProps) => {
  const {t, i18n} = useTranslation();

  const subtitle = useMemo(() => {
    if (unreadCount > 0) {
      return t('activityCenter.unreadCount', {count: unreadCount});
    }
    return t('activityCenter.allCaughtUp');
  }, [t, unreadCount]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <View style={styles.headerTextWrap}>
              <Text style={styles.title}>{t('activityCenter.title')}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
            <TouchableOpacity style={styles.closeIconButton} onPress={onClose}>
              <Icon name="close" size={20} color={palette.textSecondary} />
            </TouchableOpacity>
          </View>

          {unreadCount > 0 ? (
            <TouchableOpacity style={styles.markAllButton} onPress={onMarkAllRead}>
              <Icon name="check-all" size={18} color={palette.highlight} />
              <Text style={styles.markAllText}>{t('activityCenter.markAllRead')}</Text>
            </TouchableOpacity>
          ) : null}

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="large" color={palette.highlight} />
            </View>
          ) : items.length ? (
            <FlatList
              data={items}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              renderItem={({item}) => {
                const icon = getActivityIcon(item.type);
                return (
                  <TouchableOpacity
                    style={[styles.itemCard, !item.isRead && styles.itemCardUnread]}
                    activeOpacity={0.9}
                    onPress={() => onPressItem(item)}>
                    <View style={[styles.itemIconWrap, {backgroundColor: icon.backgroundColor}]}>
                      <Icon name={icon.name} size={20} color={icon.color} />
                    </View>
                    <View style={styles.itemTextWrap}>
                      <View style={styles.itemTitleRow}>
                        <Text style={styles.itemTitle}>{item.title}</Text>
                        {!item.isRead ? <View style={styles.unreadDot} /> : null}
                      </View>
                      <Text style={styles.itemBody}>{item.body}</Text>
                      <Text style={styles.itemTime}>
                        {formatActivityTimestamp(item.createdAtMs, i18n.language)}
                      </Text>
                    </View>
                    <Icon name="chevron-right" size={20} color={palette.textMuted} />
                  </TouchableOpacity>
                );
              }}
            />
          ) : (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconWrap}>
                <Icon name="heart-outline" size={30} color="#ef4444" />
              </View>
              <Text style={styles.emptyTitle}>{t('activityCenter.emptyTitle')}</Text>
              <Text style={styles.emptyText}>{t('activityCenter.emptyText')}</Text>
            </View>
          )}
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
    maxHeight: '78%',
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  subtitle: {
    marginTop: 4,
    color: palette.textSecondary,
  },
  closeIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe3ef',
  },
  markAllButton: {
    marginTop: 14,
    marginBottom: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  markAllText: {
    color: palette.highlight,
    fontWeight: '700',
  },
  loadingWrap: {
    paddingVertical: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingTop: 8,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderRadius: radii.lg,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#dbe3ef',
    marginBottom: 10,
  },
  itemCardUnread: {
    backgroundColor: '#fff7f7',
    borderColor: '#fecaca',
  },
  itemIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTextWrap: {
    flex: 1,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
  itemBody: {
    marginTop: 4,
    color: palette.textSecondary,
    lineHeight: 18,
  },
  itemTime: {
    marginTop: 6,
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  emptyWrap: {
    paddingVertical: 34,
    alignItems: 'center',
  },
  emptyIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fee2e2',
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  emptyText: {
    marginTop: 6,
    color: palette.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default ActivityCenterSheet;
