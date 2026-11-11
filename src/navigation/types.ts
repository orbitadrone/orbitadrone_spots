import type {FirebaseAuthTypes} from '@react-native-firebase/auth';
import type {
  CompositeNavigationProp,
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type {
  BottomTabBarProps,
  BottomTabNavigationProp,
  BottomTabScreenProps,
} from '@react-navigation/bottom-tabs';
import type {StackNavigationProp, StackScreenProps} from '@react-navigation/stack';

import type {Spot} from '../services/firestoreService';

export type Coordinate = {
  latitude: number;
  longitude: number;
};

export type LegalScreenRouteParams = {
  title: string;
  content: string;
};

export type FeedScreenRouteParams = {
  refreshAt?: number;
  createdPostId?: string | null;
  postId?: string;
  activityAt?: number;
} | undefined;

export type MapScreenRouteParams = {
  focusEventId?: string | null;
  focusLatitude?: number | null;
  focusLongitude?: number | null;
  focusRequestedAt?: number;
} | undefined;

export type AddSpotRouteParams = {
  spot?: Spot | null;
  originalSpot?: Spot | null;
  coordinate?: Coordinate | null;
} | undefined;

export type AddReviewMode = 'comment' | 'rating';

export type AddReviewRouteParams = {
  spotId: string;
  mode?: AddReviewMode;
};

export type SpotVersionsRouteParams = {
  spots: Spot[];
};

export type UserProfileRouteParams = {
  userId: string;
};

export type EventDetailRouteParams = {
  eventId: string;
};

export type CreateEventRouteParams = {
  coordinate?: Coordinate | null;
} | undefined;

export type MainTabParamList = {
  Feed: FeedScreenRouteParams;
  Map: MapScreenRouteParams;
  MySpots: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  SpotDetail: {spotId: string};
  AddSpot: AddSpotRouteParams;
  AddReview: AddReviewRouteParams;
  SpotVersions: SpotVersionsRouteParams;
  UserProfile: UserProfileRouteParams;
  CreateDronePost: undefined;
  CreateEvent: CreateEventRouteParams;
  EventDetail: EventDetailRouteParams;
  AdminPanel: undefined;
};

export type RootStackParamList = {
  App: NavigatorScreenParams<AppStackParamList> | undefined;
  Login: undefined;
  Signup: undefined;
  LegalScreen: LegalScreenRouteParams;
};

export type AuthenticatedUser = FirebaseAuthTypes.User | null;

export type RootStackNavigationProp<
  RouteName extends keyof RootStackParamList = keyof RootStackParamList,
> = StackNavigationProp<RootStackParamList, RouteName>;

export type AppStackNavigationProp<
  RouteName extends keyof AppStackParamList = keyof AppStackParamList,
> = StackNavigationProp<AppStackParamList, RouteName>;

export type MainTabNavigationProp<
  RouteName extends keyof MainTabParamList = keyof MainTabParamList,
> = BottomTabNavigationProp<MainTabParamList, RouteName>;

export type MainTabScreenNavigationProp<RouteName extends keyof MainTabParamList> =
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList, RouteName>,
    StackNavigationProp<AppStackParamList>
  >;

export type RootStackScreenProps<RouteName extends keyof RootStackParamList> = StackScreenProps<
  RootStackParamList,
  RouteName
>;

export type AppStackScreenProps<RouteName extends keyof AppStackParamList> = StackScreenProps<
  AppStackParamList,
  RouteName
>;

export type MainTabScreenProps<RouteName extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, RouteName>,
  StackScreenProps<AppStackParamList>
>;

export type AppTabBarProps = BottomTabBarProps;
