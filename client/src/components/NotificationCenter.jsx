// client/src/components/NotificationCenter.jsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, Check, Volume2, VolumeX, Trash2 } from 'lucide-react';
import { getTimeAgo as calculateTimeAgo } from '../utils/timestampUtils';

// ============================================================================
// NotificationRow Component (was missing!)
// ============================================================================
function NotificationRow({ 
  notification, 
  onMarkAsRead, 
  onDelete, 
  getSourceBadge, 
  formatNotificationMessage,
  currentTime 
}) {
  const source = notification?.source || notification?.metadata?.source;
  const useCreatedTimestamp = source === 'meta' && notification?.store === 'vironax';
  const timestamp = useCreatedTimestamp
    ? notification?.timestamp || notification?.createdAt || notification?.created_at
    : notification?.metadata?.timestamp ||
      notification?.timestamp ||
      notification?.createdAt ||
      notification?.created_at;

  // Calculate time ago directly using currentTime prop
  // This ensures the display updates whenever currentTime changes
  const timeAgoDisplay = calculateTimeAgo(timestamp, currentTime);

  // Determine store logo based on notification.store
  const storeLogo = notification.store === 'shawq' ? '/shawq-logo.svg' : '/virona-logo.svg';
  const storeLabel = notification.store === 'shawq' ? 'Shawq' : 'Virona';
  const campaignName = notification?.metadata?.campaign_name
    || notification?.metadata?.campaignName
    || notification?.metadata?.campaign
    || notification?.metadata?.campaign_id
    || notification?.metadata?.campaignId;
  const matchMethod = notification?.metadata?.match_method || notification?.metadata?.matched_via;
  const isCampaignMatch = notification?.type === 'campaign_match';
  const showCampaignDetails = notification.type === 'order' && campaignName
    && (notification.store === 'shawq' || (notification.store === 'vironax' && source === 'meta'));

  return (
    <div 
      className={`p-4 hover:bg-gray-50 transition-colors ${
        isCampaignMatch ? 'bg-violet-50/70 border-l-4 border-violet-900' : ''
      } ${
        !notification.is_read && !isCampaignMatch ? 'bg-indigo-50/50' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Store Logo */}
        <div className="flex-shrink-0 mt-0.5">
          <img 
            src={storeLogo} 
            alt={storeLabel} 
            className="w-8 h-8 rounded-full object-contain border border-gray-200 bg-white p-0.5"
            title={storeLabel}
          />
        </div>

        <div className="flex-1 min-w-0">
          {/* Message */}
          <p className={`text-sm ${!notification.is_read ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
            {formatNotificationMessage(notification)}
          </p>

          {/* Campaign source - smaller font */}
          {showCampaignDetails && (
            <p className="text-[10px] text-gray-400 mt-0.5 truncate" title={campaignName}>
              🎯 Campaign: {campaignName}
            </p>
          )}

          {isCampaignMatch && campaignName && (
            <p className="text-[10px] text-violet-800 mt-0.5 truncate" title={campaignName}>
              🎯 Matched Campaign: {campaignName}
              {matchMethod ? ` (${matchMethod.toUpperCase()})` : ''}
            </p>
          )}
          
          {/* Meta row: source badge + time */}
          <div className="flex items-center gap-2 mt-1.5">
            {isCampaignMatch && (
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-violet-900 text-white inline-flex items-center gap-1">
                Matched
              </span>
            )}
            {getSourceBadge(notification.source || notification.metadata?.source)}
            <span className="text-xs text-gray-500">
              {timeAgoDisplay}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {!notification.is_read && (
            <button
              onClick={() => onMarkAsRead(notification.id)}
              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Mark as read"
            >
              <Check className="w-4 h-4" />
            </button>
          )}
          <button
            onClick={() => onDelete(notification.id)}
            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            title="Delete"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function NotificationCenter({ currentStore }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState(null);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const dropdownRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const lastNotificationIdRef = useRef(null);

  // ============================================================================
  // Load sound preference from localStorage on mount
  // ============================================================================
  useEffect(() => {
    const savedPref = localStorage.getItem('notificationSoundEnabled');
    if (savedPref !== null) {
      setSoundEnabled(JSON.parse(savedPref));
    }
  }, []);

  // ============================================================================
  // Save sound preference when it changes
  // ============================================================================
  const toggleSound = () => {
    const newValue = !soundEnabled;
    setSoundEnabled(newValue);
    localStorage.setItem('notificationSoundEnabled', JSON.stringify(newValue));
  };

  // ============================================================================
  // Play notification sound from user-provided MP3
  // ============================================================================
  const playSound = () => {
    if (!soundEnabled) return;

    const audio = new Audio('/notification.mp3'); // place your MP3 in client/public/notification.mp3
    audio.volume = 0.7;
    audio.play().catch((err) => {
      console.log('Notification sound failed:', err);
    });
  };

  // ============================================================================
  // Fetch notifications from API
  // ============================================================================
  const fetchNotifications = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/notifications');

      if (!response.ok) {
        console.error('[Notifications] API error:', response.status);
        return;
      }

      const data = await response.json();

      if (data.success) {
        const incomingNotifications = data.notifications || [];

        setNotifications(incomingNotifications);

        // Check for new notifications and play sound
        if (incomingNotifications.length > 0) {
          const latestNotification = incomingNotifications[0];
          const latestId = latestNotification.id;

          // New notification detected!
          if (lastNotificationIdRef.current && latestId > lastNotificationIdRef.current) {
            console.log('[Notifications] New notification detected:', latestNotification.message);
            playSound();

            // Show browser notification if permission granted
            if ('Notification' in window && Notification.permission === 'granted') {
              const isCrossStore = latestNotification.store !== currentStore;
              const title = isCrossStore
                ? `New Order from ${latestNotification.store.toUpperCase()}! 🎉`
                : 'New Order! 🎉';

              new Notification(title, {
                body: latestNotification.message,
                icon: '/favicon.ico',
                tag: `order-${latestId}`,
                badge: '/favicon.ico'
              });
            }
          }

          lastNotificationIdRef.current = latestId;
        }

        setUnreadCount(data.unreadCount || 0);
        setLastFetchTime(new Date().toISOString());
      }
    } catch (error) {
      console.error('[Notifications] Failed to fetch:', error);
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // Request browser notification permission
  // ============================================================================
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('[Notifications] Permission status:', permission);
      });
    }
  }, []);

  // ============================================================================
  // Polling: Fetch notifications every 10 seconds
  // Also refetch when store changes
  // ============================================================================
  useEffect(() => {
    // Fetch immediately on load
    fetchNotifications();

    // Set up polling interval (10 seconds)
    pollIntervalRef.current = setInterval(() => {
      fetchNotifications();
    }, 10000);

    // Cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [currentStore]); // Re-setup when store changes


  // ============================================================================
  // Close dropdown when clicking outside
  // ============================================================================
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ============================================================================
  // Update current time every 30 seconds for accurate relative timestamps
  // This ensures notifications show different "time ago" values as time passes
  // ============================================================================
  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentTime(new Date());
    }, 30000); // Update every 30 seconds for timestamp refresh

    return () => clearInterval(intervalId);
  }, []);

  // ============================================================================
  // Mark notification as read
  // ============================================================================
  const markAsRead = async (id) => {
    try {
      const response = await fetch(`/api/notifications/${id}/read`, { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        console.log(`[Notifications] Marked ${id} as read`);
        fetchNotifications();
      }
    } catch (error) {
      console.error('[Notifications] Failed to mark as read:', error);
    }
  };

  // ============================================================================
  // Mark all as read
  // ============================================================================
  const markAllAsRead = async () => {
    try {
      const response = await fetch('/api/notifications/read-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        console.log('[Notifications] Marked all as read');
        fetchNotifications();
      }
    } catch (error) {
      console.error('[Notifications] Failed to mark all as read:', error);
    }
  };

  // ============================================================================
  // Delete notification
  // ============================================================================
  const deleteNotification = async (id) => {
    try {
      const response = await fetch(`/api/notifications/${id}`, { 
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.ok) {
        console.log(`[Notifications] Deleted ${id}`);
        fetchNotifications();
      }
    } catch (error) {
      console.error('[Notifications] Failed to delete:', error);
    }
  };

  // ============================================================================
  // Get relative time string ("2 min ago", "1 hour ago", etc)
  // Simple helper for header display - uses currentTime for consistency
  // ============================================================================
  const getTimeAgo = (timestamp) => {
    return calculateTimeAgo(timestamp, currentTime);
  };

  // ============================================================================
  // Count notifications by type
  // ============================================================================
  const getNotificationCounts = useCallback(() => {
    const counts = {
      shopify: 0,
      salla: 0,
      meta: 0,
      manual: 0
    };

    notifications.forEach(notification => {
      const source = notification.source || notification.metadata?.source;
      if (counts.hasOwnProperty(source)) {
        counts[source]++;
      }
    });

    return counts;
  }, [notifications]);

  const notificationCounts = getNotificationCounts();

  // ============================================================================
  // Get source badge (Shopify, Meta, Salla, Manual)
  // ============================================================================
  const getSourceBadge = (source) => {
    const badges = {
      shopify: { label: 'Shopify', color: 'bg-green-100 text-green-700' },
      salla: { label: 'Salla', color: 'bg-blue-100 text-blue-700' },
      meta: { label: 'Meta', color: 'bg-yellow-100 text-yellow-700' },
      manual: { label: 'Manual', color: 'bg-purple-100 text-purple-700' }
    };

    const badge = badges[source] || { label: source || 'Unknown', color: 'bg-gray-100 text-gray-700' };
    const count = notificationCounts[source] || 0;

    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.color} inline-flex items-center gap-1`}>
        {badge.label}
        {count > 0 && (
          <span className="ml-1 px-1.5 py-0.5 bg-white/50 rounded-full text-[10px] font-bold">
            {count}
          </span>
        )}
      </span>
    );
  };

  // ============================================================================
  // Format message for display (store logo already shows which store)
  // ============================================================================
  const formatNotificationMessage = (notification) => {
    // No need to add store name - the logo already shows which store
    return notification.message;
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Notification sound is generated via Web Audio API - no audio element needed */}

      {/* Bell Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        title="Notifications"
      >
        <span style={{fontSize: '1.25rem'}}>🛍️</span>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-2xl border border-gray-200 z-50 max-h-[600px] overflow-hidden flex flex-col">
          
          {/* Header */}
          <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Bell className="w-4 h-4" />
                Notifications
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={toggleSound}
                  className="p-1.5 hover:bg-white rounded-lg transition-colors"
                  title={soundEnabled ? 'Mute' : 'Unmute'}
                >
                  {soundEnabled ? (
                    <Volume2 className="w-4 h-4 text-indigo-600" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-gray-400" />
                  )}
                </button>
              </div>
            </div>

            {/* Action buttons */}
            {unreadCount > 0 && (
              <button
                onClick={markAllAsRead}
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium flex items-center gap-1"
              >
                <Check className="w-3 h-3" />
                Mark all as read
              </button>
            )}

            {/* Last fetch time */}
            {lastFetchTime && (
              <p className="text-xs text-gray-500 mt-2">
                Updated: {getTimeAgo(lastFetchTime)}
              </p>
            )}
          </div>

          {/* Notifications List */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <Bell className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm font-medium">No notifications</p>
                <p className="text-xs mt-1">New orders will appear here</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {notifications.map((notification) => (
                  <NotificationRow
                    key={notification.id}
                    notification={notification}
                    onMarkAsRead={markAsRead}
                    onDelete={deleteNotification}
                    getSourceBadge={getSourceBadge}
                    formatNotificationMessage={formatNotificationMessage}
                    currentTime={currentTime}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-3 border-t border-gray-200 bg-gray-50 text-center text-xs text-gray-500">
            {loading ? (
              <span>Updating...</span>
            ) : (
              <span>Checking every 10 seconds</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
