import express from 'express';
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  cleanupOldNotifications
} from '../services/notificationService.js';

const router = express.Router();

// GET /api/notifications - Get recent notifications
router.get('/', (req, res) => {
  try {
    const { store, limit } = req.query;
    const notifications = getNotifications(store || null, parseInt(limit) || 10);
    const unreadCount = getUnreadCount(store || null);
    
    res.json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('[Notifications API] Get error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/notifications/unread - Get unread count
router.get('/unread', (req, res) => {
  try {
    const { store } = req.query;
    const count = getUnreadCount(store || null);
    
    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('[Notifications API] Unread count error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/notifications/:id/read - Mark single notification as read
router.post('/:id/read', (req, res) => {
  try {
    const { id } = req.params;
    markAsRead(parseInt(id));
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Notifications API] Mark read error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/notifications/read-all - Mark all as read
router.post('/read-all', (req, res) => {
  try {
    const { store } = req.body;
    markAllAsRead(store || null);
    
    res.json({ success: true });
  } catch (error) {
    console.error('[Notifications API] Mark all read error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/notifications/cleanup - Clean up old notifications
router.delete('/cleanup', (req, res) => {
  try {
    const deleted = cleanupOldNotifications();
    
    res.json({
      success: true,
      deleted
    });
  } catch (error) {
    console.error('[Notifications API] Cleanup error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
