const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../config/database');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
console.log('🔑 JWT_SECRET:', JWT_SECRET ? 'Configurado ✅' : 'NÃO CONFIGURADO ❌');

// Validation schemas
const registerSchema = Joi.object({
  nome: Joi.string().min(3).max(100).required(),
  cpf: Joi.string().pattern(/^\d{3}\.\d{3}\.\d{3}-\d{2}$/).required(),
  telefone: Joi.string().pattern(/^\(\d{2}\) \d{4,5}-\d{4}$/).required(),
  email: Joi.string().email().required(),
  senha: Joi.string().min(6).required(),
  termsAccepted: Joi.boolean().valid(true).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  senha: Joi.string().required()
});

// Register endpoint
router.post('/register', async (req, res, next) => {
  try {
    const { error, value } = registerSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { nome, cpf, telefone, email, senha } = value;

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ? OR cpf = ?').get(email, cpf);
    if (existingUser) {
      return res.status(409).json({ error: 'Email ou CPF já cadastrado' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const userId = uuidv4();

    db.prepare(`
      INSERT INTO users (id, nome, cpf, telefone, email, senha_hash, saldo_cents)
      VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(userId, nome, cpf, telefone, email, senhaHash);

    db.prepare(`
      INSERT INTO audit_logs (user_id, action, payload, ip_address)
      VALUES (?, 'USER_REGISTERED', ?, ?)
    `).run(userId, JSON.stringify({ email, nome }), req.ip);

    const token = jwt.sign({ userId, email, role: 'user' }, JWT_SECRET, { expiresIn: '7d' });

    res.status(201).json({
      message: 'Usuário criado com sucesso',
      token,
      user: { id: userId, nome, email, cpf, telefone }
    });
  } catch (error) {
    next(error);
  }
});

// Login endpoint
router.post('/login', async (req, res, next) => {
  try {
    const { error, value } = loginSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, senha } = value;

    const user = db.prepare(`
      SELECT id, nome, email, cpf, telefone, senha_hash, saldo_cents, role
      FROM users WHERE email = ?
    `).get(email);

    if (!user) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }

    const passwordMatch = await bcrypt.compare(senha, user.senha_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Email ou senha inválidos' });
    }

    db.prepare(`
      INSERT INTO audit_logs (user_id, action, payload, ip_address)
      VALUES (?, 'USER_LOGIN', ?, ?)
    `).run(user.id, JSON.stringify({ email }), req.ip);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Login realizado com sucesso',
      token,
      user: {
        id: user.id,
        nome: user.nome,
        email: user.email,
        cpf: user.cpf,
        telefone: user.telefone,
        saldoCents: user.saldo_cents,
        role: user.role
      }
    });
  } catch (error) {
    next(error);
  }
});

// Middleware de autenticação
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido ou expirado' });
    }
    req.user = user;
    next();
  });
}

// Get user profile
router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare(`
    SELECT id, nome, email, cpf, telefone, saldo_cents, role, criado_em
    FROM users WHERE id = ?
  `).get(req.user.userId);

  if (!user) {
    return res.status(404).json({ error: 'Usuário não encontrado' });
  }

  res.json({
    id: user.id,
    nome: user.nome,
    email: user.email,
    cpf: user.cpf,
    telefone: user.telefone,
    saldoCents: user.saldo_cents,
    role: user.role,
    criadoEm: user.criado_em
  });
});

module.exports = router;
module.exports.authenticateToken = authenticateToken;