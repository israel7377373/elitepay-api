const { initializeDatabase, db } = require('./database');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

async function runMigrations() {
  console.log('🔄 Running database migrations...');

  try {
    // Inicializar schema
    initializeDatabase();

    // Criar usuário admin padrão
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

    // Criar usuário de teste
    const testEmail = 'teste@elitepay.com';
    const existingTest = db.prepare('SELECT id FROM users WHERE email = ?').get(testEmail);

    if (!existingTest) {
      const testId = uuidv4();
      const testPasswordHash = await bcrypt.hash('teste123', 10);

      db.prepare(`
        INSERT INTO users (id, nome, cpf, telefone, email, senha_hash, saldo_cents)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        testId,
        'Usuário Teste',
        '123.456.789-00',
        '(11) 98765-4321',
        testEmail,
        testPasswordHash,
        50000 // R$ 500,00
      );

      console.log('✅ Test user created');
      console.log(`   Email: ${testEmail}`);
      console.log(`   Password: teste123`);
    }

    console.log('✅ Migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  runMigrations().then(() => process.exit(0));
}

module.exports = { runMigrations };