import { useState, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { Captcha } from '../components/Captcha';
import { LotusSpinner } from '../components/LotusSpinner';
import { LanguageToggle } from '../components/LanguageToggle';

export function Login() {
  const { t } = useLanguage();
  const { login, autoLogin } = useAuth();
  const navigate = useNavigate();
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captcha, setCaptcha] = useState({ id: '', answer: '' });
  const [error, setError] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [autoLoggingIn, setAutoLoggingIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loginMode, setLoginMode] = useState(() => localStorage.getItem('loginMode') || 'count');
  const autoLoginAttempted = useRef(false);

  const navigateByRole = (user, mode) => {
    if (mode === 'count') {
      navigate('/count');
      return;
    }
    if (user.role === 'SUPER_ADMIN') navigate('/super');
    else if (user.role === 'SYS_ADMIN') navigate('/sys');
    else navigate('/home');
  };

  // Auto-login with saved credentials (Android app)
  // Uses the synchronous AndroidBridge.getCredentials() when available —
  // injected __SAVED_CREDENTIALS__ can race with React's first render.
  useEffect(() => {
    if (autoLoginAttempted.current) return;
    autoLoginAttempted.current = true;

    let savedCreds = null;
    try {
      if (window.AndroidBridge && window.AndroidBridge.getCredentials) {
        savedCreds = JSON.parse(window.AndroidBridge.getCredentials());
      }
    } catch {}
    if (!savedCreds || !savedCreds.userName || !savedCreds.password) {
      savedCreds = window.__SAVED_CREDENTIALS__;
    }
    if (savedCreds && savedCreds.userName && savedCreds.password) {
      setAutoLoggingIn(true);
      autoLogin(savedCreds.userName, savedCreds.password)
        .then((user) => {
          const mode = localStorage.getItem('loginMode') || 'count';
          navigateByRole(user, mode);
        })
        .catch(() => {
          setAutoLoggingIn(false);
        });
    }
  }, [autoLogin, navigate]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login(userName, password, captcha.id, captcha.answer);
      localStorage.setItem('loginMode', loginMode);
      navigateByRole(user, loginMode);
    } catch (err) {
      setError(err.data?.errorZh || err.message);
      setCaptchaKey(k => k + 1);
    } finally {
      setSubmitting(false);
    }
  };

  const handleModeChange = (mode) => {
    setLoginMode(mode);
    localStorage.setItem('loginMode', mode);
  };

  if (autoLoggingIn) {
    return (
      <div className="page login-page">
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <LotusSpinner size={90} />
        </div>
      </div>
    );
  }

  return (
    <div className="page login-page">
      <header className="top-bar">
        <h1>{t('title')}</h1>
        <LanguageToggle />
      </header>
      <form className="card login-form" onSubmit={handleLogin}>
        <label>{t('userName')}<input value={userName} onChange={(e) => setUserName(e.target.value)} required /></label>
        <label>{t('password')}
          <div className="password-input-row" style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword(s => !s)}
              aria-label={showPassword ? '隐藏密码' : '显示密码'}
              style={{
                position: 'absolute',
                right: '.4rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '.2rem',
                fontSize: '1.1rem',
                lineHeight: 1,
              }}
            >
              {showPassword ? '🙈' : '👁'}
            </button>
          </div>
        </label>
        <Captcha key={captchaKey} onChange={setCaptcha} />
        <div className="login-mode-row" role="group" aria-label={t('diaryMode') + '/' + t('countMode')}>
          <label className={`login-mode-option${loginMode === 'diary' ? ' active' : ''}`}>
            <input
              type="radio"
              name="loginMode"
              value="diary"
              checked={loginMode === 'diary'}
              onChange={() => handleModeChange('diary')}
            />
            <span>{t('diaryMode')}</span>
          </label>
          <label className={`login-mode-option${loginMode === 'count' ? ' active' : ''}`}>
            <input
              type="radio"
              name="loginMode"
              value="count"
              checked={loginMode === 'count'}
              onChange={() => handleModeChange('count')}
            />
            <span>{t('countMode')}</span>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="btn-primary" disabled={submitting}>{t('login')}</button>
        {submitting && <LotusSpinner size={70} />}
        <div className="form-links">
          <Link to="/reset-password">{t('forgotPassword')}</Link>
          <Link to="/register">{t('register')}</Link>
        </div>
        {window.location.protocol !== 'file:' && (
          <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.85rem' }}>
            <a href="diary-app.apk" download>📱 下载 Android APK</a>
          </div>
        )}
      </form>
    </div>
  );
}
