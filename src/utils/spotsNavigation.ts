import { Spot } from '../../src/services/firestoreService';
import type {SpotVersionsRouteParams} from '../navigation/types';
import logger from './logger';

type SpotVersionsNavigation = {
  navigate(screen: 'SpotVersions', params: SpotVersionsRouteParams): void;
  navigate(screen: 'SpotDetail', params: {spotId: string}): void;
};

export const navigateToSpotAfterAd = async ({
  navigation,
  spotId,
  fetchVersions,
  onFallback,
}: {
  navigation: SpotVersionsNavigation;
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
    logger.error('Error navigating to spot', error);
    onFallback();
  }
};
