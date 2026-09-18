/**
 * realtime.js
 * ------------------------------------------------------------------
 * A thin wrapper around Socket.IO so the REST routes never have to
 * know how WebSockets work. They just call:
 *
 *   realtime.toProject(projectId, 'task:created', task)
 *   realtime.notify(userId, 'You were assigned a task', {...})
 *
 * Rooms used:
 *   project:<projectId>  -> everybody currently looking at that board
 *   user:<userId>        -> every tab/device of one user (for notifications)
 * ------------------------------------------------------------------
 */
const db = require('./db');
const { verifyToken } = require('./auth');

let io = null;

function init(socketServer) {
  io = socketServer;

  // --- authenticate the socket handshake with the same JWT ---
  io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    const payload = token ? verifyToken(token) : null;
    if (!payload) return next(new Error('Unauthorized socket connection'));
    socket.userId = payload.id;
    next();
  });

  io.on('connection', socket => {
    // personal room -> notifications follow the user everywhere
    socket.join('user:' + socket.userId);
    console.log('socket connected  :', socket.userId);

    // the client asks to watch one board
    socket.on('project:join', projectId => {
      const project = db.findById('projects', projectId);
      if (project && project.memberIds.includes(socket.userId)) {
        socket.join('project:' + projectId);
      }
    });

    socket.on('project:leave', projectId => socket.leave('project:' + projectId));

    // "Ali is typing a comment..." inside a task
    socket.on('task:typing', ({ projectId, taskId, userName }) => {
      socket.to('project:' + projectId).emit('task:typing', { taskId, userName });
    });

    socket.on('disconnect', () => console.log('socket disconnected:', socket.userId));
  });
}

/** Broadcast an event to everyone viewing a board. */
function toProject(projectId, event, payload) {
  if (io) io.to('project:' + projectId).emit(event, payload);
}

/** Send an event to one user on all their open tabs. */
function toUser(userId, event, payload) {
  if (io) io.to('user:' + userId).emit(event, payload);
}

/**
 * Save a notification in the database AND push it live.
 * `exceptUserId` stops you from notifying yourself about your own action.
 */
function notify(userIds, { text, projectId, taskId, actorId }) {
  const list = Array.isArray(userIds) ? userIds : [userIds];
  list
    .filter(uid => uid && uid !== actorId)
    .forEach(uid => {
      const notification = db.insert('notifications', {
        userId: uid, text, projectId: projectId || null, taskId: taskId || null, read: false
      });
      toUser(uid, 'notification:new', notification);
    });
}

module.exports = { init, toProject, toUser, notify };
