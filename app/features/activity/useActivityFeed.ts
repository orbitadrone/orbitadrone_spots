import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  ActivityItem,
  markActivityItemRead,
  markAllActivityItemsRead,
  subscribeToActivityFeed,
} from '../../../src/services/activityService';
import logger from '../../../src/utils/logger';

export const useActivityFeed = (userId?: string) => {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(Boolean(userId));

  useEffect(() => {
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToActivityFeed(
      userId,
      nextItems => {
        setItems(nextItems);
        setLoading(false);
      },
      error => {
        logger.warn('[Activity] load failed', error);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [userId]);

  const unreadCount = useMemo(
    () => items.reduce((count, item) => count + (item.isRead ? 0 : 1), 0),
    [items],
  );

  const markRead = useCallback(
    async (activityId: string) => {
      if (!userId) {
        return;
      }

      const targetItem = items.find(item => item.id === activityId);
      if (!targetItem || targetItem.isRead) {
        return;
      }

      setItems(previous =>
        previous.map(item => (item.id === activityId ? {...item, isRead: true} : item)),
      );

      try {
        await markActivityItemRead(userId, activityId);
      } catch (error) {
        logger.warn('[Activity] mark read failed', error);
        setItems(previous =>
          previous.map(item => (item.id === activityId ? {...item, isRead: false} : item)),
        );
      }
    },
    [items, userId],
  );

  const markAllRead = useCallback(async () => {
    if (!userId) {
      return;
    }

    const unreadIds = items.filter(item => !item.isRead).map(item => item.id);
    if (!unreadIds.length) {
      return;
    }

    setItems(previous => previous.map(item => ({...item, isRead: true})));

    try {
      await markAllActivityItemsRead(userId, unreadIds);
    } catch (error) {
      logger.warn('[Activity] mark all read failed', error);
      setItems(previous =>
        previous.map(item => (unreadIds.includes(item.id) ? {...item, isRead: false} : item)),
      );
    }
  }, [items, userId]);

  return {
    items,
    loading,
    unreadCount,
    markRead,
    markAllRead,
  };
};
