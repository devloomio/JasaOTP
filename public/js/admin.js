/* JasaOTP — Admin Panel Logic */

// Server-side auth check (cookie). Jika belum login, server redirect ke /admin/login.

// Mock data
const mockUsers = [
  { id: 1, name: 'Andi Pratama', email: 'andi@gmail.com', balance: 45000, orders: 23, status: 'active', joined: '20 Feb 2024' },
  { id: 2, name: 'Sari Dewi', email: 'sari@gmail.com', balance: 12000, orders: 8, status: 'active', joined: '22 Feb 2024' },
  { id: 3, name: 'Budi Santoso', email: 'budi@yahoo.com', balance: 0, orders: 45, status: 'active', joined: '15 Jan 2024' },
  { id: 4, name: 'Maya Putri', email: 'maya@gmail.com', balance: 78000, orders: 12, status: 'banned', joined: '10 Feb 2024' },
  { id: 5, name: 'Rizki Aditya', email: 'rizki@gmail.com', balance: 5000, orders: 3, status: 'active', joined: '25 Feb 2024' },
  { id: 6, name: 'Dina Lestari', email: 'dina@gmail.com', balance: 22000, orders: 17, status: 'active', joined: '18 Feb 2024' },
  { id: 7, name: 'Test User', email: 'test@email.com', balance: 25000, orders: 4, status: 'active', joined: '27 Feb 2024' },
];

const mockOrders = [
  { id: 5012, user: 'Andi Pratama', service: 'WhatsApp', country: '🇮🇩 ID', number: '+62 812-XXXX-4521', otp: '394817', price: 1500, status: 'success', time: '2 menit lalu' },
  { id: 5011, user: 'Sari Dewi', service: 'Telegram', country: '🇮🇩 ID', number: '+62 857-XXXX-9283', otp: '182736', price: 1200, status: 'success', time: '5 menit lalu' },
  { id: 5010, user: 'Budi Santoso', service: 'Instagram', country: '🇮🇳 IN', number: '+91 98XXX-XX172', otp: '-', price: 500, status: 'failed', time: '12 menit lalu' },
  { id: 5009, user: 'Andi Pratama', service: 'Facebook', country: '🇮🇩 ID', number: '+62 878-XXXX-1234', otp: '847291', price: 2000, status: 'success', time: '20 menit lalu' },
  { id: 5008, user: 'Maya Putri', service: 'TikTok', country: '🇲🇾 MY', number: '+60 12-XXXX-5678', otp: '293847', price: 1800, status: 'success', time: '35 menit lalu' },
  { id: 5007, user: 'Rizki Aditya', service: 'Google', country: '🇺🇸 US', number: '+1 555-XXX-9012', otp: '-', price: 3500, status: 'pending', time: '1 jam lalu' },
  { id: 5006, user: 'Dina Lestari', service: 'WhatsApp', country: '🇮🇩 ID', number: '+62 813-XXXX-7890', otp: '159263', price: 1500, status: 'success', time: '2 jam lalu' },
];

const mockDeposits = [
  { id: 301, user: 'Andi Pratama', amount: 50000, method: 'QRIS', status: 'pending', time: '3 menit lalu' },
  { id: 300, user: 'Sari Dewi', amount: 25000, method: 'Transfer BCA', status: 'pending', time: '15 menit lalu' },
  { id: 299, user: 'Budi Santoso', amount: 100000, method: 'QRIS', status: 'success', time: '1 jam lalu' },
  { id: 298, user: 'Dina Lestari', amount: 10000, method: 'GoPay', status: 'success', time: '2 jam lalu' },
  { id: 297, user: 'Maya Putri', amount: 25000, method: 'Transfer BNI', status: 'rejected', time: '3 jam lalu' },
];

const mockServices = [
  { name: 'WhatsApp', country: '🇮🇩 Indonesia', price: 1500, stock: 245, active: true },
  { name: 'Telegram', country: '🇮🇩 Indonesia', price: 1200, stock: 312, active: true },
  { name: 'Facebook', country: '🇮🇩 Indonesia', price: 2000, stock: 178, active: true },
  { name: 'Instagram', country: '🇮🇳 India', price: 500, stock: 520, active: true },
  { name: 'TikTok', country: '🇲🇾 Malaysia', price: 1800, stock: 89, active: true },
  { name: 'Google', country: '🇺🇸 Amerika', price: 3500, stock: 42, active: true },
  { name: 'Twitter', country: '🇮🇩 Indonesia', price: 2500, stock: 0, active: false },
  { name: 'Shopee', country: '🇮🇩 Indonesia', price: 1000, stock: 156, active: true },
];

function rp(n) { return 'Rp ' + n.toLocaleString('id-ID'); }

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

// ---- Logout (pakai auth user biasa) ----
document.getElementById('adminLogout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  localStorage.removeItem('user');
  window.location.href = '/login';
});

// ---- Modal ----
const overlay = document.getElementById('modalOverlay');
const modal = document.getElementById('modal');
function openModal(title, bodyHTML) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').innerHTML = bodyHTML;
  overlay.classList.add('show');
}
function closeModal() { overlay.classList.remove('show'); }
document.getElementById('modalClose').addEventListener('click', closeModal);
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

// ---- Render Overview ----
function renderOverview() {
  const tbody = document.getElementById('recentAdminOrders');
  tbody.innerHTML = mockOrders.slice(0, 5).map(o => `
    <tr>
      <td>${o.user}</td>
      <td><strong>${o.service}</strong></td>
      <td>${rp(o.price)}</td>
      <td><span class="status-badge status-${o.status}">${o.status === 'success' ? 'Sukses' : o.status === 'pending' ? 'Pending' : 'Gagal'}</span></td>
      <td style="color:var(--text-3);font-size:.78rem">${o.time}</td>
    </tr>
  `).join('');

  const ubody = document.getElementById('recentAdminUsers');
  ubody.innerHTML = mockUsers.slice(0, 5).map(u => `
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
  const list = filter ? mockUsers.filter(u => u.name.toLowerCase().includes(filter) || u.email.toLowerCase().includes(filter)) : mockUsers;
  document.getElementById('usersTable').innerHTML = list.map(u => `
    <tr>
      <td>${u.id}</td>
      <td><strong>${u.name}</strong></td>
      <td style="color:var(--text-3)">${u.email}</td>
      <td>${rp(u.balance)}</td>
      <td>${u.orders}</td>
      <td><span class="status-badge ${u.status === 'active' ? 'status-success' : 'status-failed'}">${u.status === 'active' ? 'Aktif' : 'Banned'}</span></td>
      <td>
        <button class="btn-sm btn-edit" onclick="editUser(${u.id})">Edit</button>
        ${u.status === 'active'
      ? `<button class="btn-sm btn-ban" onclick="toggleBan(${u.id})">Ban</button>`
      : `<button class="btn-sm btn-unban" onclick="toggleBan(${u.id})">Unban</button>`
    }
      </td>
    </tr>
  `).join('');
}
document.getElementById('searchUser').addEventListener('input', e => renderUsers(e.target.value.toLowerCase()));

window.editUser = function (id) {
  const u = mockUsers.find(x => x.id === id);
  if (!u) return;
  openModal('Edit User', `
    <div class="form-group"><label>Nama</label><input id="mName" value="${u.name}"></div>
    <div class="form-group"><label>Email</label><input id="mEmail" value="${u.email}"></div>
    <div class="form-group"><label>Saldo</label><input id="mBalance" type="number" value="${u.balance}"></div>
    <button class="btn-modal" onclick="saveUser(${u.id})">Simpan</button>
  `);
};

window.saveUser = function (id) {
  const u = mockUsers.find(x => x.id === id);
  if (!u) return;
  u.name = document.getElementById('mName').value;
  u.email = document.getElementById('mEmail').value;
  u.balance = parseInt(document.getElementById('mBalance').value) || 0;
  renderUsers();
  renderOverview();
  closeModal();
};

window.toggleBan = function (id) {
  const u = mockUsers.find(x => x.id === id);
  if (!u) return;
  u.status = u.status === 'active' ? 'banned' : 'active';
  renderUsers();
};

// ---- Render Orders ----
function renderOrders(statusFilter = 'all') {
  const list = statusFilter === 'all' ? mockOrders : mockOrders.filter(o => o.status === statusFilter);
  document.getElementById('ordersTable').innerHTML = list.map(o => `
    <tr>
      <td>#${o.id}</td>
      <td>${o.user}</td>
      <td><strong>${o.service}</strong></td>
      <td>${o.country}</td>
      <td style="font-family:monospace;font-size:.78rem">${o.number}</td>
      <td style="font-family:monospace">${o.otp}</td>
      <td>${rp(o.price)}</td>
      <td><span class="status-badge status-${o.status}">${o.status === 'success' ? 'Sukses' : o.status === 'pending' ? 'Pending' : 'Gagal'}</span></td>
      <td style="color:var(--text-3);font-size:.78rem">${o.time}</td>
    </tr>
  `).join('');
}
document.getElementById('filterOrderStatus').addEventListener('change', e => renderOrders(e.target.value));

// ---- Render Deposits ----
function renderDeposits(statusFilter = 'all') {
  const list = statusFilter === 'all' ? mockDeposits : mockDeposits.filter(d => d.status === statusFilter);
  document.getElementById('depositsTable').innerHTML = list.map(d => `
    <tr>
      <td>#${d.id}</td>
      <td>${d.user}</td>
      <td><strong>${rp(d.amount)}</strong></td>
      <td>${d.method}</td>
      <td><span class="status-badge ${d.status === 'success' ? 'status-success' : d.status === 'pending' ? 'status-pending' : 'status-failed'}">${d.status === 'success' ? 'Berhasil' : d.status === 'pending' ? 'Menunggu' : 'Ditolak'}</span></td>
      <td style="color:var(--text-3);font-size:.78rem">${d.time}</td>
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

window.approveDeposit = function (id) {
  const d = mockDeposits.find(x => x.id === id);
  if (d) { d.status = 'success'; renderDeposits(); }
};
window.rejectDeposit = function (id) {
  const d = mockDeposits.find(x => x.id === id);
  if (d) { d.status = 'rejected'; renderDeposits(); }
};

// ---- Render Services ----
function renderServices() {
  document.getElementById('servicesTable').innerHTML = mockServices.map((s, i) => `
    <tr>
      <td><strong>${s.name}</strong></td>
      <td>${s.country}</td>
      <td>${rp(s.price)}</td>
      <td>${s.stock}</td>
      <td><span class="status-badge ${s.active ? 'status-success' : 'status-failed'}">${s.active ? 'Aktif' : 'Nonaktif'}</span></td>
      <td>
        <button class="btn-sm btn-edit" onclick="editService(${i})">Edit</button>
      </td>
    </tr>
  `).join('');
}

window.editService = function (i) {
  const s = mockServices[i];
  if (!s) return;
  openModal('Edit Layanan', `
    <div class="form-group"><label>Nama Layanan</label><input id="mSvcName" value="${s.name}"></div>
    <div class="form-group"><label>Negara</label><input id="mSvcCountry" value="${s.country}"></div>
    <div class="form-group"><label>Harga (Rp)</label><input id="mSvcPrice" type="number" value="${s.price}"></div>
    <div class="form-group"><label>Stok</label><input id="mSvcStock" type="number" value="${s.stock}"></div>
    <div class="form-group"><label>Status</label>
      <select id="mSvcActive"><option value="true" ${s.active ? 'selected' : ''}>Aktif</option><option value="false" ${!s.active ? 'selected' : ''}>Nonaktif</option></select>
    </div>
    <button class="btn-modal" onclick="saveService(${i})">Simpan</button>
  `);
};

window.saveService = function (i) {
  const s = mockServices[i];
  if (!s) return;
  s.name = document.getElementById('mSvcName').value;
  s.country = document.getElementById('mSvcCountry').value;
  s.price = parseInt(document.getElementById('mSvcPrice').value) || 0;
  s.stock = parseInt(document.getElementById('mSvcStock').value) || 0;
  s.active = document.getElementById('mSvcActive').value === 'true';
  renderServices();
  closeModal();
};

document.getElementById('btnAddService').addEventListener('click', () => {
  openModal('Tambah Layanan', `
    <div class="form-group"><label>Nama Layanan</label><input id="mSvcName" placeholder="contoh: WhatsApp"></div>
    <div class="form-group"><label>Negara</label><input id="mSvcCountry" placeholder="contoh: 🇮🇩 Indonesia"></div>
    <div class="form-group"><label>Harga (Rp)</label><input id="mSvcPrice" type="number" placeholder="1500"></div>
    <div class="form-group"><label>Stok</label><input id="mSvcStock" type="number" placeholder="100"></div>
    <button class="btn-modal" onclick="addService()">Tambah</button>
  `);
});

window.addService = function () {
  mockServices.push({
    name: document.getElementById('mSvcName').value,
    country: document.getElementById('mSvcCountry').value,
    price: parseInt(document.getElementById('mSvcPrice').value) || 0,
    stock: parseInt(document.getElementById('mSvcStock').value) || 0,
    active: true
  });
  renderServices();
  closeModal();
};

// ---- Init ----
renderOverview();
renderUsers();
renderOrders();
renderDeposits();
renderServices();
