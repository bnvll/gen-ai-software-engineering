'use strict';

const crypto = require('node:crypto');
const { NotFoundError } = require('../utils/errors');
const { nowIso } = require('../models/ticket');
const { classifyTicket } = require('../services/classifier');

function rowToTicket(row, logRows = []) {
  if (!row) return null;
  return {
    id: row.id,
    customer_id: row.customer_id,
    customer_email: row.customer_email,
    customer_name: row.customer_name,
    subject: row.subject,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    assigned_to: row.assigned_to,
    tags: JSON.parse(row.tags),
    metadata: JSON.parse(row.metadata),
    classification: row.classification_confidence == null && !row.classification_reasoning
      ? null
      : {
        confidence: row.classification_confidence,
        reasoning: row.classification_reasoning,
        keywords_found: row.classification_keywords ? JSON.parse(row.classification_keywords) : [],
      },
    classification_log: logRows.map((entry) => ({
      id: entry.id,
      decided_at: entry.decided_at,
      source: entry.source,
      category: entry.category,
      priority: entry.priority,
      confidence: entry.confidence,
      reasoning: entry.reasoning,
      keywords_found: entry.keywords ? JSON.parse(entry.keywords) : [],
    })),
  };
}

class TicketStore {
  /** @param {import('node:sqlite').DatabaseSync} db */
  constructor(db) {
    this.db = db;
    this.insertStmt = db.prepare(`
      INSERT INTO tickets (
        id, customer_id, customer_email, customer_name, subject, description,
        category, priority, status, created_at, updated_at, resolved_at,
        assigned_to, tags, metadata, classification_confidence,
        classification_reasoning, classification_keywords
      ) VALUES (
        @id, @customer_id, @customer_email, @customer_name, @subject, @description,
        @category, @priority, @status, @created_at, @updated_at, @resolved_at,
        @assigned_to, @tags, @metadata, @classification_confidence,
        @classification_reasoning, @classification_keywords
      )
    `);
    this.getStmt = db.prepare('SELECT * FROM tickets WHERE id = ?');
    this.deleteStmt = db.prepare('DELETE FROM tickets WHERE id = ?');
    this.logStmt = db.prepare(`
      INSERT INTO classification_log (
        ticket_id, decided_at, source, category, priority, confidence, reasoning, keywords
      ) VALUES (
        @ticket_id, @decided_at, @source, @category, @priority, @confidence, @reasoning, @keywords
      )
    `);
    this.logForTicketStmt = db.prepare(
      'SELECT * FROM classification_log WHERE ticket_id = ? ORDER BY id ASC',
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS count FROM tickets');
  }

  get size() {
    return this.countStmt.get().count;
  }

  create(input, { classifySource = 'auto_create' } = {}) {
    const id = crypto.randomUUID();
    const created_at = nowIso();
    const shouldClassify = Boolean(input.auto_classify);
    const result = shouldClassify ? classifyTicket(input) : null;

    const category = shouldClassify ? result.category : (input.category || 'other');
    const priority = shouldClassify ? result.priority : (input.priority || 'medium');
    const resolved_at = ['resolved', 'closed'].includes(input.status) ? created_at : null;

    this.insertStmt.run({
      id,
      customer_id: input.customer_id,
      customer_email: input.customer_email,
      customer_name: input.customer_name,
      subject: input.subject,
      description: input.description,
      category,
      priority,
      status: input.status || 'new',
      created_at,
      updated_at: created_at,
      resolved_at,
      assigned_to: input.assigned_to,
      tags: JSON.stringify(input.tags || []),
      metadata: JSON.stringify(input.metadata),
      classification_confidence: result?.confidence ?? null,
      classification_reasoning: result?.reasoning ?? null,
      classification_keywords: result ? JSON.stringify(result.keywords_found) : null,
    });

    if (result) {
      this.appendLog(id, {
        source: classifySource,
        category: result.category,
        priority: result.priority,
        confidence: result.confidence,
        reasoning: result.reasoning,
        keywords_found: result.keywords_found,
      });
    }

    return this.getById(id);
  }

  appendLog(ticketId, log) {
    this.logStmt.run({
      ticket_id: ticketId,
      decided_at: nowIso(),
      source: log.source,
      category: log.category,
      priority: log.priority,
      confidence: log.confidence ?? null,
      reasoning: log.reasoning ?? null,
      keywords: JSON.stringify(log.keywords_found || []),
    });
  }

  getById(id, { includeLog = true } = {}) {
    const row = this.getStmt.get(id);
    if (!row) throw new NotFoundError(`Ticket ${id} was not found`);
    const logs = includeLog ? this.logForTicketStmt.all(id) : [];
    return rowToTicket(row, logs);
  }

  list(filters = {}) {
    const clauses = [];
    const params = {};
    for (const key of ['category', 'priority', 'status', 'customer_id', 'assigned_to']) {
      if (filters[key]) {
        clauses.push(`${key} = @${key}`);
        params[key] = filters[key];
      }
    }
    if (filters.q) {
      clauses.push('(subject LIKE @q OR description LIKE @q OR customer_name LIKE @q OR customer_email LIKE @q)');
      params.q = `%${filters.q}%`;
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const stmt = this.db.prepare(`SELECT * FROM tickets ${where} ORDER BY created_at DESC`);
    const rows = stmt.all(params);
    return rows.map((row) => rowToTicket(row, []));
  }

  update(id, patch) {
    const current = this.getById(id);
    const next = {
      ...current,
      ...patch,
      tags: patch.tags ?? current.tags,
      metadata: patch.metadata ?? current.metadata,
    };

    const statusChangedToResolved = ['resolved', 'closed'].includes(next.status)
      && !['resolved', 'closed'].includes(current.status);
    const statusReopened = !['resolved', 'closed'].includes(next.status)
      && ['resolved', 'closed'].includes(current.status);

    let resolved_at = next.resolved_at;
    if (patch.resolved_at !== undefined) resolved_at = patch.resolved_at;
    else if (statusChangedToResolved) resolved_at = nowIso();
    else if (statusReopened) resolved_at = null;

    const categoryChanged = patch.category && patch.category !== current.category;
    const priorityChanged = patch.priority && patch.priority !== current.priority;

    this.db.prepare(`
      UPDATE tickets SET
        customer_id = @customer_id,
        customer_email = @customer_email,
        customer_name = @customer_name,
        subject = @subject,
        description = @description,
        category = @category,
        priority = @priority,
        status = @status,
        updated_at = @updated_at,
        resolved_at = @resolved_at,
        assigned_to = @assigned_to,
        tags = @tags,
        metadata = @metadata
      WHERE id = @id
    `).run({
      id,
      customer_id: next.customer_id,
      customer_email: next.customer_email,
      customer_name: next.customer_name,
      subject: next.subject,
      description: next.description,
      category: next.category,
      priority: next.priority,
      status: next.status,
      updated_at: nowIso(),
      resolved_at,
      assigned_to: next.assigned_to,
      tags: JSON.stringify(next.tags),
      metadata: JSON.stringify(next.metadata),
    });

    if (categoryChanged || priorityChanged) {
      this.appendLog(id, {
        source: 'manual_override',
        category: next.category,
        priority: next.priority,
        confidence: null,
        reasoning: 'Manual override via PUT /tickets/:id',
        keywords_found: [],
      });
    }

    return this.getById(id);
  }

  delete(id) {
    this.getById(id, { includeLog: false });
    this.db.prepare('DELETE FROM classification_log WHERE ticket_id = ?').run(id);
    this.deleteStmt.run(id);
  }

  autoClassify(id) {
    const ticket = this.getById(id);
    const result = classifyTicket(ticket);
    this.db.prepare(`
      UPDATE tickets SET
        category = @category,
        priority = @priority,
        updated_at = @updated_at,
        classification_confidence = @confidence,
        classification_reasoning = @reasoning,
        classification_keywords = @keywords
      WHERE id = @id
    `).run({
      id,
      category: result.category,
      priority: result.priority,
      updated_at: nowIso(),
      confidence: result.confidence,
      reasoning: result.reasoning,
      keywords: JSON.stringify(result.keywords_found),
    });
    this.appendLog(id, {
      source: 'auto_endpoint',
      category: result.category,
      priority: result.priority,
      confidence: result.confidence,
      reasoning: result.reasoning,
      keywords_found: result.keywords_found,
    });
    const updated = this.getById(id);
    return {
      ...result,
      ticket: updated,
    };
  }
}

module.exports = { TicketStore, rowToTicket };
