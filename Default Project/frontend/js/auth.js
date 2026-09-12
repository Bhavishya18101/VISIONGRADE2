const Auth = (() => {
  const TOKEN_KEY = 'vg_token';
  const USER_KEY = 'vg_user';
  const API_BASE = '/api';

  const setAuth = (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  };

  const getToken = () => localStorage.getItem(TOKEN_KEY);

  const getUser = () => {
    const user = localStorage.getItem(USER_KEY);
    return user ? JSON.parse(user) : null;
  };

  const clearAuth = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  };

  const isAuthenticated = () => !!getToken();

  const hasRole = (role) => {
    const user = getUser();
    return user && user.role === role;
  };

  const apiRequest = async (endpoint, options = {}) => {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      clearAuth();
      window.location.href = '/login.html';
      return;
    }

    return response;
  };

  const login = async (email, password) => {
    const response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Login failed');
    }

    setAuth(data.token, data.user);
    return data;
  };

  const register = async (userData) => {
    const response = await fetch(`${API_BASE}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'Registration failed');
    }

    return data;
  };

  const logout = () => {
    clearAuth();
    window.location.href = '/login.html';
  };

  const redirectByRole = () => {
    const user = getUser();
    if (!user) return;

    switch (user.role) {
      case 'admin':
        window.location.href = '/main.html';
        break;
      case 'farmer':
        window.location.href = '/farmer_landing.html';
        break;
      default:
        window.location.href = '/login.html';
    }
  };

  return {
    setAuth,
    getToken,
    getUser,
    clearAuth,
    isAuthenticated,
    hasRole,
    apiRequest,
    login,
    register,
    logout,
    redirectByRole,
  };
})();