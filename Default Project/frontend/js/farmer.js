document.addEventListener('DOMContentLoaded', () => {
  if (!Auth.isAuthenticated()) {
    window.location.href = '/login.html';
    return;
  }

  const user = Auth.getUser();
  if (user?.role !== 'farmer') {
    Auth.redirectByRole();
    return;
  }

  initUI();
  loadSlotAvailability();
  loadBookings();
  loadGradingHistory();
  setupEventListeners();
});

function initUI() {
  const user = Auth.getUser();
  document.getElementById('userInitials').textContent = user.name?.charAt(0).toUpperCase() || 'F';
  document.getElementById('userName').textContent = user.name || 'Farmer';
  document.getElementById('userEmail').textContent = user.email;

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('preferredDate').min = today;
  document.getElementById('preferredDate').value = today;
}

function setupEventListeners() {
  const avatar = document.querySelector('.user-avatar');
  const dropdown = document.querySelector('.user-dropdown');
  const logoutBtn = document.getElementById('btnLogout');
  const navLinks = document.querySelectorAll('.nav-link');
  const bookingForm = document.getElementById('bookingForm');
  const cancelModal = document.getElementById('cancelModal');
  const cancelYes = document.getElementById('cancelYes');
  const cancelNo = document.getElementById('cancelNo');
  const modalClose = cancelModal.querySelector('.modal-close');

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

  logoutBtn?.addEventListener('click', () => Auth.logout());

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const section = link.dataset.section;
      showSection(section);
      navLinks.forEach(l => l.classList.toggle('active', l === link));
    });
  });

  bookingForm?.addEventListener('submit', handleBookingSubmit);

  const openCancelModal = (bookingId) => {
    cancelModal.dataset.bookingId = bookingId;
    cancelModal.classList.add('active');
  };

  const closeCancelModal = () => {
    cancelModal.classList.remove('active');
    delete cancelModal.dataset.bookingId;
  };

  cancelYes?.addEventListener('click', async () => {
    const bookingId = cancelModal.dataset.bookingId;
    if (bookingId) {
      await cancelBooking(bookingId);
    }
    closeCancelModal();
  });

  cancelNo?.addEventListener('click', closeCancelModal);
  modalClose?.addEventListener('click', closeCancelModal);
  cancelModal?.addEventListener('click', (e) => {
    if (e.target === cancelModal) closeCancelModal();
  });
}

function showSection(sectionId) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.getElementById(sectionId)?.classList.add('active');
}

async function loadSlotAvailability() {
  try {
    const response = await Auth.apiRequest('/slots/availability');
    const data = await response.json();

    if (response.ok) {
      renderSlotAvailability(data.slots);
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('Failed to load slots:', error);
    document.getElementById('slotAvailability').innerHTML = `
      <p class="text-muted">Unable to load slot availability</p>
    `;
  }
}

function renderSlotAvailability(slots) {
  const container = document.getElementById('slotAvailability');
  if (!slots?.length) {
    container.innerHTML = '<p class="text-muted">No slots available for today</p>';
    return;
  }

  container.innerHTML = slots.map(slot => `
    <div class="slot-card ${slot.available ? 'available' : 'booked'}" data-time="${slot.time}">
      <div class="slot-time">${formatTimeRange(slot.time)}</div>
      <div class="slot-status">
        <span class="badge ${slot.available ? 'badge-success' : 'badge-error'}">
          ${slot.available ? `${slot.capacity - slot.booked} left` : 'Full'}
        </span>
      </div>
    </div>
  `).join('');
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

async function handleBookingSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('submitBooking');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnLoader = submitBtn.querySelector('.btn-loader');

  const formData = new FormData(form);
  const bookingData = Object.fromEntries(formData);

  submitBtn.disabled = true;
  btnText.style.display = 'none';
  btnLoader.style.display = 'inline-block';

  try {
    const response = await Auth.apiRequest('/bookings', {
      method: 'POST',
      body: JSON.stringify(bookingData),
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data.message);

    showToast('Slot booked successfully!', 'success');
    form.reset();
    document.getElementById('preferredDate').value = new Date().toISOString().split('T')[0];
    loadBookings();
    loadSlotAvailability();
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    submitBtn.disabled = false;
    btnText.style.display = 'inline';
    btnLoader.style.display = 'none';
  }
}

async function loadBookings() {
  try {
    const response = await Auth.apiRequest('/bookings/my');
    const data = await response.json();

    if (response.ok) {
      renderBookings(data.bookings);
    }
  } catch (error) {
    console.error('Failed to load bookings:', error);
  }
}

function renderBookings(bookings) {
  const tbody = document.querySelector('#bookingsTable tbody');
  if (!bookings?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No bookings found</td></tr>';
    return;
  }

  tbody.innerHTML = bookings.map(booking => `
    <tr>
      <td><code>${booking.bookingId.slice(-8).toUpperCase()}</code></td>
      <td>${formatDate(booking.date)} ${formatTimeRange(booking.timeSlot)}</td>
      <td>${booking.mandi}</td>
      <td>${booking.cropType} / ${booking.quantity} qt</td>
      <td><span class="badge ${getStatusBadge(booking.status)}">${booking.status}</span></td>
      <td>
        ${booking.status === 'confirmed' || booking.status === 'pending' ? `
          <button class="btn btn-secondary btn-sm cancel-booking" data-id="${booking._id}" style="padding:0.5rem 1rem;font-size:0.875rem">
            Cancel
          </button>
        ` : ''}
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.cancel-booking').forEach(btn => {
    btn.addEventListener('click', () => openCancelModal(btn.dataset.id));
  });
}

async function cancelBooking(bookingId) {
  try {
    const response = await Auth.apiRequest(`/bookings/${bookingId}`, { method: 'DELETE' });
    const data = await response.json();

    if (!response.ok) throw new Error(data.message);

    showToast('Booking cancelled', 'success');
    loadBookings();
    loadSlotAvailability();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

async function loadGradingHistory() {
  try {
    const response = await Auth.apiRequest('/grading/history');
    const data = await response.json();

    if (response.ok) {
      renderGradingHistory(data.history);
    }
  } catch (error) {
    console.error('Failed to load history:', error);
  }
}

function renderGradingHistory(history) {
  const tbody = document.querySelector('#historyTable tbody');
  if (!history?.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">No grading history</td></tr>';
    return;
  }

  tbody.innerHTML = history.map(item => `
    <tr>
      <td><code>${item.certificateId}</code></td>
      <td>${formatDate(item.date)}</td>
      <td>${item.cropType}</td>
      <td><span class="badge badge-info">Grade ${item.grade}</span></td>
      <td>${item.quantity} qt</td>
      <td>₹${item.pricePerQuintal.toLocaleString()}</td>
      <td>₹${item.totalAmount.toLocaleString()}</td>
      <td>
        <button class="btn btn-secondary btn-sm" style="padding:0.5rem 1rem;font-size:0.875rem">Download</button>
      </td>
    </tr>
  `).join('');
}

function getStatusBadge(status) {
  const map = {
    confirmed: 'badge-success',
    pending: 'badge-warning',
    completed: 'badge-info',
    cancelled: 'badge-error',
  };
  return map[status] || 'badge-info';
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
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