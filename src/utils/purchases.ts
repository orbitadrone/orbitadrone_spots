import {CustomerInfo, PurchasesOffering, PurchasesPackage} from 'react-native-purchases';

import {REMOVE_ADS_ENTITLEMENT_ID} from '../constants/purchases';

type CustomerInfoLike = Pick<CustomerInfo, 'entitlements'> | null | undefined;

const PACKAGE_PREFERENCE_ORDER = [
  'MONTHLY',
  'ANNUAL',
  'SIX_MONTH',
  'THREE_MONTH',
  'TWO_MONTH',
  'WEEKLY',
  'LIFETIME',
  'CUSTOM',
];

export const hasRemoveAdsEntitlement = (customerInfo: CustomerInfoLike) =>
  Boolean(customerInfo?.entitlements?.active?.[REMOVE_ADS_ENTITLEMENT_ID]);

export const getPreferredRemoveAdsPackage = (
  offering?: PurchasesOffering | null,
): PurchasesPackage | null => {
  const availablePackages = offering?.availablePackages ?? [];
  if (!availablePackages.length) {
    return null;
  }

  for (const packageType of PACKAGE_PREFERENCE_ORDER) {
    const match = availablePackages.find(
      availablePackage => availablePackage.packageType === packageType,
    );
    if (match) {
      return match;
    }
  }

  return availablePackages[0] ?? null;
};
