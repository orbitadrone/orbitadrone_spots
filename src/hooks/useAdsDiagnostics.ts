import {useSyncExternalStore} from 'react';

import {adsDiagnosticsService} from '../services/adsDiagnosticsService';

export const useAdsDiagnostics = () =>
  useSyncExternalStore(
    adsDiagnosticsService.subscribe,
    adsDiagnosticsService.getState,
    adsDiagnosticsService.getState,
  );
