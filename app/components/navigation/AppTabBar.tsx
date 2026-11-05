import React, {useCallback, useMemo, useState} from 'react';
import {
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTranslation} from 'react-i18next';

import {palette, shadows} from '../../../src/constants/theme';
import {
  ActivityItem,
  getActivityItemDeepLink,
} from '../../../src/services/activityService';
import type {
  AppStackNavigationProp,
  AppTabBarProps,
  MainTabParamList,
} from '../../../src/navigation/types';
import logger from '../../../src/utils/logger';
import {ensureFcmTokenForUser} from '../../../src/services/messagingService';
import {useActivityFeed} from '../../features/activity/useActivityFeed';
import {useAuthContext} from '../../context/AuthContext';
import {useMap} from '../../context/MapContext';
import ActivityCenterSheet from './ActivityCenterSheet';
import GlobalCreateSheet from './GlobalCreateSheet';

const CREATE_VISIBLE_ROUTES = new Set(['Feed', 'Map', 'MySpots']);

const getTabBarIconName = (routeName: string, focused: boolean) => {
  if (routeName === 'Feed') {
    return focused ? 'view-stream' : 'view-stream-outline';
  }
  if (routeName === 'Map') {
    return focused ? 'map' : 'map-outline';
  }
  if (routeName === 'MySpots') {
    return focused ? 'star' : 'star-outline';
  }
  return focused ? 'account-circle' : 'account-circle-outline';
};

type MainTabBarRoute = AppTabBarProps['state']['routes'][number];

const AppTabBar = ({state, descriptors, navigation}: AppTabBarProps) => {
  const {t} = useTranslation();
  const insets = useSafeAreaInsets();
  const {user} = useAuthContext();
  const {selectedCoordinate} = useMap();
  const [isCreateSheetVisible, setCreateSheetVisible] = useState(false);
  const [isActivitySheetVisible, setActivitySheetVisible] = useState(false);

  const activeRouteName = state.routes[state.index]?.name ?? '';
  const showCreateButton = CREATE_VISIBLE_ROUTES.has(activeRouteName);
  const {
    items: activityItems,
    loading: activityLoading,
    unreadCount,
    markRead,
    markAllRead,
  } = useActivityFeed(user?.uid);

  const [leftRoutes, rightRoutes] = useMemo(
    () => [state.routes.slice(0, 2), state.routes.slice(2)],
    [state.routes],
  );

  const resolveLabel = (routeName: string) => {
    if (routeName === 'Feed') {
      return t('navigation.feed');
    }
    if (routeName === 'Map') {
      return t('navigation.map');
    }
    if (routeName === 'MySpots') {
      return t('navigation.mySpots');
    }
    return t('navigation.profile');
  };

  const openCreateSheet = () => {
    if (!showCreateButton) {
      return;
    }
    setCreateSheetVisible(true);
  };

  const openActivitySheet = () => {
    setActivitySheetVisible(true);
    if (user?.uid) {
      ensureFcmTokenForUser(user.uid, {promptIfNeeded: true}).catch(error => {
        logger.warn('[ActivityCenter] notification sync failed', error);
      });
    }
  };

  const handleCreateSpot = () => {
    setCreateSheetVisible(false);
    const parentNavigation = navigation.getParent<AppStackNavigationProp>();
    if (!selectedCoordinate) {
      Alert.alert(
        t('feed.publishSpotMapFallbackTitle'),
        t('feed.publishSpotMapFallbackMessage'),
        [
          {
            text: t('map.cancel'),
            style: 'cancel',
          },
          {
            text: t('navigation.map'),
            onPress: () => navigation.navigate('Map'),
          },
        ],
      );
      return;
    }
    parentNavigation?.navigate('AddSpot', {coordinate: selectedCoordinate});
  };

  const handleCreateDronePost = () => {
    setCreateSheetVisible(false);
    navigation.getParent<AppStackNavigationProp>()?.navigate('CreateDronePost');
  };

  const handleCreateEvent = () => {
    setCreateSheetVisible(false);
    navigation
      .getParent<AppStackNavigationProp>()
      ?.navigate('CreateEvent', {coordinate: selectedCoordinate});
  };

  const handleOpenActivityItem = useCallback(
    async (item: ActivityItem) => {
      setActivitySheetVisible(false);
      await markRead(item.id);

      if (item.eventId) {
        navigation.getParent<AppStackNavigationProp>()?.navigate('EventDetail', {
          eventId: item.eventId,
        });
        return;
      }

      if (item.spotId) {
        navigation.getParent<AppStackNavigationProp>()?.navigate('SpotDetail', {
          spotId: item.spotId,
        });
        return;
      }

      if (item.postId) {
        navigation.navigate('Feed', {
          postId: item.postId,
          activityAt: Date.now(),
        });
        return;
      }

      const deepLink = getActivityItemDeepLink(item);
      if (!deepLink) {
        return;
      }

      try {
        await Linking.openURL(deepLink);
      } catch (error) {
        logger.warn('[ActivityCenter] Failed to open item deep link', {
          activityId: item.id,
          error,
        });
        Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
      }
    },
    [markRead, navigation, t],
  );

  const renderRouteButton = (route: MainTabBarRoute) => {
    const routeIndex = state.routes.findIndex(value => value.key === route.key);
    const isFocused = state.index === routeIndex;
    const descriptor = descriptors[route.key];
    const options = descriptor.options;
    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });

      if (!isFocused && !event.defaultPrevented) {
        navigation.navigate(route.name as keyof MainTabParamList);
      }
    };

    const onLongPress = () => {
      navigation.emit({
        type: 'tabLongPress',
        target: route.key,
      });
    };

    return (
      <TouchableOpacity
        key={route.key}
        accessibilityRole="button"
        accessibilityState={isFocused ? {selected: true} : {}}
        accessibilityLabel={options.tabBarAccessibilityLabel}
        testID={options.tabBarButtonTestID}
        style={styles.tabButton}
        onPress={onPress}
        onLongPress={onLongPress}>
        <Icon
          name={getTabBarIconName(route.name, isFocused)}
          size={22}
          color={isFocused ? '#ef4444' : palette.textMuted}
        />
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          style={[
            styles.tabLabel,
            isFocused ? styles.tabLabelActive : null,
          ]}>
          {resolveLabel(route.name)}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <>
      <View
        style={[
          styles.wrapper,
          {paddingBottom: Math.max(insets.bottom, 10)},
        ]}>
        <View style={styles.bar}>
          <View style={styles.sideGroup}>{leftRoutes.map(renderRouteButton)}</View>
          <View style={styles.centerGap} />
          <View style={styles.sideGroup}>{rightRoutes.map(renderRouteButton)}</View>
        </View>

        {showCreateButton ? (
          <View
            style={[
              styles.floatingActionsGroup,
              {bottom: Math.max(insets.bottom, 10) + 22},
            ]}>
            <View pointerEvents="none" style={styles.floatingActionsBase} />
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t('activityCenter.buttonLabel')}
              style={styles.activityButtonIntegrated}
              activeOpacity={0.92}
              onPress={openActivitySheet}>
              <Icon name="heart" size={20} color="#fff" />
              {unreadCount > 0 ? (
                <View style={styles.activityBadge}>
                  <Text style={styles.activityBadgeText}>
                    {unreadCount > 99 ? '99+' : String(unreadCount)}
                  </Text>
                </View>
              ) : null}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.createButton}
              activeOpacity={0.92}
              onPress={openCreateSheet}>
              <Icon name="plus" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : null}

        {!showCreateButton ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t('activityCenter.buttonLabel')}
            style={[
              styles.activityButtonStandalone,
              {
                bottom: Math.max(insets.bottom, 10) + 14,
              },
            ]}
            activeOpacity={0.92}
            onPress={openActivitySheet}>
            <Icon name="heart" size={22} color="#fff" />
            {unreadCount > 0 ? (
              <View style={styles.activityBadge}>
                <Text style={styles.activityBadgeText}>
                  {unreadCount > 99 ? '99+' : String(unreadCount)}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : null}
      </View>

      <GlobalCreateSheet
        visible={isCreateSheetVisible}
        onClose={() => setCreateSheetVisible(false)}
        onCreateSpot={handleCreateSpot}
        onCreateDronePost={handleCreateDronePost}
        onCreateEvent={handleCreateEvent}
      />
      <ActivityCenterSheet
        visible={isActivitySheetVisible}
        loading={activityLoading}
        items={activityItems}
        unreadCount={unreadCount}
        onClose={() => setActivitySheetVisible(false)}
        onPressItem={handleOpenActivityItem}
        onMarkAllRead={markAllRead}
      />
    </>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: 'transparent',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.backgroundCard,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#d9e2ef',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    ...shadows.subtle,
  },
  sideGroup: {
    flex: 1,
    flexDirection: 'row',
  },
  centerGap: {
    width: 100,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 44,
  },
  tabLabel: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '600',
    color: palette.textMuted,
    textAlign: 'center',
    width: '100%',
  },
  tabLabelActive: {
    color: '#ef4444',
  },
  floatingActionsGroup: {
    position: 'absolute',
    alignSelf: 'center',
    width: 92,
    height: 82,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  floatingActionsBase: {
    position: 'absolute',
    bottom: 0,
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#f8fbff',
    borderWidth: 1,
    borderColor: '#d9e2ef',
    ...shadows.subtle,
  },
  createButton: {
    position: 'absolute',
    bottom: 6,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: palette.highlight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#fff7f7',
    zIndex: 2,
    ...shadows.subtle,
  },
  activityButtonIntegrated: {
    position: 'absolute',
    right: 10,
    top: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff1f2',
    zIndex: 3,
    ...shadows.subtle,
  },
  activityButtonStandalone: {
    position: 'absolute',
    alignSelf: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#fff7f7',
    ...shadows.subtle,
  },
  activityBadge: {
    position: 'absolute',
    top: -7,
    right: -9,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 4,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fecaca',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#dc2626',
  },
});

export default AppTabBar;
