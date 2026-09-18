# TeamBoard — Collaborative Project Management Tool
### CodeAlpha Internship · Full Stack Development · **Task 3**
**Submitted by: Hassnain Bilal**

A Trello / Asana style project management tool. Teams create group projects, add
members, move task cards across a board, assign work, and chat inside each task —
with live updates over WebSockets, so every member sees changes instantly.

---

## 1. How to run it (2 commands)

```bash
npm install
npm start
```

Then open **http://localhost:3000**

Requirements: **Node.js 18 or newer**. No database server needed — data is stored
in `server/data/database.json`, which is created automatically on first run.

### Try the collaboration features
1. Sign up as **User A** and create a project.
2. Open a **second browser** (or an incognito window) and sign up as **User B**.
3. As User A, click **+ Member** and enter User B's email.
4. Put both windows side by side: create a task, drag a card, or post a comment in
   one window — it appears in the other window **immediately**, and the other user
   gets a notification in the bell icon.

---

## 2. Requirements checklist

| Requirement | Where it is implemented |
|---|---|
| Full-stack application | Node.js + Express backend, HTML/CSS/JS frontend served by the same server |
| Authentication system | `server/auth.js` — bcrypt password hashing + JWT tokens, protected routes |
| Create group projects | `POST /api/projects`, invite members by email |
| Project boards | Four columns (To Do / In Progress / Review / Done) with drag-and-drop |
| Task cards | Title, description, assignee, priority, due date, comment count |
| Assign tasks | Assignee dropdown limited to project members |
| Comment on tasks | `POST /api/comments` — threaded discussion inside each card |
| Communicate within tasks | Live comment stream + "user is typing…" indicator |
| Backend for Users | `server/routes/users.js` |
| Backend for Projects | `server/routes/projects.js` |
| Backend for Tasks | `server/routes/tasks.js` |
| Backend for Comments | `server/routes/comments.js` |
| **Bonus:** Notifications | Stored in the database + pushed live; bell icon with unread badge |
| **Bonus:** Real-time updates | Socket.IO rooms (`project:<id>`, `user:<id>`) in `server/realtime.js` |

---

## 3. Project structure

```
project-management-tool/
├── package.json
├── README.md
├── server/
│   ├── index.js          Express app + HTTP server + Socket.IO
│   ├── db.js             small JSON-file database (findAll / insert / update / remove)
│   ├── auth.js           bcrypt, JWT, requireAuth & requireMember middleware
│   ├── realtime.js       WebSocket rooms, broadcasts, notification helper
│   ├── data/             database.json (auto-created, git-ignored)
│   └── routes/
│       ├── users.js      register / login / me / list users
│       ├── projects.js   project CRUD + members
│       ├── tasks.js      task CRUD + move + assign
│       └── comments.js   comments + notifications
└── public/
    ├── index.html        single-page UI
    ├── styles.css        styling
    └── app.js            state, API calls, board rendering, drag & drop, sockets
```

---

## 4. REST API

All routes except register/login need the header `Authorization: Bearer <token>`.

### Auth & users
| Method | Endpoint | Body |
|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password }` |
| POST | `/api/auth/login` | `{ email, password }` |
| GET | `/api/auth/me` | — |
| GET | `/api/users` | — |

### Projects
| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/projects` | projects I am a member of |
| POST | `/api/projects` | `{ name, description }` |
| GET | `/api/projects/:id` | members only |
| PATCH | `/api/projects/:id` | owner only |
| DELETE | `/api/projects/:id` | owner only, cascades to tasks & comments |
| POST | `/api/projects/:id/members` | `{ email }` |
| DELETE | `/api/projects/:id/members/:userId` | owner only |

### Tasks
| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/tasks?projectId=` | all cards of a board |
| POST | `/api/tasks` | `{ projectId, title, description, columnId, assigneeId, priority, dueDate }` |
| GET | `/api/tasks/:id` | task + its comments |
| PATCH | `/api/tasks/:id` | edit, assign, or move to another column |
| DELETE | `/api/tasks/:id` | also deletes its comments |

### Comments & notifications
| Method | Endpoint | Notes |
|---|---|---|
| GET | `/api/comments?taskId=` | discussion of one task |
| POST | `/api/comments` | `{ taskId, text }` |
| DELETE | `/api/comments/:id` | author only |
| GET | `/api/notifications` | my 50 newest |
| PATCH | `/api/notifications/:id/read` | — |
| POST | `/api/notifications/read-all` | — |

---

## 5. WebSocket events (Socket.IO)

The socket handshake is authenticated with the same JWT.

**Client → server:** `project:join`, `project:leave`, `task:typing`

**Server → client:** `task:created`, `task:updated`, `task:deleted`,
`comment:created`, `comment:deleted`, `project:updated`, `project:deleted`,
`task:typing`, `notification:new`

---

## 6. Security notes
* Passwords are hashed with bcrypt (10 salt rounds) and never returned by the API.
* JWT tokens expire after 7 days; the secret is read from `process.env.JWT_SECRET`.
* Login errors are deliberately generic so attackers cannot discover valid emails.
* Every project/task/comment route checks project membership before responding.
* Socket connections without a valid token are rejected.
* All user text is escaped in the frontend before rendering (basic XSS protection).

---

## 7. Tech stack
**Backend:** Node.js, Express, Socket.IO, JSON Web Token, bcryptjs
**Frontend:** HTML5, CSS3, vanilla JavaScript (HTML5 drag-and-drop API)
**Storage:** JSON file store with an ORM-like API (`db.js`) — swappable for MongoDB/MySQL
