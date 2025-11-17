require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000; // ✅ ISSO ESTÁ CORRETO - não mude!

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
  'https://www.elitepaybr.com',    // 👈 Adicione o www também
  'http://localhost:5173',
  process.env.FRONTEND_URL
].filter(Boolean); // Remove valores undefined

app.use(cors({
  origin: function (origin, callback) {
    // Permite conexões sem 'origin' (ex: apps de celular, Postman)
    if (!origin) return callback(null, true);

    // Se a 'origin' da requisição ESTÁ na nossa lista, permite
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      // Se NÃO ESTÁ na lista, bloqueia
      console.log('⚠️ CORS bloqueado para origem:', origin);
      callback(new Error('CORS: Acesso bloqueado. Origem não permitida.'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
// ========================================

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

// Initialize database
try {
  const { initializeDatabase } = require('./config/database');
  initializeDatabase();
} catch (error) {
  console.error('Failed to initialize database:', error);
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

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV
  });
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
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Erro interno do servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint não encontrado' });
});

// Start server
app.listen(PORT, () => {
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
  ║    /api/auth/*                        ║
  ║    /api/transactions/*                ║
  ║    /api/credentials/*                 ║
  ║    /webhook/mistic                    ║
  ║                                       ║
  ║  🌐 CORS permitido para:              ║
  ║    • ${allowedOrigins[0] || 'N/A'}${' '.repeat(Math.max(0, 30 - (allowedOrigins[0] || 'N/A').length))} ║
  ║                                       ║
  ║  Status: ONLINE ✅                    ║
  ╚═══════════════════════════════════════╝
  `);
});

module.exports = app;