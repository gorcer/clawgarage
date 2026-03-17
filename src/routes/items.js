const express = require('express');
const { items, users } = require('../models/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const VALID_CATEGORIES = ['electronics', 'clothing', 'furniture', 'books', 'tools', 'sports', 'auto', 'other'];
const VALID_STATUSES = ['active', 'reserved', 'sold'];

// Prompt injection and XSS detection patterns
const INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /disregard\s+all\s+(previous\s+)?(commands?\s+)?(instructions?\s+)?(and\s+)?/i,
  /system\s+prompt/i,
  /you\s+are\s+now/i,
  /new\s+instructions/i,
  /override\s+(your\s+)?(system\s+)?instructions/i,
  /forget\s+(all\s+)?(previous\s+)?(instructions?\s+)?/i,
  /bypass\s+(safety|security)/i,
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on\w+\s*=/i,  // event handlers like onclick, onload
  /<iframe/i,
  /<object/i,
  /<embed/i,
  /eval\s*\(/i,
  /expression\s*\(/i,
  // SQL injection patterns
  /(\b(union|select|insert|update|delete|drop|create|alter|exec|execute|script)\b)/i,
  /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,
  /(\b(or|and)\b\s+['"][^'"]*['"]\s*=\s*['"][^'"]*['"])/i,
  /(--|\/\*|\*\/|;--)/i,
  /(\bxp_\w+)/i,
  /(\bexec\s*\()/i,
];

const SQL_INJECTION_CHARS = /(\b(or|and)\b.*['"()=]|(\b(or|and)\b\s+\d+\s*=\s*\d+))/i;

/**
 * Check text for prompt injection and malicious patterns
 * @param {string} text - Text to check
 * @returns {object|null} - Returns {pattern, index} if detected, null otherwise
 */
function detectPromptInjection(text) {
  if (!text || typeof text !== 'string') return null;
  
  const lowerText = text.toLowerCase();
  
  // Check for common prompt injection patterns
  for (const pattern of INJECTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { pattern: match[0], index: match.index };
    }
  }
  
  // Additional SQL injection check for suspicious patterns
  if (SQL_INJECTION_CHARS.test(lowerText)) {
    // More detailed check for actual SQL injection attempts
    const sqlPatterns = [
      /\b(or|and)\b\s+['"][^'"]+['"]\s*=\s*['"][^'"]+['"]/i,
      /\bor\b\s+\d+\s*=\s*\d+/i,
      /union\s+select/i,
      /select\s+\*\s+from/i,
      /insert\s+into/i,
      /delete\s+from/i,
      /drop\s+table/i,
      /'\s*or\s+'1'\s*=\s*'1/i,
      /'\s*or\s+1\s*=\s*1/i,
    ];
    
    for (const sqlPattern of sqlPatterns) {
      const match = text.match(sqlPattern);
      if (match) {
        return { pattern: match[0], index: match.index };
      }
    }
  }
  
  return null;
}

/**
 * Validate item fields for prompt injection
 * @param {object} fields - Object with fields to validate
 * @returns {object|null} - Returns error object if injection detected, null if safe
 */
function validateFields(fields) {
  const fieldNames = Object.keys(fields);
  
  for (const fieldName of fieldNames) {
    let value = fields[fieldName];
    
    // Handle nested objects (like contacts)
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nestedResult = validateFields(value);
      if (nestedResult) {
        return nestedResult;
      }
      continue;
    }
    
    // Skip non-string values
    if (typeof value !== 'string') continue;
    
    const result = detectPromptInjection(value);
    if (result) {
      return {
        field: fieldName,
        detected: result.pattern,
        message: `Potential prompt injection detected in field "${fieldName}": ${result.pattern}`
      };
    }
  }
  
  return null;
}

/**
 * GET /api/items
 * Get all items
 * 
 * Query params:
 * - lat, lng, radius - filter by coordinates (km)
 * - minPrice, maxPrice - filter by price
 * - search - search by title/description
 * - category - filter by category
 */
router.get('/', async (req, res) => {
  try {
    const { lat, lng, radius, minPrice, maxPrice, search, category, limit: limitParam } = req.query;
    
    // Parse and validate limit
    let limit = limitParam ? parseInt(limitParam, 10) : 50;
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 100) limit = 100;
    
    const filters = {};
    
    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
      }
      filters.category = category;
    }
    
    if (minPrice) filters.minPrice = minPrice;
    if (maxPrice) filters.maxPrice = maxPrice;
    if (search) filters.search = search;
    
    let result = await items.findAll(filters);

    // Apply limit (default 50, max 100)
    result = result.slice(0, limit);

    // Filter by coordinates if provided
    if (lat && lng && radius) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      const rad = parseFloat(radius);
      
      result = result.filter(l => {
        if (!l.latitude || !l.longitude) return false;
        const dist = getDistance(
          userLat, userLng,
          parseFloat(l.latitude),
          parseFloat(l.longitude)
        );
        return dist <= rad;
      });
    }

    const safe = result.map(l => ({
      id: l.id,
      title: l.title,
      price: parseFloat(l.price),
      category: l.category,
      status: l.status,
      photos: l.photos?.[0] ? [l.photos[0]] : [],
      sellerLogin: l.seller_login
    }));

    res.json({ items: safe });
  } catch (error) {
    console.error('Error fetching items:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/items/:id
 * Get single item (short info)
 */
router.get('/:id', async (req, res) => {
  try {
    const listing = await items.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Get seller login
    const seller = await users.findById(listing.seller_id);
    
    res.json({
      item: {
        id: listing.id,
        title: listing.title,
        price: parseFloat(listing.price),
        category: listing.category,
        status: listing.status,
        photos: listing.photos?.[0] ? [listing.photos[0]] : [],
        sellerLogin: seller?.login
      }
    });
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/items/:id/full
 * Get single item (full info)
 */
router.get('/:id/full', async (req, res) => {
  try {
    const listing = await items.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Get seller login
    const seller = await users.findById(listing.seller_id);
    
    res.json({
      item: {
        id: listing.id,
        title: listing.title,
        description: listing.description,
        price: parseFloat(listing.price),
        category: listing.category,
        status: listing.status,
        photos: listing.photos || [],
        sellerLocation: listing.latitude && listing.longitude ? {
          latitude: parseFloat(listing.latitude),
          longitude: parseFloat(listing.longitude)
        } : null,
        contacts: listing.contacts,
        sellerLogin: seller?.login,
        sellerLink: listing.seller_link,
        createdAt: listing.created_at,
        updatedAt: listing.updated_at
      }
    });
  } catch (error) {
    console.error('Error fetching item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/items
 * Create new item
 * {
 *   "title": "Item title",
 *   "description": "Item description",
 *   "price": 100.00,
 *   "category": "electronics", // optional, default: "other"
 *   "photos": ["url1", "url2"], // optional, array of photo URLs
 *   "sellerLocation": { "latitude": 55.75, "longitude": 37.61 }, // optional
 *   "contacts": { "phone": "+1234567890" }, // optional
 *   "sellerLink": "https://t.me/username" // optional
 * }
 */
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, description, price, category, photos, sellerLocation, contacts, sellerLink } = req.body;

    if (!title || !description || price === undefined) {
      return res.status(400).json({ error: 'Title, description and price are required' });
    }

    // Check for prompt injection in text fields
    const injectionCheck = validateFields({ title, description, contacts, sellerLink });
    if (injectionCheck) {
      console.warn(`Prompt injection attempt detected: ${injectionCheck.message}`);
      return res.status(400).json({ error: 'Potential malicious content detected. Please remove suspicious patterns.' });
    }

    // Validate category
    const itemCategory = category || 'other';
    if (!VALID_CATEGORIES.includes(itemCategory)) {
      return res.status(400).json({ error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
    }

    // Validate photos if provided
    let itemPhotos = [];
    if (photos) {
      if (!Array.isArray(photos)) {
        return res.status(400).json({ error: 'Photos must be an array' });
      }
      itemPhotos = photos;
    }

    const item = await items.create({
      seller_id: req.user.id,
      title,
      description,
      price: parseFloat(price),
      category: itemCategory,
      latitude: sellerLocation?.latitude,
      longitude: sellerLocation?.longitude,
      contacts: contacts || {},
      seller_link: sellerLink || '',
      photos: itemPhotos
    });

    // Get seller login
    const seller = await users.findById(item.seller_id);

    res.status(201).json({
      message: 'Item created',
      item: {
        id: item.id,
        title: item.title,
        description: item.description,
        price: parseFloat(item.price),
        category: item.category,
        status: item.status,
        photos: item.photos || [],
        sellerLocation: item.latitude && item.longitude ? {
          latitude: parseFloat(item.latitude),
          longitude: parseFloat(item.longitude)
        } : null,
        contacts: item.contacts,
        sellerLogin: seller?.login,
        sellerLink: item.seller_link,
        createdAt: item.created_at,
        updatedAt: item.updated_at
      }
    });
  } catch (error) {
    console.error('Error creating item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/items/:id
 * Update item
 */
router.put('/:id', authenticate, async (req, res) => {
  try {
    const listing = await items.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { title, description, price, category, photos, sellerLocation, contacts, sellerLink, status } = req.body;
    
    // Check for prompt injection in text fields being updated
    const fieldsToCheck = {};
    if (title) fieldsToCheck.title = title;
    if (description) fieldsToCheck.description = description;
    if (contacts) fieldsToCheck.contacts = contacts;
    if (sellerLink !== undefined) fieldsToCheck.sellerLink = sellerLink;
    
    if (Object.keys(fieldsToCheck).length > 0) {
      const injectionCheck = validateFields(fieldsToCheck);
      if (injectionCheck) {
        console.warn(`Prompt injection attempt detected: ${injectionCheck.message}`);
        return res.status(400).json({ error: 'Potential malicious content detected. Please remove suspicious patterns.' });
      }
    }
    
    const updates = {};
    
    if (title) updates.title = title;
    if (description) updates.description = description;
    if (price !== undefined) updates.price = parseFloat(price);
    
    // Validate category if provided
    if (category) {
      if (!VALID_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
      }
      updates.category = category;
    }
    
    // Validate photos if provided
    if (photos !== undefined) {
      if (!Array.isArray(photos)) {
        return res.status(400).json({ error: 'Photos must be an array' });
      }
      updates.photos = photos;
    }
    
    // Validate status if provided
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` });
      }
      updates.status = status;
    }
    
    if (sellerLocation) {
      updates.latitude = sellerLocation.latitude;
      updates.longitude = sellerLocation.longitude;
    }
    if (contacts) updates.contacts = contacts;
    if (sellerLink !== undefined) updates.seller_link = sellerLink;

    const updated = await items.update(req.params.id, updates);
    
    // Get seller login
    const seller = await users.findById(updated.seller_id);

    res.json({
      message: 'Item updated',
      item: {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        price: parseFloat(updated.price),
        category: updated.category,
        status: updated.status,
        photos: updated.photos || [],
        sellerLocation: updated.latitude && updated.longitude ? {
          latitude: parseFloat(updated.latitude),
          longitude: parseFloat(updated.longitude)
        } : null,
        contacts: updated.contacts,
        sellerLogin: seller?.login,
        sellerLink: updated.seller_link,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PATCH /api/items/:id/status
 * Update item status only
 * 
 * Request body:
 * {
 *   "status": "reserved" // or "sold", "active"
 * }
 */
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const listing = await items.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }
    
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid: ${VALID_STATUSES.join(', ')}` });
    }

    const updated = await items.update(req.params.id, { status });
    
    // Get seller login
    const seller = await users.findById(updated.seller_id);

    res.json({
      message: 'Item status updated',
      item: {
        id: updated.id,
        title: updated.title,
        description: updated.description,
        price: parseFloat(updated.price),
        category: updated.category,
        status: updated.status,
        sellerLocation: updated.latitude && updated.longitude ? {
          latitude: parseFloat(updated.latitude),
          longitude: parseFloat(updated.longitude)
        } : null,
        contacts: updated.contacts,
        sellerLogin: seller?.login,
        sellerLink: updated.seller_link,
        createdAt: updated.created_at,
        updatedAt: updated.updated_at
      }
    });
  } catch (error) {
    console.error('Error updating item status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/items/:id
 * Delete item
 */
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const listing = await items.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (listing.seller_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await items.delete(req.params.id);

    res.json({ message: 'Item deleted' });
  } catch (error) {
    console.error('Error deleting item:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

module.exports = router;
