// src/services/taxCalculator.js

/**
 * Elite Pay Tax Calculator
 * 
 * REGRAS:
 * - API MisticPay cobra R$1,00 (100 cents) por operação de depósito
 * - Elite Pay cobra 4% sobre o valor bruto do depósito
 * - Saques: apenas taxa da API (R$1,00)
 * - Todos os cálculos em centavos (integer)
 */

const API_FEE_CENTS = 100; // R$1,00
const ELITEPAY_TAX_RATE = 0.04; // 4%

/**
 * Calcula taxas para depósito
 * @param {number} amountCents - Valor bruto em centavos
 * @returns {object} { taxaMinha, taxaApi, valorLiquido }
 */
function calculateDepositFees(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Amount must be a positive integer (cents)');
  }

  // Taxa Elite Pay: 4% do valor bruto
  const taxaMinhaCents = Math.round(amountCents * ELITEPAY_TAX_RATE);
  
  // Taxa API: fixa de R$1,00
  const taxaApiCents = API_FEE_CENTS;
  
  // Valor líquido ao cliente
  const valorLiquidoCents = amountCents - taxaMinhaCents - taxaApiCents;
  
  if (valorLiquidoCents <= 0) {
    throw new Error('Amount too low - fees exceed deposit value');
  }

  return {
    taxaMinhaCents,
    taxaApiCents,
    valorLiquidoCents,
    totalTaxasCents: taxaMinhaCents + taxaApiCents
  };
}

/**
 * Calcula taxas para saque
 * @param {number} amountCents - Valor do saque em centavos
 * @returns {object} { taxaApi, valorTotal }
 */
function calculateWithdrawFees(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Amount must be a positive integer (cents)');
  }

  // Saque: apenas taxa da API
  const taxaApiCents = API_FEE_CENTS;
  const valorTotalCents = amountCents + taxaApiCents;

  return {
    taxaMinhaCents: 0, // Não cobramos taxa no saque
    taxaApiCents,
    valorTotalCents // Total que será debitado do saldo
  };
}

/**
 * Converte reais para centavos
 */
function realsToCents(reais) {
  return Math.round(reais * 100);
}

/**
 * Converte centavos para reais
 */
function centsToReais(cents) {
  return cents / 100;
}

/**
 * Formata valor em centavos para string BRL
 */
function formatBRL(cents) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(centsToReais(cents));
}

module.exports = {
  calculateDepositFees,
  calculateWithdrawFees,
  realsToCents,
  centsToReais,
  formatBRL,
  API_FEE_CENTS,
  ELITEPAY_TAX_RATE
};