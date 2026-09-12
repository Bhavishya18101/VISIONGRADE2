document.addEventListener('DOMContentLoaded', () => {
  if (!Auth.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  const user = Auth.getUser();
  if (user?.role !== 'admin') {
    Auth.redirectByRole();
    return;
  }

  initUI();
  initCharts();
  setupEventListeners();
  connectWebSocket();
  loadInitialData();
  startPeriodicUpdates();
});

let ws = null;
let charts = {};
let gradingSessionActive = false;
let currentCameraStream = null;

function initUI() {
  const user = Auth.getUser();
  document.getElementById('userInitials').textContent = user.name?.charAt(0).toUpperCase() || 'A';
  document.getElementById('userName').textContent = user.name || 'Admin';
  document.getElementById('userEmail').textContent = user.email;

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('bookingDateFilter').value = today;
}

function setupEventListeners() {
  const avatar = document.querySelector('.user-avatar');
  const dropdown = document.querySelector('.user-dropdown');
  const logoutBtn = document.getElementById('btnLogout');
  const navLinks = document.querySelectorAll('.nav-link');
  const cameraSelect = document.getElementById('cameraSelect');
  const btnStartGrading = document.getElementById('btnStartGrading');
  const modalClose = document.querySelector('#deviceModal .modal-close');
  const deviceModal = document.getElementById('deviceModal');
  const bookingSearch = document.getElementById('bookingSearch');
  const bookingStatusFilter = document.getElementById('bookingStatusFilter');
  const bookingDateFilter = document.getElementById('bookingDateFilter');

  avatar?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.hasAttribute('hidden');
    dropdown.hidden = !isOpen;
    avatar.setAttribute('aria-expanded', isOpen);
  });

  document.addEventListener('click', (e) => {
    if (!avatar?.contains(e.target) && !dropdown?.contains(e.target)) {
      dropdown?.setAttribute('hidden', '');
      avatar?.setAttribute('aria-expanded', 'false');
    }
  });

  logoutBtn?.addEventListener('click', () => {
    if (ws) ws.close();
    Auth.logout();
  });

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      showSection(section);
      navLinks.forEach(l => l.classList.toggle('active', l === link));
    });
  });

  cameraSelect?.addEventListener('change', handleCameraSelect);
  btnStartGrading?.addEventListener('click', toggleGradingSession);

  modalClose?.addEventListener('click', () => deviceModal.classList.remove('active'));
  deviceModal?.addEventListener('click', (e) => {
    if (e.target === deviceModal) deviceModal.classList.remove('active');
  });

  bookingSearch?.addEventListener('input', debounce(loadAdminBookings, 300));
  bookingStatusFilter?.addEventListener('change', loadAdminBookings);
  bookingDateFilter?.addEventListener('change', loadAdminBookings);
}

function showSection(sectionId) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.getElementById(sectionId)?.classList.add('active');

  if (sectionId === 'grading' && !gradingSessionActive) {
    loadCameras();
  }
}

function connectWebSocket() {
  const wsUrl = `ws://${window.location.hostname}:3001`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    updateConnectionStatus(true);
    ws.send(JSON.stringify({ type: 'auth', token: Auth.getToken() }));
    ws.send(JSON.stringify({ type: 'subscribe', channels: ['telemetry', 'grading', 'bookings', 'alerts'] }));
  };

  ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (e) {
      console.error('WS message parse error:', e);
    }
  };

  ws.onclose = () => {
    updateConnectionStatus(false);
    setTimeout(connectWebSocket, 5000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
    updateConnectionStatus(false);
  };
}

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connectionStatus');
  if (!statusEl) return;

  const dot = statusEl.querySelector('.status-dot');
  const text = statusEl.querySelector('span:last-child');

  if (connected) {
    dot.style.background = 'var(--success)';
    dot.style.boxShadow = '0 0 8px var(--success)';
    text.textContent = 'Connected';
  } else {
    dot.style.background = 'var(--error)';
    dot.style.boxShadow = '0 0 8px var(--error)';
    text.textContent = 'Disconnected';
  }
}

function handleWebSocketMessage(message) {
  switch (message.type) {
    case 'telemetry':
      updateTelemetry(message.data);
      break;
    case 'grading_result':
      updateGradingResults(message.data);
      break;
    case 'booking_update':
      loadAdminBookings();
      loadSidebarStats();
      break;
    case 'alert':
      showToast(message.data.message, message.data.severity || 'warning');
      updateAlertsCount();
      break;
    case 'device_status':
      updateDeviceList(message.data);
      break;
    case 'camera_list':
      populateCameraSelect(message.data);
      break;
    default:
      console.log('Unknown message type:', message.type);
  }
}

function updateTelemetry(data) {
  if (data.throughput) updateThroughputChart(data.throughput);
  if (data.grades) updateGradeChart(data.grades);
  if (data.mandi) updateMandiChart(data.mandi);
  if (data.devices) updateDeviceList(data.devices);
  if (data.stats) updateSidebarStats(data.stats);
}

function updateGradingResults(data) {
  const container = document.getElementById('currentGrading');
  if (data.detection) {
    container.innerHTML = `
      <div class="detection-result">
        <div class="detection-header">
          <span class="badge badge-${getGradeBadge(data.detection.grade)}">Grade ${data.detection.grade}</span>
          <span class="confidence">${(data.detection.confidence * 100).toFixed(1)}%</span>
        </div>
        <div class="detection-image">
          <img src="${data.detection.imageUrl}" alt="Graded onion" style="max-width:100%;border-radius:var(--radius-sm)">
        </div>
        <div class="detection-meta">
          <span>Size: ${data.detection.size}mm</span>
          <span>Weight: ${data.detection.weight}g</span>
          <span>Defects: ${data.detection.defects || 'None'}</span>
        </div>
      </div>
    `;
  }

  if (data.sessionStats) {
    document.getElementById('sessionTotal').textContent = `${data.sessionStats.totalWeight} qt`;
    document.getElementById('gradeA').textContent = `${data.sessionStats.gradeA}%`;
    document.getElementById('gradeB').textContent = `${data.sessionStats.gradeB}%`;
    document.getElementById('gradeRejected').textContent = `${data.sessionStats.rejected}%`;
  }

  if (data.recentDetections) {
    renderDetectionList(data.recentDetections);
  }
}

function renderDetectionList(detections) {
  const list = document.getElementById('detectionList');
  if (!detections?.length) {
    list.innerHTML = '<p class="text-muted">No detections yet</p>';
    return;
  }

  list.innerHTML = detections.slice(0, 10).map(d => `
    <div class="detection-item">
      <div class="detection-grade badge badge-${getGradeBadge(d.grade)}">Grade ${d.grade}</div>
      <div class="detection-info">
        <span>${d.timestamp}</span>
        <span>${d.weight}g • ${d.size}mm</span>
      </div>
      <div class="detection-confidence">${(d.confidence * 100).toFixed(0)}%</div>
    </div>
  `).join('');
}

function getGradeBadge(grade) {
  const map = { 'A': 'success', 'B': 'warning', 'C': 'info', 'Rejected': 'error' };
  return map[grade] || 'info';
}

async function loadInitialData() {
  await Promise.all([
    loadSidebarStats(),
    loadAdminBookings(),
    loadAnalytics(),
    loadDevices(),
    loadActivityFeed(),
    loadHealthGrid(),
  ]);
}

async function loadSidebarStats() {
  try {
    const response = await Auth.apiRequest('/admin/stats');
    const data = await response.json();
    if (response.ok) updateSidebarStats(data);
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

function updateSidebarStats(stats) {
  const elements = {
    statTodayGraded: stats.todayGraded || 0,
    statActiveFarmers: stats.activeFarmers || 0,
    statPendingBookings: stats.pendingBookings || 0,
    statAlerts: stats.alerts || 0,
  };

  Object.entries(elements).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = typeof value === 'number' ? value.toLocaleString() : value;
  });
}

async function loadAdminBookings() {
  const search = document.getElementById('bookingSearch')?.value || '';
  const status = document.getElementById('bookingStatusFilter')?.value || '';
  const date = document.getElementById('bookingDateFilter')?.value || '';

  try {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    if (status) params.append('status', status);
    if (date) params.append('date', date);

    const response = await Auth.apiRequest(`/admin/bookings?${params}`);
    const data = await response.json();

    if (response.ok) renderAdminBookings(data.bookings);
  } catch (e) {
    console.error('Failed to load bookings:', e);
  }
}

function renderAdminBookings(bookings) {
  const tbody = document.querySelector('#adminBookingsTable tbody');
  if (!bookings?.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No bookings found</td></tr>';
    return;
  }

  tbody.innerHTML = bookings.map(b => `
    <tr>
      <td><code>${b.bookingId.slice(-8).toUpperCase()}</code></td>
      <td>
        <div>
          <div style="font-weight:500">${b.farmerName}</div>
          <div class="text-muted" style="font-size:0.75rem">${b.farmerEmail}</div>
        </div>
      </td>
      <td>${formatDate(b.date)} ${formatTimeRange(b.timeSlot)}</td>
      <td>${b.mandi}</td>
      <td>${b.cropType} / ${b.quantity} qt</td>
      <td><span class="badge ${getStatusBadge(b.status)}">${b.status}</span></td>
      <td>
        <div class="action-buttons">
          ${b.status === 'pending' || b.status === 'confirmed' ? `
            <button class="btn btn-secondary btn-sm" onclick="updateBookingStatus('${b._id}', 'confirmed')" style="padding:0.4rem 0.75rem;font-size:0.8rem">Confirm</button>
            <button class="btn btn-danger btn-sm" onclick="updateBookingStatus('${b._id}', 'cancelled')" style="padding:0.4rem 0.75rem;font-size:0.8rem">Cancel</button>
          ` : ''}
          ${b.status === 'confirmed' ? `
            <button class="btn btn-primary btn-sm" onclick="updateBookingStatus('${b._id}', 'completed')" style="padding:0.4rem 0.75rem;font-size:0.8rem">Complete</button>
          ` : ''}
          <button class="btn btn-secondary btn-sm" onclick="viewBookingDetails('${b._id}')" style="padding:0.4rem 0.75rem;font-size:0.8rem">View</button>
        </div>
      </td>
    </tr>
  `).join('');
}

window.updateBookingStatus = async function(bookingId, status) {
  try {
    const response = await Auth.apiRequest(`/admin/bookings/${bookingId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    showToast(`Booking ${status}`, 'success');
    loadAdminBookings();
    loadSidebarStats();
  } catch (e) {
    showToast(e.message, 'error');
  }
};

window.viewBookingDetails = function(bookingId) {
  showToast('Booking details modal - implement as needed', 'info');
};

async function loadAnalytics() {
  try {
    const response = await Auth.apiRequest('/admin/analytics');
    const data = await response.json();
    if (response.ok) renderAnalytics(data);
  } catch (e) {
    console.error('Failed to load analytics:', e);
  }
}

function renderAnalytics(data) {
  document.getElementById('kpiTotalVolume').textContent = (data.totalVolume || 0).toLocaleString();
  document.getElementById('kpiAvgGrade').textContent = data.avgGrade || 'A';
  document.getElementById('kpiRevenue').textContent = `₹${(data.revenue || 0).toLocaleString()}`;
  document.getElementById('kpiEfficiency').textContent = `${data.efficiency || 0}%`;

  if (data.volumeTrend) updateWeeklyVolumeChart(data.volumeTrend);
  if (data.qualityTrend) updateQualityTrendChart(data.qualityTrend);
  if (data.leaderboard) renderLeaderboard(data.leaderboard);
}

function renderLeaderboard(leaderboard) {
  const tbody = document.querySelector('#leaderboardTable tbody');
  if (!leaderboard?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No data</td></tr>';
    return;
  }

  tbody.innerHTML = leaderboard.map((farmer, i) => `
    <tr>
      <td><span class="badge badge-info">#${i + 1}</span></td>
      <td>${farmer.name}</td>
      <td>${farmer.totalVolume} qt</td>
      <td><span class="badge badge-${getGradeBadge(farmer.avgGrade)}">${farmer.avgGrade}</span></td>
      <td>${farmer.sessions}</td>
      <td>₹${farmer.revenue.toLocaleString()}</td>
    </tr>
  `).join('');
}

async function loadDevices() {
  try {
    const response = await Auth.apiRequest('/admin/devices');
    const data = await response.json();
    if (response.ok) {
      updateDeviceList(data.devices);
      renderDeviceGrid(data.devices);
    }
  } catch (e) {
    console.error('Failed to load devices:', e);
  }
}

function updateDeviceList(devices) {
  const list = document.getElementById('deviceList');
  if (!devices?.length) {
    list.innerHTML = '<p class="text-muted">No devices connected</p>';
    return;
  }

  list.innerHTML = devices.map(d => `
    <div class="device-item ${d.online ? 'online' : 'offline'}">
      <div class="device-status-indicator ${d.online ? 'active' : ''}"></div>
      <div class="device-info">
        <div class="device-name">${d.name}</div>
        <div class="device-meta">${d.location} • ${d.lastSeen ? 'Online' : 'Offline'}</div>
      </div>
      <div class="device-actions">
        <span class="badge ${d.online ? 'badge-success' : 'badge-error'}">${d.online ? 'Online' : 'Offline'}</span>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.device-item').forEach((item, i) => {
    item.addEventListener('click', () => showDeviceModal(devices[i]));
  });
}

function renderDeviceGrid(devices) {
  const grid = document.getElementById('deviceGrid');
  if (!devices?.length) {
    grid.innerHTML = '<p class="text-muted" style="grid-column:1/-1">No devices registered</p>';
    return;
  }

  grid.innerHTML = devices.map(d => `
    <div class="card device-card ${d.online ? '' : 'offline'}">
      <div class="device-card-header">
        <h4>${d.name}</h4>
        <span class="badge ${d.online ? 'badge-success' : 'badge-error'}">${d.online ? 'Online' : 'Offline'}</span>
      </div>
      <div class="device-card-body">
        <div class="device-metric">
          <span class="metric-label">Location</span>
          <span class="metric-value">${d.location}</span>
        </div>
        <div class="device-metric">
          <span class="metric-label">CPU</span>
          <span class="metric-value">${d.cpu}%</span>
        </div>
        <div class="device-metric">
          <span class="metric-label">Memory</span>
          <span class="metric-value">${d.memory}%</span>
        </div>
        <div class="device-metric">
          <span class="metric-label">Temperature</span>
          <span class="metric-value">${d.temperature}°C</span>
        </div>
        <div class="device-metric">
          <span class="metric-label">Camera</span>
          <span class="metric-value">${d.cameraStatus}</span>
        </div>
        <div class="device-metric">
          <span class="metric-label">Last Seen</span>
          <span class="metric-value">${d.lastSeen}</span>
        </div>
      </div>
      <div class="device-card-footer">
        <button class="btn btn-secondary btn-sm" onclick="showDeviceModal(${JSON.stringify(d).replace(/"/g, '"')})">Details</button>
        <button class="btn btn-primary btn-sm" onclick="restartDevice('${d._id}')">Restart</button>
      </div>
    </div>
  `).join('');
}

window.showDeviceModal = function(device) {
  const modal = document.getElementById('deviceModal');
  const content = document.getElementById('deviceModalContent');
  document.getElementById('deviceModalTitle').textContent = device.name;

  content.innerHTML = `
    <div class="device-detail">
      <div class="detail-row"><span>Device ID</span><code>${device._id}</code></div>
      <div class="detail-row"><span>Location</span><span>${device.location}</span></div>
      <div class="detail-row"><span>IP Address</span><code>${device.ip}</code></div>
      <div class="detail-row"><span>Firmware</span><span>${device.firmware}</span></div>
      <div class="detail-row"><span>Model</span><span>${device.model}</span></div>
      <div class="detail-row"><span>Status</span><span class="badge ${device.online ? 'badge-success' : 'badge-error'}">${device.online ? 'Online' : 'Offline'}</span></div>
      <hr style="margin:1rem 0;border-color:var(--border-color)">
      <h4>System Metrics</h4>
      <div class="detail-row"><span>CPU Usage</span><span>${device.cpu}%</span></div>
      <div class="detail-row"><span>Memory Usage</span><span>${device.memory}%</span></div>
      <div class="detail-row"><span>Disk Usage</span><span>${device.disk}%</span></div>
      <div class="detail-row"><span>Temperature</span><span>${device.temperature}°C</span></div>
      <div class="detail-row"><span>Uptime</span><span>${device.uptime}</span></div>
      <hr style="margin:1rem 0;border-color:var(--border-color)">
      <h4>Camera Status</h4>
      <div class="detail-row"><span>Camera 1</span><span class="badge ${device.cam1 ? 'badge-success' : 'badge-error'}">${device.cam1 ? 'Active' : 'Inactive'}</span></div>
      <div class="detail-row"><span>Camera 2</span><span class="badge ${device.cam2 ? 'badge-success' : 'badge-error'}">${device.cam2 ? 'Active' : 'Inactive'}</span></div>
    </div>
  `;

  modal.classList.add('active');
};

window.restartDevice = async function(deviceId) {
  if (!confirm('Restart this device?')) return;
  try {
    const response = await Auth.apiRequest(`/admin/devices/${deviceId}/restart`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    showToast('Restart command sent', 'success');
    loadDevices();
  } catch (e) {
    showToast(e.message, 'error');
  }
};

async function loadCameras() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'get_cameras' }));
  }
}

function populateCameraSelect(cameras) {
  const select = document.getElementById('cameraSelect');
  const currentValue = select.value;
  select.innerHTML = '<option value="">Select Camera</option>';
  cameras.forEach(cam => {
    const opt = document.createElement('option');
    opt.value = cam.id;
    opt.textContent = `${cam.name} (${cam.device})`;
    opt.dataset.device = cam.device;
    select.appendChild(opt);
  });
  if (currentValue) select.value = currentValue;
}

async function handleCameraSelect(e) {
  const cameraId = e.target.value;
  const video = document.getElementById('cameraVideo');
  const placeholder = document.querySelector('.camera-placeholder');
  const canvas = document.getElementById('overlayCanvas');

  if (currentCameraStream) {
    currentCameraStream.getTracks().forEach(t => t.stop());
  }

  if (!cameraId) {
    video.style.display = 'none';
    canvas.style.display = 'none';
    placeholder.style.display = 'flex';
    return;
  }

  try {
    const response = await Auth.apiRequest(`/cameras/${cameraId}/stream`);
    const data = await response.json();

    if (response.ok && data.streamUrl) {
      video.srcObject = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: data.deviceId } }
      });
      currentCameraStream = video.srcObject;
      video.style.display = 'block';
      canvas.style.display = 'block';
      placeholder.style.display = 'none';
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    } else {
      throw new Error(data.message || 'Failed to start stream');
    }
  } catch (error) {
    console.error('Camera error:', error);
    showToast('Failed to start camera: ' + error.message, 'error');
    video.style.display = 'none';
    canvas.style.display = 'none';
    placeholder.style.display = 'flex';
  }
}

function toggleGradingSession() {
  const btn = document.getElementById('btnStartGrading');
  const cameraId = document.getElementById('cameraSelect').value;

  if (!cameraId) {
    showToast('Please select a camera first', 'warning');
    return;
  }

  gradingSessionActive = !gradingSessionActive;

  if (gradingSessionActive) {
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="4" width="4" height="16"/>
        <rect x="14" y="4" width="4" height="16"/>
      </svg>
      Stop Session
    `;
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-danger');
    ws?.send(JSON.stringify({ type: 'start_grading', cameraId }));
    showToast('Grading session started', 'success');
  } else {
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"/>
      </svg>
      Start Session
    `;
    btn.classList.remove('btn-danger');
    btn.classList.add('btn-primary');
    ws?.send(JSON.stringify({ type: 'stop_grading' }));
    showToast('Grading session stopped', 'info');
  }
}

async function loadActivityFeed() {
  try {
    const response = await Auth.apiRequest('/admin/activity?limit=10');
    const data = await response.json();
    if (response.ok) renderActivityFeed(data.activities);
  } catch (e) {
    console.error('Failed to load activity:', e);
  }
}

function renderActivityFeed(activities) {
  const feed = document.getElementById('activityFeed');
  if (!activities?.length) {
    feed.innerHTML = '<p class="text-muted">No recent activity</p>';
    return;
  }

  feed.innerHTML = activities.map(a => `
    <div class="activity-item">
      <div class="activity-icon ${a.type}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          ${getActivityIcon(a.type)}
        </svg>
      </div>
      <div class="activity-content">
        <div class="activity-text">${a.message}</div>
        <div class="activity-time">${formatRelativeTime(a.timestamp)}</div>
      </div>
    </div>
  `).join('');
}

function getActivityIcon(type) {
  const icons = {
    grading: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    booking: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
    device: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  };
  return icons[type] || icons.grading;
}

async function loadHealthGrid() {
  try {
    const response = await Auth.apiRequest('/admin/health');
    const data = await response.json();
    if (response.ok) renderHealthGrid(data);
  } catch (e) {
    console.error('Failed to load health:', e);
  }
}

function renderHealthGrid(health) {
  const grid = document.getElementById('healthGrid');
  const checks = [
    { key: 'database', label: 'Database', icon: 'database' },
    { key: 'ai_service', label: 'AI Service', icon: 'cpu' },
    { key: 'storage', label: 'Storage', icon: 'hard-drive' },
    { key: 'network', label: 'Network', icon: 'wifi' },
  ];

  grid.innerHTML = checks.map(c => {
    const status = health[c.key] || 'unknown';
    return `
      <div class="health-item ${status}">
        <div class="health-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${getHealthIcon(c.icon)}
          </svg>
        </div>
        <div class="health-info">
          <div class="health-label">${c.label}</div>
          <div class="health-status">${status}</div>
        </div>
        <div class="health-indicator ${status}"></div>
      </div>
    `;
  }).join('');
}

function getHealthIcon(type) {
  const icons = {
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/>',
    'hard-drive': '<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  };
  return icons[type] || '';
}

function initCharts() {
  Chart.defaults.font.family = 'Inter';
  Chart.defaults.color = '#b8a9d6';
  Chart.defaults.borderColor = 'rgba(90, 46, 137, 0.3)';

  charts.throughput = new Chart(document.getElementById('throughputChart'), {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Quintals/Hour', data: [], borderColor: '#00d4aa', backgroundColor: 'rgba(0,212,170,0.1)', fill: true, tension: 0.4 }] },
    options: getChartOptions('Quintals'),
  });

  charts.grade = new Chart(document.getElementById('gradeChart'), {
    type: 'doughnut',
    data: { labels: ['Grade A', 'Grade B', 'Rejected'], datasets: [{ data: [0, 0, 0], backgroundColor: ['#2ed573', '#ffa502', '#ff4757'], borderWidth: 0 }] },
    options: { ...getChartOptions(), cutout: '70%', plugins: { legend: { position: 'bottom' } } },
  });

  charts.mandi = new Chart(document.getElementById('mandiChart'), {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'Utilization %', data: [], backgroundColor: 'rgba(90, 46, 137, 0.6)', borderColor: '#5a2e89', borderWidth: 1 }] },
    options: getChartOptions('Utilization %'),
  });

  charts.weeklyVolume = new Chart(document.getElementById('weeklyVolumeChart'), {
    type: 'line',
    data: { labels: [], datasets: [{ label: 'Volume (qt)', data: [], borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', fill: true, tension: 0.4 }] },
    options: getChartOptions('Quintals'),
  });

  charts.qualityTrend = new Chart(document.getElementById('qualityTrendChart'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'Grade A %', data: [], borderColor: '#2ed573', backgroundColor: 'rgba(46,213,115,0.1)', fill: true, tension: 0.4 },
      { label: 'Grade B %', data: [], borderColor: '#ffa502', backgroundColor: 'rgba(255,165,2,0.1)', fill: true, tension: 0.4 },
    ]},
    options: getChartOptions('Percentage'),
  });
}

function getChartOptions(yAxisLabel = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#7a6d9e' } },
      y: { grid: { color: 'rgba(90, 46, 137, 0.2)' }, ticks: { color: '#7a6d9e' }, title: { display: !!yAxisLabel, text: yAxisLabel, color: '#b8a9d6' } },
    },
    interaction: { intersect: false, mode: 'index' },
  };
}

function updateThroughputChart(data) {
  if (!charts.throughput) return;
  charts.throughput.data.labels = data.labels;
  charts.throughput.data.datasets[0].data = data.values;
  charts.throughput.update('none');
}

function updateGradeChart(data) {
  if (!charts.grade) return;
  charts.grade.data.datasets[0].data = [data.A || 0, data.B || 0, data.rejected || 0];
  charts.grade.update('none');
}

function updateMandiChart(data) {
  if (!charts.mandi) return;
  charts.mandi.data.labels = data.labels;
  charts.mandi.data.datasets[0].data = data.values;
  charts.mandi.update('none');
}

function updateWeeklyVolumeChart(data) {
  if (!charts.weeklyVolume) return;
  charts.weeklyVolume.data.labels = data.labels;
  charts.weeklyVolume.data.datasets[0].data = data.values;
  charts.weeklyVolume.update('none');
}

function updateQualityTrendChart(data) {
  if (!charts.qualityTrend) return;
  charts.qualityTrend.data.labels = data.labels;
  charts.qualityTrend.data.datasets[0].data = data.gradeA;
  charts.qualityTrend.data.datasets[1].data = data.gradeB;
  charts.qualityTrend.update('none');
}

function startPeriodicUpdates() {
  setInterval(() => {
    loadSidebarStats();
    loadActivityFeed();
    loadHealthGrid();
  }, 30000);
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTimeRange(timeStr) {
  const [start, end] = timeStr.split('-');
  return `${formatTime(start)} - ${formatTime(end)}`;
}

function formatTime(time) {
  const [h, m] = time.split(':');
  const hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${m} ${ampm}`;
}

function formatRelativeTime(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

function getStatusBadge(status) {
  const map = { confirmed: 'badge-success', pending: 'badge-warning', completed: 'badge-info', cancelled: 'badge-error' };
  return map[status] || 'badge-info';
}

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      ${type === 'success' ? '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' :
        type === 'error' ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>' :
        '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'}
    </svg>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function updateAlertsCount() {
  const el = document.getElementById('statAlerts');
  if (el) el.textContent = parseInt(el.textContent) + 1;
}