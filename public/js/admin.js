/* PusatOTP — Admin Panel Logic (DB-backed) */

// Server-side auth check (cookie). Jika belum login/bukan admin, server redirect.

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

// ---- State ----
let allUsers = [];
let allOrders = [];
let allDeposits = [];

// ---- Navigation ----
const links = document.querySelectorAll('.sb-link');
const panels = { overview: 'panelOverview', users: 'panelUsers', orders: 'panelOrders', deposits: 'panelDeposits', services: 'panelServices' };
const titles = { overview: 'Overview', users: 'Manajemen User', orders: 'Semua Order', deposits: 'Deposit Masuk', services: 'Kelola Layanan' };

function switchSection(s) {
  Object.values(panels).forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById(panels[s]).classList.remove('hidden');
  links.forEach(l => l.classList.toggle('active', l.dataset.section === s));
  document.getElementById('pageTitle').textContent = titles[s];
  document.getElementById('sidebar').classList.remove('open');
}
links.forEach(l => l.addEventListener('click', e => { e.preventDefault(); switchSection(l.dataset.section); }));
document.getElementById('sidebarToggle').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

// ---- Logout ----
document.getElementById('adminLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  localStorage.removeItem('user');
  window.location.href = '/login';
});

// ---- Modal ----
const overlay = document.getElementById('modalOverlay');
function openModal(title, bodyHTML) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  overlay.classList.add('show');
}
function closeModal() { overlay.classList.remove('show'); }
document.getElementById('modalClose').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

// ---- Load Data from API ----
async function loadStats() {
  const data = await api('/api/admin/stats');
  if (data.success && data.stats) {
    const s = data.stats;
    document.getElementById('statUsers').textContent = s.totalUsers || 0;
    document.getElementById('statOrders').textContent = Number(s.totalOrders || 0).toLocaleString('id-ID');
    document.getElementById('statRevenue').textContent = s.totalRevenue > 1000000
      ? `Rp ${(s.totalRevenue / 1000000).toFixed(1)} jt`
      : rp(s.totalRevenue || 0);
    document.getElementById('statSuccess').textContent = s.successRate ? `${s.successRate}%` : '0%';
  }
}

async function loadUsers() {
  const data = await api('/api/admin/users');
  if (data.success && Array.isArray(data.users)) {
    allUsers = data.users;
    renderUsers();
    renderOverviewUsers();
  }
}

async function loadOrders() {
  const data = await api('/api/admin/orders');
  if (data.success && Array.isArray(data.orders)) {
    allOrders = data.orders;
    renderOrders();
    renderOverviewOrders();
  }
}

async function loadDeposits() {
  const data = await api('/api/admin/deposits');
  if (data.success && Array.isArray(data.deposits)) {
    allDeposits = data.deposits;
    renderDeposits();
  }
}

// ---- Render Overview ----
function renderOverviewOrders() {
  const tbody = document.getElementById('recentAdminOrders');
  const list = allOrders.slice(0, 5);
  if (list.length === 0) {
    tbody.innerHTML = '<tr class="tbl-empty"><td colspan="5">Belum ada order</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(o => `
    <tr>
      <td>${o.user || '-'}</td>
      <td><strong>${o.service || '-'}</strong></td>
      <td><span class="status-badge status-${o.status === 'success' ? 'success' : o.status === 'pending' ? 'pending' : 'failed'}">${o.status === 'success' ? 'Sukses' : o.status === 'pending' ? 'Pending' : 'Gagal'}</span></td>
      <td>${o.server || '-'}</td>
      <td style="color:var(--text-3);font-size:.78rem">${o.time || '-'}</td>
    </tr>
  `).join('');
}

function renderOverviewUsers() {
  const ubody = document.getElementById('recentAdminUsers');
  const list = allUsers.slice(0, 5);
  if (list.length === 0) {
    ubody.innerHTML = '<tr class="tbl-empty"><td colspan="4">Belum ada user</td></tr>';
    return;
  }
  ubody.innerHTML = list.map(u => `
    <tr>
      <td><strong>${u.name}</strong></td>
      <td style="color:var(--text-3)">${u.email}</td>
      <td>${rp(u.balance)}</td>
      <td style="color:var(--text-3);font-size:.78rem">${u.joined}</td>
    </tr>
  `).join('');
}

// ---- Render Users ----
function renderUsers(filter = '') {
  const list = filter ? allUsers.filter(u => u.name.toLowerCase().includes(filter) || u.email.toLowerCase().includes(filter)) : allUsers;
  const tbody = document.getElementById('usersTable');
  if (list.length === 0) {
    tbody.innerHTML = '<tr class="tbl-empty"><td colspan="7">Tidak ada user</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(u => `
    <tr>
      <td>${u.id}</td>
      <td><strong>${u.name}</strong></td>
      <td style="color:var(--text-3)">${u.email}</td>
      <td>${rp(u.balance)}</td>
      <td>${u.orders}</td>
      <td><span class="status-badge status-success">${u.role === 'admin' ? 'Admin' : 'User'}</span></td>
      <td style="color:var(--text-3);font-size:.78rem">${u.joined}</td>
    </tr>
  `).join('');
}
document.getElementById('searchUser').addEventListener('input', e => renderUsers(e.target.value.toLowerCase()));

// ---- Render Orders ----
function renderOrders(statusFilter = 'all') {
  const list = statusFilter === 'all' ? allOrders : allOrders.filter(o => o.status === statusFilter);
  const tbody = document.getElementById('ordersTable');
  if (list.length === 0) {
    tbody.innerHTML = '<tr class="tbl-empty"><td colspan="9">Tidak ada order</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(o => `
    <tr>
      <td>#${o.orderId || o.id}</td>
      <td>${o.user || '-'}</td>
      <td><strong>${o.service || '-'}</strong></td>
      <td>${o.country || '-'}</td>
      <td style="font-family:monospace;font-size:.78rem">${o.phone || '-'}</td>
      <td style="font-family:monospace">${o.otp || '-'}</td>
      <td>${o.server || '-'}</td>
      <td><span class="status-badge status-${o.status === 'success' ? 'success' : o.status === 'pending' ? 'pending' : 'failed'}">${o.status === 'success' ? 'Sukses' : o.status === 'pending' ? 'Pending' : 'Gagal'}</span></td>
      <td style="color:var(--text-3);font-size:.78rem">${o.time || '-'}</td>
    </tr>
  `).join('');
}
document.getElementById('filterOrderStatus').addEventListener('change', e => renderOrders(e.target.value));

// ---- Render Deposits ----
function renderDeposits(statusFilter = 'all') {
  const list = statusFilter === 'all' ? allDeposits : allDeposits.filter(d => d.status === statusFilter);
  const tbody = document.getElementById('depositsTable');
  if (list.length === 0) {
    tbody.innerHTML = '<tr class="tbl-empty"><td colspan="7">Tidak ada deposit</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(d => `
    <tr>
      <td>#${d.id}</td>
      <td>${d.user || '-'}</td>
      <td><strong>${rp(d.amount)}</strong></td>
      <td>${d.method || '-'}</td>
      <td><span class="status-badge ${d.status === 'success' ? 'status-success' : d.status === 'pending' ? 'status-pending' : 'status-failed'}">${d.status === 'success' ? 'Berhasil' : d.status === 'pending' ? 'Menunggu' : 'Ditolak'}</span></td>
      <td style="color:var(--text-3);font-size:.78rem">${d.time || '-'}</td>
      <td>
        ${d.status === 'pending' ? `
          <button class="btn-sm btn-approve" onclick="approveDeposit(${d.id})">✓ Terima</button>
          <button class="btn-sm btn-reject" onclick="rejectDeposit(${d.id})">✗ Tolak</button>
        ` : '-'}
      </td>
    </tr>
  `).join('');
}
document.getElementById('filterDepositStatus').addEventListener('change', e => renderDeposits(e.target.value));

window.approveDeposit = async function (id) {
  if (!confirm('Yakin terima deposit ini? Saldo user akan bertambah.')) return;
  const result = await api(`/api/admin/deposits/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'success' }),
  });
  if (result.success) {
    await loadDeposits();
    await loadStats();
    await loadUsers();
  } else {
    alert(result.message || 'Gagal update deposit');
  }
};

window.rejectDeposit = async function (id) {
  if (!confirm('Yakin tolak deposit ini?')) return;
  const result = await api(`/api/admin/deposits/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ status: 'rejected' }),
  });
  if (result.success) {
    await loadDeposits();
    await loadStats();
  } else {
    alert(result.message || 'Gagal update deposit');
  }
};

// ---- Render Services (still from provider API) ----
function renderServices() {
  document.getElementById('servicesTable').innerHTML = `
    <tr class="tbl-empty">
      <td colspan="6">Layanan dikelola oleh provider API. Lihat daftar layanan di halaman Order dashboard.</td>
    </tr>
  `;
}

// ---- Init ----
async function init() {
  await Promise.all([loadStats(), loadUsers(), loadOrders(), loadDeposits()]);
  renderServices();
}
init();
