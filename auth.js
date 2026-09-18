/**
 * auth.js
 * ------------------------------------------------------------------
 * Everything related to "who is this request coming from?"
 *   - hashPassword / checkPassword  -> bcryptjs
 *   - signToken / verifyToken       -> JSON Web Token
 *   - requireAuth                   -> Express middleware
 *   - requireMember                 -> only project members may touch a project
 * ------------------------------------------------------------------
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

// In a real deployment this comes from an environment variable.
const JWT_SECRET = process.env.JWT_SECRET || 'codealpha-task3-dev-secret-change-me';
const TOKEN_LIFETIME = '7d';

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);           // 10 salt rounds
}

function checkPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_LIFETIME });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);      // returns the payload
  } catch {
    return null;                               // expired or tampered
  }
}

/** Strip the password hash before sending a user to the browser. */
function publicUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

/**
 * Express middleware.
 * Expects:  Authorization: Bearer <token>
 * On success it puts the full user record on req.user.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided. Please log in.' });

  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired. Please log in again.' });

  const user = db.findById('users', payload.id);
  if (!user) return res.status(401).json({ error: 'User no longer exists.' });

  req.user = user;
  next();
}

/**
 * Middleware factory: makes sure req.user is a member of the project.
 * `getProjectId` tells it where to find the project id on the request.
 */
function requireMember(getProjectId) {
  return (req, res, next) => {
    const projectId = getProjectId(req);
    const project = db.findById('projects', projectId);
    if (!project) return res.status(404).json({ error: 'Project not found.' });
    if (!project.memberIds.includes(req.user.id)) {
      return res.status(403).json({ error: 'You are not a member of this project.' });
    }
    req.project = project;
    next();
  };
}

module.exports = {
  JWT_SECRET,
  hashPassword,
  checkPassword,
  signToken,
  verifyToken,
  publicUser,
  requireAuth,
  requireMember
};
