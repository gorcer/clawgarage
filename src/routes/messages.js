const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { items, messages, users } = require('../models/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/messages/:itemId
 * Get messages for item
 */
router.get('/:itemId', authenticate, async (req, res) => {
  try {
    const { itemId } = req.params;
    const item = await items.findById(itemId);
    
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const itemMessages = await messages.findByItemId(itemId);
    
    res.json({ messages: itemMessages });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/messages/:itemId
 * Send message to seller
 * 
 * Request body:
 * {
 *   "text": "Message text"
 * }
 */
router.post('/:itemId', authenticate, async (req, res) => {
  try {
    const { itemId } = req.params;
    const { text } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Message text is required' });
    }

    const item = await items.findById(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (item.seller_id === req.user.id) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    const message = await messages.create({
      from_user_id: req.user.id,
      to_user_id: item.seller_id,
      item_id: itemId,
      text: text.trim()
    });

    res.status(201).json({
      message: 'Message sent',
      data: message
    });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
