// Función para obtener la miniatura de un video de YouTube
export const getYouTubeThumbnail = (url: string) => {
  let videoId = '';
  if (url.includes('youtu.be/')) {
    videoId = url.split('youtu.be/')[1];
  } else if (url.includes('watch?v=')) {
    videoId = url.split('watch?v=')[1];
  }
  const ampersandPosition = videoId.indexOf('&');
  if (ampersandPosition !== -1) {
    videoId = videoId.substring(0, ampersandPosition);
  }
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
};
