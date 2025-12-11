// client/src/components/NotificationCenter.jsx
import { useState, useEffect, useRef } from 'react';
import { Bell, Check, Volume2, VolumeX, Trash2, X } from 'lucide-react';

export default function NotificationCenter({ currentStore }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [lastFetchTime, setLastFetchTime] = useState(null);
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
  // Play notification sound using Web Audio API (cha-ching cash register sound)
  // ============================================================================
  const playSound = () => {
    if (!soundEnabled) return;

    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Create a pleasant two-tone "cha-ching" coin sound
      const playTone = (frequency, startTime, duration, volume = 0.3) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, startTime);

        // Bell-like envelope: quick attack, gradual decay
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

        oscillator.start(startTime);
        oscillator.stop(startTime + duration);
      };

      const now = audioContext.currentTime;

      // First chime (lower note) - the "cha"
      playTone(880, now, 0.15, 0.25);        // A5
      playTone(1760, now, 0.15, 0.15);       // A6 overtone

      // Second chime (higher note) - the "ching"
      playTone(1318.5, now + 0.1, 0.25, 0.3);  // E6
      playTone(2637, now + 0.1, 0.25, 0.15);   // E7 overtone

      // Add a subtle metallic shimmer
      playTone(1975.5, now + 0.12, 0.2, 0.1);  // B6

    } catch (err) {
      console.log('Web Audio API sound failed:', err);
    }
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

        setNotifications((prevNotifications) => {
          const previousTimestamps = new Map(
            prevNotifications.map((notification) => [notification.id, notification.localTimestamp])
          );

          const annotatedNotifications = incomingNotifications.map((notification) => ({
            ...notification,
            localTimestamp: previousTimestamps.get(notification.id) || new Date().toISOString()
          }));

          // Check for new notifications and play sound
          if (annotatedNotifications.length > 0) {
            const latestNotification = annotatedNotifications[0];
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

          return annotatedNotifications;
        });

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
  // ============================================================================
  const getDisplayTimestamp = (notification) =>
    notification?.localTimestamp || notification?.timestamp || notification?.createdAt;

  const getTimeAgo = (timestamp) => {
    if (!timestamp) return 'Unknown time';

    const now = new Date();
    const then = new Date(timestamp);

    if (Number.isNaN(then.getTime())) return 'Unknown time';

    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

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

    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge.color}`}>
        {badge.label}
      </span>
    );
  };

  // ============================================================================
  // Format message for display (add store name for cross-store)
  // ============================================================================
  const formatNotificationMessage = (notification) => {
    const isCrossStore = notification.store !== currentStore;
    
    if (isCrossStore) {
      // Format: [STORE] Country • Amount • Source
      // Example: [VIRONAX] SA • SAR 1,400 • Salla
      return `[${notification.store.toUpperCase()}] ${notification.message}`;
    }
    
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
        <Bell className="w-5 h-5" />
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
                {notifications.map((notification) => {
                  const isCrossStore = notification.store !== currentStore;
                  const displayMessage = formatNotificationMessage(notification);

                  return (
                    <div
                      key={notification.id}
                      className={`p-4 hover:bg-gray-50 transition-colors ${
                        !notification.is_read ? 'bg-indigo-50/50 border-l-4 border-l-indigo-500' : ''
                      } ${isCrossStore ? 'border-l-4 border-l-purple-500' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Icon */}
                        <div className="text-2xl flex-shrink-0">
                          {notification.type === 'order' ? '🛍️' : '📊'}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Badges */}
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            {getSourceBadge(notification.source)}
                            
                            <span className="text-xs font-medium text-gray-900 uppercase px-2 py-0.5 bg-gray-100 rounded">
                              {notification.store}
                            </span>

                            {isCrossStore && (
                              <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">
                                📍 From {notification.store}
                              </span>
                            )}
                          </div>

                          {/* Message */}
                          <p className="text-sm text-gray-900 font-medium break-words">
                            {displayMessage}
                          </p>

                          {/* Time */}
                          <p className="text-xs text-gray-500 mt-1.5">
                            {getTimeAgo(getDisplayTimestamp(notification))}
                          </p>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!notification.is_read && (
                            <>
                              <button
                                onClick={() => markAsRead(notification.id)}
                                className="p-1 text-indigo-500 hover:bg-indigo-50 rounded transition-colors"
                                title="Mark as read"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => deleteNotification(notification.id)}
                            className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
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
