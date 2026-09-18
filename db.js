/**
 * db.js
 * ------------------------------------------------------------------
 * A very small JSON-file database.
 *
 * Why not MongoDB/MySQL?  So the reviewer can run the project with
 * only `npm install && npm start` - no database server to set up.
 * The API below (findAll / findOne / insert / update / remove) is
 * deliberately shaped like a real ORM, so swapping in Mongoose or
 * Sequelize later means changing only this one file.
 * ------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

// The "tables" of our database.
const EMPTY_DB = {
  users: [],
  projects: [],
  tasks: [],
  comments: [],
  notifications: []
};

// ---------- load once into memory ----------
function load() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(EMPTY_DB, null, 2));
    return { ...EMPTY_DB };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return { ...EMPTY_DB, ...parsed };          // make sure no table is missing
  } catch (err) {
    console.error('database.json was corrupted, starting fresh.', err.message);
    return { ...EMPTY_DB };
  }
}

let cache = load();

// Writing is debounced so 50 quick task-moves do not cause 50 disk writes.
let writeTimer = null;
function save() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    fs.writeFileSync(DB_FILE, JSON.stringify(cache, null, 2));
  }, 40);
}

// ---------- id helper ----------
let counter = 0;
function id() {
  counter += 1;
  return Date.now().toString(36) + '-' + counter.toString(36) + '-' +
         Math.random().toString(36).slice(2, 7);
}

// ---------- generic CRUD ----------
const db = {
  id,

  /** every row of a table, optionally filtered: findAll('tasks', t => t.projectId === x) */
  findAll(table, filterFn) {
    const rows = cache[table] || [];
    return filterFn ? rows.filter(filterFn) : rows.slice();
  },

  /** first matching row, or null */
  findOne(table, filterFn) {
    return (cache[table] || []).find(filterFn) || null;
  },

  findById(table, rowId) {
    return (cache[table] || []).find(r => r.id === rowId) || null;
  },

  /** insert a row; an id and createdAt are added automatically */
  insert(table, row) {
    const record = { id: id(), createdAt: new Date().toISOString(), ...row };
    cache[table].push(record);
    save();
    return record;
  },

  /** patch a row by id and return the updated copy */
  update(table, rowId, patch) {
    const row = cache[table].find(r => r.id === rowId);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    save();
    return row;
  },

  /** delete one row (returns true/false) */
  remove(table, rowId) {
    const before = cache[table].length;
    cache[table] = cache[table].filter(r => r.id !== rowId);
    save();
    return cache[table].length < before;
  },

  /** delete many rows, e.g. every comment of a deleted task */
  removeWhere(table, filterFn) {
    cache[table] = cache[table].filter(r => !filterFn(r));
    save();
  }
};

module.exports = db;
