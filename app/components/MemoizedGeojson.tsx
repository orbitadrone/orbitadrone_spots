import React, { memo } from 'react';
import { Geojson } from 'react-native-maps';

interface MemoizedGeojsonProps {
  geojson: any;
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
}

const MemoizedGeojson = memo(({ geojson, strokeColor, fillColor, strokeWidth }: MemoizedGeojsonProps) => {
  return (
    <Geojson
      geojson={geojson}
      strokeColor={strokeColor}
      fillColor={fillColor}
      strokeWidth={strokeWidth}
    />
  );
});

export default MemoizedGeojson;