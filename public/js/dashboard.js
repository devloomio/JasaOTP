/* JasaOTP — Dashboard Logic (Provider API v1+v2) */
/* Flow: Server → Negara → Layanan/Konfirmasi → OTP */

// Notification sound (Web Audio API)
function playNotifSound() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        [880, 1174.66].forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.15);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.15 + 0.4);
            osc.connect(gain).connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.15);
            osc.stop(ctx.currentTime + i * 0.15 + 0.4);
        });
    } catch (e) { }
}

// Browser Notification (works in background tab)
if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
}
function notifyOTP(code) {
    try {
        if ('Notification' in window && Notification.permission === 'granted') {
            const n = new Notification('📱 OTP Diterima!', {
                body: `Kode: ${code}`,
                icon: '/favicon.ico',
                tag: 'otp-received',
                requireInteraction: true,
            });
            n.onclick = () => { window.focus(); n.close(); };
        }
    } catch (e) { }
}

// ============================================
// Toast Notification
// ============================================
let toastTimer = null;
function showToast(message, type = 'info', duration = 3500) {
    // Remove existing toast
    const old = document.getElementById('toastOverlay');
    if (old) { old.remove(); clearTimeout(toastTimer); }

    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const titles = { success: 'Berhasil!', error: 'Gagal!', info: 'Info' };

    const overlay = document.createElement('div');
    overlay.id = 'toastOverlay';
    overlay.className = 'toast-overlay';
    overlay.innerHTML = `
        <div class="toast-box toast-${type}">
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <div class="toast-title">${titles[type] || titles.info}</div>
            <div class="toast-msg">${message}</div>
            <button class="toast-btn" id="toastDismiss">OK</button>
            <div class="toast-progress" style="animation-duration:${duration}ms"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Animate in
    requestAnimationFrame(() => overlay.classList.add('show'));

    function dismiss() {
        clearTimeout(toastTimer);
        overlay.classList.remove('show');
        setTimeout(() => overlay.remove(), 350);
    }

    overlay.querySelector('#toastDismiss').addEventListener('click', dismiss);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
    toastTimer = setTimeout(dismiss, duration);
}

// ============================================
// Auth Check
// ============================================
let user = JSON.parse(localStorage.getItem('user') || 'null');

(async () => {
    try {
        const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
        const data = await res.json();
        if (!data.success) { window.location.href = '/login'; return; }
        user = data.user;
        localStorage.setItem('user', JSON.stringify(user));
        applyUser();
        await loadBalance();
    } catch (e) { window.location.href = '/login'; }
})();

function applyUser() {
    document.getElementById('userName').textContent = user?.name || 'User';
    document.getElementById('userEmail').textContent = user?.email || '';
    document.getElementById('userAvatar').textContent = (user?.name || 'U').charAt(0).toUpperCase();
}
if (user) applyUser();

// ============================================
// State
// ============================================
let balance = 0;
let orders = [];
let deposits = JSON.parse(localStorage.getItem('jasaotp_deposits') || '[]');
let currentServer = 'v2';      // 'v1' or 'v2'
let currentServerLabel = '';    // '🐯 Harimau' etc
let countriesData = [];
let allServices = [];
let selectedCountry = null;
let selectedService = null;
let activeOrder = null;
let otpPollTimer = null;
let countdownTimer = null;      // global 20-min countdown interval
let cancelDelayTimer = null;    // global 3-min cancel delay interval

// Save/load orders from Neon DB
async function loadOrdersFromDB() {
    try {
        const data = await api('/api/orders');
        if (data.success && Array.isArray(data.orders)) {
            orders = data.orders;
        }
    } catch (e) { console.error('Load orders error:', e); }
    updateStats();
    renderOrders('recentOrders', false);
    renderOrders('historyOrders', true);
}

async function saveOrderToDB(order) {
    try {
        await api('/api/orders', {
            method: 'POST',
            body: JSON.stringify({
                order_id: order.id,
                service: order.service,
                country: order.country,
                phone: order.number,
                status: order.status || 'pending',
                server: currentServer,
            }),
        });
    } catch (e) { console.error('Save order error:', e); }
}

async function updateOrderInDB(orderId, status, otp) {
    try {
        await api(`/api/orders/${orderId}`, {
            method: 'PUT',
            body: JSON.stringify({ status, otp }),
        });
    } catch (e) { console.error('Update order error:', e); }
}

function saveDeposits() {
    try { localStorage.setItem('jasaotp_deposits', JSON.stringify(deposits.slice(0, 100))); } catch (e) { }
}

function rp(n) { return 'Rp ' + Number(n).toLocaleString('id-ID'); }

async function api(endpoint, options = {}) {
    try {
        const res = await fetch(endpoint, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        return await res.json();
    } catch (e) { return { success: false, error: e.message }; }
}

// ============================================
// Balance
// ============================================
async function loadBalance() {
    const data = await api('/api/balance?server=v2');
    if (data?.data?.saldo !== undefined) balance = parseFloat(data.data.saldo) || 0;
    else if (data?.saldo !== undefined) balance = parseFloat(data.saldo) || 0;
    updateBalance();
}
function updateBalance() {
    document.getElementById('balanceDisplay').textContent = rp(balance);
    document.getElementById('statSaldo').textContent = rp(balance);
}

// ============================================
// Navigation
// ============================================
const links = document.querySelectorAll('.sb-link');
const panels = { beranda: 'panelBeranda', beli: 'panelBeli', riwayat: 'panelRiwayat', deposit: 'panelDeposit' };
const titles = { beranda: 'Beranda', beli: 'Beli Nomor', riwayat: 'Riwayat', deposit: 'Deposit' };

function switchSection(section) {
    Object.values(panels).forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById(panels[section]).classList.remove('hidden');
    links.forEach(l => l.classList.toggle('active', l.dataset.section === section));
    document.getElementById('pageTitle').textContent = titles[section];
    document.getElementById('sidebar').classList.remove('open');
}
links.forEach(link => link.addEventListener('click', (e) => { e.preventDefault(); switchSection(link.dataset.section); }));
document.getElementById('sidebarToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('logoutBtn').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
    localStorage.removeItem('user');
    window.location.href = '/login';
});

// ============================================
// Step Wizard
// ============================================
function setStep(n) {
    ['buyStep1', 'buyStep2', 'buyStep3'].forEach((id, i) => {
        document.getElementById(id).classList.toggle('hidden', i !== n - 1);
    });
    document.getElementById('step1indicator').className = n >= 1 ? (n > 1 ? 'step done' : 'step active') : 'step';
    document.getElementById('step2indicator').className = n >= 2 ? (n > 2 ? 'step done' : 'step active') : 'step';
    document.getElementById('step3indicator').className = n >= 3 ? 'step active' : 'step';
}

// ============================================
// Step 1: Pilih Server
// ============================================
document.querySelectorAll('#serverPickCards .server-card').forEach(card => {
    card.addEventListener('click', () => {
        currentServer = card.dataset.server;
        currentServerLabel = card.querySelector('.srv-title').textContent;
        document.getElementById('selectedServerBadge').textContent = currentServerLabel;
        setStep(2);
        loadCountries();
    });
});

// ============================================
// Step 2: Pilih Negara
// ============================================
async function loadCountries() {
    const grid = document.getElementById('countryGrid');
    grid.innerHTML = '<div class="loading-spinner">Memuat negara...</div>';

    const data = await api(`/api/countries?server=${currentServer}`);
    let list = [];
    if (data?.data && Array.isArray(data.data)) list = data.data;
    else if (Array.isArray(data)) list = data;

    if (list.length === 0) {
        list = [
            { id_negara: 0, nama_negara: 'rusia' },
            { id_negara: 6, nama_negara: 'indonesia' },
            { id_negara: 4, nama_negara: 'filipina' },
        ];
    }

    countriesData = list.map(c => ({
        id: c.id_negara ?? c.id ?? c.code,
        name: c.nama_negara || c.name || c.code || '',
    }));

    renderCountries(countriesData);
}

function renderCountries(list) {
    const grid = document.getElementById('countryGrid');
    if (list.length === 0) {
        grid.innerHTML = '<div class="loading-spinner">Negara tidak ditemukan</div>';
        return;
    }
    grid.innerHTML = list.map(c => `
        <div class="country-card" data-id="${c.id}" data-name="${c.name}">
            <span class="country-name">${c.name}</span>
        </div>
    `).join('');

    grid.querySelectorAll('.country-card').forEach(card => {
        card.addEventListener('click', () => {
            selectedCountry = { id: card.dataset.id, name: card.dataset.name };
            document.getElementById('confirmServerBadge').textContent = currentServerLabel;
            document.getElementById('confirmCountryBadge').textContent = selectedCountry.name;
            setStep(3);
            loadServices();
        });
    });
}

document.getElementById('searchCountry').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderCountries(countriesData.filter(c => c.name.toLowerCase().includes(q)));
});

// ============================================
// Step 3: Pilih Layanan
// ============================================
async function loadServices() {
    const grid = document.getElementById('serviceGrid');
    grid.innerHTML = '<div class="loading-spinner">Memuat layanan...</div>';
    document.getElementById('confirmDetails').style.display = 'none';
    document.getElementById('btnBuy').disabled = true;
    selectedService = null;

    const data = await api(`/api/services?negara=${selectedCountry.id}&operator=any&server=${currentServer}`);

    let items = [];
    if (data && typeof data === 'object') {
        let dataObj = data.data || data;
        // API nests inside country ID: { "6": { "tg": {...} } } — unwrap
        const vals = Object.values(dataObj);
        if (vals.length === 1 && typeof vals[0] === 'object' && vals[0] !== null && !Array.isArray(vals[0])) {
            dataObj = vals[0];
        }
        for (const [code, svc] of Object.entries(dataObj)) {
            if (typeof svc === 'object' && svc !== null && svc.harga !== undefined) {
                items.push({ code, layanan: svc.layanan || code, harga: Number(svc.harga), stok: svc.stok || 0 });
            }
        }
    }

    allServices = items.filter(s => s.stok > 0).sort((a, b) => (a.layanan || '').localeCompare(b.layanan || ''));
    renderServices(allServices);
}

function renderServices(list) {
    const grid = document.getElementById('serviceGrid');
    if (list.length === 0) {
        grid.innerHTML = '<div class="loading-spinner">Layanan tidak tersedia</div>';
        return;
    }
    grid.innerHTML = list.map(s => `
        <div class="service-card" data-code="${s.code}" data-name="${s.layanan || s.code}" data-price="${s.harga}">
            <span class="svc-name">${s.layanan || s.code}</span>
            <div class="svc-meta">
                <span class="svc-price">${rp(s.harga)}</span>
            </div>
        </div>
    `).join('');

    grid.querySelectorAll('.service-card').forEach(card => {
        card.addEventListener('click', () => {
            // Deselect previous
            grid.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');

            selectedService = { code: card.dataset.code, name: card.dataset.name, price: parseInt(card.dataset.price) };

            // Show confirm
            document.getElementById('confirmService').textContent = selectedService.name;
            document.getElementById('confirmCountry').textContent = selectedCountry.name;
            document.getElementById('confirmServer').textContent = currentServerLabel;
            document.getElementById('confirmPrice').textContent = rp(selectedService.price);
            document.getElementById('confirmDetails').style.display = '';
            document.getElementById('btnBuy').disabled = false;
        });
    });
}

document.getElementById('searchService').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    renderServices(allServices.filter(s => (s.layanan || s.code || '').toLowerCase().includes(q)));
});

// ============================================
// Step Navigation
// ============================================
document.getElementById('backToStep1').addEventListener('click', () => setStep(1));
document.getElementById('backToStep2').addEventListener('click', () => {
    setStep(2);
    document.getElementById('searchCountry').value = '';
});
document.getElementById('btnNewOrder')?.addEventListener('click', () => {
    stopOTPPolling();
    stopCountdownTimers();
    document.getElementById('confirmCard').classList.remove('hidden');
    document.getElementById('otpResult').classList.add('hidden');
    setStep(1);
});

// Cancel order
document.getElementById('btnCancelOrder')?.addEventListener('click', async () => {
    if (!activeOrder?.id) return;
    const btn = document.getElementById('btnCancelOrder');
    btn.disabled = true;
    btn.textContent = '⏳ Membatalkan...';
    try {
        await api(`/api/order/${activeOrder.id}/cancel`, {
            method: 'POST',
            body: JSON.stringify({ server: currentServer }),
        });
        stopOTPPolling();
        stopCountdownTimers();
        document.getElementById('otpStatus').textContent = 'Dibatalkan';
        document.getElementById('otpStatus').style.background = '#fef2f2';
        document.getElementById('otpStatus').style.color = '#dc2626';
        document.querySelector('.otp-pulse').classList.add('success');
        document.querySelector('.otp-pulse').style.background = '#dc2626';
        document.querySelector('.otp-result-header h3').textContent = '❌ Order Dibatalkan';
        // Update existing pending order instead of adding duplicate
        const cancelIdx = orders.findIndex(o => o.id === activeOrder.id);
        if (cancelIdx !== -1) {
            orders[cancelIdx].status = 'failed';
            orders[cancelIdx].otp = '-';
            orders[cancelIdx].time = new Date().toLocaleString('id-ID');
        }
        updateOrderInDB(activeOrder.id, 'failed', '-');
        updateStats(); renderOrders('recentOrders', false); renderOrders('historyOrders', true);
        await loadBalance();
    } catch (e) {
        showToast('Gagal membatalkan: ' + e.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = '✕ Batalkan Order';
});

// ============================================
// Order (Buy)
// ============================================
document.getElementById('btnBuy').addEventListener('click', async () => {
    if (!selectedService || !selectedCountry) return;
    const btn = document.getElementById('btnBuy');
    btn.disabled = true;
    btn.textContent = '⏳ Memproses...';

    try {
        const result = await api('/api/order', {
            method: 'POST',
            body: JSON.stringify({
                negara: selectedCountry.id,
                layanan: selectedService.code,
                operator: 'any',
                server: currentServer,
            }),
        });

        if (result.success === false || result.error) {
            showToast(result.error || result.message || 'Gagal membeli nomor.', 'error');
            btn.disabled = false;
            btn.textContent = '🛒 Beli Nomor';
            return;
        }

        const orderId = result.order_id || result.id || result.data?.order_id || result.data?.id;
        const phone = result.number || result.phone || result.nomor || result.data?.number || '';

        activeOrder = { id: orderId, number: phone, service: selectedService.name, country: selectedCountry.name };

        // Immediately save order as pending so it appears in history
        const newOrder = { id: orderId, service: selectedService.name, country: selectedCountry.name, number: phone, otp: '-', status: 'pending', time: new Date().toLocaleString('id-ID') };
        orders.unshift(newOrder);
        saveOrderToDB(newOrder);
        updateStats(); renderOrders('recentOrders', false); renderOrders('historyOrders', true);

        // Show OTP panel
        document.getElementById('confirmCard').classList.add('hidden');
        document.getElementById('otpResult').classList.remove('hidden');
        document.getElementById('otpNumber').textContent = phone || 'Memuat...';
        document.getElementById('otpService').textContent = selectedService.name;
        document.getElementById('otpStatus').textContent = 'Menunggu...';
        document.getElementById('otpStatus').style.background = '#fffbeb';
        document.getElementById('otpStatus').style.color = '#d97706';

        const digits = document.getElementById('otpCode');
        digits.classList.remove('received');
        digits.innerHTML = '<span>-</span><span>-</span><span>-</span><span>-</span><span>-</span><span>-</span>';

        document.querySelector('.otp-pulse').classList.remove('success');
        document.querySelector('.otp-pulse').style.background = '';
        document.querySelector('.otp-result-header h3').textContent = '📱 Menunggu OTP';

        if (orderId) startOTPPolling(orderId);

        // Clear any previous timers before starting new ones
        stopCountdownTimers();

        // Disable cancel for 3 minutes (timestamp-based to survive tab switch)
        const cancelBtn = document.getElementById('btnCancelOrder');
        cancelBtn.disabled = true;
        const cancelEndTime = Date.now() + 180 * 1000;
        function updateCancelBtn() {
            const left = Math.max(0, Math.ceil((cancelEndTime - Date.now()) / 1000));
            if (left <= 0) {
                clearInterval(cancelDelayTimer);
                cancelDelayTimer = null;
                cancelBtn.disabled = false;
                cancelBtn.textContent = '✕ Batalkan Order';
            } else {
                cancelBtn.textContent = `✕ Batal (${Math.floor(left / 60)}:${(left % 60).toString().padStart(2, '0')})`;
            }
        }
        updateCancelBtn();
        cancelDelayTimer = setInterval(updateCancelBtn, 1000);

        // Timer 20 min (timestamp-based to survive tab switch)
        const timerEndTime = Date.now() + 1200 * 1000;
        const timerEl = document.getElementById('otpTimer');
        function updateMainTimer() {
            const left = Math.max(0, Math.ceil((timerEndTime - Date.now()) / 1000));
            const m = Math.floor(left / 60).toString().padStart(2, '0');
            const s = (left % 60).toString().padStart(2, '0');
            timerEl.textContent = `${m}:${s}`;
            if (left <= 0) { clearInterval(countdownTimer); countdownTimer = null; stopOTPPolling(); }
        }
        updateMainTimer();
        countdownTimer = setInterval(updateMainTimer, 1000);

        await loadBalance();
    } catch (e) {
        showToast('Terjadi kesalahan: ' + e.message, 'error');
    }

    btn.disabled = false;
    btn.textContent = '🛒 Beli Nomor';
});

// Copy phone number (strip country code: +6281xxx → 81xxx)
document.getElementById('btnCopyNum')?.addEventListener('click', () => {
    const raw = document.getElementById('otpNumber').textContent || '';
    let cleaned = raw;
    if (cleaned.startsWith('+62')) cleaned = cleaned.slice(3);
    else if (cleaned.startsWith('+7')) cleaned = cleaned.slice(2);
    else if (cleaned.startsWith('+1')) cleaned = cleaned.slice(2);
    else cleaned = cleaned.replace(/^\+\d{1,2}/, '');
    if (!cleaned || cleaned === '-') return;
    navigator.clipboard.writeText(cleaned).then(() => {
        const btn = document.getElementById('btnCopyNum');
        btn.textContent = '✅';
        setTimeout(() => btn.textContent = '📋', 2000);
    });
});

// Copy OTP
document.getElementById('btnCopy').addEventListener('click', () => {
    const container = document.getElementById('otpCode');
    const fullText = container.querySelector('.otp-full-text');
    let code;
    if (fullText) {
        code = fullText.textContent;
    } else {
        code = Array.from(container.querySelectorAll('span')).map(s => s.textContent).join('');
    }
    if (!code || code === '------') return;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('btnCopy');
        btn.textContent = '✅ Tersalin!';
        setTimeout(() => btn.textContent = '📋 Salin Kode', 2000);
    });
});

// ============================================
// OTP Polling
// ============================================
let lastReceivedSms = null; // track last SMS to detect new codes
let otpReceivedTimeout = null; // 5-min timer after first code received

function startOTPPolling(orderId) {
    stopOTPPolling();
    lastReceivedSms = null;

    otpPollTimer = setInterval(async () => {
        try {
            const result = await api(`/api/order/${orderId}?server=${currentServer}`);

            // Check if status is failed/cancelled/expired first
            const status = result.status || result.data?.status;
            if (status === 'failed' || status === 'cancelled' || status === 'expired' || status === '3') {
                document.getElementById('otpStatus').textContent = 'Gagal';
                document.getElementById('otpStatus').style.background = '#fef2f2';
                document.getElementById('otpStatus').style.color = '#dc2626';
                const failIdx = orders.findIndex(o => o.id === orderId);
                if (failIdx !== -1) {
                    orders[failIdx].status = 'failed';
                    orders[failIdx].time = new Date().toLocaleString('id-ID');
                }
                updateOrderInDB(orderId, 'failed');
                updateStats(); renderOrders('recentOrders', false); renderOrders('historyOrders', true);
                stopOTPPolling();
                stopCountdownTimers();
                return;
            }

            // Extract raw SMS/OTP from API response (check multiple fields)
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

            // If SMS is still "waiting" / "menunggu" / empty → keep polling
            if (!smsRaw || /^(menunggu|waiting|pending|Menunggu sms|Waiting for sms)/i.test(smsRaw)) {
                return;
            }

            // If same SMS as before → skip (no new code)
            if (smsRaw === lastReceivedSms) return;

            // New SMS received! Update display with latest code
            lastReceivedSms = smsRaw;

            const digits = document.getElementById('otpCode');
            digits.classList.add('received');

            if (/^\d{3,8}$/.test(smsRaw)) {
                digits.innerHTML = smsRaw.split('').map(d => `<span>${d}</span>`).join('');
            } else {
                digits.innerHTML = `<span class="otp-full-text">${smsRaw}</span>`;
            }

            document.getElementById('otpStatus').textContent = 'Diterima ✓';
            document.getElementById('otpStatus').style.background = '#ecfdf5';
            document.getElementById('otpStatus').style.color = '#059669';
            document.querySelector('.otp-pulse').classList.add('success');
            document.querySelector('.otp-result-header h3').textContent = '📱 OTP Diterima!';

            playNotifSound();
            notifyOTP(smsRaw);

            // Update order with latest code
            const successIdx = orders.findIndex(o => o.id === orderId);
            if (successIdx !== -1) {
                orders[successIdx].otp = smsRaw;
                orders[successIdx].status = 'success';
                orders[successIdx].time = new Date().toLocaleString('id-ID');
            }
            updateOrderInDB(orderId, 'success', smsRaw);
            updateStats(); renderOrders('recentOrders', false); renderOrders('historyOrders', true);

            // Start 5-min timer on first code received, then stop polling
            if (!otpReceivedTimeout) {
                otpReceivedTimeout = setTimeout(() => {
                    stopOTPPolling();
                }, 5 * 60 * 1000); // 5 minutes
            }

        } catch (e) { console.error('Poll error:', e); }
    }, 3000);
}
function stopOTPPolling() {
    if (otpPollTimer) { clearInterval(otpPollTimer); otpPollTimer = null; }
    if (otpReceivedTimeout) { clearTimeout(otpReceivedTimeout); otpReceivedTimeout = null; }
}
function stopCountdownTimers() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (cancelDelayTimer) { clearInterval(cancelDelayTimer); cancelDelayTimer = null; }
}

// ============================================
// Stats & Render
// ============================================
function updateStats() {
    document.getElementById('statOrder').textContent = orders.length;
    document.getElementById('statSukses').textContent = orders.filter(o => o.status === 'success').length;
}

function renderOrders(targetId, showAll) {
    const tbody = document.getElementById(targetId);
    const list = showAll ? orders : orders.slice(0, 5);
    if (list.length === 0) {
        tbody.innerHTML = `<tr class="tbl-empty"><td colspan="${showAll ? 7 : 5}">Belum ada order</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(o => `
    <tr>
      ${showAll ? `<td>${o.id || '-'}</td>` : ''}
      <td><strong>${o.service || '-'}</strong></td>
      <td>${o.country || '-'}</td>
      <td style="font-family:monospace;font-size:0.78rem">${o.number || '-'}</td>
      ${showAll ? `<td style="font-family:monospace">${o.otp || '-'}</td>` : ''}
      <td><span class="status-badge status-${o.status === 'success' ? 'success' : o.status === 'pending' ? 'pending' : 'failed'}">${o.status === 'success' ? 'Sukses' : o.status === 'pending' ? 'Menunggu' : 'Gagal'}</span></td>
      <td style="color:var(--text-3);font-size:0.78rem">${o.time || '-'}</td>
    </tr>`).join('');
}

function renderDeposits() {
    const tbody = document.getElementById('depositHistory');
    if (deposits.length === 0) { tbody.innerHTML = '<tr class="tbl-empty"><td colspan="4">Belum ada riwayat deposit</td></tr>'; return; }
    tbody.innerHTML = deposits.map(d => `<tr><td>${d.date}</td><td><strong>${d.amount}</strong></td><td>${d.method}</td><td><span class="status-badge status-${d.status}">${d.status === 'success' ? 'Berhasil' : 'Pending'}</span></td></tr>`).join('');
}

// ============================================
// Deposit
// ============================================
const depositAmount = document.getElementById('depositAmount');
const btnDeposit = document.getElementById('btnDeposit');
depositAmount.addEventListener('change', () => { btnDeposit.disabled = !depositAmount.value; });
btnDeposit.addEventListener('click', () => {
    const amount = parseInt(depositAmount.value);
    if (!amount) return;
    balance += amount;
    updateBalance();
    deposits.unshift({
        date: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
        amount: rp(amount),
        method: document.querySelector('input[name="payment"]:checked').value.toUpperCase(),
        status: 'success'
    });
    saveDeposits();
    renderDeposits();
    depositAmount.value = '';
    btnDeposit.disabled = true;
    showToast('Deposit berhasil ditambahkan!', 'success');
});

// ============================================
// Init
// ============================================
updateBalance();
updateStats();
renderOrders('recentOrders', false);
renderOrders('historyOrders', true);
renderDeposits();
loadOrdersFromDB();
