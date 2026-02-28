/* PusatOTP — Auth Handler (Cookie-based) */

const errorEl = document.getElementById('authError');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('show');
}
function hideError() {
    errorEl.classList.remove('show');
}

// Login
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();
        const btn = document.getElementById('btnSubmit');
        btn.disabled = true;
        btn.textContent = 'Memproses...';

        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (data.success) {
                // User info disimpan di localStorage (bukan token!)
                localStorage.setItem('user', JSON.stringify(data.user));
                window.location.href = '/dashboard';
            } else {
                showError(data.message || 'Login gagal');
            }
        } catch (err) {
            showError('Terjadi kesalahan. Coba lagi.');
        }
        btn.disabled = false;
        btn.textContent = 'Masuk';
    });
}

// Register
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        hideError();
        const btn = document.getElementById('btnSubmit');
        btn.disabled = true;
        btn.textContent = 'Memproses...';

        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const password = document.getElementById('password').value;

        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ name, email, password })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('user', JSON.stringify(data.user));
                window.location.href = '/dashboard';
            } else {
                showError(data.message || 'Registrasi gagal');
            }
        } catch (err) {
            showError('Terjadi kesalahan. Coba lagi.');
        }
        btn.disabled = false;
        btn.textContent = 'Daftar Sekarang';
    });
}
