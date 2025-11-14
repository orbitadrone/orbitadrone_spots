import { Spot } from '../../src/services/firestoreService';

export const navigateToSpotAfterAd = async ({
  navigation,
  spotId,
  fetchVersions,
  onFallback,
}: {
  navigation: any;
  spotId: string;
  fetchVersions: (id: string) => Promise<Spot[]>;
  onFallback: () => void;
}) => {
  try {
    const versions = await fetchVersions(spotId);
    if (versions.length > 1) {
      navigation.navigate('SpotVersions', { spots: versions });
    } else if (versions.length === 1) {
      navigation.navigate('SpotDetail', { spotId: versions[0].id });
    } else {
      onFallback();
    }
  } catch (error) {
    console.error("Error navigating to spot:", error);
    onFallback();
  }
};
