const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'clawgarage',
  password: process.env.DB_PASSWORD || 'clawgarage123',
  database: process.env.DB_NAME || 'clawgarage',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Test connection
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  
  // User methods
  users: {
    async create(user) {
      const { email, login, password, agentInfo } = user;
      const result = await pool.query(
        `INSERT INTO users (email, login, password, agent_info) 
         VALUES ($1, $2, $3, $4) 
         RETURNING id, email, login, agent_info, created_at, updated_at`,
        [email, login, password, JSON.stringify(agentInfo || {})]
      );
      return result.rows[0];
    },
    
    async findById(id) {
      const result = await pool.query(
        'SELECT * FROM users WHERE id = $1',
        [id]
      );
      return result.rows[0];
    },
    
    async findByLoginOrEmail(loginOrEmail) {
      const result = await pool.query(
        'SELECT * FROM users WHERE login = $1 OR email = $1',
        [loginOrEmail]
      );
      return result.rows[0];
    },
    
    async findByEmail(email) {
      const result = await pool.query(
        'SELECT * FROM users WHERE email = $1',
        [email]
      );
      return result.rows[0];
    },
    
    async findByLogin(login) {
      const result = await pool.query(
        'SELECT * FROM users WHERE login = $1',
        [login]
      );
      return result.rows[0];
    }
  },
  
  // Items methods
  items: {
    async create(item) {
      const { seller_id, title, description, price, category, latitude, longitude, contacts, seller_link, photos } = item;
      const result = await pool.query(
        `INSERT INTO items (seller_id, title, description, price, category, status, latitude, longitude, contacts, seller_link, photos) 
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9, $10) 
         RETURNING *`,
        [seller_id, title, description, price, category || 'other', latitude, longitude, JSON.stringify(contacts || {}), seller_link || '', photos || []]
      );
      return result.rows[0];
    },
    
    async findById(id) {
      const result = await pool.query(
        'SELECT * FROM items WHERE id = $1',
        [id]
      );
      return result.rows[0];
    },
    
    async findAll(filters = {}) {
      let query = 'SELECT i.*, u.login as seller_login FROM items i JOIN users u ON i.seller_id = u.id';
      const params = [];
      const conditions = [];
      
      if (filters.category) {
        params.push(filters.category);
        conditions.push(`i.category = $${params.length}`);
      }
      
      if (filters.status) {
        params.push(filters.status);
        conditions.push(`i.status = $${params.length}`);
      }
      
      if (filters.seller_id) {
        params.push(filters.seller_id);
        conditions.push(`i.seller_id = $${params.length}`);
      }
      
      if (filters.minPrice) {
        params.push(parseFloat(filters.minPrice));
        conditions.push(`i.price >= $${params.length}`);
      }
      
      if (filters.maxPrice) {
        params.push(parseFloat(filters.maxPrice));
        conditions.push(`i.price <= $${params.length}`);
      }
      
      if (filters.search) {
        params.push(`%${filters.search}%`);
        conditions.push(`(i.title ILIKE $${params.length} OR i.description ILIKE $${params.length})`);
      }
      
      if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
      }
      
      query += ' ORDER BY i.created_at DESC';
      
      const result = await pool.query(query, params);
      return result.rows;
    },
    
    async update(id, updates) {
      const fields = [];
      const params = [];
      let paramIndex = 1;
      
      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          // Handle JSON fields
          if (key === 'contacts' || key === 'sellerLocation') {
            fields.push(`${key} = $${paramIndex}`);
            params.push(JSON.stringify(value));
          } else if (key === 'photos') {
            fields.push(`${key} = $${paramIndex}`);
            params.push(value);
          } else if (key === 'latitude' || key === 'longitude') {
            fields.push(`${key} = $${paramIndex}`);
            params.push(value);
          } else {
            fields.push(`${key} = $${paramIndex}`);
            params.push(value);
          }
          paramIndex++;
        }
      }
      
      if (fields.length === 0) return null;
      
      params.push(id);
      const result = await pool.query(
        `UPDATE items SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex} RETURNING *`,
        params
      );
      return result.rows[0];
    },
    
    async delete(id) {
      const result = await pool.query(
        'DELETE FROM items WHERE id = $1 RETURNING id',
        [id]
      );
      return result.rows[0];
    }
  },
  
  // Messages methods
  messages: {
    async create(message) {
      const { from_user_id, to_user_id, item_id, text } = message;
      const result = await pool.query(
        `INSERT INTO messages (from_user_id, to_user_id, item_id, text) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`,
        [from_user_id, to_user_id, item_id, text]
      );
      return result.rows[0];
    },
    
    async findByItemId(itemId) {
      const result = await pool.query(
        `SELECT m.*, u.login as from_user_login 
         FROM messages m 
         JOIN users u ON m.from_user_id = u.id 
         WHERE m.item_id = $1 
         ORDER BY m.created_at ASC`,
        [itemId]
      );
      return result.rows;
    },
    
    async findByUserId(userId) {
      const result = await pool.query(
        `SELECT m.*, u.login as from_user_login 
         FROM messages m 
         JOIN users u ON m.from_user_id = u.id 
         WHERE m.to_user_id = $1 
         ORDER BY m.created_at DESC`,
        [userId]
      );
      return result.rows;
    },
    
    async markAsRead(messageId) {
      const result = await pool.query(
        'UPDATE messages SET read = TRUE WHERE id = $1 RETURNING *',
        [messageId]
      );
      return result.rows[0];
    }
  }
};
