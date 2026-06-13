// ─────────────────────────────────────────────────────────
//  SHARED UTILITIES
// ─────────────────────────────────────────────────────────

// ── Toast Notification System ──
function showToast(message, type = 'default', duration = 4000) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const icons = { success: '✓', error: '✕', warning: '⚠', default: 'ℹ' };
    toast.innerHTML = `<span>${icons[type] || icons.default}</span><span>${message}</span>`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'toast-out 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ── Session helpers ──
function getSession() {
    try {
        return JSON.parse(sessionStorage.getItem('sct_user') || 'null');
    } catch { return null; }
}

function setSession(user) {
    sessionStorage.setItem('sct_user', JSON.stringify(user));
}

function clearSession() {
    sessionStorage.removeItem('sct_user');
}

function requireAuth(expectedRole) {
    const user = getSession();
    if (!user) {
        window.location.href = 'index.html';
        return null;
    }
    if (expectedRole && user.role !== expectedRole) {
        showToast('Access denied. Redirecting…', 'error');
        setTimeout(() => window.location.href = 'index.html', 1500);
        return null;
    }
    return user;
}

function logout() {
    clearSession();
    window.location.href = 'index.html';
}

// ── Badge helper ──
function badge(status) {
    if (!status) return '—';
    const cls = status.toLowerCase().replace(/[\s\/]+/g, '-');
    return `<span class="badge badge--${cls}">${status}</span>`;
}

// ── Loading state for buttons ──
function setLoading(btn, loading, originalText) {
    if (loading) {
        btn.disabled = true;
        btn.dataset.original = btn.innerHTML;
        btn.innerHTML = `<span class="spinner"></span> Loading…`;
    } else {
        btn.disabled = false;
        btn.innerHTML = originalText || btn.dataset.original || btn.innerHTML;
    }
}

// ─────────────────────────────────────────────────────────
//  LOGIN PAGE
// ─────────────────────────────────────────────────────────
if (document.getElementById('loginForm')) {
    document.getElementById('loginForm').addEventListener('submit', async function (e) {
        e.preventDefault();
        const btn = this.querySelector('button[type=submit]');
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const role = document.getElementById('roleSelect').value;

        if (!email || !password || !role) {
            showToast('Please fill all fields.', 'error');
            return;
        }

        setLoading(btn, true);

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, role })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                showToast(data.message || 'Login failed.', 'error');
                return;
            }

            // Save full user object to session
            setSession({ userId: data.userId, fullName: data.fullName, email: data.email, role: data.role });
            showToast(`Welcome back, ${data.fullName}!`, 'success');

            setTimeout(() => {
                window.location.href = data.role.toLowerCase() + '_dashboard.html';
            }, 700);

        } catch (err) {
            showToast('Cannot connect to server. Is it running?', 'error');
            console.error(err);
        } finally {
            setLoading(btn, false, 'Sign In');
        }
    });
}

// ─────────────────────────────────────────────────────────
//  PASSENGER DASHBOARD
// ─────────────────────────────────────────────────────────
if (document.getElementById('passengerDashboard')) {
    const user = requireAuth('Passenger');
    if (user) initPassengerDashboard(user);
}

async function initPassengerDashboard(user) {
    // Set greeting
    document.getElementById('userGreeting').textContent = user.fullName;

    // Load trips into dropdown
    await loadTripOptions();

    // Load my bookings
    await loadMyBookings(user.userId);
}

async function loadTripOptions() {
    const select = document.getElementById('tripSelect');
    if (!select) return;

    try {
        const res = await fetch('/api/trips');
        const data = await res.json();

        if (!data.success || !data.data.length) {
            select.innerHTML = '<option value="">No trips available</option>';
            return;
        }

        select.innerHTML = '<option value="">— Select a trip —</option>';
        data.data.forEach(trip => {
            const opt = document.createElement('option');
            opt.value = trip.TRIP_ID;
            opt.dataset.fare = trip.BASE_FARE;
            opt.textContent = `${trip.ROUTE_NAME} | ${trip.VEHICLE_TYPE} (${trip.VEHICLE_NO}) | ${trip.SEATS_AVAILABLE} seats | PKR ${trip.BASE_FARE}`;
            select.appendChild(opt);
        });

        // Show fare preview on selection
        select.addEventListener('change', function () {
            const farePreview = document.getElementById('farePreview');
            if (!farePreview) return;
            const selected = this.options[this.selectedIndex];
            if (selected.dataset.fare) {
                farePreview.textContent = `Base fare: PKR ${selected.dataset.fare} / seat`;
                farePreview.style.display = 'block';
            } else {
                farePreview.style.display = 'none';
            }
        });

    } catch (err) {
        select.innerHTML = '<option value="">Error loading trips</option>';
        console.error(err);
    }
}

async function submitBooking() {
    const user = getSession();
    if (!user) return;

    const btn = document.getElementById('bookBtn');
    const tripId = document.getElementById('tripSelect').value;
    const seats = parseInt(document.getElementById('seatsInput').value) || 1;
    const pickup = document.getElementById('pickup').value.trim();
    const dropoff = document.getElementById('dropoff').value.trim();

    // Validate
    if (!tripId) { showToast('Please select a trip.', 'error'); return; }
    if (!pickup)  { showToast('Please enter a pickup location.', 'error'); return; }
    if (!dropoff) { showToast('Please enter a drop-off location.', 'error'); return; }
    if (seats < 1 || seats > 10) { showToast('Seats must be between 1 and 10.', 'error'); return; }

    setLoading(btn, true);

    try {
        const res = await fetch('/api/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.userId, tripId, seats, pickup, dropoff })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            showToast(data.message || 'Booking failed.', 'error');
            return;
        }

        showToast(data.message, 'success');
        document.getElementById('bookingForm').reset();
        document.getElementById('farePreview').style.display = 'none';
        await loadTripOptions();         // refresh seat counts
        await loadMyBookings(user.userId);

    } catch (err) {
        showToast('Server error. Please try again.', 'error');
        console.error(err);
    } finally {
        setLoading(btn, false, 'Book Now');
    }
}

async function loadMyBookings(userId) {
    const tbody = document.getElementById('bookingsTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr class="loading-row"><td colspan="8">Loading bookings…</td></tr>';

    try {
        const res = await fetch(`/api/my-bookings?userId=${userId}`);
        const data = await res.json();

        if (!data.success) { tbody.innerHTML = '<tr><td colspan="8">Error loading bookings.</td></tr>'; return; }

        if (!data.data.length) {
            tbody.innerHTML = `<tr><td colspan="8">
                <div class="empty-state">
                    <div class="empty-state__icon">🎫</div>
                    <div class="empty-state__title">No bookings yet</div>
                    <div class="empty-state__text">Book your first trip above!</div>
                </div>
            </td></tr>`;
            return;
        }

        tbody.innerHTML = data.data.map(b => `
            <tr>
                <td>#${b.BOOKING_ID}</td>
                <td>${b.ROUTE_NAME}</td>
                <td>${b.DEPARTURE_TIME}</td>
                <td>${b.SEATS_BOOKED}</td>
                <td>${badge(b.BOOKING_STATUS)}</td>
                <td>PKR ${b.AMOUNT ?? '—'}</td>
                <td>${b.PAYMENT_METHOD ?? '—'}</td>
                <td>${badge(b.PAYMENT_STATUS)}</td>
            </tr>
        `).join('');

    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8">Failed to load bookings.</td></tr>';
        console.error(err);
    }
}

// ─────────────────────────────────────────────────────────
//  DRIVER DASHBOARD
// ─────────────────────────────────────────────────────────
if (document.getElementById('driverDashboard')) {
    const user = requireAuth('Driver');
    if (user) initDriverDashboard(user);
}

async function initDriverDashboard(user) {
    document.getElementById('userGreeting').textContent = user.fullName;
    await loadDriverTrips(user.userId);
}

async function loadDriverTrips(userId) {
    const tbody = document.getElementById('tripsTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr class="loading-row"><td colspan="7">Loading trips…</td></tr>';

    try {
        const res = await fetch(`/api/driver-trips?userId=${userId}`);
        const data = await res.json();

        if (!data.success) { tbody.innerHTML = '<tr><td colspan="7">Error loading trips.</td></tr>'; return; }

        if (!data.data.length) {
            tbody.innerHTML = `<tr><td colspan="7">
                <div class="empty-state">
                    <div class="empty-state__icon">🚌</div>
                    <div class="empty-state__title">No trips assigned</div>
                    <div class="empty-state__text">Contact admin to get trips assigned.</div>
                </div>
            </td></tr>`;
            return;
        }

        tbody.innerHTML = data.data.map(t => {
            const canStart = t.TRIP_STATUS === 'Scheduled';
            const canComplete = t.TRIP_STATUS === 'In-Progress';
            const canCancel = ['Scheduled', 'In-Progress'].includes(t.TRIP_STATUS);

            return `
            <tr>
                <td>#${t.TRIP_ID}</td>
                <td>${t.ROUTE_NAME}</td>
                <td>${t.REG_NUMBER} <span class="text-muted">(${t.VEHICLE_TYPE})</span></td>
                <td>${t.DEPARTURE_TIME}</td>
                <td>${t.SEATS_AVAILABLE}</td>
                <td>${badge(t.TRIP_STATUS)}</td>
                <td>
                    <div class="flex gap-2">
                        ${canStart ? `<button class="btn btn--sm btn--primary" onclick="updateTripStatus(${t.TRIP_ID},'In-Progress')">Start</button>` : ''}
                        ${canComplete ? `<button class="btn btn--sm btn--secondary" onclick="updateTripStatus(${t.TRIP_ID},'Completed')">Complete</button>` : ''}
                        ${canCancel ? `<button class="btn btn--sm btn--danger" onclick="updateTripStatus(${t.TRIP_ID},'Cancelled')">Cancel</button>` : ''}
                        ${!canStart && !canComplete && !canCancel ? '<span class="text-muted">—</span>' : ''}
                    </div>
                </td>
            </tr>`;
        }).join('');

    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7">Failed to load trips.</td></tr>';
        console.error(err);
    }
}

async function updateTripStatus(tripId, newStatus) {
    const user = getSession();
    if (!user) return;

    const confirmed = confirm(`Set trip #${tripId} to "${newStatus}"?`);
    if (!confirmed) return;

    try {
        const res = await fetch('/api/update-trip-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tripId, newStatus, userId: user.userId })
        });

        const data = await res.json();
        if (!res.ok || !data.success) { showToast(data.message, 'error'); return; }

        showToast(data.message, 'success');
        await loadDriverTrips(user.userId);

    } catch (err) {
        showToast('Server error.', 'error');
        console.error(err);
    }
}

// ─────────────────────────────────────────────────────────
//  ADMIN DASHBOARD
// ─────────────────────────────────────────────────────────
if (document.getElementById('adminDashboard')) {
    const user = requireAuth('Admin');
    if (user) initAdminDashboard(user);
}

async function initAdminDashboard(user) {
    document.getElementById('userGreeting').textContent = user.fullName;

    // Load default tab
    await loadReports();
    await loadUsers();
}

async function loadReports() {
    const tbody = document.getElementById('reportTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading…</td></tr>';

    try {
        const res = await fetch('/api/reports');
        const data = await res.json();

        if (!data.success) { tbody.innerHTML = '<tr><td colspan="6">Error loading reports.</td></tr>'; return; }

        if (!data.data.length) { tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="empty-state__title">No data</div></div></td></tr>'; return; }

        let totalRev = 0;
        tbody.innerHTML = data.data.map(r => {
            totalRev += parseFloat(r.TOTAL_REVENUE) || 0;
            return `
            <tr>
                <td>${r.ROUTE_NAME}</td>
                <td>${r.DISTANCE_KM} km</td>
                <td>PKR ${r.BASE_FARE}</td>
                <td>${r.TOTAL_TRIPS}</td>
                <td>${r.TOTAL_BOOKINGS}</td>
                <td>PKR ${r.TOTAL_REVENUE}</td>
            </tr>`;
        }).join('');

        const totalEl = document.getElementById('totalRevenue');
        if (totalEl) totalEl.textContent = `PKR ${totalRev.toLocaleString()}`;

    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6">Failed to load reports.</td></tr>';
        console.error(err);
    }
}

async function loadUsers() {
    const tbody = document.getElementById('usersTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading…</td></tr>';

    try {
        const res = await fetch('/api/users');
        const data = await res.json();

        if (!data.success) { tbody.innerHTML = '<tr><td colspan="6">Error.</td></tr>'; return; }

        tbody.innerHTML = data.data.map(u => `
            <tr>
                <td>#${u.USER_ID}</td>
                <td>${u.FULL_NAME}</td>
                <td>${u.EMAIL}</td>
                <td>${u.PHONE}</td>
                <td>${badge(u.ROLE)}</td>
                <td>${badge(u.STATUS)}</td>
            </tr>
        `).join('');

    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6">Failed to load users.</td></tr>';
        console.error(err);
    }
}

// Tab switching (admin dashboard)
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

// ─────────────────────────────────────────────────────────
//  MANAGE VEHICLE (admin)
// ─────────────────────────────────────────────────────────
if (document.getElementById('manageVehiclePage')) {
    requireAuth('Admin');
    loadVehicleList();
}

async function addVehicle() {
    const user = getSession();
    if (!user) return;

    const btn = document.getElementById('addVehicleBtn');
    const regNumber = document.getElementById('regNumber').value.trim();
    const vehicleType = document.getElementById('vehicleType').value;
    const capacity = document.getElementById('capacity').value;
    const fuelType = document.getElementById('fuelType').value;
    const driverId = document.getElementById('driverId').value;

    if (!regNumber || !vehicleType || !capacity || !fuelType) {
        showToast('All fields except Driver ID are required.', 'error');
        return;
    }

    if (!/^[A-Z]{3}-[A-Z]{2}-\d{4}$/.test(regNumber) && regNumber.length < 4) {
        showToast('Enter a valid registration number.', 'error');
        return;
    }

    setLoading(btn, true);

    try {
        const res = await fetch('/api/add-vehicle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ regNumber, vehicleType, capacity: Number(capacity), fuelType, driverId: driverId || null })
        });

        const data = await res.json();
        if (!res.ok || !data.success) { showToast(data.message, 'error'); return; }

        showToast(data.message, 'success');
        document.getElementById('vehicleForm').reset();
        await loadVehicleList();

    } catch (err) {
        showToast('Server error.', 'error');
        console.error(err);
    } finally {
        setLoading(btn, false, 'Add Vehicle');
    }
}

async function loadVehicleList() {
    const tbody = document.getElementById('vehiclesTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr class="loading-row"><td colspan="6">Loading…</td></tr>';

    try {
        const res = await fetch('/api/vehicles');
        const data = await res.json();

        if (!data.success) { tbody.innerHTML = '<tr><td colspan="6">Error.</td></tr>'; return; }

        if (!data.data.length) {
            tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-state__title">No vehicles</div></div></td></tr>`;
            return;
        }

        tbody.innerHTML = data.data.map(v => `
            <tr>
                <td>${v.REG_NUMBER}</td>
                <td>${v.VEHICLE_TYPE}</td>
                <td>${v.CAPACITY}</td>
                <td>${v.FUEL_TYPE}</td>
                <td>${badge('Available')}</td>
                <td>${v.ASSIGNED_DRIVER ?? '<span class="text-muted">Unassigned</span>'}</td>
            </tr>
        `).join('');

    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6">Failed.</td></tr>';
        console.error(err);
    }
}