const express = require('express');
const crypto = require('crypto');
const { db } = require('../config/database');
const { authenticateToken } = require('./auth');

const router = express.Router();

// Todas as rotas precisam autenticação
router.use(authenticateToken);

// Gerar credenciais de API
router.post('/generate', (req, res) => {
  try {
    const userId = req.user.userId;

    // Verificar se já existe credencial
    const existing = db.prepare(`
      SELECT * FROM api_credentials WHERE user_id = ?
    `).get(userId);

    if (existing) {
      return res.status(400).json({ 
        error: 'Você já possui credenciais. Delete as antigas para gerar novas.' 
      });
    }

    // Gerar Client ID e Client Secret
    const clientId = `ci_${crypto.randomBytes(16).toString('hex')}`;
    const clientSecret = `cs_${crypto.randomBytes(32).toString('hex')}`;

    // Salvar no banco
    db.prepare(`
      INSERT INTO api_credentials (user_id, client_id, client_secret)
      VALUES (?, ?, ?)
    `).run(userId, clientId, clientSecret);

    // Audit log
    db.prepare(`
      INSERT INTO audit_logs (user_id, action, payload)
      VALUES (?, 'API_CREDENTIALS_GENERATED', ?)
    `).run(userId, JSON.stringify({ clientId }));

    res.json({
      success: true,
      clientId,
      clientSecret
    });

  } catch (error) {
    console.error('Erro ao gerar credenciais:', error);
    res.status(500).json({ error: 'Erro ao gerar credenciais' });
  }
});

// Obter credenciais
router.get('/', (req, res) => {
  try {
    const userId = req.user.userId;

    const credentials = db.prepare(`
      SELECT client_id, client_secret, criado_em 
      FROM api_credentials 
      WHERE user_id = ?
    `).get(userId);

    if (!credentials) {
      return res.json({ hasCredentials: false });
    }

    res.json({
      hasCredentials: true,
      clientId: credentials.client_id,
      clientSecret: credentials.client_secret,
      createdAt: credentials.criado_em
    });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar credenciais' });
  }
});

// Deletar credenciais
router.delete('/', (req, res) => {
  try {
    const userId = req.user.userId;

    db.prepare(`DELETE FROM api_credentials WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM api_allowed_ips WHERE user_id = ?`).run(userId);

    db.prepare(`
      INSERT INTO audit_logs (user_id, action, payload)
      VALUES (?, 'API_CREDENTIALS_DELETED', ?)
    `).run(userId, JSON.stringify({ timestamp: new Date().toISOString() }));

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar credenciais' });
  }
});

// Adicionar IP autorizado
router.post('/ips', (req, res) => {
  try {
    const userId = req.user.userId;
    const { ip } = req.body;

    if (!ip || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return res.status(400).json({ error: 'IP inválido' });
    }

    const id = crypto.randomBytes(16).toString('hex');

    db.prepare(`
      INSERT INTO api_allowed_ips (id, user_id, ip_address)
      VALUES (?, ?, ?)
    `).run(id, userId, ip);

    res.json({ success: true, id, ip });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao adicionar IP' });
  }
});

// Listar IPs autorizados
router.get('/ips', (req, res) => {
  try {
    const userId = req.user.userId;

    const ips = db.prepare(`
      SELECT id, ip_address, criado_em 
      FROM api_allowed_ips 
      WHERE user_id = ?
    `).all(userId);

    res.json({ ips });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar IPs' });
  }
});

// Deletar IP autorizado
router.delete('/ips/:id', (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    db.prepare(`
      DELETE FROM api_allowed_ips 
      WHERE id = ? AND user_id = ?
    `).run(id, userId);

    res.json({ success: true });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao deletar IP' });
  }
});

module.exports = router;