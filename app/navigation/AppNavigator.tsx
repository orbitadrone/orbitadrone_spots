import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import MapScreen from '../screens/MapScreen';
import FeedScreen from '../screens/FeedScreen';
import MySpotsScreen from '../screens/MySpotsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import UserProfileScreen from '../screens/UserProfileScreen';
import SpotDetailScreen from '../screens/SpotDetailScreen';
import AddSpotScreen from '../screens/AddSpotScreen';
import AddReviewScreen from '../screens/AddReviewScreen'; // Importar AddReviewScreen
import SpotVersionsScreen from '../screens/SpotVersionsScreen'; // Importar SpotVersionsScreen
import AdminPanelScreen from '../screens/AdminPanelScreen';
import CreateDronePostScreen from '../screens/CreateDronePostScreen';
import CreateEventScreen from '../screens/CreateEventScreen';
import EventDetailScreen from '../screens/EventDetailScreen';

import { useTranslation } from 'react-i18next';
import AppTabBar from '../components/navigation/AppTabBar';
import type {AppStackParamList, MainTabParamList} from '../../src/navigation/types';
import type {BottomTabBarProps} from '@react-navigation/bottom-tabs';

const Tab = createBottomTabNavigator<MainTabParamList>();
const Stack = createStackNavigator<AppStackParamList>();

const renderAppTabBar = (props: BottomTabBarProps) => <AppTabBar {...props} />;

// Navegador de Pestañas principal
function MainTabNavigator() {
  const { t } = useTranslation(); // La traducción se obtiene aquí
  return (
    <Tab.Navigator
      id={undefined}
      tabBar={renderAppTabBar}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tab.Screen
        name="Feed"
        component={FeedScreen}
        options={{
          tabBarLabel: t('navigation.feed'),
        }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{
          tabBarLabel: t('navigation.map'),
        }}
      />
      <Tab.Screen
        name="MySpots"
        component={MySpotsScreen}
        options={{
          tabBarLabel: t('navigation.mySpots'),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: t('navigation.profile'),
        }}
      />
    </Tab.Navigator>
  );
}

// Navegador de Stack principal que contiene todo
function AppNavigator() {
  return (
    <Stack.Navigator id={undefined} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={MainTabNavigator} />
      <Stack.Screen name="SpotDetail" component={SpotDetailScreen} />
      <Stack.Screen name="AddSpot" component={AddSpotScreen} />
      <Stack.Screen name="AddReview" component={AddReviewScreen} />
      <Stack.Screen name="SpotVersions" component={SpotVersionsScreen} />
      <Stack.Screen name="UserProfile" component={UserProfileScreen} />
      <Stack.Screen name="CreateDronePost" component={CreateDronePostScreen} />
      <Stack.Screen name="CreateEvent" component={CreateEventScreen} />
      <Stack.Screen name="EventDetail" component={EventDetailScreen} />
      <Stack.Screen name="AdminPanel" component={AdminPanelScreen} />
    </Stack.Navigator>
  );
}

export default AppNavigator;
