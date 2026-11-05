import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTranslation} from 'react-i18next';

import {
  AffiliateOffer,
  AffiliateStore,
  AffiliateStoreGroup,
  getAffiliateOffersForGroup,
  getAffiliateStoreGroups,
  getAffiliateStores,
  trackAffiliateClick,
} from '../../src/services/firestoreService';
import {palette, radii, shadows} from '../../src/constants/theme';
import logger from '../../src/utils/logger';

type AffiliateStoreSheetProps = {
  visible: boolean;
  onClose: () => void;
  source: 'map' | 'profile';
};

const normalizeAffiliateUrl = (value: string) => {
  const trimmed = value.trim();
  const unquoted = trimmed.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
  const compact = unquoted.replace(/\s+/g, '');
  if (!/^https?:\/\//i.test(compact)) {
    return `https://${compact}`;
  }
  return compact;
};

const sortByPriorityAndName = <T extends {name: string; priority?: number}>(
  items: T[],
) =>
  [...items].sort((a, b) => {
    const priorityA = a.priority ?? 9999;
    const priorityB = b.priority ?? 9999;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.name.localeCompare(b.name);
  });

const sortOffers = (items: AffiliateOffer[]) =>
  [...items].sort((a, b) => {
    const priorityA = a.priority ?? 9999;
    const priorityB = b.priority ?? 9999;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    const updatedA = a.updatedAt?.toMillis?.() ?? 0;
    const updatedB = b.updatedAt?.toMillis?.() ?? 0;
    return updatedB - updatedA;
  });

const AffiliateStoreSheet: React.FC<AffiliateStoreSheetProps> = ({
  visible,
  onClose,
  source,
}) => {
  const {t} = useTranslation();
  const [storeGroups, setStoreGroups] = useState<AffiliateStoreGroup[]>([]);
  const [stores, setStores] = useState<AffiliateStore[]>([]);
  const [selectedGroup, setSelectedGroup] =
    useState<AffiliateStoreGroup | null>(null);
  const [offers, setOffers] = useState<AffiliateOffer[]>([]);
  const [offersLoading, setOffersLoading] = useState(false);
  const [offersErrorMessage, setOffersErrorMessage] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const [groupsResult, storesResult] = await Promise.allSettled([
        getAffiliateStoreGroups(),
        getAffiliateStores(),
      ]);
      if (groupsResult.status === 'fulfilled') {
        const activeGroups = groupsResult.value.filter(
          group => group.isActive !== false,
        );
        setStoreGroups(sortByPriorityAndName(activeGroups));
      } else {
        logger.warn(
          '[AffiliateStoreSheet] Failed to load store groups',
          groupsResult.reason,
        );
        setStoreGroups([]);
      }
      if (storesResult.status === 'fulfilled') {
        const activeStores = storesResult.value.filter(
          store => store.isActive !== false,
        );
        setStores(sortByPriorityAndName(activeStores));
      } else {
        logger.warn(
          '[AffiliateStoreSheet] Failed to load stores',
          storesResult.reason,
        );
        setStores([]);
      }
      if (
        groupsResult.status === 'rejected' &&
        storesResult.status === 'rejected'
      ) {
        setErrorMessage(t('affiliateStores.loadError'));
      }
    } catch (error) {
      logger.warn('[AffiliateStoreSheet] Failed to load stores', error);
      setErrorMessage(t('affiliateStores.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (visible) {
      setSelectedGroup(null);
      setOffers([]);
      setOffersErrorMessage(null);
      loadStores();
    }
  }, [visible, loadStores]);

  const loadOffers = useCallback(
    async (groupId: string) => {
      setOffersLoading(true);
      setOffersErrorMessage(null);
      try {
        const results = await getAffiliateOffersForGroup(groupId);
        const activeOffers = results.filter(offer => offer.isActive !== false);
        setOffers(sortOffers(activeOffers));
      } catch (error) {
        logger.warn('[AffiliateStoreSheet] Failed to load offers', error);
        setOffersErrorMessage(t('affiliateStores.offersLoadError'));
      } finally {
        setOffersLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (selectedGroup?.displayMode === 'offers' && selectedGroup.id) {
      loadOffers(selectedGroup.id);
    } else {
      setOffers([]);
      setOffersErrorMessage(null);
    }
  }, [selectedGroup, loadOffers]);

  const handleClose = useCallback(() => {
    setSelectedGroup(null);
    onClose();
  }, [onClose]);

  const handleOpenStore = useCallback(
    async (store: AffiliateStore) => {
      if (!store.affiliateUrl) {
        return;
      }
      const url = normalizeAffiliateUrl(store.affiliateUrl);
      handleClose();
      trackAffiliateClick({
        storeId: store.id ?? store.name,
        storeName: store.name,
        source,
      }).catch(error =>
        logger.warn('[AffiliateStoreSheet] Failed to track click', error),
      );
      try {
        await Linking.openURL(url);
      } catch (error) {
        logger.warn('[AffiliateStoreSheet] Failed to open link', error);
        Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
      }
    },
    [handleClose, source, t],
  );

  const handleOpenOffer = useCallback(
    async (offer: AffiliateOffer) => {
      if (!offer.affiliateUrl) {
        return;
      }
      const url = normalizeAffiliateUrl(offer.affiliateUrl);
      handleClose();
      trackAffiliateClick({
        storeId: offer.id ?? offer.title,
        storeName: offer.title,
        source,
      }).catch(error =>
        logger.warn('[AffiliateStoreSheet] Failed to track click', error),
      );
      try {
        await Linking.openURL(url);
      } catch (error) {
        logger.warn('[AffiliateStoreSheet] Failed to open offer link', error);
        Alert.alert(t('alerts.error'), t('alerts.cannotOpenLink'));
      }
    },
    [handleClose, source, t],
  );

  const renderCard = ({
    name,
    logoUrl,
    discountLabel,
    onPress,
    accessibilityLabel,
  }: {
    name: string;
    logoUrl?: string;
    discountLabel?: string;
    onPress: () => void;
    accessibilityLabel: string;
  }) => (
    <TouchableOpacity
      style={styles.storeCard}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityLabel={accessibilityLabel}>
      <View style={styles.logoWrapper}>
        {logoUrl ? (
          <Image
            source={{uri: logoUrl}}
            style={styles.storeLogo}
            resizeMode="contain"
          />
        ) : (
          <Icon
            name="storefront-outline"
            size={32}
            color={palette.textSecondary}
          />
        )}
      </View>
      <Text style={styles.storeName} numberOfLines={2}>
        {name}
      </Text>
      {discountLabel ? (
        <View style={styles.discountBadge}>
          <Text style={styles.discountText}>{discountLabel}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );

  const renderStore = ({item}: {item: AffiliateStore}) =>
    renderCard({
      name: item.name,
      logoUrl: item.logoUrl,
      discountLabel: item.discountLabel,
      onPress: () => handleOpenStore(item),
      accessibilityLabel: item.name,
    });

  const renderGroup = ({item}: {item: AffiliateStoreGroup}) =>
    renderCard({
      name: item.name,
      logoUrl: item.logoUrl,
      discountLabel: item.discountLabel,
      onPress: () => setSelectedGroup(item),
      accessibilityLabel: item.name,
    });

  const renderOffer = ({item}: {item: AffiliateOffer}) => (
    <TouchableOpacity
      style={styles.offerCard}
      onPress={() => handleOpenOffer(item)}
      activeOpacity={0.85}
      accessibilityLabel={item.title}>
      {item.imageUrl ? (
        <Image
          source={{uri: item.imageUrl}}
          style={styles.offerImage}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.offerImagePlaceholder}>
          <Icon
            name="image-off-outline"
            size={22}
            color={palette.textSecondary}
          />
        </View>
      )}
      <View style={styles.offerDetails}>
        <Text style={styles.offerTitle} numberOfLines={2}>
          {item.title}
        </Text>
        <View style={styles.offerPriceRow}>
          {item.couponPrice ? (
            <Text style={styles.offerPrice}>{item.couponPrice}</Text>
          ) : null}
          {item.originalPrice ? (
            <Text style={styles.offerOriginalPrice}>{item.originalPrice}</Text>
          ) : null}
        </View>
        {item.couponCode ? (
          <Text style={styles.offerCoupon}>
            {t('affiliateStores.couponCode', {code: item.couponCode})}
          </Text>
        ) : null}
        {item.discountLabel ? (
          <Text style={styles.offerDiscount}>{item.discountLabel}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  const renderStateMessage = (message: string) => (
    <View style={styles.stateContainer}>
      <Text style={styles.stateText}>{message}</Text>
    </View>
  );

  const renderContent = () => {
    if (loading) {
      return (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="small" color={palette.highlight} />
          <Text style={styles.stateText}>{t('affiliateStores.loading')}</Text>
        </View>
      );
    }
    if (errorMessage) {
      return renderStateMessage(errorMessage);
    }
    if (selectedGroup?.displayMode === 'offers') {
      if (offersLoading) {
        return (
          <View style={styles.stateContainer}>
            <ActivityIndicator size="small" color={palette.highlight} />
            <Text style={styles.stateText}>
              {t('affiliateStores.offersLoading')}
            </Text>
          </View>
        );
      }
      if (offersErrorMessage) {
        return renderStateMessage(offersErrorMessage);
      }
      if (!offers.length) {
        return renderStateMessage(t('affiliateStores.offersEmpty'));
      }
      return (
        <FlatList
          data={offers}
          keyExtractor={(item, index) => item.id ?? `${item.title}-${index}`}
          renderItem={renderOffer}
          contentContainerStyle={styles.offerList}
          showsVerticalScrollIndicator={false}
        />
      );
    }
    const showStoreGroups = storeGroups.length > 0 && !selectedGroup;
    if (showStoreGroups) {
      return (
        <FlatList
          data={storeGroups}
          keyExtractor={(item, index) => item.id ?? `${item.name}-${index}`}
          renderItem={renderGroup}
          numColumns={2}
          contentContainerStyle={styles.storeGrid}
          columnWrapperStyle={styles.storeRow}
          showsVerticalScrollIndicator={false}
        />
      );
    }
    const filteredStores = selectedGroup
      ? stores.filter(store => store.groupId === selectedGroup.id)
      : stores;
    if (!filteredStores.length) {
      return renderStateMessage(
        selectedGroup
          ? t('affiliateStores.categoriesEmpty')
          : t('affiliateStores.empty'),
      );
    }
    return (
      <FlatList
        data={filteredStores}
        keyExtractor={(item, index) => item.id ?? `${item.name}-${index}`}
        renderItem={renderStore}
        numColumns={2}
        contentContainerStyle={styles.storeGrid}
        columnWrapperStyle={styles.storeRow}
        showsVerticalScrollIndicator={false}
      />
    );
  };

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <View style={styles.headerLeft}>
              {selectedGroup && (
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => setSelectedGroup(null)}>
                  <Icon
                    name="chevron-left"
                    size={22}
                    color={palette.textPrimary}
                  />
                </TouchableOpacity>
              )}
              <View style={styles.sheetTitleContainer}>
                <Text style={styles.sheetTitle}>
                  {selectedGroup
                    ? selectedGroup.name
                    : t('affiliateStores.storeTitle')}
                </Text>
                <Text style={styles.sheetSubtitle}>
                  {selectedGroup
                    ? selectedGroup.displayMode === 'offers'
                      ? t('affiliateStores.offersSubtitle')
                      : t('affiliateStores.categoriesSubtitle')
                    : t('affiliateStores.storeSubtitle')}
                </Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={handleClose}>
              <Icon name="close" size={22} color={palette.textPrimary} />
            </TouchableOpacity>
          </View>
          {renderContent()}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  sheet: {
    backgroundColor: palette.backgroundCard,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
    maxHeight: '75%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backButton: {
    marginRight: 8,
    padding: 6,
    borderRadius: radii.full,
    backgroundColor: palette.backgroundLight,
    borderWidth: 1,
    borderColor: palette.borderLight,
  },
  sheetTitleContainer: {
    flex: 1,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: palette.textPrimary,
  },
  sheetSubtitle: {
    fontSize: 13,
    color: palette.textSecondary,
    marginTop: 4,
  },
  closeButton: {
    padding: 6,
    borderRadius: radii.full,
    backgroundColor: palette.backgroundLight,
    borderWidth: 1,
    borderColor: palette.borderLight,
  },
  storeGrid: {
    paddingBottom: 10,
  },
  storeRow: {
    justifyContent: 'space-between',
  },
  offerList: {
    paddingBottom: 12,
  },
  offerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.backgroundLight,
    borderRadius: radii.lg,
    padding: 10,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  offerImage: {
    width: 70,
    height: 70,
    borderRadius: 12,
    marginRight: 12,
    backgroundColor: palette.backgroundMuted,
  },
  offerImagePlaceholder: {
    width: 70,
    height: 70,
    borderRadius: 12,
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.backgroundMuted,
  },
  offerDetails: {
    flex: 1,
  },
  offerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textPrimary,
    marginBottom: 4,
  },
  offerPriceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  offerPrice: {
    fontSize: 14,
    fontWeight: '700',
    color: palette.success,
  },
  offerOriginalPrice: {
    fontSize: 12,
    color: palette.textSecondary,
    textDecorationLine: 'line-through',
  },
  offerCoupon: {
    marginTop: 4,
    fontSize: 12,
    color: palette.textSecondary,
  },
  offerDiscount: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '600',
    color: palette.highlight,
  },
  storeCard: {
    flex: 1,
    backgroundColor: palette.backgroundLight,
    borderRadius: radii.lg,
    padding: 12,
    marginHorizontal: 4,
    marginBottom: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  logoWrapper: {
    width: '100%',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeLogo: {
    width: '100%',
    height: 40,
  },
  discountBadge: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.full,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  discountText: {
    fontSize: 12,
    fontWeight: '700',
    color: palette.success,
  },
  storeName: {
    marginTop: 8,
    fontSize: 12,
    color: palette.textSecondary,
    textAlign: 'center',
  },
  stateContainer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  stateText: {
    marginTop: 8,
    textAlign: 'center',
    color: palette.textSecondary,
  },
});

export default AffiliateStoreSheet;
