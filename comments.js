/**
 * routes/comments.js  ->  mounted at /api/comments  and  /api/notifications
 * ------------------------------------------------------------------
 * GET    /api/comments?taskId=...   the discussion inside one task
 * POST   /api/comments              post a message in a task
 * DELETE /api/comments/:id          delete your own message
 *
 * GET    /api/notifications         my notifications (newest first)
 * PATCH  /api/notifications/:id/read    mark one as read
 * POST   /api/notifications/read-all    mark everything as read
 * ------------------------------------------------------------------
 */
const express = require('express');
const db = require('../db');
const { requireAuth, publicUser } = require('../auth');
const realtime = require('../realtime');

const router = express.Router();
router.use(requireAuth);

/** Load task + project and check membership. Returns null after responding. */
function loadTaskContext(taskId, req, res) {
  const task = db.findById('tasks', taskId);
  if (!task) { res.status(404).json({ error: 'Task not found.' }); return null; }
  const project = db.findById('projects', task.projectId);
  if (!project || !project.memberIds.includes(req.user.id)) {
    res.status(403).json({ error: 'You are not a member of this project.' });
    return null;
  }
  return { task, project };
}

function decorate(comment) {
  return { ...comment, author: publicUser(db.findById('users', comment.userId)) };
}

/* ------------------- COMMENTS OF ONE TASK -------------------------- */
router.get('/comments', (req, res) => {
  const ctx = loadTaskContext(req.query.taskId, req, res);
  if (!ctx) return;
  const comments = db.findAll('comments', c => c.taskId === ctx.task.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(decorate);
  res.json(comments);
});

/* -------------------------- POST A COMMENT ------------------------- */
router.post('/comments', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty.' });

  const ctx = loadTaskContext(req.body.taskId, req, res);
  if (!ctx) return;

  const comment = db.insert('comments', {
    taskId: ctx.task.id,
    projectId: ctx.project.id,
    userId: req.user.id,
    text
  });

  const payload = decorate(comment);

  // 1. live chat update for everybody on the board
  realtime.toProject(ctx.project.id, 'comment:created', payload);

  // 2. notify the assignee, the task creator and anyone already in the thread
  const participants = new Set([
    ctx.task.assigneeId,
    ctx.task.createdBy,
    ...db.findAll('comments', c => c.taskId === ctx.task.id).map(c => c.userId)
  ]);
  realtime.notify([...participants], {
    text: `${req.user.name} commented on "${ctx.task.title}"`,
    projectId: ctx.project.id, taskId: ctx.task.id, actorId: req.user.id
  });

  res.status(201).json(payload);
});

/* ------------------------ DELETE A COMMENT ------------------------- */
router.delete('/comments/:id', (req, res) => {
  const comment = db.findById('comments', req.params.id);
  if (!comment) return res.status(404).json({ error: 'Comment not found.' });
  if (comment.userId !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own comments.' });
  }
  db.remove('comments', comment.id);
  realtime.toProject(comment.projectId, 'comment:deleted', {
    id: comment.id, taskId: comment.taskId
  });
  res.json({ ok: true });
});

/* -------------------------- NOTIFICATIONS -------------------------- */
router.get('/notifications', (req, res) => {
  const list = db.findAll('notifications', n => n.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 50);
  res.json(list);
});

router.patch('/notifications/:id/read', (req, res) => {
  const n = db.findById('notifications', req.params.id);
  if (!n || n.userId !== req.user.id) {
    return res.status(404).json({ error: 'Notification not found.' });
  }
  res.json(db.update('notifications', n.id, { read: true }));
});

router.post('/notifications/read-all', (req, res) => {
  db.findAll('notifications', n => n.userId === req.user.id && !n.read)
    .forEach(n => db.update('notifications', n.id, { read: true }));
  res.json({ ok: true });
});

module.exports = router;
