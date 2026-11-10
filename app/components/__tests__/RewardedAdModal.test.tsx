import React from 'react';
import {render, fireEvent, screen} from '@testing-library/react-native';
import RewardedAdModal from '../RewardedAdModal';

const mockOpenPrivacyOptions = jest.fn().mockResolvedValue(undefined);
const mockAds = {canRequestAds: true, isPrivacyOptionsRequired: false};

jest.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
jest.mock('../../context/AdContext', () => ({
  useAds: () => ({...mockAds, openPrivacyOptions: mockOpenPrivacyOptions}),
}));

describe('RewardedAdModal', () => {
  const onClose = jest.fn();
  const onWatchAd = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    mockAds.canRequestAds = true;
    mockAds.isPrivacyOptionsRequired = false;
  });

  it('lets the user choose a rewarded video', () => {
    render(<RewardedAdModal isVisible onClose={onClose} onWatchAd={onWatchAd} />);
    expect(screen.getByText('rewardedAds.description')).toBeTruthy();
    fireEvent.press(screen.getByText('rewardedAds.watchAdButton'));
    expect(onWatchAd).toHaveBeenCalledTimes(1);
  });

  it('does not show a hidden modal', () => {
    render(<RewardedAdModal isVisible={false} onClose={onClose} onWatchAd={onWatchAd} />);
    expect(screen.queryByText('rewardedAds.title')).toBeNull();
  });

  it('does not request a video when consent disallows ads', () => {
    mockAds.canRequestAds = false;
    mockAds.isPrivacyOptionsRequired = true;
    render(<RewardedAdModal isVisible onClose={onClose} onWatchAd={onWatchAd} />);
    fireEvent.press(screen.getByText('rewardedAds.watchAdButton'));
    expect(onWatchAd).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('adsPrivacy.manageChoicesButton'));
    expect(mockOpenPrivacyOptions).toHaveBeenCalledTimes(1);
  });
});
