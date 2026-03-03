require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const BCRYPT_ROUNDS = 12;
const TOKEN_EXPIRY = 24 * 60 * 60 * 1000; // 24 jam
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');

// ============================================
// Database (Neon PostgreSQL)
// ============================================
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// Auto-create tabel saat startup
async function initDB() {
    try {
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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS order_history (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                order_id VARCHAR(100) NOT NULL,
                service VARCHAR(100),
                country VARCHAR(100),
                phone VARCHAR(50),
                otp TEXT DEFAULT '-',
                status VARCHAR(20) DEFAULT 'pending',
                server VARCHAR(10) DEFAULT 'v2',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS deposits (
                id SERIAL PRIMARY KEY,
                user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
                amount INTEGER NOT NULL,
                method VARCHAR(50) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'rejected')),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);
        console.log('✅ Database connected & tabel siap (users, order_history, deposits)');
    } catch (err) {
        console.error('❌ Database error:', err.message);
        console.log('⚠️  Fallback ke in-memory mode (data hilang saat restart)');
    }
}

// Helper: cek apakah DB tersedia
function hasDB() {
    return !!process.env.DATABASE_URL;
}

// ============================================
// Security Middleware
// ============================================

// Helmet — security HTTP headers
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

// CORS
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || true,
    credentials: true,
}));

// Body parser dengan limit
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser(SESSION_SECRET));

// Rate limiter global
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { success: false, message: 'Terlalu banyak request. Coba lagi nanti.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', globalLimiter);

// Rate limiter login (anti brute force)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { success: false, message: 'Terlalu banyak percobaan login. Coba lagi 15 menit.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// In-memory fallback (kalau DATABASE_URL tidak ada)
// ============================================
const memUsers = new Map();
const tokens = new Map();

function generateToken() {
    return crypto.randomBytes(48).toString('hex');
}

function createToken(email) {
    const token = generateToken();
    tokens.set(token, { email, createdAt: Date.now() });
    return token;
}

function validateToken(token) {
    if (!token) return null;
    const session = tokens.get(token);
    if (!session) return null;
    if (Date.now() - session.createdAt > TOKEN_EXPIRY) {
        tokens.delete(token);
        return null;
    }
    return session;
}

function setAuthCookie(res, token) {
    res.cookie('auth_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: TOKEN_EXPIRY,
        signed: true,
        path: '/',
    });
}

function clearAuthCookie(res) {
    res.clearCookie('auth_token', { path: '/' });
}

// ============================================
// Database Helpers
// ============================================
async function dbGetUser(email) {
    if (hasDB()) {
        const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        return rows[0] || null;
    }
    return memUsers.get(email) || null;
}

async function dbCreateUser(name, email, hashedPassword, role) {
    if (hasDB()) {
        const { rows } = await pool.query(
            'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, name, email, role, balance, created_at',
            [name, email, hashedPassword, role]
        );
        return rows[0];
    }
    const user = { name, email, password: hashedPassword, role, balance: 0, created: Date.now() };
    memUsers.set(email, user);
    return user;
}

async function dbCountUsers() {
    if (hasDB()) {
        const { rows } = await pool.query('SELECT COUNT(*) FROM users');
        return parseInt(rows[0].count);
    }
    return memUsers.size;
}

// ============================================
// Auth Middleware
// ============================================
async function requireAuth(req, res, next) {
    const token = req.signedCookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
    const session = validateToken(token);
    if (!session) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: 'Sesi tidak valid. Silakan login ulang.' });
        }
        return res.redirect('/login');
    }
    try {
        const user = await dbGetUser(session.email);
        if (!user) {
            if (req.path.startsWith('/api/')) return res.status(401).json({ success: false });
            return res.redirect('/login');
        }
        req.userEmail = session.email;
        req.user = user;
        next();
    } catch (err) {
        console.error('Auth error:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
}

async function requireAdmin(req, res, next) {
    const token = req.signedCookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
    const session = validateToken(token);
    if (!session) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu.' });
        }
        return res.redirect('/login');
    }
    try {
        const user = await dbGetUser(session.email);
        if (!user || user.role !== 'admin') {
            if (req.path.startsWith('/api/')) {
                return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses admin.' });
            }
            return res.redirect('/dashboard');
        }
        req.userEmail = session.email;
        req.user = user;
        req.isAdmin = true;
        next();
    } catch (err) {
        console.error('Admin auth error:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
}

// ============================================
// Input Sanitization
// ============================================
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/[<>"'&]/g, (c) => {
        const map = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '&': '&amp;' };
        return map[c] || c;
    });
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255;
}

// ============================================
// Auth API
// ============================================

// POST /api/auth/register
app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
        const name = sanitize(req.body.name);
        const email = sanitize(req.body.email).toLowerCase();
        const password = req.body.password;

        if (!name || !email || !password) {
            return res.status(400).json({ success: false, message: 'Semua field harus diisi' });
        }
        if (name.length > 100) {
            return res.status(400).json({ success: false, message: 'Nama terlalu panjang' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ success: false, message: 'Format email tidak valid' });
        }
        if (password.length < 6 || password.length > 128) {
            return res.status(400).json({ success: false, message: 'Password harus 6-128 karakter' });
        }

        // Cek email sudah ada
        const existing = await dbGetUser(email);
        if (existing) {
            return res.status(409).json({ success: false, message: 'Email sudah terdaftar' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // User pertama = admin
        const count = await dbCountUsers();
        const role = count === 0 ? 'admin' : 'user';

        const user = await dbCreateUser(name, email, hashedPassword, role);

        const token = createToken(email);
        setAuthCookie(res, token);

        res.json({ success: true, token, user: { name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        console.error('Register error:', err);
        if (err.code === '23505') { // unique violation
            return res.status(409).json({ success: false, message: 'Email sudah terdaftar' });
        }
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
});

// POST /api/auth/login
app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const email = sanitize(req.body.email).toLowerCase();
        const password = req.body.password;

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email dan password harus diisi' });
        }

        const user = await dbGetUser(email);
        if (!user) {
            await bcrypt.hash(password, BCRYPT_ROUNDS);
            return res.status(401).json({ success: false, message: 'Email atau password salah' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: 'Email atau password salah' });
        }

        const token = createToken(email);
        setAuthCookie(res, token);

        res.json({ success: true, token, user: { name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
    }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
    const token = req.signedCookies.auth_token;
    if (token) tokens.delete(token);
    clearAuthCookie(res);
    res.json({ success: true });
});

// GET /api/auth/me
app.get('/api/auth/me', async (req, res) => {
    const token = req.signedCookies.auth_token || req.headers.authorization?.replace('Bearer ', '');
    const session = validateToken(token);
    if (!session) return res.status(401).json({ success: false });
    try {
        const user = await dbGetUser(session.email);
        if (!user) return res.status(401).json({ success: false });
        res.json({ success: true, user: { name: user.name, email: user.email, role: user.role } });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// ============================================
// OTP Provider API Proxy (v1 + v2)
// ============================================
const PROVIDER_KEY = process.env.PROVIDER_API_KEY || '';
const API_V1 = process.env.PROVIDER_V1_URL || 'https://api.jasaotp.id/v1';
const API_V2 = process.env.PROVIDER_V2_URL || 'https://api.jasaotp.id/v2';

function getApiBase(server) {
    return server === 'v1' ? API_V1 : API_V2;
}

async function providerRequest(endpoint, params = {}, server = 'v2') {
    if (!PROVIDER_KEY) {
        return { success: false, error: 'API key belum diset. Set PROVIDER_API_KEY di .env' };
    }
    const base = getApiBase(server);
    const qp = new URLSearchParams({ api_key: PROVIDER_KEY, ...params });
    const url = `${base}/${endpoint}?${qp.toString()}`;
    try {
        const response = await fetch(url);
        const text = await response.text();
        try { return JSON.parse(text); }
        catch { return { success: true, raw: text }; }
    } catch (error) {
        console.error(`Provider API error [${endpoint}]:`, error.message);
        return { success: false, error: error.message };
    }
}

// GET /api/balance — cek saldo
app.get('/api/balance', requireAuth, async (req, res) => {
    const server = req.query.server || 'v2';
    const result = await providerRequest('balance.php', {}, server);
    res.json(result);
});

// GET /api/countries — daftar negara
app.get('/api/countries', requireAuth, async (req, res) => {
    const server = req.query.server || 'v2';
    const result = await providerRequest('negara.php', {}, server);
    res.json(result);
});

// GET /api/operators — daftar operator per negara
app.get('/api/operators', requireAuth, async (req, res) => {
    const negara = req.query.negara;
    const server = req.query.server || 'v2';
    if (!negara) return res.status(400).json({ success: false, message: 'Parameter negara diperlukan' });
    const result = await providerRequest('operator.php', { negara }, server);
    res.json(result);
});

// GET /api/services — daftar layanan per negara
app.get('/api/services', requireAuth, async (req, res) => {
    const negara = req.query.negara;
    const server = req.query.server || 'v2';
    if (!negara) return res.status(400).json({ success: false, message: 'Parameter negara diperlukan' });
    const params = { negara };
    if (req.query.operator) params.operator = req.query.operator;
    const result = await providerRequest('layanan.php', params, server);
    res.json(result);
});

// POST /api/order — beli nomor
app.post('/api/order', requireAuth, async (req, res) => {
    const { negara, layanan, operator, server } = req.body;
    if (!negara || !layanan) {
        return res.status(400).json({ success: false, message: 'Negara dan layanan harus diisi' });
    }
    const params = { negara, layanan };
    if (operator) params.operator = operator;
    const result = await providerRequest('order.php', params, server || 'v2');
    res.json(result);
});

// GET /api/order/:id — cek OTP (sms)
app.get('/api/order/:id', requireAuth, async (req, res) => {
    const id = req.params.id;
    const server = req.query.server || 'v2';
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).json({ success: false, message: 'ID tidak valid' });
    }
    const result = await providerRequest('sms.php', { id }, server);
    res.json(result);
});

// GET /api/order/:id/stream — SSE stream untuk OTP
app.get('/api/order/:id/stream', requireAuth, (req, res) => {
    const id = req.params.id;
    const server = req.query.server || 'v2';
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).json({ success: false, message: 'ID tidak valid' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.flushHeaders();

    let closed = false;
    let lastSms = null;
    const startTime = Date.now();
    const MAX_DURATION = 20 * 60 * 1000; // 20 menit

    // Kirim heartbeat awal
    res.write(': connected\n\n');

    const interval = setInterval(async () => {
        if (closed) { clearInterval(interval); return; }

        // Timeout 20 menit
        if (Date.now() - startTime > MAX_DURATION) {
            res.write(`event: timeout\ndata: ${JSON.stringify({ message: 'Waktu habis' })}\n\n`);
            clearInterval(interval);
            res.end();
            return;
        }

        try {
            const result = await providerRequest('sms.php', { id }, server);

            // Cek status gagal
            const status = result.status || result.data?.status;
            if (status === 'failed' || status === 'cancelled' || status === 'expired' || status === '3') {
                res.write(`event: failed\ndata: ${JSON.stringify({ status: 'failed' })}\n\n`);
                clearInterval(interval);
                res.end();
                return;
            }

            // Extract SMS dari berbagai field
            let smsRaw = null;
            const candidates = [
                result.sms, result.code, result.otp,
                result.data?.sms, result.data?.code, result.data?.otp,
                result.message,
            ];
            for (const c of candidates) {
                if (c && typeof c === 'string' && c.trim().length > 0) {
                    smsRaw = c.trim();
                    break;
                }
            }

            // Masih menunggu
            if (!smsRaw || /^(menunggu|waiting|pending|Menunggu sms|Waiting for sms)/i.test(smsRaw)) {
                // Kirim heartbeat agar koneksi tidak timeout
                res.write(': heartbeat\n\n');
                return;
            }

            // SMS baru diterima
            if (smsRaw !== lastSms) {
                lastSms = smsRaw;
                res.write(`event: otp\ndata: ${JSON.stringify({ sms: smsRaw })}\n\n`);
            }
        } catch (e) {
            console.error('SSE poll error:', e.message);
            res.write(': error\n\n');
        }
    }, 3000);

    // Cleanup saat client disconnect
    req.on('close', () => {
        closed = true;
        clearInterval(interval);
    });
});

// POST /api/order/:id/cancel — cancel order
app.post('/api/order/:id/cancel', requireAuth, async (req, res) => {
    const id = req.params.id;
    const server = req.body.server || 'v2';
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).json({ success: false, message: 'ID tidak valid' });
    }
    const result = await providerRequest('cancel.php', { id }, server);
    res.json(result);
});

// ============================================
// Order History API (Neon DB)
// ============================================

// GET /api/orders — ambil riwayat order user
app.get('/api/orders', requireAuth, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true, orders: [] });
        const { rows } = await pool.query(
            'SELECT order_id, service, country, phone, otp, status, server, created_at, updated_at FROM order_history WHERE user_email = $1 ORDER BY created_at DESC LIMIT 100',
            [req.userEmail]
        );
        const orders = rows.map(r => ({
            id: r.order_id,
            service: r.service,
            country: r.country,
            number: r.phone,
            otp: r.otp || '-',
            status: r.status,
            server: r.server,
            time: new Date(r.created_at).toLocaleString('id-ID'),
        }));
        res.json({ success: true, orders });
    } catch (err) {
        console.error('Get orders error:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat riwayat' });
    }
});

// POST /api/orders — simpan order baru
app.post('/api/orders', requireAuth, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true });
        const { order_id, service, country, phone, status, server } = req.body;
        if (!order_id) return res.status(400).json({ success: false, message: 'order_id diperlukan' });
        await pool.query(
            'INSERT INTO order_history (user_email, order_id, service, country, phone, status, server) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [req.userEmail, order_id, service || '', country || '', phone || '', status || 'pending', server || 'v2']
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Save order error:', err);
        res.status(500).json({ success: false, message: 'Gagal menyimpan order' });
    }
});

// PUT /api/orders/:orderId — update status order
app.put('/api/orders/:orderId', requireAuth, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true });
        const { orderId } = req.params;
        const { status, otp } = req.body;
        if (!status) return res.status(400).json({ success: false, message: 'status diperlukan' });
        await pool.query(
            'UPDATE order_history SET status = $1, otp = COALESCE($2, otp), updated_at = NOW() WHERE order_id = $3 AND user_email = $4',
            [status, otp || null, orderId, req.userEmail]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Update order error:', err);
        res.status(500).json({ success: false, message: 'Gagal update order' });
    }
});

// ============================================
// Deposit API (Neon DB)
// ============================================

// GET /api/deposits — ambil riwayat deposit user
app.get('/api/deposits', requireAuth, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true, deposits: [] });
        const { rows } = await pool.query(
            'SELECT id, amount, method, status, created_at FROM deposits WHERE user_email = $1 ORDER BY created_at DESC LIMIT 100',
            [req.userEmail]
        );
        const deposits = rows.map(r => ({
            id: r.id,
            amount: r.amount,
            method: r.method,
            status: r.status,
            date: new Date(r.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
        }));
        res.json({ success: true, deposits });
    } catch (err) {
        console.error('Get deposits error:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat riwayat deposit' });
    }
});

// POST /api/deposits — buat deposit baru
app.post('/api/deposits', requireAuth, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true });
        const { amount, method } = req.body;
        if (!amount || !method) return res.status(400).json({ success: false, message: 'amount dan method diperlukan' });
        if (amount < 5000) return res.status(400).json({ success: false, message: 'Minimal deposit Rp 5.000' });
        const { rows } = await pool.query(
            'INSERT INTO deposits (user_email, amount, method) VALUES ($1, $2, $3) RETURNING id, amount, method, status, created_at',
            [req.userEmail, parseInt(amount), sanitize(method)]
        );
        res.json({ success: true, deposit: rows[0] });
    } catch (err) {
        console.error('Create deposit error:', err);
        res.status(500).json({ success: false, message: 'Gagal membuat deposit' });
    }
});

// ============================================
// Admin API (Neon DB)
// ============================================

// GET /api/admin/stats — overview statistik
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true, stats: {} });
        const [usersR, ordersR, successR, depositsR] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM order_history'),
            pool.query("SELECT COUNT(*) FROM order_history WHERE status = 'success'"),
            pool.query("SELECT COALESCE(SUM(amount), 0) as total FROM deposits WHERE status = 'success'"),
        ]);
        const totalOrders = parseInt(ordersR.rows[0].count);
        const successOrders = parseInt(successR.rows[0].count);
        res.json({
            success: true,
            stats: {
                totalUsers: parseInt(usersR.rows[0].count),
                totalOrders,
                totalRevenue: parseInt(depositsR.rows[0].total),
                successRate: totalOrders > 0 ? Math.round((successOrders / totalOrders) * 100) : 0,
            },
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat statistik' });
    }
});

// GET /api/admin/users — list semua user
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true, users: [] });
        const { rows } = await pool.query(`
            SELECT u.id, u.name, u.email, u.balance, u.role, u.created_at,
                   COUNT(oh.id) as order_count
            FROM users u
            LEFT JOIN order_history oh ON u.email = oh.user_email
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `);
        const users = rows.map(r => ({
            id: r.id,
            name: r.name,
            email: r.email,
            balance: r.balance,
            role: r.role,
            orders: parseInt(r.order_count),
            joined: new Date(r.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
        }));
        res.json({ success: true, users });
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat data user' });
    }
});

// GET /api/admin/orders — list semua order
app.get('/api/admin/orders', requireAdmin, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true, orders: [] });
        const { rows } = await pool.query(`
            SELECT oh.id, oh.order_id, oh.service, oh.country, oh.phone, oh.otp, oh.status, oh.server, oh.created_at,
                   u.name as user_name, u.email as user_email
            FROM order_history oh
            JOIN users u ON oh.user_email = u.email
            ORDER BY oh.created_at DESC
            LIMIT 200
        `);
        const orders = rows.map(r => ({
            id: r.id,
            orderId: r.order_id,
            user: r.user_name,
            email: r.user_email,
            service: r.service,
            country: r.country,
            phone: r.phone,
            otp: r.otp || '-',
            status: r.status,
            server: r.server,
            time: new Date(r.created_at).toLocaleString('id-ID'),
        }));
        res.json({ success: true, orders });
    } catch (err) {
        console.error('Admin orders error:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat data order' });
    }
});

// GET /api/admin/deposits — list semua deposit
app.get('/api/admin/deposits', requireAdmin, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true, deposits: [] });
        const { rows } = await pool.query(`
            SELECT d.id, d.amount, d.method, d.status, d.created_at,
                   u.name as user_name, u.email as user_email
            FROM deposits d
            JOIN users u ON d.user_email = u.email
            ORDER BY d.created_at DESC
            LIMIT 200
        `);
        const deposits = rows.map(r => ({
            id: r.id,
            user: r.user_name,
            email: r.user_email,
            amount: r.amount,
            method: r.method,
            status: r.status,
            time: new Date(r.created_at).toLocaleString('id-ID'),
        }));
        res.json({ success: true, deposits });
    } catch (err) {
        console.error('Admin deposits error:', err);
        res.status(500).json({ success: false, message: 'Gagal memuat data deposit' });
    }
});

// PUT /api/admin/deposits/:id — approve/reject deposit
app.put('/api/admin/deposits/:id', requireAdmin, async (req, res) => {
    try {
        if (!hasDB()) return res.json({ success: true });
        const { id } = req.params;
        const { status } = req.body;
        if (!status || !['success', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Status harus success atau rejected' });
        }

        // Ambil deposit info
        const { rows: depRows } = await pool.query('SELECT * FROM deposits WHERE id = $1', [id]);
        if (depRows.length === 0) return res.status(404).json({ success: false, message: 'Deposit tidak ditemukan' });
        const deposit = depRows[0];

        // Jangan proses ulang deposit yang sudah selesai
        if (deposit.status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Deposit sudah diproses' });
        }

        // Update status deposit
        await pool.query('UPDATE deposits SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);

        // Jika approve, tambah saldo user
        if (status === 'success') {
            await pool.query('UPDATE users SET balance = balance + $1 WHERE email = $2', [deposit.amount, deposit.user_email]);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Admin deposit update error:', err);
        res.status(500).json({ success: false, message: 'Gagal update deposit' });
    }
});

// ============================================
// Page Routes
// ============================================
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/ketua', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Fallback
app.get('/{*path}', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================
// Error handler
// ============================================
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server' });
});

// ============================================
// Start
// ============================================
async function start() {
    if (hasDB()) {
        await initDB();
    } else {
        console.log('⚠️  DATABASE_URL tidak diset — pakai in-memory (data hilang saat restart)');
        console.log('   Set DATABASE_URL di .env untuk pakai Neon PostgreSQL');
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 PusatOTP berjalan di http://0.0.0.0:${PORT}`);
        console.log(`🔒 Security: helmet, rate-limit, bcrypt, httpOnly cookies`);
        console.log(`👑 User pertama yang register otomatis jadi admin`);
    });
}

start().catch(err => {
    console.error('Startup error:', err);
    process.exit(1);
});
