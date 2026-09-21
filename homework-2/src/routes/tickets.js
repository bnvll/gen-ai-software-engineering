'use strict';

const express = require('express');
const multer = require('multer');
const { parseBoolean, validateCreateInput, validateListQuery, validateUpdateInput } = require('../validators/ticketValidator');
const { parseImportPayload } = require('../services/importer');
const { ValidationError, ApiError } = require('../utils/errors');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function createTicketsRouter(store) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const filters = validateListQuery(req.query);
    const tickets = store.list(filters);
    res.json({ tickets, count: tickets.length });
  });

  router.post('/', (req, res) => {
    const input = validateCreateInput(req.body);
    if (parseBoolean(req.query.auto_classify, false)) input.auto_classify = true;
    const ticket = store.create(input);
    res.status(201).location(`/tickets/${ticket.id}`).json(ticket);
  });

  router.post(
    '/import',
    (req, res, next) => {
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('multipart/form-data')) {
        return upload.single('file')(req, res, next);
      }
      return express.raw({ type: '*/*', limit: '5mb' })(req, res, next);
    },
    (req, res) => {
      const autoClassify = parseBoolean(req.query.auto_classify, false)
        || parseBoolean(req.body?.auto_classify, false)
        || parseBoolean(req.body?.autoClassify, false);

      let filename = '';
      let contentType = req.headers['content-type'] || '';
      let body;

      if (req.file) {
        filename = req.file.originalname || '';
        contentType = req.file.mimetype || contentType;
        body = req.file.buffer.toString('utf8');
        if (req.body && typeof req.body === 'object' && parseBoolean(req.body.auto_classify, false)) {
          // multer puts text fields on req.body
        }
      } else if (Buffer.isBuffer(req.body)) {
        body = req.body.toString('utf8');
      } else if (typeof req.body === 'string') {
        body = req.body;
      } else {
        throw new ApiError(400, 'Malformed file', 'Provide a CSV, JSON or XML file (multipart field "file" or raw body)');
      }

      const fieldAuto = req.file && req.body && parseBoolean(req.body.auto_classify, false);
      const { format, records } = parseImportPayload({ contentType, filename, body });

      const errors = [];
      const created = [];
      for (const record of records) {
        try {
          const input = validateCreateInput(record.row);
          if (autoClassify || fieldAuto || input.auto_classify) input.auto_classify = true;
          created.push(store.create(input, { classifySource: 'auto_import' }));
        } catch (error) {
          if (error instanceof ValidationError) {
            errors.push({
              index: record.index,
              error: error.error,
              details: error.details,
            });
          } else {
            errors.push({
              index: record.index,
              error: 'Import failed',
              details: [{ field: 'row', message: error.message }],
            });
          }
        }
      }

      res.status(200).json({
        format,
        total: records.length,
        successful: created.length,
        failed: errors.length,
        errors,
        tickets: created,
      });
    },
  );

  router.get('/:id', (req, res) => {
    res.json(store.getById(req.params.id));
  });

  router.put('/:id', (req, res) => {
    const patch = validateUpdateInput(req.body);
    res.json(store.update(req.params.id, patch));
  });

  router.delete('/:id', (req, res) => {
    store.delete(req.params.id);
    res.status(204).end();
  });

  router.post('/:id/auto-classify', (req, res) => {
    const result = store.autoClassify(req.params.id);
    res.json({
      category: result.category,
      priority: result.priority,
      confidence: result.confidence,
      reasoning: result.reasoning,
      keywords_found: result.keywords_found,
      ticket: result.ticket,
    });
  });

  return router;
}

module.exports = { createTicketsRouter };
