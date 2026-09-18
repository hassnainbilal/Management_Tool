/**
 * routes/users.js  ->  mounted at /api/auth  and  /api/users
 * ------------------------------------------------------------------
 * POST /api/auth/register   { name, email, password }  -> { token, user }
 * POST /api/auth/login      { email, password }        -> { token, user }
 * GET  /api/auth/me                                    -> { user }
 * GET  /api/users                                      -> [ users ]  (to invite people)
 * ------------------------------------------------------------------
 */
const express = require('express');
const db = require('../db');
const { hashPassword, checkPassword, signToken, publicUser, requireAuth } = require('../auth');

const router = express.Router();

/* ----------------------------- REGISTER ----------------------------- */
router.post('/auth/register', (req, res) => {
  const name = (req.body.name || '').trim();
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  // --- validation ---
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are all required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'That email address does not look valid.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }
  if (db.findOne('users', u => u.email === email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }

  const user = db.insert('users', {
    name,
    email,
    password: hashPassword(password),          // never store the plain password
    avatar: name.trim().charAt(0).toUpperCase()
  });

  res.status(201).json({ token: signToken(user), user: publicUser(user) });
});

/* ------------------------------ LOGIN ------------------------------- */
router.post('/auth/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const user = db.findOne('users', u => u.email === email);
  // Same message for "no such user" and "wrong password" so attackers
  // cannot use the error to discover which emails are registered.
  if (!user || !checkPassword(password, user.password)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  res.json({ token: signToken(user), user: publicUser(user) });
});

/* ------------------- WHO AM I (used on page reload) ------------------ */
router.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* ---------------- ALL USERS (for the "add member" box) --------------- */
router.get('/users', requireAuth, (req, res) => {
  res.json(db.findAll('users').map(publicUser));
});

module.exports = router;
