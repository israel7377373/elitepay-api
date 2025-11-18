const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { db } = require('../config/database');
const { authenticateToken } = require('./auth');

const router = express.Router();
router.use(authenticateToken);

// ========================================
// CRIAR TABELAS SE NÃO EXISTIREM
// ========================================
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      client_id TEXT UNIQUE NOT NULL,
      client_secret_hash TEXT NOT NULL, 
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS api_allowed_ips (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      ip_address TEXT NOT NULL,
      criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  console.log('Tabelas de credenciais verificadas/criadas com sucesso.');
} catch (error) {
  console.error('Erro ao criar tabelas:', error.message);
}

// ========================================
// GERAR CREDENCIAIS DE API
// ========================================
router.post('/generate', async (req, res) => {
  try {
    const userId = req.user.userId;

    let existing;
    try {
      existing = db.prepare(`SELECT client_id FROM api_credentials WHERE user_id = ?`).get(userId);
    } catch (dbError) {
      return res.status(500).json({ error: 'Erro no banco de dados ao verificar credenciais existentes.' });
    }

    if (existing) {
      return res.status(400).json({ error: 'Você já possui credenciais. Delete as antigas para gerar novas.' });
    }

    // Gerar Client ID e Client Secret
    const clientId = `ci_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = `cs_${crypto.randomBytes(32).toString('hex')}`;
    const clientSecretHash = await bcrypt.hash(clientSecret, 10); 

    // Salvar no banco (salva o HASH)
    try {
      db.prepare(`
        INSERT INTO api_credentials (user_id, client_id, client_secret_hash)
        VALUES (?, ?, ?)
      `).run(userId, clientId, clientSecretHash);
    } catch (dbError) {
      return res.status(500).json({ error: 'Erro ao salvar credenciais no banco de dados' });
    }

    // Audit log 
    try {
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, payload)
        VALUES (?, 'API_CREDENTIALS_GENERATED', ?)
      `).run(userId, JSON.stringify({ clientId }));
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria (não crítico):', auditError);
    }

    res.json({
      success: true,
      clientId,
      clientSecret, 
      createdAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Erro geral ao gerar credenciais:', error);
    res.status(500).json({ error: 'Erro ao gerar credenciais' });
  }
});

// ========================================
// OBTER CREDENCIAIS
// ========================================
router.get('/', (req, res) => {
  try {
    const userId = req.user.userId;

    const credentials = db.prepare(`
      SELECT client_id, criado_em 
      FROM api_credentials 
      WHERE user_id = ?
    `).get(userId);

    if (!credentials) {
      return res.json({ hasCredentials: false });
    }
    
    // Retorna apenas o ID e a data (NÃO o Secret)
    res.json({
      hasCredentials: true,
      clientId: credentials.client_id,
      createdAt: credentials.criado_em
    });

  } catch (error) {
    console.error('Erro ao buscar credenciais:', error);
    res.status(500).json({ error: 'Erro ao buscar credenciais' });
  }
});

// ========================================
// DELETAR CREDENCIAIS
// ========================================
router.delete('/', (req, res) => {
  try {
    const userId = req.user.userId;
    db.prepare(`DELETE FROM api_credentials WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM api_allowed_ips WHERE user_id = ?`).run(userId);

    // Audit log
    try {
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, payload)
        VALUES (?, 'API_CREDENTIALS_DELETED', ?)
      `).run(userId, JSON.stringify({ timestamp: new Date().toISOString() }));
    } catch (auditError) {
      console.error('Erro ao criar log de auditoria (não crítico):', auditError);
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Erro ao deletar credenciais:', error);
    res.status(500).json({ error: 'Erro ao deletar credenciais' });
  }
});

// ========================================
// ADICIONAR IP AUTORIZADO
// ========================================
router.post('/ips', (req, res) => {
  try {
    const userId = req.user.userId;
    const { ip } = req.body;

    if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return res.status(400).json({ error: 'IP inválido. Use o formato xxx.xxx.xxx.xxx' });
    }

    const parts = ip.split('.');
    if (parts.some(part => parseInt(part) > 255)) {
      return res.status(400).json({ error: 'IP inválido. Cada parte deve ser entre 0-255' });
    }

    const id = crypto.randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO api_allowed_ips (id, user_id, ip_address)
      VALUES (?, ?, ?)
    `).run(id, userId, ip);

    res.json({ success: true, id, ip });

  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'Este IP já está cadastrado' });
    }
    
    res.status(500).json({ error: 'Erro ao adicionar IP' });
  }
});

// ========================================
// LISTAR IPS AUTORIZADOS
// ========================================
router.get('/ips', (req, res) => {
  try {
    const userId = req.user.userId;

    const ips = db.prepare(`
      SELECT id, ip_address, criado_em 
      FROM api_allowed_ips 
      WHERE user_id = ?
      ORDER BY criado_em DESC
    `).all(userId);

    res.json({ ips: ips || [] });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar IPs' });
  }
});

// ========================================
// DELETAR IP AUTORIZADO
// ========================================
router.delete('/ips/:id', (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = db.prepare(`
      DELETE FROM api_allowed_ips 
      WHERE id = ? AND user_id = ?
    `).run(id, userId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'IP não encontrado' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar IP' });
  }
});

// ========================================
// ROTA DE DIAGNÓSTICO (REMOVER EM PRODUÇÃO)
// ========================================
router.get('/debug/tables', (req, res) => {
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();

    const hasApiCredentials = tables.some(t => t.name === 'api_credentials');
    const hasAuditLogs = tables.some(t => t.name === 'audit_logs');
    const hasAllowedIps = tables.some(t => t.name === 'api_allowed_ips');

    res.json({ 
      success: true, 
      tables: tables.map(t => t.name),
      hasApiCredentials,
      hasAuditLogs,
      hasAllowedIps,
      allTablesExist: hasApiCredentials && hasAuditLogs && hasAllowedIps
    });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao verificar tabelas' });
  }
});

module.exports = router;
