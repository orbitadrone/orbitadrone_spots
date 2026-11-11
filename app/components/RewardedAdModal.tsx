import React from 'react';
import {Modal, View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {useTranslation} from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import CustomButton from './CustomButton';
import {useAds} from '../context/AdContext';
import logger from '../../src/utils/logger';

interface RewardedAdModalProps {
  isVisible: boolean;
  onClose: () => void;
  onWatchAd: () => void;
}

const RewardedAdModal = ({isVisible, onClose, onWatchAd}: RewardedAdModalProps) => {
  const {t} = useTranslation();
  const {canRequestAds, isPrivacyOptionsRequired, openPrivacyOptions} = useAds();

  return (
    <Modal animationType="slide" transparent visible={isVisible} onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} accessibilityLabel={t('common.cancel')}>
            <Icon name="close" size={24} color="#666" />
          </TouchableOpacity>
          <Icon name="play-circle-outline" size={48} color="#2563eb" />
          <Text style={styles.title}>{t('rewardedAds.title')}</Text>
          <Text style={styles.description}>
            {canRequestAds ? t('rewardedAds.description') : t('adsPrivacy.rewardBlockedDescription')}
          </Text>
          <CustomButton
            title={t('rewardedAds.watchAdButton')}
            onPress={onWatchAd}
            disabled={!canRequestAds}
          />
          {!canRequestAds && isPrivacyOptionsRequired ? (
            <TouchableOpacity
              style={styles.privacyButton}
              onPress={() => {
                openPrivacyOptions().catch(error => {
                  logger.warn('[RewardedAdModal] Failed to open privacy options', error);
                });
              }}>
              <Text style={styles.privacyText}>{t('adsPrivacy.manageChoicesButton')}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)'},
  card: {width: '88%', maxWidth: 440, padding: 24, borderRadius: 20, backgroundColor: '#fff', alignItems: 'center'},
  closeButton: {alignSelf: 'flex-end', padding: 4},
  title: {fontSize: 22, fontWeight: '700', color: '#111827', marginTop: 12, marginBottom: 12},
  description: {fontSize: 15, textAlign: 'center', color: '#4b5563', marginBottom: 20, lineHeight: 22},
  privacyButton: {padding: 12, marginTop: 8},
  privacyText: {color: '#2563eb', textAlign: 'center'},
});

export default RewardedAdModal;
