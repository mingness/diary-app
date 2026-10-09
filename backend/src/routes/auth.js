import { Router } from 'express';
import {
  getUserByName,
  createUser,
  verifyPassword,
  formatUser,
  setPasswordNull,
  getAdminProfileOverride,
  syncProfileToAdminOverrides,
} from '../services/userService.js';
import { generateCaptcha, verifyCaptcha } from '../services/captchaService.js';
import { signToken } from '../middleware/auth.js';

const router = Router();

router.get('/captcha', async (req, res) => {
  res.json(await generateCaptcha());
});

router.post('/login', async (req, res) => {
  const { userName, password, captchaId, captchaAnswer } = req.body;
  if (!(await verifyCaptcha(captchaId, captchaAnswer))) {
    return res.status(400).json({ error: 'Captcha verification failed', errorZh: '人类验证失败' });
  }
  const user = await getUserByName(userName);
  if (!user || user.password_hash === 'RESET_PENDING' || !user.password_hash || !verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid credentials', errorZh: '用户名或密码错误' });
  }
  const formattedUser = await formatUser(user, password);
  // For existing users: if admin override is empty, sync decrypted profile so SYS_ADMIN can view it
  if (user.role === 'NORMAL_USER') {
    const override = await getAdminProfileOverride(userName);
    if (!override) {
      await syncProfileToAdminOverrides(userName, formattedUser);
    }
  }
  const token = signToken(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 });
  res.json({ user: formattedUser, token });
});

// Auto-login for Android app with saved credentials (no captcha required)
router.post('/auto-login', async (req, res) => {
  const { userName, password } = req.body;
  if (!userName || !password) {
    return res.status(400).json({ error: 'Missing credentials', errorZh: '缺少凭据' });
  }
  const user = await getUserByName(userName);
  if (!user || user.password_hash === 'RESET_PENDING' || !user.password_hash || !verifyPassword(user, password)) {
    return res.status(401).json({ error: 'Invalid credentials', errorZh: '用户名或密码错误' });
  }
  const formattedUser = await formatUser(user, password);
  // For existing users: if admin override is empty, sync decrypted profile so SYS_ADMIN can view it
  if (user.role === 'NORMAL_USER') {
    const override = await getAdminProfileOverride(userName);
    if (!override) {
      await syncProfileToAdminOverrides(userName, formattedUser);
    }
  }
  const token = signToken(user);
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 * 1000 });
  res.json({ user: formattedUser, token });
});

router.post('/register', async (req, res) => {
  const { userName, password, familyName = '', givenName = '', address = '' } = req.body;
  if (await getUserByName(userName)) {
    return res.status(400).json({ error: 'Username taken', errorZh: '用户名已存在' });
  }
  const useEmail = `${userName}@noemail.local`;
  await createUser({
    userName,
    email: useEmail,
    password,
    role: 'NORMAL_USER',
    familyName,
    givenName,
    address,
  });
  res.json({ success: true });
});

router.post('/reset-password', async (req, res) => {
  const { userName } = req.body;
  const user = await getUserByName(userName);
  if (!user) {
    return res.status(404).json({ error: 'User not found', errorZh: '用户名不存在' });
  }
  await setPasswordNull(userName);
  res.json({ success: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

export default router;