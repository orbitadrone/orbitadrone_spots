import React, { createContext, useState, useContext, ReactNode, useMemo } from 'react';
import { Region } from 'react-native-maps';

interface MapState {
  region: Region | null;
  setRegion: (region: Region | null) => void;
  selectedCoordinate: { latitude: number; longitude: number } | null;
  setSelectedCoordinate: (coordinate: { latitude: number; longitude: number } | null) => void;
}

const MapContext = createContext<MapState | undefined>(undefined);

export const MapProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [region, setRegion] = useState<Region | null>(null);
  const [selectedCoordinate, setSelectedCoordinate] = useState<{ latitude: number; longitude: number } | null>(null);

  const value = useMemo(() => ({
    region, 
    setRegion, 
    selectedCoordinate, 
    setSelectedCoordinate
  }), [region, selectedCoordinate]);

  return (
    <MapContext.Provider value={value}>
      {children}
    </MapContext.Provider>
  );
};

export const useMap = () => {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error('useMap must be used within a MapProvider');
  }
  return context;
};