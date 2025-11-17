-- models.sql
-- Elite Pay Database Schema

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    cpf TEXT NOT NULL UNIQUE,
    telefone TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    senha_hash TEXT NOT NULL,
    saldo_cents INTEGER DEFAULT 0,
    role TEXT DEFAULT 'user',
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tipo TEXT NOT NULL CHECK(tipo IN ('deposito', 'saque')),
    valor_bruto_cents INTEGER NOT NULL,
    valor_liquido_cents INTEGER NOT NULL,
    taxa_minha_cents INTEGER DEFAULT 0,
    taxa_api_cents INTEGER DEFAULT 100,
    api_transaction_id TEXT,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente', 'aprovado', 'cancelado', 'recusado')),
    chave_pix TEXT,
    tipo_chave_pix TEXT,
    descricao TEXT,
    qrcode_url TEXT,
    copy_paste TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Central balance table (for platform fees)
CREATE TABLE IF NOT EXISTS central_balance (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    total_taxas_cents INTEGER DEFAULT 0,
    total_saques_cents INTEGER DEFAULT 0,
    total_depositos_cents INTEGER DEFAULT 0,
    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    payload TEXT,
    ip_address TEXT,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API Credentials table
CREATE TABLE IF NOT EXISTS api_credentials (
    user_id TEXT PRIMARY KEY,
    client_id TEXT UNIQUE NOT NULL,
    client_secret TEXT NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    atualizado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- API Allowed IPs table
CREATE TABLE IF NOT EXISTS api_allowed_ips (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, ip_address),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_tipo ON transactions(tipo);
CREATE INDEX IF NOT EXISTS idx_transactions_api_id ON transactions(api_transaction_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_cpf ON users(cpf);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_credentials_client_id ON api_credentials(client_id);
CREATE INDEX IF NOT EXISTS idx_api_allowed_ips_user ON api_allowed_ips(user_id);
CREATE INDEX IF NOT EXISTS idx_api_allowed_ips_ip ON api_allowed_ips(ip_address);

-- Initialize central balance
INSERT OR IGNORE INTO central_balance (id, total_taxas_cents) VALUES (1, 0);