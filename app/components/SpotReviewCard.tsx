import React from 'react';
import {Button, Image, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {Rating} from 'react-native-ratings';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {Review} from '../../src/services/firestoreService';
import {palette, radii, shadows} from '../../src/constants/theme';

type SpotReviewCardProps = {
  review: Review;
  authorName: string;
  authorProfileId?: string | null;
  reportLabel: string;
  viewVideoLabel: string;
  onPressAuthor: (userId: string) => void;
  onOpenVideo: (url: string) => void;
  onReport: () => void;
};

const SpotReviewCard = ({
  review,
  authorName,
  authorProfileId,
  reportLabel,
  viewVideoLabel,
  onPressAuthor,
  onOpenVideo,
  onReport,
}: SpotReviewCardProps) => {
  const displayRating = typeof review.rating === 'number' && review.rating > 0;
  const displayText = typeof review.text === 'string' && review.text.trim().length > 0;

  return (
    <View style={styles.reviewCard}>
      <TouchableOpacity
        onPress={() => authorProfileId && onPressAuthor(authorProfileId)}
        disabled={!authorProfileId}>
        <Text
          style={[
            styles.reviewAuthor,
            authorProfileId ? styles.reviewAuthorLink : undefined,
          ]}>
          {authorName}
        </Text>
      </TouchableOpacity>

      {displayRating ? (
        <Rating
          type="star"
          ratingCount={5}
          imageSize={15}
          readonly
          startingValue={review.rating}
          style={styles.reviewRating}
        />
      ) : null}

      {displayText ? <Text style={styles.reviewText}>{review.text}</Text> : null}

      {review.photos?.length ? (
        <View style={styles.reviewPhotosContainer}>
          {review.photos.map((photoUri, index) => (
            <Image key={`${review.id ?? 'review'}-photo-${index}`} source={{uri: photoUri}} style={styles.reviewPhoto} />
          ))}
        </View>
      ) : null}

      {review.videoUrl ? (
        <Button title={viewVideoLabel} onPress={() => onOpenVideo(review.videoUrl!)} />
      ) : null}

      <TouchableOpacity style={styles.reviewReportButton} onPress={onReport}>
        <Icon name="flag-outline" size={16} color="#666" />
        <Text style={styles.reviewReportText}>{reportLabel}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  reviewCard: {
    backgroundColor: palette.backgroundCard,
    padding: 12,
    borderRadius: radii.lg,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: palette.borderLight,
    ...shadows.subtle,
  },
  reviewAuthor: {
    fontWeight: 'bold',
    marginBottom: 4,
    color: palette.textPrimary,
  },
  reviewAuthorLink: {
    color: palette.highlight,
    textDecorationLine: 'underline',
  },
  reviewRating: {
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  reviewText: {
    fontSize: 14,
    color: palette.textSecondary,
    lineHeight: 22,
  },
  reviewPhotosContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 8,
  },
  reviewPhoto: {
    width: 100,
    height: 100,
    margin: 4,
    borderRadius: radii.md,
  },
  reviewReportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  reviewReportText: {
    marginLeft: 4,
    color: '#666',
    fontSize: 12,
    textDecorationLine: 'underline',
  },
});

export default React.memo(SpotReviewCard);
