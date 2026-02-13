/**
 * Simple test script for notification system
 * Run with: node server/test-notifications.js
 */

import { initDb } from './db/database.js';
import {
  createNotification,
  createOrderNotifications,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  cleanupOldNotifications
} from './services/notificationService.js';

async function runTests() {
  console.log('🧪 Testing Notification System...\n');

  // Initialize database
  initDb();

  // Test 1: Create a manual notification
  console.log('Test 1: Creating manual notification...');
  const notifId = createNotification({
    store: 'vironax',
    type: 'order',
    message: 'Test Order • SAR 500.00 • Manual',
    metadata: {
      source: 'manual',
      country: 'Saudi Arabia',
      country_code: 'SA',
      currency: 'SAR',
      value: 500,
      order_count: 1,
      timestamp: new Date().toISOString()
    }
  });
  console.log(`✓ Created notification ID: ${notifId}\n`);

  // Test 2: Create order notifications from array
  console.log('Test 2: Creating notifications from order array...');
  const testOrders = [
    {
      created_at: new Date().toISOString(),
      country: 'SA',
      total_price: 250.50,
      currency: 'SAR'
    },
    {
      created_at: new Date().toISOString(),
      country: 'AE',
      total_price: 180.75,
      currency: 'AED'
    }
  ];
  const created = createOrderNotifications('vironax', 'manual', testOrders);
  console.log(`✓ Created ${created} notifications\n`);

  // Test 3: Get notifications
  console.log('Test 3: Fetching notifications...');
  const notifications = getNotifications('vironax', 10);
  console.log(`✓ Found ${notifications.length} notifications`);
  notifications.forEach(n => {
    console.log(`  - ${n.message} (${n.is_read ? 'read' : 'unread'})`);
  });
  console.log();

  // Test 4: Get unread count
  console.log('Test 4: Checking unread count...');
  const unreadCount = getUnreadCount('vironax');
  console.log(`✓ Unread count: ${unreadCount}\n`);

  // Test 5: Mark as read
  if (notifications.length > 0) {
    console.log('Test 5: Marking first notification as read...');
    markAsRead(notifications[0].id);
    const newUnread = getUnreadCount('vironax');
    console.log(`✓ New unread count: ${newUnread}\n`);
  }

  // Test 6: Mark all as read
  console.log('Test 6: Marking all as read...');
  markAllAsRead('vironax');
  const allRead = getUnreadCount('vironax');
  console.log(`✓ Unread count after mark all: ${allRead}\n`);

  // Test 7: Delete notification
  if (notifications.length > 0) {
    console.log('Test 7: Deleting a notification...');
    const deleted = deleteNotification(notifications[0].id);
    console.log(`✓ Deleted ${deleted} notification(s)\n`);
  }

  // Test 8: Cleanup old notifications
  console.log('Test 8: Cleaning up old notifications...');
  const cleaned = cleanupOldNotifications();
  console.log(`✓ Cleaned ${cleaned} old notification(s)\n`);

  // Test 9: Test source filtering - Shawq
  console.log('Test 9: Testing source filtering for Shawq...');
  const shawqMeta = createOrderNotifications('shawq', 'meta', [{
    created_at: new Date().toISOString(),
    country: 'US',
    total_price: 100,
    currency: 'USD'
  }]);
  console.log(`✓ Shawq Meta orders created notifications: ${shawqMeta} (should be 0)`);

  const now = new Date();
  const shawqShopifyOrders = [
    { order_id: '2454', order_created_at: new Date(now.getTime() - 60_000).toISOString(), country: 'US', order_total: 178.00, currency: 'USD' },
    { order_id: '2453', order_created_at: new Date(now.getTime() - 70_000).toISOString(), country: 'BE', order_total: 107.96, currency: 'USD' },
    { order_id: '2452', order_created_at: new Date(now.getTime() - 80_000).toISOString(), country: 'GB', order_total: 110.34, currency: 'USD' },
    { order_id: '2451', order_created_at: new Date(now.getTime() - 90_000).toISOString(), country: 'NL', order_total: 192.10, currency: 'USD' }
  ];

  const shawqShopify = createOrderNotifications('shawq', 'shopify', shawqShopifyOrders);
  const shawqNotifs = getNotifications('shawq', 20).filter((n) => (n.source || n.metadata?.source) === 'shopify');

  const totalsByOrderId = new Map(shawqShopifyOrders.map((o) => [String(o.order_id), Number(o.order_total)]));
  let mismatches = 0;
  for (const notif of shawqNotifs) {
    const orderId = notif.metadata?.order_id ? String(notif.metadata.order_id) : null;
    if (!orderId || !totalsByOrderId.has(orderId)) continue;
    const expected = totalsByOrderId.get(orderId);
    const actual = typeof notif.metadata?.value === 'number' ? notif.metadata.value : null;
    if (expected == null || actual == null || Math.abs(expected - actual) > 0.0001) {
      mismatches++;
      console.log(`  ✗ Mismatch order_id=${orderId}: expected=${expected} actual=${actual}`);
    }
  }

  if (shawqShopify !== shawqShopifyOrders.length) {
    throw new Error(`Shawq Shopify notification count mismatch: expected=${shawqShopifyOrders.length} actual=${shawqShopify}`);
  }
  if (mismatches > 0) {
    throw new Error(`Shawq Shopify notification value mismatches: ${mismatches}`);
  }
  console.log(`✓ Shawq Shopify orders created notifications: ${shawqShopify} (per-order, values match)\n`);

  // Test 10: Test source filtering - VironaX
  console.log('Test 10: Testing source filtering for VironaX...');
  // Salla not active, so Meta should create notifications
  const vironaxMeta = createOrderNotifications('vironax', 'meta', [{
    created_at: new Date().toISOString(),
    country: 'SA',
    total_price: 200,
    currency: 'SAR'
  }]);
  console.log(`✓ VironaX Meta orders created notifications: ${vironaxMeta} (should be > 0 if Salla not active)\n`);

  // Test 11: Late attribution update should create a new Meta notification once
  console.log('Test 11: Testing late attribution updates for VironaX Meta...');
  const lateDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const lateCampaignId = 'late_campaign_001';
  const lateCountry = 'SA';

  const lateFirst = createOrderNotifications('vironax', 'meta', [{
    date: lateDate,
    country: lateCountry,
    campaign_id: lateCampaignId,
    campaign_name: 'Late Campaign',
    order_count: 1,
    order_total: 100,
    currency: 'SAR',
    timestamp: new Date().toISOString()
  }]);

  const lateSecond = createOrderNotifications('vironax', 'meta', [{
    date: lateDate,
    country: lateCountry,
    campaign_id: lateCampaignId,
    campaign_name: 'Late Campaign',
    order_count: 2,
    order_total: 150,
    currency: 'SAR',
    timestamp: new Date().toISOString()
  }]);

  const lateThirdDuplicate = createOrderNotifications('vironax', 'meta', [{
    date: lateDate,
    country: lateCountry,
    campaign_id: lateCampaignId,
    campaign_name: 'Late Campaign',
    order_count: 2,
    order_total: 150,
    currency: 'SAR',
    timestamp: new Date().toISOString()
  }]);

  if (lateFirst < 1 || lateSecond < 1 || lateThirdDuplicate !== 0) {
    throw new Error(`Late attribution notification behavior mismatch: first=${lateFirst}, second=${lateSecond}, duplicate=${lateThirdDuplicate}`);
  }
  console.log(`✓ Late attribution notifications: first=${lateFirst}, update=${lateSecond}, duplicate=${lateThirdDuplicate}\n`);

  console.log('✅ All tests completed!\n');

  // Final summary
  const finalNotifs = getNotifications(null, 20);
  console.log(`📊 Final Summary:`);
  console.log(`   Total notifications: ${finalNotifs.length}`);
  console.log(`   VironaX unread: ${getUnreadCount('vironax')}`);
  console.log(`   Shawq unread: ${getUnreadCount('shawq')}`);
  console.log(`   All stores unread: ${getUnreadCount()}`);
}

// Run the tests
runTests().catch(console.error);
