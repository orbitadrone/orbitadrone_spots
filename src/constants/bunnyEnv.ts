import { BUNNY_LIBRARY_ID as RAW_BUNNY_LIBRARY_ID } from '@env';

// Expose Bunny library ID from environment for places that need to build embed URLs.
export const BUNNY_LIBRARY_ID = (RAW_BUNNY_LIBRARY_ID || '').toString().trim();

export default BUNNY_LIBRARY_ID;

