// src/services/misticPayService.js
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const MISTIC_BASE = process.env.MISTIC_BASE || 'https://api.misticpay.com';
const CI = process.env.CI;
const CS = process.env.CS;

if (!CI || !CS) {
  throw new Error('MisticPay credentials (CI/CS) not configured in environment');
}

/**
 * Cliente Axios configurado para MisticPay
 */
const misticClient = axios.create({
  baseURL: MISTIC_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'ci': CI,
    'cs': CS
  }
});

// Interceptor para logs
misticClient.interceptors.request.use(request => {
  console.log('🔵 MisticPay Request:', {
    method: request.method,
    url: request.url,
    data: request.data
  });
  return request;
});

misticClient.interceptors.response.use(
  response => {
    console.log('✅ MisticPay Response:', response.data);
    return response;
  },
  error => {
    console.error('❌ MisticPay Error:', {
      status: error.response?.status,
      data: error.response?.data,
      message: error.message
    });
    throw error;
  }
);

/**
 * Cria transação de depósito (PIX)
 * @param {object} params
 * @returns {Promise<object>}
 */
async function createPixTransaction(params) {
  const {
    amount, // Valor em centavos
    payerName,
    payerDocument,
    description,
    webhookUrl
  } = params;

  const transactionId = uuidv4();

  try {
    const response = await misticClient.post('/api/transactions/create', {
      amount: amount, // MisticPay espera centavos ou reais? Verificar doc
      payerName,
      payerDocument,
      transactionId,
      projectWebhook: webhookUrl || `${process.env.APP_URL || 'http://localhost:4000'}/webhook/mistic`,
      description: description || 'Depósito Elite Pay'
    });

    return {
      success: true,
      data: response.data,
      transactionId
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
      transactionId
    };
  }
}

/**
 * Processa saque via PIX
 * @param {object} params
 * @returns {Promise<object>}
 */
async function processWithdraw(params) {
  const {
    amount, // em centavos
    pixKey,
    pixKeyType,
    description
  } = params;

  try {
    const response = await misticClient.post('/api/transactions/withdraw', {
      amount,
      pixKey,
      pixKeyType,
      description: description || 'Saque Elite Pay'
    });

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

/**
 * Consulta status de transação (se API suportar)
 */
async function checkTransactionStatus(apiTransactionId) {
  try {
    const response = await misticClient.get(`/api/transactions/${apiTransactionId}`);
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

module.exports = {
  createPixTransaction,
  processWithdraw,
  checkTransactionStatus,
  misticClient
};