import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '../api/client';

const AuthContext = createContext();

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionPassword, setSessionPassword] = useState(() => sessionStorage.getItem('sessionPassword'));
  const [token, setToken] = useState(() => localStorage.getItem('token'));
  const [loading, setLoading] = useState(!!localStorage.getItem('token'));

  // Restore user session on mount if token exists
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    if (!savedToken) {
      setLoading(false);
      return;
    }
    api.get('/users/me')
      .then((res) => {
        setUser(res.user);
        setLoading(false);
      })
      .catch(() => {
        // Token invalid or expired
        localStorage.removeItem('token');
        sessionStorage.removeItem('sessionPassword');
        setToken(null);
        setSessionPassword(null);
        setLoading(false);
      });
  }, []);

  const login = useCallback(async (userName, password, captchaId, captchaAnswer) => {
    const res = await api.post('/auth/login', { userName, password, captchaId, captchaAnswer });
    setUser(res.user);
    setSessionPassword(password);
    setToken(res.token);
    localStorage.setItem('token', res.token);
    sessionStorage.setItem('sessionPassword', password);
    // Save credentials to Android SharedPreferences for auto-login
    if (typeof window !== 'undefined' && window.AndroidBridge && window.AndroidBridge.saveCredentials) {
      try { window.AndroidBridge.saveCredentials(userName, password); } catch {}
    }
    return res.user;
  }, []);

  const autoLogin = useCallback(async (userName, password) => {
    const res = await api.post('/auth/auto-login', { userName, password });
    setUser(res.user);
    setSessionPassword(password);
    setToken(res.token);
    localStorage.setItem('token', res.token);
    sessionStorage.setItem('sessionPassword', password);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Ignore logout errors
    }
    setUser(null);
    setSessionPassword(null);
    setToken(null);
    localStorage.removeItem('token');
    sessionStorage.removeItem('sessionPassword');
    // Clear saved credentials in Android
    if (typeof window !== 'undefined' && window.AndroidBridge && window.AndroidBridge.clearCredentials) {
      try { window.AndroidBridge.clearCredentials(); } catch {}
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, sessionPassword, token, login, autoLogin, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
