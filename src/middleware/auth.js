// ==========================================
// src/middleware/auth.js
// ==========================================
const jwt = require(‘jsonwebtoken’);

const JWT_SECRET = process.env.JWT_SECRET;

function authenticateToken(req, res, next) {
const authHeader = req.headers[‘authorization’];
const token = authHeader && authHeader.split(’ ’)[1];

if (!token) {
return res.status(401).json({ error: ‘Token não fornecido’ });
}

jwt.verify(token, JWT_SECRET, (err, user) => {
if (err) {
return res.status(403).json({ error: ‘Token inválido ou expirado’ });
}
req.user = user;
next();
});
}

function requireAdmin(req, res, next) {
if (req.user.role !== ‘admin’) {
return res.status(403).json({ error: ‘Acesso negado - apenas administradores’ });
}
next();
}

module.exports = { authenticateToken, requireAdmin };

// ==========================================
// src/middleware/validation.js
// ==========================================
const Joi = require(‘joi’);

const schemas = {
register: Joi.object({
nome: Joi.string().min(3).max(100).required(),
cpf: Joi.string().pattern(/^\d{3}.\d{3}.\d{3}-\d{2}$/).required()
.messages({
‘string.pattern.base’: ‘CPF deve estar no formato: 123.456.789-00’
}),
telefone: Joi.string().pattern(/^(\d{2}) \d{4,5}-\d{4}$/).required()
.messages({
‘string.pattern.base’: ‘Telefone deve estar no formato: (11) 98765-4321’
}),
email: Joi.string().email().required(),
senha: Joi.string().min(6).required(),
termsAccepted: Joi.boolean().valid(true).required()
.messages({
‘any.only’: ‘Você deve aceitar os termos de uso’
})
}),

login: Joi.object({
email: Joi.string().email().required(),
senha: Joi.string().required()
}),

createDeposit: Joi.object({
amountCents: Joi.number().integer().min(300).required()
.messages({
‘number.min’: ‘Valor mínimo: R$ 3,00’
}),
payerName: Joi.string().min(3).required(),
payerDocument: Joi.string().required(),
description: Joi.string().max(200).optional()
}),

withdraw: Joi.object({
amountCents: Joi.number().integer().min(1000).required()
.messages({
‘number.min’: ‘Valor mínimo para saque: R$ 10,00’
}),
pixKey: Joi.string().required(),
pixKeyType: Joi.string().valid(‘CPF’, ‘EMAIL’, ‘TELEFONE’, ‘CHAVE_ALEATORIA’).required(),
description: Joi.string().max(200).optional()
})
};

function validate(schemaName) {
return (req, res, next) => {
const schema = schemas[schemaName];
if (!schema) {
return res.status(500).json({ error: ‘Schema de validação não encontrado’ });
}

```
const { error, value } = schema.validate(req.body, { abortEarly: false });

if (error) {
  const errors = error.details.map(detail => ({
    field: detail.path.join('.'),
    message: detail.message
  }));
  return res.status(400).json({ errors });
}

req.validatedBody = value;
next();
```

};
}

module.exports = { validate, schemas };

// ==========================================
// src/middleware/errorHandler.js
// ==========================================
const logger = require(’../config/logger’);

function errorHandler(err, req, res, next) {
// Log do erro
logger.error({
message: err.message,
stack: err.stack,
path: req.path,
method: req.method,
ip: req.ip,
userId: req.user?.userId
});

// Erros conhecidos
if (err.name === ‘ValidationError’) {
return res.status(400).json({
error: ‘Erro de validação’,
details: err.details
});
}

if (err.name === ‘UnauthorizedError’) {
return res.status(401).json({
error: ‘Não autorizado’,
message: err.message
});
}

if (err.code === ‘SQLITE_CONSTRAINT’) {
return res.status(409).json({
error: ‘Conflito de dados’,
message: ‘Registro já existe ou viola restrição de integridade’
});
}

// Erro genérico
const statusCode = err.statusCode || 500;
const message = process.env.NODE_ENV === ‘production’
? ‘Erro interno do servidor’
: err.message;

res.status(statusCode).json({
error: message,
…(process.env.NODE_ENV === ‘development’ && { stack: err.stack })
});
}

function notFoundHandler(req, res) {
res.status(404).json({
error: ‘Endpoint não encontrado’,
path: req.path,
method: req.method
});
}

module.exports = { errorHandler, notFoundHandler };

// ==========================================
// src/config/logger.js
// ==========================================
const winston = require(‘winston’);
const path = require(‘path’);

const logFormat = winston.format.combine(
winston.format.timestamp({ format: ‘YYYY-MM-DD HH:mm:ss’ }),
winston.format.errors({ stack: true }),
winston.format.splat(),
winston.format.json()
);

const logger = winston.createLogger({
level: process.env.LOG_LEVEL || ‘info’,
format: logFormat,
defaultMeta: { service: ‘elitepay-api’ },
transports: [
// Arquivo de erros
new winston.transports.File({
filename: path.join(__dirname, ‘../../logs/error.log’),
level: ‘error’,
maxsize: 5242880, // 5MB
maxFiles: 5
}),
// Arquivo geral
new winston.transports.File({
filename: path.join(__dirname, ‘../../logs/combined.log’),
maxsize: 5242880,
maxFiles: 5
})
]
});

// Em desenvolvimento, também logar no console
if (process.env.NODE_ENV !== ‘production’) {
logger.add(new winston.transports.Console({
format: winston.format.combine(
winston.format.colorize(),
winston.format.simple()
)
}));
}

module.exports = logger;

// ==========================================
// src/config/migrate.js
// ==========================================
const { initializeDatabase } = require(’./database’);
const { db } = require(’./database’);
const bcrypt = require(‘bcrypt’);
const { v4: uuidv4 } = require(‘uuid’);

async function runMigrations() {
console.log(‘🔄 Running database migrations…’);

try {
// Inicializar schema
initializeDatabase();

```
// Criar usuário admin padrão (se não existir)
const adminEmail = process.env.ADMIN_EMAIL || 'admin@elitepay.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';

const existingAdmin = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);

if (!existingAdmin) {
  const adminId = uuidv4();
  const passwordHash = await bcrypt.hash(adminPassword, 12);

  db.prepare(`
    INSERT INTO users (id, nome, cpf, telefone, email, senha_hash, role, saldo_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    adminId,
    'Administrador',
    '000.000.000-00',
    '(00) 00000-0000',
    adminEmail,
    passwordHash,
    'admin',
    0
  );

  console.log('✅ Admin user created');
  console.log(`   Email: ${adminEmail}`);
  console.log(`   Password: ${adminPassword}`);
  console.log('   ⚠️  CHANGE PASSWORD IN PRODUCTION!');
} else {
  console.log('✅ Admin user already exists');
}

// Verificar tabelas criadas
const tables = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table'
`).all();

console.log('✅ Database tables:', tables.map(t => t.name).join(', '));

console.log('✅ Migrations completed successfully');
```

} catch (error) {
console.error(‘❌ Migration failed:’, error);
process.exit(1);
}
}

// Executar se chamado diretamente
if (require.main === module) {
runMigrations().then(() => process.exit(0));
}

module.exports = { runMigrations };

// ==========================================
// src/config/seed.js
// ==========================================
const { db } = require(’./database’);
const bcrypt = require(‘bcrypt’);
const { v4: uuidv4 } = require(‘uuid’);

async function seedDatabase() {
console.log(‘🌱 Seeding database with test data…’);

try {
// Criar usuário de teste
const testUserId = uuidv4();
const testPassword = await bcrypt.hash(‘teste123’, 10);

```
db.prepare(`
  INSERT OR IGNORE INTO users (id, nome, cpf, telefone, email, senha_hash, saldo_cents)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
  testUserId,
  'Usuário Teste',
  '123.456.789-00',
  '(11) 98765-4321',
  'teste@elitepay.com',
  testPassword,
  50000 // R$ 500,00
);

// Criar transações de exemplo
const transactions = [
  {
    id: uuidv4(),
    tipo: 'deposito',
    valorBruto: 10000,
    valorLiquido: 9500,
    taxaMinha: 400,
    taxaApi: 100,
    status: 'aprovado',
    descricao: 'Depósito de teste 1'
  },
  {
    id: uuidv4(),
    tipo: 'deposito',
    valorBruto: 5000,
    valorLiquido: 4700,
    taxaMinha: 200,
    taxaApi: 100,
    status: 'aprovado',
    descricao: 'Depósito de teste 2'
  },
  {
    id: uuidv4(),
    tipo: 'saque',
    valorBruto: 3000,
    valorLiquido: 3000,
    taxaMinha: 0,
    taxaApi: 100,
    status: 'aprovado',
    descricao: 'Saque de teste',
    chavePix: 'teste@elitepay.com',
    tipoChavePix: 'EMAIL'
  },
  {
    id: uuidv4(),
    tipo: 'deposito',
    valorBruto: 15000,
    valorLiquido: 14400,
    taxaMinha: 600,
    taxaApi: 100,
    status: 'pendente',
    descricao: 'Depósito pendente'
  }
];

const insertTx = db.prepare(`
  INSERT OR IGNORE INTO transactions (
    id, user_id, tipo, valor_bruto_cents, valor_liquido_cents,
    taxa_minha_cents, taxa_api_cents, status, descricao, chave_pix, tipo_chave_pix
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

transactions.forEach(tx => {
  insertTx.run(
    tx.id,
    testUserId,
    tx.tipo,
    tx.valorBruto,
    tx.valorLiquido,
    tx.taxaMinha,
    tx.taxaApi,
    tx.status,
    tx.descricao,
    tx.chavePix || null,
    tx.tipoChavePix || null
  );
});

console.log('✅ Test data seeded successfully');
console.log('   Test user: teste@elitepay.com');
console.log('   Password: teste123');
console.log('   Balance: R$ 500,00');
```

} catch (error) {
console.error(‘❌ Seed failed:’, error);
process.exit(1);
}
}

// Executar se chamado diretamente
if (require.main === module) {
seedDatabase().then(() => process.exit(0));
}

module.exports = { seedDatabase };