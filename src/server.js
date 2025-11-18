require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

// Criar pasta logs se não existir
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// ========================================
// CONFIGURAÇÃO DO CORS
// ========================================
const allowedOrigins = [
  'https://elitepaybr.com',
  'https://www.elitepaybr.com',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('⚠️ CORS bloqueado para origem:', origin);
      callback(new Error('CORS: Acesso bloqueado. Origem não permitida.'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(helmet());
app.use(express.json());
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Muitas requisições, tente novamente mais tarde'
});
app.use('/api/', limiter);

// ========================================
// INICIALIZAR BANCO DE DADOS
// ========================================
try {
  const { initializeDatabase, db } = require('./config/database');
  initializeDatabase();
  
  // Criar tabelas de credenciais API
  console.log('📊 Criando tabelas de credenciais API...');
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      client_id TEXT UNIQUE NOT NULL,
      client_secret TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS api_allowed_ips (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      ip_address TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, ip_address),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_api_credentials_user ON api_credentials(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_credentials_client_id ON api_credentials(client_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_api_allowed_ips_user ON api_allowed_ips(user_id);
  `);
  
  console.log('✅ Tabelas de credenciais API criadas/verificadas com sucesso');
  
} catch (error) {
  console.error('❌ Falha ao inicializar banco de dados:', error);
  process.exit(1);
}

// ========================================
// ROTAS
// ========================================
const authRoutes = require('./routes/auth');
const transactionsRoutes = require('./routes/transactions');
const webhookRoutes = require('./routes/webhook');
const apiCredentialsRoutes = require('./routes/api-credentials');

app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/webhook', webhookRoutes);
app.use('/api/credentials', apiCredentialsRoutes);

// ========================================
// HEALTH CHECK
// ========================================
app.get('/health', (req, res) => {
  try {
    const { db } = require('./config/database');
    
    // Testar conexão com o banco
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table'
    `).all();
    
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV,
      database: {
        connected: true,
        tables: tables.length
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV,
      database: {
        connected: false,
        error: error.message
      }
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Elite Pay API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      transactions: '/api/transactions/*',
      webhook: '/webhook/mistic',
      credentials: '/api/credentials/*'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  
  // Erro de CORS
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      error: 'Acesso bloqueado - Origem não permitida',
      allowedOrigins: allowedOrigins
    });
  }
  
  res.status(err.status || 500).json({
    error: err.message || 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint não encontrado',
    path: req.path,
    method: req.method
  });
});

// Start server
// CORREÇÃO: Atribuímos o resultado de app.listen() à variável 'server'
const server = app.listen(PORT, () => {
  const serverUrl = process.env.APP_URL || `http://localhost:${PORT}`;
  const environment = process.env.NODE_ENV || 'development';
  
  console.log(`
  ╔═══════════════════════════════════════╗
  ║      🏛️  ELITE PAY - BACKEND         ║
  ║                                       ║
  ║  Environment: ${environment.toUpperCase().padEnd(24)} ║
  ║  Server: ${serverUrl.padEnd(28)} ║
  ║  Health: ${serverUrl}/health ${' '.repeat(Math.max(0, 16 - serverUrl.length))} ║
  ║                                       ║
  ║  📍 Endpoints:                        ║
  ║    /api/auth/* ║
  ║    /api/transactions/* ║
  ║    /api/credentials/* ║
  ║    /webhook/mistic                    ║
  ║                                       ║
  ║  🌐 CORS permitido para:              ║
  ${allowedOrigins.map(origin => `  ║    • ${origin}${' '.repeat(Math.max(0, 33 - origin.length))} ║`).join('\n')}
  ║                                       ║
  ║  Status: ONLINE ✅                    ║
  ╚═══════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('⚠️ SIGTERM recebido. Encerrando servidor...');
  // Agora 'server.close' funciona corretamente
  server.close(() => {
    console.log('✅ Servidor encerrado gracefully');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('⚠️ SIGINT recebido. Encerrando servidor...');
  process.exit(0);
});

module.exports = app;
