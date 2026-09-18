/**
 * routes/tasks.js  ->  mounted at /api/tasks
 * ------------------------------------------------------------------
 * GET    /api/tasks?projectId=...   all task cards of one board
 * POST   /api/tasks                 create a card
 * GET    /api/tasks/:id             one card (with its comments)
 * PATCH  /api/tasks/:id             edit / assign / move to another column
 * DELETE /api/tasks/:id             delete a card and its comments
 * ------------------------------------------------------------------
 * Every change is broadcast over WebSockets to 'project:<id>' so other
 * members see the board update without refreshing.
 */
const express = require('express');
const db = require('../db');
const { requireAuth, publicUser } = require('../auth');
const realtime = require('../realtime');

const router = express.Router();
router.use(requireAuth);

const PRIORITIES = ['low', 'medium', 'high'];

/** Helper: load a task and make sure the caller is a member of its project. */
function loadTask(req, res) {
  const task = db.findById('tasks', req.params.id);
  if (!task) { res.status(404).json({ error: 'Task not found.' }); return null; }
  const project = db.findById('projects', task.projectId);
  if (!project || !project.memberIds.includes(req.user.id)) {
    res.status(403).json({ error: 'You are not a member of this project.' });
    return null;
  }
  req.project = project;
  return task;
}

/** Add assignee + comment count so the card can render in one go. */
function decorate(task) {
  return {
    ...task,
    assignee: task.assigneeId ? publicUser(db.findById('users', task.assigneeId)) : null,
    commentCount: db.findAll('comments', c => c.taskId === task.id).length
  };
}

/* ------------------------ TASKS OF A BOARD ------------------------- */
router.get('/', (req, res) => {
  const project = db.findById('projects', req.query.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  if (!project.memberIds.includes(req.user.id)) {
    return res.status(403).json({ error: 'You are not a member of this project.' });
  }
  const tasks = db.findAll('tasks', t => t.projectId === project.id)
                  .sort((a, b) => a.order - b.order)
                  .map(decorate);
  res.json(tasks);
});

/* --------------------------- CREATE -------------------------------- */
router.post('/', (req, res) => {
  const { projectId, title, description, columnId, assigneeId, dueDate, priority } = req.body;

  const project = db.findById('projects', projectId);
  if (!project) return res.status(404).json({ error: 'Project not found.' });
  if (!project.memberIds.includes(req.user.id)) {
    return res.status(403).json({ error: 'You are not a member of this project.' });
  }
  if (!title || !title.trim()) return res.status(400).json({ error: 'Task title is required.' });

  const column = project.columns.find(c => c.id === columnId) || project.columns[0];
  if (assigneeId && !project.memberIds.includes(assigneeId)) {
    return res.status(400).json({ error: 'You can only assign tasks to project members.' });
  }

  const task = db.insert('tasks', {
    projectId,
    title: title.trim(),
    description: (description || '').trim(),
    columnId: column.id,
    assigneeId: assigneeId || null,
    createdBy: req.user.id,
    dueDate: dueDate || null,
    priority: PRIORITIES.includes(priority) ? priority : 'medium',
    order: Date.now()
  });

  const payload = decorate(task);
  realtime.toProject(projectId, 'task:created', payload);      // live update
  if (task.assigneeId) {
    realtime.notify(task.assigneeId, {
      text: `${req.user.name} assigned you the task "${task.title}"`,
      projectId, taskId: task.id, actorId: req.user.id
    });
  }
  res.status(201).json(payload);
});

/* -------------------------- ONE TASK ------------------------------- */
router.get('/:id', (req, res) => {
  const task = loadTask(req, res);
  if (!task) return;
  const comments = db.findAll('comments', c => c.taskId === task.id)
    .map(c => ({ ...c, author: publicUser(db.findById('users', c.userId)) }));
  res.json({ ...decorate(task), comments });
});

/* ---------------- UPDATE (edit, assign, drag to column) ------------ */
router.patch('/:id', (req, res) => {
  const task = loadTask(req, res);
  if (!task) return;

  const patch = {};
  if (typeof req.body.title === 'string' && req.body.title.trim()) patch.title = req.body.title.trim();
  if (typeof req.body.description === 'string') patch.description = req.body.description.trim();
  if (typeof req.body.dueDate !== 'undefined') patch.dueDate = req.body.dueDate || null;
  if (PRIORITIES.includes(req.body.priority)) patch.priority = req.body.priority;
  if (typeof req.body.order === 'number') patch.order = req.body.order;

  if (typeof req.body.columnId === 'string') {
    const column = req.project.columns.find(c => c.id === req.body.columnId);
    if (!column) return res.status(400).json({ error: 'That column does not exist.' });
    patch.columnId = column.id;
  }

  let assigneeChanged = false;
  if (typeof req.body.assigneeId !== 'undefined') {
    const newAssignee = req.body.assigneeId || null;
    if (newAssignee && !req.project.memberIds.includes(newAssignee)) {
      return res.status(400).json({ error: 'You can only assign tasks to project members.' });
    }
    assigneeChanged = newAssignee !== task.assigneeId;
    patch.assigneeId = newAssignee;
  }

  const updated = db.update('tasks', task.id, patch);
  const payload = decorate(updated);
  realtime.toProject(updated.projectId, 'task:updated', payload);

  if (assigneeChanged && updated.assigneeId) {
    realtime.notify(updated.assigneeId, {
      text: `${req.user.name} assigned you the task "${updated.title}"`,
      projectId: updated.projectId, taskId: updated.id, actorId: req.user.id
    });
  }
  if (patch.columnId && patch.columnId !== task.columnId) {
    const columnName = req.project.columns.find(c => c.id === patch.columnId).title;
    const watchers = [updated.assigneeId, updated.createdBy];
    realtime.notify(watchers, {
      text: `${req.user.name} moved "${updated.title}" to ${columnName}`,
      projectId: updated.projectId, taskId: updated.id, actorId: req.user.id
    });
  }

  res.json(payload);
});

/* --------------------------- DELETE -------------------------------- */
router.delete('/:id', (req, res) => {
  const task = loadTask(req, res);
  if (!task) return;

  db.removeWhere('comments', c => c.taskId === task.id);
  db.removeWhere('notifications', n => n.taskId === task.id);
  db.remove('tasks', task.id);

  realtime.toProject(task.projectId, 'task:deleted', { id: task.id, projectId: task.projectId });
  res.json({ ok: true });
});

module.exports = router;
