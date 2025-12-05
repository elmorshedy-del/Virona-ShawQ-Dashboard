import express from 'express';
import { getDb } from '../db/database.js';

const router = express.Router();

// Get manual orders
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const store = req.query.store || 'vironax';
    
    let days = 7;
    if (req.query.days) days = parseInt(req.query.days);
    else if (req.query.weeks) days = parseInt(req.query.weeks) * 7;
    else if (req.query.months) days = parseInt(req.query.months) * 30;
    
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const orders = db.prepare(`
      SELECT * FROM manual_orders 
      WHERE store = ? AND date >= ?
      ORDER BY date DESC, created_at DESC
    `).all(store, startDate);
    
    res.json(orders);
  } catch (error) {
    console.error('Get manual orders error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add manual order
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const store = req.query.store || req.body.store || 'vironax';
    const { date, country, campaign, spend, orders_count, revenue, source, notes } = req.body;
    
    const result = db.prepare(`
      INSERT INTO manual_orders (store, date, country, campaign, spend, orders_count, revenue, source, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      store,
      date,
      country,
      campaign || '',
      spend || 0,
      orders_count || 1,
      revenue || 0,
      source || 'whatsapp',
      notes || ''
    );
    
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (error) {
    console.error('Add manual order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete single order
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    
    db.prepare('DELETE FROM manual_orders WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Delete manual order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk delete orders
router.post('/delete-bulk', (req, res) => {
  try {
    const db = getDb();
    const store = req.query.store || req.body.store || 'vironax';
    const { scope, date } = req.body;
    
    let sql = 'DELETE FROM manual_orders WHERE store = ?';
    const params = [store];
    
    if (scope === 'all') {
      // Delete all for this store
    } else if (scope === 'day' && date) {
      sql += ' AND date = ?';
      params.push(date);
    } else if (scope === 'week' && date) {
      const d = new Date(date);
      const weekStart = new Date(d.setDate(d.getDate() - d.getDay())).toISOString().split('T')[0];
      const weekEnd = new Date(d.setDate(d.getDate() + 6)).toISOString().split('T')[0];
      sql += ' AND date BETWEEN ? AND ?';
      params.push(weekStart, weekEnd);
    } else if (scope === 'month' && date) {
      const month = date.substring(0, 7);
      sql += " AND date LIKE ?";
      params.push(`${month}%`);
    } else if (scope === 'year' && date) {
      const year = date.substring(0, 4);
      sql += " AND date LIKE ?";
      params.push(`${year}%`);
    }
    
    const result = db.prepare(sql).run(...params);
    res.json({ success: true, deleted: result.changes });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
