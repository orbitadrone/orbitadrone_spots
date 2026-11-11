import {
  buildFilteredPilots,
  buildFilteredSpots,
  buildPilotMarkersForMap,
  getSpotRegion,
  parseMapSearch,
} from '../app/features/map/mapScreenShared';

describe('mapScreenShared', () => {
  it('parses terms and hashtags from search text', () => {
    expect(parseMapSearch('Madrid costa #Freestyle #Sunset')).toEqual({
      hasSearch: true,
      plainQuery: 'madrid costa',
      tags: ['freestyle', 'sunset'],
      terms: ['madrid', 'costa'],
    });
  });

  it('filters spots by text, tags, and selected flight styles', () => {
    const parsedSearch = parseMapSearch('madrid #freestyle');
    const spots = [
      {
        id: 'spot-1',
        name: 'Madrid Rooftop',
        address: 'Centro',
        description: 'Sunset line over the city',
        tags: ['Freestyle', 'Sunset'],
        flightStyles: ['Freestyle', 'Cinematic'],
      },
      {
        id: 'spot-2',
        name: 'Valencia Beach',
        address: 'Malvarrosa',
        description: 'Long range coast line',
        tags: ['LongRange'],
        flightStyles: ['Long Range'],
      },
    ] as any[];

    expect(
      buildFilteredSpots({
        parsedSearch,
        selectedStyles: ['Cinematic'],
        spots,
      }),
    ).toEqual([spots[0]]);
  });

  it('filters pilots by display name or region using the plain query', () => {
    const pilots = [
      {id: 'u1', displayName: 'Madrid Pilot', cityRegion: 'Toledo'},
      {id: 'u2', displayName: 'Carlos', cityRegion: 'Costa Brava'},
      {id: 'u3', displayName: 'Ana', cityRegion: 'Madrid Norte'},
    ] as any[];

    expect(
      buildFilteredPilots({
        parsedSearch: parseMapSearch('madrid'),
        pilotMarkers: pilots,
      }),
    ).toEqual([pilots[0], pilots[2]]);
  });

  it('keeps the current user marker synchronized with the latest profile marker data', () => {
    const markers = [
      {id: 'pilot-1', latitude: 1, longitude: 1, photoUrl: 'old.jpg'},
      {id: 'pilot-2', latitude: 2, longitude: 2, photoUrl: 'pilot-2.jpg'},
    ] as any[];

    expect(
      buildPilotMarkersForMap({
        pilotMarkerData: {latitude: 10, longitude: 20, photoUrl: 'new.jpg'},
        pilotMarkers: markers,
        userId: 'pilot-1',
      }),
    ).toEqual([
      {id: 'pilot-1', latitude: 10, longitude: 20, photoUrl: 'new.jpg'},
      {id: 'pilot-2', latitude: 2, longitude: 2, photoUrl: 'pilot-2.jpg'},
    ]);
  });

  it('builds map regions from either GeoPoint-like coordinates or flat lat/lng fields', () => {
    expect(
      getSpotRegion({
        coordinates: {latitude: 40.4, longitude: -3.7},
      } as any),
    ).toEqual({
      latitude: 40.4,
      longitude: -3.7,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });

    expect(
      getSpotRegion({
        lat: 41.38,
        lng: 2.17,
      } as any),
    ).toEqual({
      latitude: 41.38,
      longitude: 2.17,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    });
  });
});
