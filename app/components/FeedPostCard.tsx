import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Video, {BufferingStrategyType} from 'react-native-video';
import {Rating} from 'react-native-ratings';

import {PostComment} from '../../src/services/socialService';
import {Review, Spot, UserProfile} from '../../src/services/firestoreService';
import type {EventPublicJoinMode} from '../../src/services/eventService';
import {palette, shadows} from '../../src/constants/theme';
import logger from '../../src/utils/logger';
import {isTrustedBunnyEmbedRequestUrl} from '../../src/utils/videoPlayback';
import {
  FEED_MEDIA_MIN_HEIGHT,
  FEED_VIDEO_BUFFER_CONFIG,
} from '../features/feed/feedShared';

type FeedPostCardPost = {
  id: string;
  type: 'spot' | 'drone' | 'event';
  createdBy: string;
  text: string;
  images: string[];
  videoUrl?: string;
  spot?: Spot;
  eventId?: string;
  eventMeta?: {
    title: string;
    startsAtMs: number;
    locationLabel?: string | null;
    locationAddress?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    isPublic: boolean;
    publicJoinMode?: EventPublicJoinMode;
  };
};

type FeedMetric = {
  comments: Array<Review | PostComment>;
  ratings: Review[];
  likesCount: number;
};

type FeedPostCardLabels = {
  badgeSpot: string;
  badgeDrone: string;
  badgeEvent: string;
  video: string;
  noMedia: string;
  seeMore: string;
  seeLess: string;
  viewOnMap: string;
  directions: string;
  viewEvent: string;
  share: string;
  report: string;
  yourRating: string;
  latestComments: string;
  noCommentsYet: string;
  commentPlaceholder: string;
  viewAllComments: string;
  exploreSpot: string;
  errorTitle: string;
  videoPlaybackError: string;
  unknownUser: string;
  eventStarts: string;
  eventPublicClosed: string;
  eventPublicOpen: string;
  eventPublic: string;
  eventPrivate: string;
  requestJoinAction: string;
  joinOpenAction: string;
};

type FeedPostCardProps = {
  post: FeedPostCardPost;
  metric: FeedMetric;
  postAuthor: string;
  profilesByUserId: Record<string, UserProfile | null>;
  labels: FeedPostCardLabels;
  isExpanded: boolean;
  liked: boolean;
  userSpotRating: number;
  commentDraft: string;
  savingLike: boolean;
  savingComment: boolean;
  savingRating: boolean;
  reportSubmitting: boolean;
  hasVideo: boolean;
  videoPreviewUri: string | null;
  inlineVideoSource: {url: string; fallbackUrls: string[]} | null;
  nativeVideoHeaders?: Record<string, string>;
  bunnyEmbed: {guid: string; embedUrl: string; autoplayEmbedUrl: string} | null;
  shouldUseBunnyEmbed: boolean;
  willRenderBunnyWebView: boolean;
  isVideoPlaying: boolean;
  isVideoBuffering: boolean;
  videoFrameHeight: number;
  heartScale: Animated.Value;
  buildInlineBunnyIframeHtml: (embedUrl: string) => string;
  onToggleText: (postId: string) => void;
  onTogglePlayback: (postId: string) => void;
  onLike: (post: FeedPostCardPost) => void;
  onRateSpot: (spotId: string, rating: number) => void;
  onChangeComment: (postId: string, value: string) => void;
  onSendComment: (post: FeedPostCardPost) => void;
  onOpenComments: (postId: string) => void;
  onShare: (post: FeedPostCardPost) => void;
  onReport: (post: FeedPostCardPost) => void;
  onFocusSpotOnMap: (spot: Spot) => void;
  onOpenEventDirections: (post: FeedPostCardPost) => void;
  onViewEventOnMap: (post: FeedPostCardPost) => void;
  onJoinEvent: (post: FeedPostCardPost) => void;
  onGoToSpotDetail: (spotId?: string) => void;
  onGoToEventDetail: (eventId?: string) => void;
  onVideoBufferingChange: (postId: string, isBuffering: boolean) => void;
  onVideoMeasured: (postId: string, widthValue: unknown, heightValue: unknown) => void;
  onSwitchToBunnyEmbed: (postId: string) => void;
  onAdvanceVideoSource: (
    postId: string,
    nextSource: {url: string; fallbackUrls: string[]},
  ) => void;
  onEnsureVideoPlaying: (postId: string) => void;
  canJoinEvent: boolean;
  joiningEvent: boolean;
};

const FeedPostCard = ({
  post,
  metric,
  postAuthor,
  profilesByUserId,
  labels,
  isExpanded,
  liked,
  userSpotRating,
  commentDraft,
  savingLike,
  savingComment,
  savingRating,
  reportSubmitting,
  hasVideo,
  videoPreviewUri,
  inlineVideoSource,
  nativeVideoHeaders,
  bunnyEmbed,
  shouldUseBunnyEmbed,
  willRenderBunnyWebView,
  isVideoPlaying,
  isVideoBuffering,
  videoFrameHeight,
  heartScale,
  buildInlineBunnyIframeHtml,
  onToggleText,
  onTogglePlayback,
  onLike,
  onRateSpot,
  onChangeComment,
  onSendComment,
  onOpenComments,
  onShare,
  onReport,
  onFocusSpotOnMap,
  onOpenEventDirections,
  onViewEventOnMap,
  onJoinEvent,
  onGoToSpotDetail,
  onGoToEventDetail,
  onVideoBufferingChange,
  onVideoMeasured,
  onSwitchToBunnyEmbed,
  onAdvanceVideoSource,
  onEnsureVideoPlaying,
  canJoinEvent,
  joiningEvent,
}: FeedPostCardProps) => {
  const commentsPreview = metric.comments.slice(0, 2);
  const shouldCollapse = post.text.length > 180;
  const isSpotPost = post.type === 'spot';
  const isEventPost = post.type === 'event';
  const headIconName = isSpotPost ? 'map-marker' : isEventPost ? 'calendar-star' : 'drone';
  const headIconColor = isSpotPost ? '#0f766e' : isEventPost ? '#d97706' : '#0369a1';
  const headLabel = isSpotPost
    ? labels.badgeSpot
    : isEventPost
      ? labels.badgeEvent
      : labels.badgeDrone;
  const eventVisibilityLabel = post.eventMeta?.isPublic
    ? post.eventMeta.publicJoinMode === 'open'
      ? labels.eventPublicOpen
      : labels.eventPublicClosed
    : labels.eventPrivate;
  const joinEventLabel =
    post.eventMeta?.publicJoinMode === 'open'
      ? labels.joinOpenAction
      : labels.requestJoinAction;
  const eventStartLabel = post.eventMeta?.startsAtMs
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(post.eventMeta.startsAtMs))
    : null;
  const resolvedNativeVideoSource = inlineVideoSource?.url
    ? nativeVideoHeaders
      ? {
          uri: inlineVideoSource.url,
          headers: nativeVideoHeaders,
          bufferConfig: FEED_VIDEO_BUFFER_CONFIG,
        }
      : {
          uri: inlineVideoSource.url,
          bufferConfig: FEED_VIDEO_BUFFER_CONFIG,
        }
    : undefined;

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={styles.cardHeadLeft}>
          <Icon
            name={headIconName}
            size={16}
            color={headIconColor}
          />
          <Text style={styles.cardHeadType}>{headLabel}</Text>
        </View>
        <Text style={styles.cardHeadAuthor}>@{postAuthor}</Text>
      </View>

      <View style={[styles.mediaFrame, hasVideo ? {height: videoFrameHeight} : null]}>
        {hasVideo && (inlineVideoSource?.url || shouldUseBunnyEmbed) ? (
          <Pressable
            style={styles.videoPressable}
            disabled={willRenderBunnyWebView}
            pointerEvents={willRenderBunnyWebView ? 'box-none' : 'auto'}
            onPress={() => onTogglePlayback(post.id)}>
            {isVideoPlaying ? (
              shouldUseBunnyEmbed && bunnyEmbed ? (
                (() => {
                  const {WebView} = require('react-native-webview');
                  return (
                    <WebView
                      key={`${post.id}-${bunnyEmbed.autoplayEmbedUrl}`}
                      style={styles.videoWebView}
                      androidLayerType="software"
                      androidHardwareAccelerationDisabled
                      javaScriptEnabled
                      domStorageEnabled
                      allowsFullscreenVideo
                      allowsInlineMediaPlayback
                      mediaPlaybackRequiresUserAction={false}
                      originWhitelist={['*']}
                      source={{
                        html: buildInlineBunnyIframeHtml(bunnyEmbed.autoplayEmbedUrl),
                        baseUrl: 'https://iframe.mediadelivery.net',
                      }}
                      onShouldStartLoadWithRequest={(request: any) => {
                        const url = request?.url || '';
                        const allowed = isTrustedBunnyEmbedRequestUrl(url);
                        if (!allowed) {
                          logger.warn('[Feed] blocked unexpected bunny webview navigation', {
                            postId: post.id,
                            url,
                          });
                        }
                        return allowed;
                      }}
                      thirdPartyCookiesEnabled={false}
                      javaScriptCanOpenWindowsAutomatically={false}
                      setSupportMultipleWindows={false}
                      mixedContentMode="never"
                      onHttpError={(event: any) => {
                        logger.warn('[Feed] inline bunny webview http error', {
                          postId: post.id,
                          statusCode: event?.nativeEvent?.statusCode,
                          url: event?.nativeEvent?.url,
                        });
                      }}
                      onError={(event: any) => {
                        logger.warn('[Feed] inline bunny webview failed', {
                          postId: post.id,
                          error: event?.nativeEvent,
                        });
                      }}
                    />
                  );
                })()
              ) : (
                <Video
                  key={`${post.id}-${inlineVideoSource?.url ?? 'video'}`}
                  source={resolvedNativeVideoSource}
                  style={styles.videoView}
                  resizeMode="contain"
                  paused={false}
                  muted={false}
                  repeat
                  controls={false}
                  bufferingStrategy={BufferingStrategyType.DEPENDING_ON_MEMORY}
                  progressUpdateInterval={250}
                  poster={
                    videoPreviewUri
                      ? {
                          source: {uri: videoPreviewUri},
                          resizeMode: 'contain',
                        }
                      : undefined
                  }
                  onLoadStart={() => {
                    onVideoBufferingChange(post.id, true);
                  }}
                  onReadyForDisplay={() => {
                    onVideoBufferingChange(post.id, false);
                  }}
                  onBuffer={event => {
                    onVideoBufferingChange(
                      post.id,
                      Boolean((event as any)?.isBuffering),
                    );
                  }}
                  onLoad={payload => {
                    const naturalSize = (payload as any)?.naturalSize;
                    onVideoMeasured(post.id, naturalSize?.width, naturalSize?.height);
                    onVideoBufferingChange(post.id, false);
                  }}
                  onError={playbackError => {
                    onVideoBufferingChange(post.id, false);
                    logger.warn('[Feed] inline video playback failed', {
                      postId: post.id,
                      source: inlineVideoSource?.url,
                      error: playbackError,
                      usedHeaders: nativeVideoHeaders,
                    });
                    if (bunnyEmbed && !shouldUseBunnyEmbed) {
                      logger.warn('[Feed] switching post to bunny embed fallback', {
                        postId: post.id,
                        bunnyGuid: bunnyEmbed.guid,
                      });
                      onSwitchToBunnyEmbed(post.id);
                      return;
                    }
                    const fallbackUrls = inlineVideoSource?.fallbackUrls ?? [];
                    if (!fallbackUrls.length) {
                      Alert.alert(labels.errorTitle, labels.videoPlaybackError);
                      return;
                    }
                    const [nextUrl, ...rest] = fallbackUrls;
                    onAdvanceVideoSource(post.id, {
                      url: nextUrl,
                      fallbackUrls: rest,
                    });
                    onEnsureVideoPlaying(post.id);
                  }}
                />
              )
            ) : videoPreviewUri ? (
              <Image
                source={{uri: videoPreviewUri}}
                style={styles.imageView}
                onLoad={event => {
                  const source = (event as any)?.nativeEvent?.source;
                  onVideoMeasured(post.id, source?.width, source?.height);
                }}
              />
            ) : (
              <View style={styles.mediaFallback}>
                <Icon name="video-off-outline" size={24} color={palette.textMuted} />
                <Text style={styles.mediaFallbackText}>{labels.video}</Text>
              </View>
            )}
            {isVideoPlaying && !willRenderBunnyWebView && isVideoBuffering ? (
              <View style={styles.videoBufferOverlay} pointerEvents="none">
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : null}
            <View style={styles.videoPill}>
              <Icon name="play-circle" size={18} color="#fff" />
              <Text style={styles.videoPillText}>{labels.video}</Text>
            </View>
            <View style={styles.videoTogglePill}>
              <Icon
                name={isVideoPlaying ? 'pause-circle' : 'play-circle'}
                size={18}
                color="#fff"
              />
            </View>
          </Pressable>
        ) : post.images.length ? (
          <Image source={{uri: post.images[0]}} style={styles.imageView} />
        ) : (
          <View style={styles.mediaFallback}>
            <Icon name="image-off-outline" size={24} color={palette.textMuted} />
            <Text style={styles.mediaFallbackText}>{labels.noMedia}</Text>
          </View>
        )}
      </View>

      <View style={styles.cardContent}>
        {post.text ? (
          <>
            <Text
              style={styles.postText}
              numberOfLines={shouldCollapse && !isExpanded ? 3 : undefined}>
              {post.text}
            </Text>
            {shouldCollapse ? (
              <TouchableOpacity onPress={() => onToggleText(post.id)}>
                <Text style={styles.linkText}>
                  {isExpanded ? labels.seeLess : labels.seeMore}
                </Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}

        {isSpotPost ? (
          <View style={styles.spotMetaRow}>
            <View style={styles.spotRatingSummary}>
              <Icon name="star" size={14} color="#f59e0b" />
              <Text style={styles.spotRatingText}>
                {Number(post.spot?.averageRating || 0).toFixed(1)}
                {' · '}
                {post.spot?.ratingCount ?? post.spot?.reviewCount ?? 0}
              </Text>
            </View>
            {post.spot ? (
              <TouchableOpacity
                style={styles.mapButton}
                onPress={() => onFocusSpotOnMap(post.spot!)}>
                <Icon name="map-marker-radius" size={15} color="#fff" />
                <Text style={styles.mapButtonText}>{labels.viewOnMap}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {isEventPost && post.eventMeta ? (
          <View style={styles.eventMetaCard}>
            <View style={styles.eventMetaRow}>
              <Icon name="calendar-clock" size={16} color="#d97706" />
              <Text style={styles.eventMetaText}>
                {labels.eventStarts}: {eventStartLabel || '-'}
              </Text>
            </View>
            {post.eventMeta.locationLabel ? (
              <View style={styles.eventMetaRow}>
                <Icon name="map-marker-outline" size={16} color="#d97706" />
                <Text style={styles.eventMetaText}>{post.eventMeta.locationLabel}</Text>
              </View>
            ) : null}
            <View style={styles.eventMetaRow}>
              <Icon
                name={post.eventMeta.isPublic ? 'earth' : 'lock-outline'}
                size={16}
                color="#d97706"
              />
              <Text style={styles.eventMetaText}>
                {eventVisibilityLabel}
              </Text>
            </View>
          </View>
        ) : null}

        <View style={styles.actionsRow}>
          <Pressable onPress={() => onLike(post)}>
            <Animated.View
              style={[
                styles.actionIconButton,
                {transform: [{scale: heartScale}]},
              ]}>
              <Icon
                name={liked ? 'heart' : 'heart-outline'}
                size={20}
                color={liked ? '#ef4444' : palette.textSecondary}
              />
              <Text style={styles.actionLabel}>{metric.likesCount}</Text>
              {savingLike ? (
                <ActivityIndicator size="small" color={palette.textMuted} />
              ) : null}
            </Animated.View>
          </Pressable>

          <View style={styles.actionIconButton}>
            <Icon name="comment-outline" size={20} color={palette.textSecondary} />
            <Text style={styles.actionLabel}>{metric.comments.length}</Text>
          </View>

          <TouchableOpacity style={styles.actionIconButton} onPress={() => onShare(post)}>
            <Icon name="share-variant-outline" size={20} color={palette.textSecondary} />
            <Text style={styles.actionLabel}>{labels.share}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionIconButton} onPress={() => onReport(post)}>
            <Icon
              name={reportSubmitting ? 'progress-clock' : 'flag-outline'}
              size={20}
              color={palette.textSecondary}
            />
            <Text style={styles.actionLabel}>{labels.report}</Text>
          </TouchableOpacity>
        </View>

        {isSpotPost && post.spot?.id ? (
          <View style={styles.inlineRatingWrap}>
            <Text style={styles.inlineSectionTitle}>{labels.yourRating}</Text>
            <View style={styles.inlineRatingRow}>
              <Rating
                type="star"
                imageSize={22}
                ratingCount={5}
                startingValue={userSpotRating}
                onFinishRating={value => onRateSpot(post.spot!.id!, value)}
                readonly={savingRating}
              />
              {savingRating ? (
                <ActivityIndicator size="small" color={palette.highlight} />
              ) : null}
            </View>
          </View>
        ) : null}

        <View style={styles.commentsBlock}>
          <Text style={styles.inlineSectionTitle}>{labels.latestComments}</Text>
          {commentsPreview.length ? (
            commentsPreview.map(comment => {
              const userId =
                (comment as Review).userId || (comment as PostComment).userId;
              const author =
                profilesByUserId[userId]?.displayName || labels.unknownUser;
              const text =
                (comment as Review).text || (comment as PostComment).text || '';
              return (
                <View
                  key={(comment as Review).id || (comment as PostComment).id}
                  style={styles.commentBubble}>
                  <Text style={styles.commentAuthor}>{author}</Text>
                  <Text style={styles.commentText}>{text}</Text>
                </View>
              );
            })
          ) : (
            <Text style={styles.commentEmpty}>{labels.noCommentsYet}</Text>
          )}

          <View style={styles.commentInputRow}>
            <TextInput
              style={styles.commentInput}
              placeholder={labels.commentPlaceholder}
              placeholderTextColor={palette.textMuted}
              value={commentDraft}
              onChangeText={value => onChangeComment(post.id, value)}
            />
            <TouchableOpacity
              style={styles.sendButton}
              onPress={() => onSendComment(post)}
              disabled={savingComment}>
              {savingComment ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Icon name="send" size={18} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity onPress={() => onOpenComments(post.id)}>
            <Text style={styles.linkText}>{labels.viewAllComments}</Text>
          </TouchableOpacity>

          {isSpotPost && post.spot ? (
            <View style={styles.spotActionFooter}>
              <TouchableOpacity onPress={() => onGoToSpotDetail(post.spot?.id)}>
                <Text style={styles.linkText}>{labels.exploreSpot}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => onFocusSpotOnMap(post.spot!)}>
                <Text style={styles.linkText}>{labels.viewOnMap}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {isEventPost ? (
            <View style={styles.eventActionFooter}>
              {canJoinEvent ? (
                <TouchableOpacity
                  style={styles.eventActionButton}
                  onPress={() => onJoinEvent(post)}
                  disabled={joiningEvent}>
                  {joiningEvent ? (
                    <ActivityIndicator size="small" color="#92400e" />
                  ) : (
                    <Icon
                      name={
                        post.eventMeta?.publicJoinMode === 'open'
                          ? 'account-plus-outline'
                          : 'account-arrow-right-outline'
                      }
                      size={14}
                      color="#92400e"
                    />
                  )}
                  <Text style={styles.eventActionText}>{joinEventLabel}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={styles.eventActionButton} onPress={() => onGoToEventDetail(post.eventId)}>
                <Icon name="calendar-star" size={14} color="#92400e" />
                <Text style={styles.eventActionText}>{labels.viewEvent}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.eventActionButton} onPress={() => onViewEventOnMap(post)}>
                <Icon name="map-search-outline" size={14} color="#92400e" />
                <Text style={styles.eventActionText}>{labels.viewOnMap}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.eventActionButton} onPress={() => onOpenEventDirections(post)}>
                <Icon name="directions" size={14} color="#92400e" />
                <Text style={styles.eventActionText}>{labels.directions}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    overflow: 'hidden',
    marginBottom: 12,
    ...shadows.subtle,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#f8fafc',
  },
  cardHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cardHeadType: {
    fontSize: 11,
    fontWeight: '700',
    color: palette.textSecondary,
    textTransform: 'uppercase',
  },
  cardHeadAuthor: {
    color: palette.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  mediaFrame: {
    height: FEED_MEDIA_MIN_HEIGHT,
    backgroundColor: '#e2e8f0',
  },
  videoPressable: {
    flex: 1,
  },
  imageView: {
    width: '100%',
    height: '100%',
  },
  videoView: {
    width: '100%',
    height: '100%',
  },
  videoWebView: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  videoBufferOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.22)',
  },
  videoPill: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.74)',
    paddingVertical: 4,
    paddingHorizontal: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  videoPillText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  videoTogglePill: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.74)',
    paddingVertical: 6,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mediaFallbackText: {
    color: palette.textMuted,
    fontSize: 12,
  },
  cardContent: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 10,
  },
  postText: {
    color: palette.textSecondary,
    fontSize: 14,
    lineHeight: 19,
  },
  linkText: {
    color: palette.highlight,
    fontSize: 13,
    fontWeight: '700',
  },
  spotMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventMetaCard: {
    gap: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#fff7ed',
    borderWidth: 1,
    borderColor: '#fde7c7',
  },
  eventMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eventMetaText: {
    flex: 1,
    color: '#92400e',
    fontWeight: '600',
  },
  spotRatingSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  spotRatingText: {
    color: palette.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#0f766e',
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
  },
  mapButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  actionIconButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionLabel: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  inlineRatingWrap: {
    gap: 5,
    borderTopWidth: 1,
    borderTopColor: '#edf2f7',
    paddingTop: 8,
  },
  inlineSectionTitle: {
    color: palette.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  inlineRatingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  commentsBlock: {
    gap: 8,
  },
  commentBubble: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#f8fafc',
  },
  commentAuthor: {
    color: palette.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 2,
  },
  commentText: {
    color: palette.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  commentEmpty: {
    color: palette.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  commentInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  commentInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#dbe3ef',
    borderRadius: 10,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: palette.textPrimary,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: palette.highlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spotActionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eventActionFooter: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  eventActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#fed7aa',
    backgroundColor: '#fff7ed',
  },
  eventActionText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '700',
  },
});

export default React.memo(FeedPostCard);
