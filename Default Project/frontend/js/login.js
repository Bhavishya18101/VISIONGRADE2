document.addEventListener('DOMContentLoaded', () => {
  if (Auth.isAuthenticated()) {
    Auth.redirectByRole();
    return;
  }

  const form = document.getElementById('loginForm');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const loginBtn = document.getElementById('loginBtn');
  const btnText = loginBtn.querySelector('.btn-text');
  const btnLoader = loginBtn.querySelector('.btn-loader');
  const passwordToggle = document.querySelector('.password-toggle');
  const demoButtons = document.querySelectorAll('.demo-btn');

  const showError = (inputId, message) => {
    const errorEl = document.getElementById(`${inputId}Error`);
    const inputEl = document.getElementById(inputId);
    if (errorEl) errorEl.textContent = message;
    if (inputEl) inputEl.style.borderColor = 'var(--error)';
  };

  const clearError = (inputId) => {
    const errorEl = document.getElementById(`${inputId}Error`);
    const inputEl = document.getElementById(inputId);
    if (errorEl) errorEl.textContent = '';
    if (inputEl) inputEl.style.borderColor = '';
  };

  const clearAllErrors = () => {
    ['email', 'password'].forEach(clearError);
  };

  const setLoading = (loading) => {
    loginBtn.disabled = loading;
    btnText.style.display = loading ? 'none' : 'inline';
    btnLoader.style.display = loading ? 'inline-block' : 'none';
  };

  const showToast = (message, type = 'info') => {
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
  };

  passwordToggle?.addEventListener('click', () => {
    const isPassword = passwordInput.type === 'password';
    passwordInput.type = isPassword ? 'text' : 'password';
    passwordToggle.querySelector('.eye-open').style.display = isPassword ? 'none' : 'block';
    passwordToggle.querySelector('.eye-closed').style.display = isPassword ? 'block' : 'none';
  });

  const validateEmail = (email) => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const validateForm = () => {
    let valid = true;
    clearAllErrors();

    if (!emailInput.value.trim()) {
      showError('email', 'Email is required');
      valid = false;
    } else if (!validateEmail(emailInput.value)) {
      showError('email', 'Please enter a valid email');
      valid = false;
    }

    if (!passwordInput.value) {
      showError('password', 'Password is required');
      valid = false;
    } else if (passwordInput.value.length < 6) {
      showError('password', 'Password must be at least 6 characters');
      valid = false;
    }

    return valid;
  };

  emailInput.addEventListener('input', () => clearError('email'));
  passwordInput.addEventListener('input', () => clearError('password'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAllErrors();

    if (!validateForm()) return;

    setLoading(true);

    try {
      const data = await Auth.login(emailInput.value.trim(), passwordInput.value);
      showToast(`Welcome back, ${data.user.name}!`, 'success');
      setTimeout(() => Auth.redirectByRole(), 800);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  });

  demoButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      emailInput.value = btn.dataset.email;
      passwordInput.value = btn.dataset.password;
      clearAllErrors();
      form.dispatchEvent(new Event('submit'));
    });
  });

  emailInput.focus();
});