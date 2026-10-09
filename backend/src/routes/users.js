﻿import { Router } from 'express';
import { authMiddleware, sessionKeyMiddleware, requireRole } from '../middleware/auth.js';
import {
  formatUser,
  updateUserProfile,
  updatePassword,
  listAllUsers,
  listNormalUsers,
  getUserByName,
  getUserByEmail,
  deleteNormalUser,
  deleteNormalUsers,
  adminUpdateProfile,
  adminResetPassword,
  getAdminProfileOverride,
  createNormalUser,
  searchUsersByName,
  listUsersNeedingPasswordReset,
  adminSetPassword,
} from '../services/userService.js';

const router = Router();
router.use(authMiddleware, sessionKeyMiddleware);

router.get('/me', async (req, res) => {
  const password = req.sessionPassword;
  let user = await formatUser(req.user, password);
  const override = await getAdminProfileOverride(req.user.user_name);
  if (override) {
    user = {
      ...user,
      photo: override.photo || user.photo,
      address: override.address || user.address,
      familyName: override.familyName || user.familyName,
      givenName: override.givenName || user.givenName,
    };
  }
  res.json({ user });
});

router.put('/me', async (req, res) => {
  const { photo, address, familyName, givenName, oldPassword, newPassword } = req.body;
  const password = req.sessionPassword || oldPassword;
  if (!password) return res.status(400).json({ error: 'Password required' });

  if (photo !== undefined || address !== undefined || familyName !== undefined || givenName !== undefined) {
    await updateUserProfile(req.user, password, { photo, address, familyName, givenName });
  }
  if (newPassword) {
    const ok = await updatePassword(req.user, password, newPassword);
    if (!ok) return res.status(400).json({ error: 'Wrong password', errorZh: '当前密码错误' });
  }
  const updated = await getUserByName(req.user.user_name);
  res.json({ user: await formatUser(updated, newPassword || password) });
});

router.get('/all', requireRole('SYS_ADMIN', 'SUPER_ADMIN'), async (req, res) => {
  if (req.userRole === 'SUPER_ADMIN') {
    return res.json({ users: await listNormalUsers() });
  }
  res.json({ users: await listAllUsers() });
});

router.get('/search/:pattern', requireRole('SYS_ADMIN'), async (req, res) => {
  const pattern = req.params.pattern;
  const users = await searchUsersByName(pattern);
  const results = [];
  for (const user of users) {
    const override = await getAdminProfileOverride(user.user_name);
    results.push({
      id: user.id,
      user_name: user.user_name,
      email: user.email,
      role: user.role,
      created_at: user.created_at,
      photo: override?.photo || '(encrypted)',
      address: override?.address || '(encrypted)',
      familyName: override?.familyName || '',
      givenName: override?.givenName || '',
    });
  }
  res.json({ users: results });
});

router.post('/create', requireRole('SYS_ADMIN'), async (req, res) => {
  const { userName, email, password, photo, address, familyName, givenName } = req.body;
  if (!userName) {
    return res.status(400).json({ error: 'userName is required' });
  }
  if (!password) {
    return res.status(400).json({ error: 'password is required' });
  }
  if (await getUserByName(userName)) {
    return res.status(400).json({ error: 'User already exists' });
  }
  if (email && (await getUserByEmail(email))) {
    return res.status(400).json({ error: 'Email already exists' });
  }
  const { id, password: newPassword } = await createNormalUser({ userName, email, password, photo, address, familyName, givenName });
  res.json({ success: true, id, password: newPassword });
});

router.post('/batch-delete', requireRole('SYS_ADMIN'), async (req, res) => {
  const { userNames } = req.body;
  if (!Array.isArray(userNames) || userNames.length === 0) {
    return res.status(400).json({ error: 'userNames array required' });
  }
  const deleted = await deleteNormalUsers(userNames);
  res.json({ success: true, deleted });
});

router.delete('/:userName', requireRole('SYS_ADMIN'), async (req, res) => {
  const ok = await deleteNormalUser(req.params.userName);
  if (!ok) return res.status(400).json({ error: 'Cannot delete' });
  res.json({ success: true });
});

router.put('/:userName/profile', requireRole('SYS_ADMIN'), async (req, res) => {
  const { photo, address, familyName, givenName, resetPassword, email, newPassword } = req.body;
  const userName = req.params.userName;

  try {
    await adminUpdateProfile(userName, photo, address, familyName, givenName, email);
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('unique') || msg.includes('UNIQUE') || msg.includes('duplicate')) {
      return res.status(400).json({ error: 'Email already in use', errorZh: '邮箱已被其他用户使用' });
    }
    return res.status(500).json({ error: 'Profile update failed', errorZh: '更新失败: ' + msg });
  }

  let resultPassword = null;
  if (resetPassword) {
    try {
      const result = await adminResetPassword(userName);
      resultPassword = result.password;
    } catch (err) {
      return res.status(500).json({ error: 'Reset password failed', errorZh: '重置密码失败: ' + String(err?.message || err) });
    }
  } else if (newPassword) {
    try {
      const ok = await adminSetPassword(userName, newPassword);
      if (!ok) return res.status(400).json({ error: 'Cannot set password', errorZh: '无法设置密码' });
      resultPassword = newPassword;
    } catch (err) {
      return res.status(500).json({ error: 'Set password failed', errorZh: '设置密码失败: ' + String(err?.message || err) });
    }
  }

  res.json({ success: true, ...(resultPassword && { password: resultPassword, newPassword: resultPassword }) });
});

router.post('/:userName/reset-password', requireRole('SYS_ADMIN'), async (req, res) => {
  const userName = req.params.userName;
  const result = await adminResetPassword(userName);
  if (!result) return res.status(400).json({ error: 'Cannot reset password' });
  res.json({ success: true, password: result.password });
});

// List users who need password reset (password_hash is NULL)
router.get('/pending-reset', requireRole('SYS_ADMIN'), async (req, res) => {
  const users = await listUsersNeedingPasswordReset();
  res.json({ users });
});

// SYS_ADMIN sets a specific password for a user
router.post('/:userName/set-password', requireRole('SYS_ADMIN'), async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password is required' });
  const ok = await adminSetPassword(req.params.userName, password);
  if (!ok) return res.status(400).json({ error: 'Cannot set password' });
  res.json({ success: true });
});

export default router;