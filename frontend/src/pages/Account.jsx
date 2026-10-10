import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';

export function Account() {
  const { t } = useLanguage();
  const { user, setUser, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ user_name: '', photo: '', familyName: '', givenName: '', address: '', oldPassword: '', newPassword: '', confirmPassword: '' });
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [msg, setMsg] = useState('');
  const fileInputRef = useRef(null);

  useEffect(() => {
    api.get('/users/me').then((res) => {
      setForm(f => ({
        ...f,
        user_name: res.user.user_name,
        photo: res.user.photo || '',
        familyName: res.user.familyName || '',
        givenName: res.user.givenName || '',
        address: res.user.address || '',
      }));
      setUser(res.user);
    });
  }, [setUser]);

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMsg(t('photo') + ' must be an image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxSize = 300;
        let width = img.width;
        let height = img.height;
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          } else {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setForm(f => ({ ...f, photo: dataUrl }));
        setMsg('');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const openPhotoDialog = () => {
    fileInputRef.current?.click();
  };

  const handleSave = async (e) => {
    e.preventDefault();
    // Validate password confirmation
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      setMsg(t('passwordMismatch') || '两次密码输入不同');
      return;
    }
    try {
      const res = await api.put('/users/me', {
        photo: form.photo,
        address: form.address,
        familyName: form.familyName,
        givenName: form.givenName,
        oldPassword: form.oldPassword,
        newPassword: form.newPassword || undefined,
      });
      setUser(res.user);
      if (form.newPassword) sessionStorage.setItem('sessionPassword', form.newPassword);
      setForm(f => ({ ...f, oldPassword: '', newPassword: '', confirmPassword: '' }));
      setMsg(t('success'));
    } catch (err) {
      setMsg(err.data?.errorZh || err.message);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="page">
      <header className="top-bar">
        <button className="btn-back" onClick={() => navigate(-1)}>{t('back')}</button>
        <h2>{t('account')}</h2>
      </header>
      <form className="card" onSubmit={handleSave}>
        <label>{t('userName')}<input value={form.user_name} disabled /></label>
        <label>{t('familyName') || 'Family Name'}<input value={form.familyName} onChange={(e) => setForm({ ...form, familyName: e.target.value })} /></label>
        <label>{t('givenName') || 'Given Name'}<input value={form.givenName} onChange={(e) => setForm({ ...form, givenName: e.target.value })} /></label>
        <label>{t('address')}<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <label>{t('photo')}
          <input type="hidden" value={form.photo} readOnly />
          <button type="button" className="btn-secondary" onClick={openPhotoDialog}>{t('uploadPhoto') || 'Upload Photo'}</button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{display:'none'}} onChange={handlePhotoUpload} />
        </label>
        {form.photo && <img src={form.photo} alt="avatar" className="avatar-preview" />}
        <label>{t('oldPassword')}
          <div className="password-input-row" style={{ position: 'relative' }}>
            <input
              type={showOldPassword ? 'text' : 'password'}
              value={form.oldPassword}
              onChange={(e) => setForm({ ...form, oldPassword: e.target.value })}
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowOldPassword(s => !s)}
              style={{ position: 'absolute', right: '.4rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '.2rem', fontSize: '1.1rem', lineHeight: 1 }}
            >
              {showOldPassword ? '🙈' : '👁'}
            </button>
          </div>
        </label>
        <label>{t('newPassword')}
          <div className="password-input-row" style={{ position: 'relative' }}>
            <input
              type={showNewPassword ? 'text' : 'password'}
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
              style={{ paddingRight: '2.5rem' }}
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowNewPassword(s => !s)}
              style={{ position: 'absolute', right: '.4rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: '.2rem', fontSize: '1.1rem', lineHeight: 1 }}
            >
              {showNewPassword ? '🙈' : '👁'}
            </button>
          </div>
        </label>
        <label>{t('confirmPassword') || '确认新密码'}<input type={showNewPassword ? 'text' : 'password'} value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} /></label>
        {msg && <p>{msg}</p>}
        <div style={{ display: 'flex', gap: '.75rem', marginTop: '.5rem' }}>
          <button type="submit" className="btn-primary" style={{ flex: 1 }}>{t('save')}</button>
          <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={handleLogout}>{t('logout')}</button>
        </div>
      </form>
    </div>
  );
}