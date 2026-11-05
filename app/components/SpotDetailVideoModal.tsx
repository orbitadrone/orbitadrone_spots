import React from 'react';
import {Alert, Modal, StyleSheet, TouchableOpacity, View} from 'react-native';
import Video from 'react-native-video';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {radii} from '../../src/constants/theme';
import logger from '../../src/utils/logger';
import {isTrustedBunnyEmbedRequestUrl} from '../../src/utils/videoPlayback';

export type SpotDetailVideoInfo = {
  url: string;
  type: 'native' | 'bunny';
  guid?: string;
  fallbackUrls?: string[];
};

type SpotDetailVideoModalProps = {
  visible: boolean;
  videoInfo: SpotDetailVideoInfo | null;
  playbackErrorTitle: string;
  playbackErrorMessage: string;
  onClose: () => void;
  onChangeVideoInfo: React.Dispatch<React.SetStateAction<SpotDetailVideoInfo | null>>;
};

const SpotDetailVideoModal = ({
  visible,
  videoInfo,
  playbackErrorTitle,
  playbackErrorMessage,
  onClose,
  onChangeVideoInfo,
}: SpotDetailVideoModalProps) => (
  <Modal
    animationType="slide"
    transparent={false}
    visible={visible}
    onRequestClose={onClose}>
    <View style={styles.container}>
      <TouchableOpacity style={styles.closeButton} onPress={onClose}>
        <Icon name="close" size={30} color="#fff" />
      </TouchableOpacity>

      {videoInfo ? (
        videoInfo.type === 'bunny' ? (
          (() => {
            logger.log('[Video] render bunny', videoInfo);
            const {WebView} = require('react-native-webview');
            return (
              <WebView
                style={styles.webview}
                javaScriptEnabled
                domStorageEnabled
                allowsFullscreenVideo
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                originWhitelist={['*']}
                onShouldStartLoadWithRequest={(request: any) => {
                  const url = request?.url || '';
                  const allowed = isTrustedBunnyEmbedRequestUrl(url);
                  if (!allowed) {
                    logger.warn('[Video] blocked unexpected bunny webview navigation', {url});
                  }
                  return allowed;
                }}
                source={{uri: videoInfo.url}}
                thirdPartyCookiesEnabled={false}
                javaScriptCanOpenWindowsAutomatically={false}
                setSupportMultipleWindows={false}
                mixedContentMode="never"
              />
            );
          })()
        ) : (
          <Video
            key={videoInfo.url}
            onReadyForDisplay={() => logger.log('[Video] render native', videoInfo)}
            source={{uri: videoInfo.url}}
            style={styles.videoPlayer}
            controls
            resizeMode="contain"
            onError={error => {
              logger.warn('Video Error', error);
              onChangeVideoInfo(previous => {
                if (
                  !previous ||
                  previous.type !== 'native' ||
                  !previous.fallbackUrls?.length
                ) {
                  Alert.alert(playbackErrorTitle, playbackErrorMessage);
                  return previous;
                }
                const [nextUrl, ...rest] = previous.fallbackUrls;
                logger.log('[Video] trying fallback source', {
                  from: previous.url,
                  to: nextUrl,
                });
                return {
                  ...previous,
                  url: nextUrl,
                  fallbackUrls: rest,
                };
              });
            }}
          />
        )
      ) : null}
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 2,
    padding: 6,
    borderRadius: radii.md,
  },
  webview: {
    flex: 1,
  },
  videoPlayer: {
    ...StyleSheet.absoluteFillObject,
  },
});

export default React.memo(SpotDetailVideoModal);
