'use strict';

const path = require('node:path');
const { openDatabase } = require('../db');
const { TicketStore } = require('../stores/ticketStore');
const { validateCreateInput } = require('../validators/ticketValidator');
const { ticket } = require('./generateSamples');

const dbPath = process.env.SQLITE_PATH || path.join(__dirname, '..', '..', 'data', 'tickets.db');
const count = Number.parseInt(process.env.SEED_COUNT ?? '50', 10);
const db = openDatabase(dbPath);
const store = new TicketStore(db);
for (let i = 0; i < count; i += 1) {
  const input = validateCreateInput({ ...ticket(i), auto_classify: true });
  input.auto_classify = true;
  store.create(input, { classifySource: 'auto_import' });
}
process.stdout.write(`seeded ${store.size} tickets into ${dbPath}\n`);
db.close();
