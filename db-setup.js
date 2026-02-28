// Setup database schema untuk JasaOTP
// Jalankan: node db-setup.js

require('dotenv').config();
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL belum diset di .env');
    console.log('');
    console.log('Cara setup:');
    console.log('1. Buat project di https://neon.tech');
    console.log('2. Copy connection string');
    console.log('3. Tambahkan ke .env:');
    console.log('   DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require');
    process.exit(1);
}

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
});

async function setup() {
    console.log('🔄 Membuat tabel...');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
            balance INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `);
    console.log('✅ Tabel users dibuat');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS order_history (
            id SERIAL PRIMARY KEY,
            user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
            order_id VARCHAR(100) NOT NULL,
            service VARCHAR(100),
            country VARCHAR(100),
            phone VARCHAR(50),
            otp VARCHAR(20) DEFAULT '-',
            status VARCHAR(20) DEFAULT 'pending',
            server VARCHAR(10) DEFAULT 'v2',
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
    `);
    console.log('✅ Tabel order_history dibuat');

    // Cek apakah sudah ada admin
    const { rows } = await pool.query("SELECT COUNT(*) FROM users WHERE role = 'admin'");
    if (parseInt(rows[0].count) === 0) {
        console.log('ℹ️  Belum ada admin. User pertama yang register akan otomatis jadi admin.');
    } else {
        console.log(`✅ Sudah ada ${rows[0].count} admin`);
    }

    await pool.end();
    console.log('');
    console.log('🎉 Database siap!');
    console.log('Jalankan: node server.js');
}

setup().catch(err => {
    console.error('❌ Error:', err.message);
    process.exit(1);
});
