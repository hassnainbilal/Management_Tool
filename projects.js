/**
 * routes/projects.js  ->  mounted at /api/projects
 * ------------------------------------------------------------------
 * GET    /api/projects              projects I belong to
 * POST   /api/projects              create a group project
 * GET    /api/projects/:id          one project + its members + columns
 * PATCH  /api/projects/:id          rename / edit description (owner only)
 * DELETE /api/projects/:id          delete project + its tasks + comments
 * POST   /api/projects/:id/members  invite a teammate by email
 * DELETE /api/projects/:id/members/:userId   remove a teammate (owner only)
 * ------------------------------------------------------------------
 */
const express = require('express');
const db = require('../db');
const { requireAuth, requireMember, publicUser } = require('../auth');
const realtime = require('../realtime');

const router = express.Router();
router.use(requireAuth);                       // every route below needs a login

const memberOnly = requireMember(req => req.params.id);

// Default board columns every new project starts with.
const DEFAULT_COLUMNS = [
  { id: 'todo',  title: 'To Do' },
  { id: 'doing', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done',  title: 'Done' }
];

/** Attach the member objects so the frontend can show avatars. */
function withMembers(project) {
  return {
    ...project,
    members: project.memberIds
      .map(uid => publicUser(db.findById('users', uid)))
      .filter(Boolean)
  };
}

/* --------------------------- MY PROJECTS --------------------------- */
router.get('/', (req, res) => {
  const mine = db.findAll('projects', p => p.memberIds.includes(req.user.id));
  res.json(mine.map(p => ({
    ...withMembers(p),
    taskCount: db.findAll('tasks', t => t.projectId === p.id).length
  })));
});

/* ------------------------- CREATE PROJECT -------------------------- */
router.post('/', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Project name is required.' });

  const project = db.insert('projects', {
    name,
    description: (req.body.description || '').trim(),
    ownerId: req.user.id,
    memberIds: [req.user.id],                  // the creator is the first member
    columns: DEFAULT_COLUMNS
  });

  res.status(201).json(withMembers(project));
});

/* --------------------------- ONE PROJECT --------------------------- */
router.get('/:id', memberOnly, (req, res) => {
  res.json(withMembers(req.project));
});

/* ---------------------------- EDIT --------------------------------- */
router.patch('/:id', memberOnly, (req, res) => {
  if (req.project.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Only the project owner can edit the project.' });
  }
  const patch = {};
  if (typeof req.body.name === 'string' && req.body.name.trim()) patch.name = req.body.name.trim();
  if (typeof req.body.description === 'string') patch.description = req.body.description.trim();
  if (Array.isArray(req.body.columns)) patch.columns = req.body.columns;

  const updated = db.update('projects', req.project.id, patch);
  realtime.toProject(updated.id, 'project:updated', withMembers(updated));
  res.json(withMembers(updated));
});

/* --------------------------- DELETE -------------------------------- */
router.delete('/:id', memberOnly, (req, res) => {
  if (req.project.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Only the project owner can delete the project.' });
  }
  const taskIds = db.findAll('tasks', t => t.projectId === req.project.id).map(t => t.id);
  db.removeWhere('comments', c => taskIds.includes(c.taskId));
  db.removeWhere('tasks', t => t.projectId === req.project.id);
  db.removeWhere('notifications', n => n.projectId === req.project.id);
  db.remove('projects', req.project.id);

  realtime.toProject(req.project.id, 'project:deleted', { id: req.project.id });
  res.json({ ok: true });
});

/* ------------------------- ADD A MEMBER ---------------------------- */
router.post('/:id/members', memberOnly, (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = db.findOne('users', u => u.email === email);
  if (!user) return res.status(404).json({ error: 'No registered user with that email.' });
  if (req.project.memberIds.includes(user.id)) {
    return res.status(409).json({ error: 'That user is already a member.' });
  }

  const updated = db.update('projects', req.project.id, {
    memberIds: [...req.project.memberIds, user.id]
  });

  realtime.notify(user.id, {
    text: `${req.user.name} added you to the project "${updated.name}"`,
    projectId: updated.id,
    actorId: req.user.id
  });
  realtime.toProject(updated.id, 'project:updated', withMembers(updated));

  res.status(201).json(withMembers(updated));
});

/* ------------------------ REMOVE A MEMBER -------------------------- */
router.delete('/:id/members/:userId', memberOnly, (req, res) => {
  if (req.project.ownerId !== req.user.id) {
    return res.status(403).json({ error: 'Only the project owner can remove members.' });
  }
  if (req.params.userId === req.project.ownerId) {
    return res.status(400).json({ error: 'The owner cannot be removed from the project.' });
  }

  const updated = db.update('projects', req.project.id, {
    memberIds: req.project.memberIds.filter(uid => uid !== req.params.userId)
  });

  // Un-assign any task that belonged to the removed member.
  db.findAll('tasks', t => t.projectId === updated.id && t.assigneeId === req.params.userId)
    .forEach(t => db.update('tasks', t.id, { assigneeId: null }));

  realtime.toProject(updated.id, 'project:updated', withMembers(updated));
  res.json(withMembers(updated));
});

module.exports = router;
