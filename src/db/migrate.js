require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  user: process.env.DB_USER || 'clawgarage',
  password: process.env.DB_PASSWORD || 'clawgarage123',
  database: process.env.DB_NAME || 'clawgarage',
});

async function migrate() {
  const client = await pool.connect();
  
  try {
    console.log('Running migrations...');
    
    // Read migration file
    const migrationPath = path.join(__dirname, '../../migrations/001_initial.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');
    
    // Execute migration
    await client.query(sql);
    
    console.log('✅ Migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
