/**
 * @format
 */

import './src/firebaseConfig';
import './src/services/messagingBackgroundHandler';
import { silenceConsoleInProd } from './src/utils/logger';
import {AppRegistry} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

// Silence verbose console methods in production builds
silenceConsoleInProd();

AppRegistry.registerComponent(appName, () => App);
