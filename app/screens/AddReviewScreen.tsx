import React, { useMemo, useState } from 'react';
import { View, Text, Button, StyleSheet, Alert, ActivityIndicator, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { addReview, Review } from '../../src/services/firestoreService';
import { authInstance as auth } from '../../src/firebaseConfig';

const AddReviewScreen = ({ navigation, route }: { navigation: any, route: any }) => {
  const { t } = useTranslation();
  const { spotId, mode = 'comment' } = route.params ?? {};
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);

  const isRatingMode = mode === 'rating';
  const title = useMemo(
    () => (isRatingMode ? t('addReview.ratingTitle') : t('addReview.commentTitle')),
    [isRatingMode, t],
  );
  const submitLabel = useMemo(
    () => (isRatingMode ? t('addReview.submitRatingButton') : t('addReview.submitCommentButton')),
    [isRatingMode, t],
  );

  const handleAddReview = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert(t('alerts.error'), t('alerts.mustBeLoggedIn'));
      return;
    }

    if (isRatingMode) {
      if (rating === 0) {
        Alert.alert(t('alerts.error'), t('alerts.enterRatingOnly'));
        return;
      }
    } else {
      if (!comment.trim()) {
        Alert.alert(t('alerts.error'), t('alerts.enterComment'));
        return;
      }
    }

    setLoading(true);
    try {
      const newReview: Omit<Review, 'id' | 'createdAt'> = {
        spotId,
        userId: user.uid,
        type: isRatingMode ? 'rating' : 'comment',
        moderationStatus: 'approved',
        moderationNotes: null,
        moderatedBy: null,
        moderatedAt: null,
        reportCount: 0,
      };

      if (isRatingMode) {
        newReview.rating = rating;
      }

      if (!isRatingMode) {
        newReview.text = comment.trim();
      }

      await addReview(newReview);
      Alert.alert(t('alerts.reviewAdded'));
      navigation.goBack();
    } catch (error) {
      console.error("Error adding review: ", error);
      Alert.alert(t('alerts.error'), t('alerts.addReviewError'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" />
        <Text>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
        <Icon name="arrow-left" size={24} color="#000" />
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>

      {isRatingMode ? (
        <>
          <Text style={styles.label}>{t('addReview.ratingLabel')}</Text>
          <View style={styles.ratingContainer}>
            {[1, 2, 3, 4, 5].map((star) => (
              <TouchableOpacity key={star} onPress={() => setRating(star)}>
                <Text style={rating >= star ? styles.starSelected : styles.starUnselected}>★</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.helperText}>{t('addReview.ratingOnlyHint')}</Text>
        </>
      ) : (
        <>
          <Text style={styles.label}>{t('addReview.commentLabel')}</Text>
          <TextInput
            style={styles.commentInput}
            placeholder={t('addReview.commentPlaceholder')}
            value={comment}
            onChangeText={setComment}
            multiline
            numberOfLines={4}
          />
        </>
      )}

      <Button title={submitLabel} onPress={handleAddReview} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    marginTop: 16,
  },
  ratingContainer: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  starSelected: {
    fontSize: 30,
    color: 'gold',
  },
  starUnselected: {
    fontSize: 30,
    color: 'gray',
  },
  commentInput: {
    minHeight: 100,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
    color: '#000',
    marginBottom: 20,
  },
  helperText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 20,
    textAlign: 'center',
  },
  backButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    zIndex: 1,
  },
});

export default AddReviewScreen;
