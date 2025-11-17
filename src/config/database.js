const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../database.sqlite');

// Create database connection
const db = new Database(DB_PATH, { 
  verbose: process.env.NODE_ENV === 'development' ? console.log : null 
});

// Enable foreign keys
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Initialize database schema
function initializeDatabase() {
  const schemaPath = path.join(__dirname, '../models/models.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  
  // Execute schema (split by semicolon and filter empty statements)
  const statements = schema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  statements.forEach(statement => {
    try {
      db.exec(statement);
    } catch (error) {
      console.error('Error executing statement:', statement);
      throw error;
    }
  });
  
  console.log('✅ Database initialized successfully');
}

// Backup database
function backupDatabase() {
  const backupPath = `${DB_PATH}.backup-${Date.now()}`;
  db.backup(backupPath);
  return backupPath;
}

module.exports = {
  db,
  initializeDatabase,
  backupDatabase
};