const express = require('express');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');
const { authenticateToken } = require('./auth');
const axios = require('axios');

const router = express.Router();

// Configuração MisticPay
const MISTIC_CONFIG = {
  baseURL: 'https://api.misticpay.com',
  headers: {
    'ci': process.env.CI || 'ci_jbbmajuwwmq28hv',
    'cs': process.env.CS || 'cs_isxps89xg5jodulumlayuy40d',
    'Content-Type': 'application/json'
  }
};

// DEBUG - ANTES do authenticateToken
router.get('/debug/all', (req, res) => {
  try {
    const transactions = db.prepare(`
      SELECT id, api_transaction_id, user_id, valor_bruto_cents, 
             valor_liquido_cents, status, criado_em 
      FROM transactions 
      ORDER BY criado_em DESC 
      LIMIT 10
    `).all();
    
    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Todas as rotas precisam de autenticação (DEPOIS do debug)
router.use(authenticateToken);

// ... resto do código

// Validation schema
const createPixSchema = Joi.object({
  amount: Joi.number().min(0.01).required(),
  description: Joi.string().max(200).optional()
});

// CRIAR TRANSAÇÃO PIX (RECEBER)
router.post('/create', async (req, res, next) => {
  try {
    const { error, value } = createPixSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { amount, description } = value;
    const userId = req.user.userId;
    
    // Buscar dados do usuário
    const user = db.prepare('SELECT nome, cpf FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    // Gerar ID único para a transação
    const transactionId = uuidv4();
    const amountCents = Math.round(amount * 100);
    
    // Calcular taxas (4% + R$1)
    const taxaMinhaCents = Math.round(amountCents * 0.04);
    const taxaApiCents = 100; // R$1,00
    const valorLiquidoCents = amountCents - taxaMinhaCents - taxaApiCents;

    // Chamar API MisticPay
    try {
      console.log('📤 Enviando para MisticPay:', {
        amount: amount,
        payerName: user.nome,
        payerDocument: user.cpf,
        transactionId: transactionId
      });

      const response = await axios.post(
        `${MISTIC_CONFIG.baseURL}/api/transactions/create`,
        {
          amount: parseFloat(amount.toFixed(2)),
          payerName: user.nome,
          payerDocument: user.cpf,
          transactionId: transactionId,
          description: description || 'Pagamento Elite Pay'
        },
        { headers: MISTIC_CONFIG.headers }
      );

      const apiData = response.data; // apiData é o objeto COMPLETO
      
      // ✅ CORRIGIDO - Buscando de dentro de 'apiData.data'
      const qrCode = apiData.data?.qrcodeUrl; // Usamos a URL, não o Base64
      const copyPaste = apiData.data?.copyPaste;
      const apiTransactionId = apiData.data?.transactionId;

      console.log('✅ MisticPay respondeu:', apiData);
      console.log('🖼️ QR Code da API:', qrCode);
      console.log('📋 Copy Paste da API:', copyPaste);
      console.log('📦 Response completo:', JSON.stringify(apiData, null, 2));

      // Salvar transação no banco
      db.prepare(`
        INSERT INTO transactions (
          id, user_id, tipo, valor_bruto_cents, valor_liquido_cents,
          taxa_minha_cents, taxa_api_cents, api_transaction_id, status,
          qrcode_url, copy_paste, descricao
        ) VALUES (?, ?, 'deposito', ?, ?, ?, ?, ?, 'pendente', ?, ?, ?)
      `).run(
        transactionId,
        userId,
        amountCents,
        valorLiquidoCents,
        taxaMinhaCents,
        taxaApiCents,
        apiTransactionId || transactionId, // ✅ CORRIGIDO
        qrCode || null,                   // ✅ CORRIGIDO
        copyPaste || null,                // ✅ CORRIGIDO
        description || 'Pagamento via PIX'
      );

      // Audit log
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, payload)
        VALUES (?, 'PIX_CREATED', ?)
      `).run(userId, JSON.stringify({ transactionId, amount }));

      // Criar backup do usuário
      createUserBackup(userId);

      // Enviar a resposta CORRETA de volta para o React
      res.status(201).json({
        success: true,
        transactionId: transactionId,
        apiTransactionId: apiTransactionId, // ✅ CORRIGIDO
        qrcodeUrl: qrCode,                   // ✅ CORRIGIDO
        copyPaste: copyPaste,                // ✅ CORRIGIDO
        amount: amount,
        valorLiquido: (valorLiquidoCents / 100).toFixed(2),
        taxas: {
          elitePay: (taxaMinhaCents / 100).toFixed(2),
          api: (taxaApiCents / 100).toFixed(2)
        },
        status: 'pendente'
      });

    } catch (apiError) {
      console.error('❌ MisticPay API Error:', apiError.response?.data || apiError.message);
      return res.status(400).json({
        error: 'Erro ao gerar PIX',
        details: apiError.response?.data?.message || apiError.message
      });
    }

  } catch (error) {
    next(error);
  }
});
// SAQUE/TRANSFERÊNCIA PIX
const withdrawSchema = Joi.object({
  amount: Joi.number().min(10).required(),
  pixKey: Joi.string().required(),
  pixKeyType: Joi.string().valid('CPF', 'CNPJ', 'EMAIL', 'TELEFONE', 'CHAVE_ALEATORIA').required(),
  description: Joi.string().max(200).optional()
});

router.post('/withdraw', async (req, res, next) => {
  try {
    const { error, value } = withdrawSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { amount, pixKey, pixKeyType, description } = value;
    const userId = req.user.userId;
    const amountCents = Math.round(amount * 100);
    const taxaApiCents = 100;
    const totalCents = amountCents + taxaApiCents;

    // Verificar saldo
    const user = db.prepare('SELECT saldo_cents FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    if (user.saldo_cents < totalCents) {
      return res.status(400).json({
        error: 'Saldo insuficiente',
        saldoAtual: (user.saldo_cents / 100).toFixed(2),
        necessario: (totalCents / 100).toFixed(2)
      });
    }

    const transactionId = uuidv4();

    try {
      const response = await axios.post(
        `${MISTIC_CONFIG.baseURL}/api/transactions/withdraw`,
        {
          amount: parseFloat(amount.toFixed(2)),
          pixKey: pixKey,
          pixKeyType: pixKeyType,
          description: description || 'Saque Elite Pay'
        },
        { headers: MISTIC_CONFIG.headers }
      );

      // Deduzir do saldo
      db.prepare(`
        UPDATE users
        SET saldo_cents = saldo_cents - ?, atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(totalCents, userId);

      // Salvar transação
      db.prepare(`
        INSERT INTO transactions (
          id, user_id, tipo, valor_bruto_cents, valor_liquido_cents,
          taxa_minha_cents, taxa_api_cents, status, chave_pix, tipo_chave_pix, descricao
        ) VALUES (?, ?, 'saque', ?, ?, 0, ?, 'aprovado', ?, ?, ?)
      `).run(
        transactionId,
        userId,
        amountCents,
        amountCents,
        taxaApiCents,
        pixKey,
        pixKeyType,
        description || 'Saque via PIX'
      );

      // Audit log
      db.prepare(`
        INSERT INTO audit_logs (user_id, action, payload)
        VALUES (?, 'WITHDRAW_PROCESSED', ?)
      `).run(userId, JSON.stringify({ transactionId, amount, pixKey }));

      createUserBackup(userId);

      res.json({
        success: true,
        transactionId: transactionId,
        amount: amount,
        pixKey: pixKey,
        taxa: (taxaApiCents / 100).toFixed(2),
        novoSaldo: ((user.saldo_cents - totalCents) / 100).toFixed(2)
      });

    } catch (apiError) {
      console.error('MisticPay Withdraw Error:', apiError.response?.data || apiError.message);
      return res.status(400).json({
        error: 'Erro ao processar saque',
        details: apiError.response?.data || apiError.message
      });
    }

  } catch (error) {
    next(error);
  }
});

// LISTAR TRANSAÇÕES
router.get('/', (req, res) => {
  try {
    const userId = req.user.userId;
    const { tipo, status, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [userId];

    if (tipo) {
      query += ' AND tipo = ?';
      params.push(tipo);
    }

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY criado_em DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const transactions = db.prepare(query).all(...params);

    const formatted = transactions.map(tx => ({
      id: tx.id,
      tipo: tx.tipo,
      valorBruto: (tx.valor_bruto_cents / 100).toFixed(2),
      valorLiquido: (tx.valor_liquido_cents / 100).toFixed(2),
      taxaMinha: (tx.taxa_minha_cents / 100).toFixed(2),
      taxaApi: (tx.taxa_api_cents / 100).toFixed(2),
      status: tx.status,
      descricao: tx.descricao,
      chavePix: tx.chave_pix,
      tipoChavePix: tx.tipo_chave_pix,
      apiTransactionId: tx.api_transaction_id,
      qrcodeUrl: tx.qrcode_url,
      copyPaste: tx.copy_paste,
      criadoEm: tx.criado_em,
      metodo: 'PIX'
    }));

    res.json({
      success: true,
      transactions: formatted,
      count: formatted.length
    });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar transações' });
  }
});

// OBTER TRANSAÇÃO ESPECÍFICA
router.get('/:id', (req, res) => {
  try {
    const userId = req.user.userId;
    const transactionId = req.params.id;

    const tx = db.prepare(`
      SELECT * FROM transactions WHERE id = ? AND user_id = ?
    `).get(transactionId, userId);

    if (!tx) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    res.json({
      id: tx.id,
      tipo: tx.tipo,
      valorBruto: (tx.valor_bruto_cents / 100).toFixed(2),
      valorLiquido: (tx.valor_liquido_cents / 100).toFixed(2),
      taxaMinha: (tx.taxa_minha_cents / 100).toFixed(2),
      taxaApi: (tx.taxa_api_cents / 100).toFixed(2),
      status: tx.status,
      descricao: tx.descricao,
      chavePix: tx.chave_pix,
      tipoChavePix: tx.tipo_chave_pix,
      qrcodeUrl: tx.qrcode_url,
      copyPaste: tx.copy_paste,
      apiTransactionId: tx.api_transaction_id,
      criadoEm: tx.criado_em,
      metodo: 'PIX'
    });

  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar transação' });
  }
});

// FUNÇÃO DE BACKUP
function createUserBackup(userId) {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const transactions = db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(userId);

    const backup = {
      user: {
        id: user.id,
        nome: user.nome,
        cpf: user.cpf,
        telefone: user.telefone,
        email: user.email,
        saldo: (user.saldo_cents / 100).toFixed(2),
        criadoEm: user.criado_em
      },
      transactions: transactions.map(tx => ({
        id: tx.id,
        tipo: tx.tipo,
        valor: (tx.valor_bruto_cents / 100).toFixed(2),
        status: tx.status,
        data: tx.criado_em
      })),
      backupDate: new Date().toISOString()
    };

    const backupFile = path.join(backupDir, `${userId}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
    
    console.log(`✅ Backup criado: ${userId}`);
  } catch (error) {
    console.error('Erro ao criar backup:', error);
  }
}
// DEBUG - Listar todas as transações
router.get('/debug/all', (req, res) => {
  try {
    const transactions = db.prepare(`
      SELECT id, api_transaction_id, user_id, valor_bruto_cents, 
             valor_liquido_cents, status, criado_em 
      FROM transactions 
      ORDER BY criado_em DESC 
      LIMIT 10
    `).all();
    
    res.json({ transactions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
module.exports = router;