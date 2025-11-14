import React, { useState, useEffect } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import CustomButton from './CustomButton';
import Purchases, { PurchasesOffering } from 'react-native-purchases';
import Toast from 'react-native-toast-message';
import { REMOVE_ADS_ENTITLEMENT_ID, REMOVE_ADS_DISPLAY_NAME } from '../../src/constants/purchases';

interface RemoveAdsModalProps {
  isVisible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
}

const RemoveAdsModal: React.FC<RemoveAdsModalProps> = ({
  isVisible,
  onClose,
  onWatchAd,
}) => {
  const { t } = useTranslation();
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isVisible) {
      const fetchOfferings = async () => {
        setIsLoading(true);
        try {
          const offerings = await Purchases.getOfferings();
          if (offerings.current !== null) {
            setOffering(offerings.current);
          }
        } catch (e) {
          console.error("Error fetching offerings", e);
        } finally {
          setIsLoading(false);
        }
      };
      fetchOfferings();
    }
  }, [isVisible, t]);

  const handleSubscribe = async () => {
    if (!offering?.availablePackages[0]) {
      return;
    }
    try {
      const { customerInfo } = await Purchases.purchasePackage(offering.availablePackages[0]);
      // Aquí puedes verificar si el usuario tiene la suscripción activa
      if (customerInfo.entitlements.active[REMOVE_ADS_ENTITLEMENT_ID]) {
        Toast.show({ type: 'success', text1: t('iap.purchaseSuccessTitle'), text2: t('iap.purchaseSuccessMessage') });
        onClose();
      }
    } catch (e: any) {
      if (!e.userCancelled) {
        console.error("Purchase error", e);
        Toast.show({ type: 'error', text1: t('iap.purchaseError'), text2: e.message });
      }
    }
  };

  const handleRestorePurchases = async () => {
    try {
      const customerInfo = await Purchases.restorePurchases();
      if (customerInfo.entitlements.active[REMOVE_ADS_ENTITLEMENT_ID]) {
        Toast.show({ type: 'success', text1: t('iap.restoreSuccessTitle'), text2: t('iap.restoreSuccessMessage') });
        onClose();
      } else {
        Toast.show({ type: 'info', text1: t('iap.restoreEmptyTitle'), text2: t('iap.restoreEmptyMessage') });
      }
    } catch (e) {
      console.error("Restore error", e);
      Toast.show({ type: 'error', text1: t('iap.restoreError') });
    }
  };

  const monthlyPackage = offering?.availablePackages[0];
  
  const getSubscribeButtonTitle = () => {
    if (isLoading) {
      return t('common.loading');
    }
    if (monthlyPackage) {
      return `${t('removeAds.subscribeButton')} - ${monthlyPackage.product.priceString}`;
    }
    return t('iap.productNotFound');
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={onClose}
    >
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Icon name="close" size={24} color="#888" />
          </TouchableOpacity>

          <Icon name="crown" size={48} color="#FFD700" style={styles.headerIcon} />
          <Text style={styles.modalTitle}>{t('removeAds.title')}</Text>
          <Text style={styles.modalSubtitle}>{t('removeAds.subtitle')}</Text>

          <View style={styles.optionContainer}>
            <View style={styles.optionHeader}>
              <Icon name="gift-outline" size={24} color="#4CAF50" />
              <Text style={styles.optionTitle}>{t('removeAds.rewardOptionTitle')}</Text>
            </View>
            <Text style={styles.optionDescription}>
              {t('removeAds.rewardOptionDescription')}
            </Text>
            <CustomButton
              title={t('removeAds.watchAdButton')}
              onPress={onWatchAd}
              style={styles.rewardButton}
              textStyle={styles.rewardButtonText}
            />
          </View>

          <View style={styles.optionContainer}>
            <View style={styles.optionHeader}>
              <Icon name="rocket-launch-outline" size={24} color="#007BFF" />
              <Text style={styles.optionTitle}>
                {t('removeAds.premiumOptionTitle', { defaultValue: REMOVE_ADS_DISPLAY_NAME })}
              </Text>
            </View>
            <Text style={styles.optionDescription}>
              {t('removeAds.premiumOptionDescription', { planName: REMOVE_ADS_DISPLAY_NAME })}
            </Text>
            <CustomButton
              title={getSubscribeButtonTitle()}
              onPress={handleSubscribe}
              disabled={isLoading || !monthlyPackage}
            />
          </View>

          <TouchableOpacity style={styles.restoreButton} onPress={handleRestorePurchases}>
            <Text style={styles.restoreButtonText}>{t('iap.restorePurchases')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 25,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '90%',
  },
  closeButton: {
    position: 'absolute',
    top: 15,
    right: 15,
  },
  headerIcon: {
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 20,
  },
  optionContainer: {
    width: '100%',
    padding: 15,
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 10,
    marginBottom: 15,
    alignItems: 'center',
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  optionTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginLeft: 10,
  },
  optionDescription: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
    marginBottom: 15,
    lineHeight: 20,
  },
  rewardButton: {
    backgroundColor: '#E8F5E9',
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  rewardButtonText: {
    color: '#4CAF50',
  },
  restoreButton: {
    width: '100%',
    marginTop: 10,
    paddingVertical: 10,
  },
  restoreButtonText: {
    color: '#007BFF',
    fontSize: 14,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
});

export default RemoveAdsModal;
