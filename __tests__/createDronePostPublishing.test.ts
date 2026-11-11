jest.mock('../src/services/storageService', () => ({
  uploadFile: jest.fn(),
}));

jest.mock('../src/services/bunnyStreamService', () => ({
  uploadVideoToBunny: jest.fn(),
}));

jest.mock('../src/services/socialService', () => ({
  createDronePost: jest.fn(),
}));

jest.mock('../src/utils/logger', () => ({
  __esModule: true,
  default: {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import {classifyCreateDronePostError} from '../app/features/createDronePost/createDronePostPublishing';

describe('classifyCreateDronePostError', () => {
  it('detects storage permission failures', () => {
    expect(
      classifyCreateDronePostError({
        error: {code: 'storage/unauthorized'},
        step: 'upload_images',
      }),
    ).toBe('storage_permission');
  });

  it('detects auth failures from API status or localized messages', () => {
    expect(
      classifyCreateDronePostError({
        error: {status: 401},
        step: 'create_post',
      }),
    ).toBe('auth');

    expect(
      classifyCreateDronePostError({
        error: new Error('Usuario no autenticado'),
        step: 'upload_video',
      }),
    ).toBe('auth');
  });

  it('detects transient upload failures separately from generic publish errors', () => {
    expect(
      classifyCreateDronePostError({
        error: new Error('Upload timed out because of network connection'),
        step: 'upload_video',
      }),
    ).toBe('network_upload');

    expect(
      classifyCreateDronePostError({
        error: new Error('Validation failed'),
        step: 'create_post',
      }),
    ).toBe('generic');
  });
});
