import 'react-native';
import React from 'react';
import renderer, {act} from 'react-test-renderer';

import App from '../App';

describe('App', () => {
  it('renders correctly', () => {
    jest.useFakeTimers();
    let tree: renderer.ReactTestRenderer | null = null;

    act(() => {
      tree = renderer.create(<App />);
    });

    // Flush pending timers/effects so hooks like setTimeout complete.
    act(() => {
      jest.runAllTimers();
    });

    act(() => {
      tree?.unmount();
    });
  });
});
