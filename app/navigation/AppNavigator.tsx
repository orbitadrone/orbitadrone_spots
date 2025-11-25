import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createStackNavigator } from '@react-navigation/stack';
import MapScreen from '../screens/MapScreen';
import MySpotsScreen from '../screens/MySpotsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import UserProfileScreen from '../screens/UserProfileScreen';
import SpotDetailScreen from '../screens/SpotDetailScreen';
import AddSpotScreen from '../screens/AddSpotScreen';
import AddReviewScreen from '../screens/AddReviewScreen'; // Importar AddReviewScreen
import SpotVersionsScreen from '../screens/SpotVersionsScreen'; // Importar SpotVersionsScreen
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTranslation } from 'react-i18next';

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator();

// Navegador de Pestañas principal
function MainTabNavigator() {
  const { t } = useTranslation(); // La traducción se obtiene aquí
  return (
    <Tab.Navigator
      id={undefined}
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;
          if (route.name === 'Map') {
            iconName = focused ? 'map' : 'map-outline';
          } else if (route.name === 'MySpots') {
            iconName = focused ? 'star' : 'star-outline';
          } else if (route.name === 'Profile') {
            iconName = focused ? 'account-circle' : 'account-circle-outline';
          }
          return <Icon name={iconName as string} size={size} color={color} />;
        },
        tabBarActiveTintColor: 'tomato',
        tabBarInactiveTintColor: 'gray',
        headerShown: false,
        tabBarLabelStyle: {
          fontSize: 10,
        },
      })}
    >
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
    </Stack.Navigator>
  );
}

export default AppNavigator;
