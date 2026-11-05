import React from 'react';
import {Image, Modal, ScrollView, Text, TouchableOpacity, View} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {palette} from '../../../src/constants/theme';
import {
  AdminSelectedSpotDetails,
  buildSpotMedia,
  formatAdminDate,
} from '../../features/admin/adminPanelShared';
import {styles} from './adminStyles';

type AdminSpotDetailsModalProps = {
  onClose: () => void;
  selectedSpotDetails: AdminSelectedSpotDetails | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  usersById: Record<string, {displayName?: string | null}>;
};

export default function AdminSpotDetailsModal({
  onClose,
  selectedSpotDetails,
  t,
  usersById,
}: AdminSpotDetailsModalProps) {
  return (
    <Modal
      visible={Boolean(selectedSpotDetails)}
      transparent
      animationType="slide"
      onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {selectedSpotDetails?.spot.name || t('feed.untitled')}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={20} color={palette.textPrimary} />
            </TouchableOpacity>
          </View>

          {selectedSpotDetails ? (
            <ScrollView>
              <Text style={styles.modalMeta}>
                {t('admin.spots.author')}:{' '}
                {usersById[selectedSpotDetails.spot.createdBy]?.displayName ||
                  t('common.unknownUser')}
              </Text>
              <Text style={styles.modalMeta}>
                {t('admin.spots.createdAt')}:{' '}
                {formatAdminDate(selectedSpotDetails.spot.createdAt, t)}
              </Text>
              <Text style={styles.modalMeta}>
                {t('admin.spots.rating')}:{' '}
                {Number(selectedSpotDetails.spot.averageRating || 0).toFixed(1)} (
                {selectedSpotDetails.spot.ratingCount ??
                  selectedSpotDetails.spot.reviewCount ??
                  0}
                )
              </Text>
              <Text style={styles.modalMeta}>
                {t('admin.spots.commentsCount')}: {selectedSpotDetails.comments.length}
              </Text>

              {buildSpotMedia(selectedSpotDetails.spot).images.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {buildSpotMedia(selectedSpotDetails.spot).images.map(image => (
                    <Image key={image} source={{uri: image}} style={styles.modalImage} />
                  ))}
                </ScrollView>
              ) : null}

              {selectedSpotDetails.spot.videoUrl ? (
                <View style={styles.modalVideoBadge}>
                  <Icon name="play-circle" size={18} color={palette.highlight} />
                  <Text style={styles.modalMeta}>{t('admin.spots.hasVideo')}</Text>
                </View>
              ) : null}

              <Text style={styles.modalDescription}>
                {selectedSpotDetails.spot.description || t('feed.noDescription')}
              </Text>

              <Text style={styles.modalSubTitle}>{t('admin.spots.commentsSection')}</Text>
              {selectedSpotDetails.comments.length ? (
                selectedSpotDetails.comments.map(comment => {
                  const author =
                    usersById[comment.userId]?.displayName || t('common.unknownUser');
                  return (
                    <View key={comment.id} style={styles.modalCommentRow}>
                      <Text style={styles.commentAuthor}>{author}</Text>
                      <Text style={styles.commentBody}>{comment.text}</Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.modalMeta}>{t('feed.noCommentsYet')}</Text>
              )}

              <Text style={styles.modalSubTitle}>{t('admin.spots.ratingsSection')}</Text>
              {selectedSpotDetails.ratings.length ? (
                selectedSpotDetails.ratings.map(rating => {
                  const author =
                    usersById[rating.userId]?.displayName || t('common.unknownUser');
                  return (
                    <View key={rating.id} style={styles.modalCommentRow}>
                      <Text style={styles.commentAuthor}>{author}</Text>
                      <Text style={styles.modalMeta}>
                        {t('admin.spots.ratingValue', {value: rating.rating})}
                      </Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.modalMeta}>{t('admin.spots.noRatings')}</Text>
              )}
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
