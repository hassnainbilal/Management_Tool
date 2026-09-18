/**
 * server/index.js  -  application entry point
 * ------------------------------------------------------------------
 * 1. builds the Express app (REST API + static frontend)
 * 2. wraps it in a raw HTTP server
 * 3. attaches Socket.IO to that same server for real-time updates
 *
 * Run with:  npm start      ->  http://localhost:3000
 * ------------------------------------------------------------------
 */
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const realtime = require('./realtime');
const userRoutes = require('./routes/users');
const projectRoutes = require('./routes/projects');
const taskRoutes = require('./routes/tasks');
const commentRoutes = require('./routes/comments');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());

// tiny request logger - handy while demoing the project
app.use((req, _res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/* ------------------------------ API -------------------------------- */
app.use('/api', userRoutes);              // /api/auth/*  and  /api/users
app.use('/api/projects', projectRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api', commentRoutes);           // /api/comments  and  /api/notifications

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

/* -------------------------- FRONTEND ------------------------------- */
app.use(express.static(path.join(__dirname, '..', 'public')));

// any unknown non-API route falls back to the single page app
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/* ------------------------ ERROR HANDLER ---------------------------- */
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/* --------------------- HTTP + WEBSOCKET SERVER --------------------- */
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
realtime.init(io);

server.listen(PORT, () => {
  console.log('----------------------------------------------------');
  console.log('  CodeAlpha Task 3 - Project Management Tool');
  console.log('  Server running on http://localhost:' + PORT);
  console.log('  Real-time updates: Socket.IO enabled');
  console.log('----------------------------------------------------');
});
