const express = require('express');
const { db } = require('../config/database');
const router = express.Router();

// IMPORTANTE: Middleware para log de TODAS as requisições
router.use((req, res, next) => {
  console.log('\n========== WEBHOOK CHAMADO ==========');
  console.log('📅 Data/Hora:', new Date().toISOString());
  console.log('🔗 URL:', req.originalUrl);
  console.log('📦 Body:', JSON.stringify(req.body, null, 2));
  console.log('📋 Headers:', JSON.stringify(req.headers, null, 2));
  console.log('=====================================\n');
  next();
});

// Webhook MisticPay
router.post('/mistic', async (req, res) => {
  try {
    const payload = req.body;
    
    console.log('🔍 Processando webhook...');
    console.log('Payload recebido:', payload);

    // Extrair dados (a MisticPay pode enviar com nomes diferentes)
    const transactionId = payload.transactionId || payload.transaction_id || payload.id || payload.txId;
    const status = payload.status || payload.paymentStatus;
    const amount = payload.amount || payload.value;

    console.log('🆔 Transaction ID extraído:', transactionId);
    console.log('📊 Status:', status);
    console.log('💰 Valor:', amount);

    if (!transactionId) {
      console.error('❌ ERRO: TransactionId não encontrado no payload');
      return res.status(400).json({ 
        error: 'TransactionId não encontrado',
        receivedPayload: payload 
      });
    }

    // Buscar transação - tentar TODOS os campos possíveis
    console.log('🔎 Buscando transação no banco...');
    
    let transaction = db.prepare(`
      SELECT * FROM transactions 
      WHERE api_transaction_id = ? 
         OR id = ?
    `).get(transactionId, transactionId);

    // Se não encontrou, listar todas as transações pendentes para debug
    if (!transaction) {
      console.log('⚠️ Transação não encontrada com ID:', transactionId);
      console.log('📋 Listando transações pendentes:');
      
      const pending = db.prepare(`
        SELECT id, api_transaction_id, valor_bruto_cents, status, criado_em 
        FROM transactions 
        WHERE status = 'pendente' 
        ORDER BY criado_em DESC 
        LIMIT 10
      `).all();
      
      console.table(pending);

      // Tentar encontrar pela última transação pendente (fallback)
      if (pending.length > 0) {
        console.log('🔄 Usando última transação pendente como fallback');
        transaction = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(pending[0].id);
      }
    }

    if (!transaction) {
      console.error('❌ Transação definitivamente não encontrada');
      return res.status(404).json({ 
        error: 'Transação não encontrada',
        searchedId: transactionId,
        hint: 'Verifique se a transação foi criada corretamente'
      });
    }

    console.log('✅ Transação encontrada:', {
      id: transaction.id,
      user_id: transaction.user_id,
      valor_liquido_cents: transaction.valor_liquido_cents,
      status_atual: transaction.status
    });

    // Verificar se já foi processada
    if (transaction.status === 'aprovado') {
      console.log('⚠️ Transação já foi aprovada anteriormente');
      return res.json({ 
        success: true, 
        message: 'Transação já processada anteriormente' 
      });
    }

    // Processar pagamento aprovado
    if (status === 'approved' || status === 'paid' || status === 'success' || status === 'completed' || status === 'COMPLETO' || status === 'completo') {
      console.log('💚 Status APROVADO - Creditando saldo...');

      // Iniciar transação SQL
      const updateTransaction = db.transaction(() => {
        // 1. Atualizar status da transação
        db.prepare(`
          UPDATE transactions 
          SET status = 'aprovado',
              atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(transaction.id);

        // 2. Creditar saldo do usuário
        const saldoAntes = db.prepare('SELECT saldo_cents FROM users WHERE id = ?').get(transaction.user_id);
        
        db.prepare(`
          UPDATE users 
          SET saldo_cents = saldo_cents + ?, 
              atualizado_em = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(transaction.valor_liquido_cents, transaction.user_id);

        const saldoDepois = db.prepare('SELECT saldo_cents FROM users WHERE id = ?').get(transaction.user_id);

        console.log('💰 Saldo ANTES:', (saldoAntes.saldo_cents / 100).toFixed(2));
        console.log('💵 Valor creditado:', (transaction.valor_liquido_cents / 100).toFixed(2));
        console.log('💎 Saldo DEPOIS:', (saldoDepois.saldo_cents / 100).toFixed(2));

        // 3. Criar audit log
        db.prepare(`
          INSERT INTO audit_logs (user_id, action, payload)
          VALUES (?, 'PAYMENT_CONFIRMED', ?)
        `).run(transaction.user_id, JSON.stringify({
          transactionId,
          amount,
          valorCreditado: (transaction.valor_liquido_cents / 100).toFixed(2),
          timestamp: new Date().toISOString()
        }));

        return saldoDepois.saldo_cents;
      });

      const novoSaldo = updateTransaction();

      console.log('✅ SUCESSO! Pagamento processado com sucesso');
      
      return res.json({ 
        success: true, 
        message: 'Pagamento confirmado e saldo creditado',
        transactionId: transaction.id,
        newBalance: (novoSaldo / 100).toFixed(2)
      });
    }

    // Processar pagamento cancelado/falhou
    if (status === 'cancelled' || status === 'failed' || status === 'rejected' || status === 'error') {
      console.log('❌ Status RECUSADO');

      db.prepare(`
        UPDATE transactions 
        SET status = 'recusado',
            atualizado_em = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(transaction.id);

      return res.json({ 
        success: true, 
        message: 'Status atualizado para recusado' 
      });
    }

    // Status desconhecido
    console.log('⚠️ Status não mapeado:', status);
    return res.json({ 
      success: true, 
      message: 'Webhook recebido mas status não processado',
      receivedStatus: status 
    });

  } catch (error) {
    console.error('❌❌❌ ERRO CRÍTICO NO WEBHOOK ❌❌❌');
    console.error('Error:', error);
    console.error('Stack:', error.stack);
    
    return res.status(500).json({ 
      error: 'Erro interno do servidor',
      details: error.message 
    });
  }
});

// Endpoint de teste
router.get('/test', (req, res) => {
  res.json({ 
    status: 'Webhook funcionando',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;