'use strict';

const { ValidationErrorBag } = require('../utils/errors');
const {
  CATEGORIES,
  PRIORITIES,
  STATUSES,
  SOURCES,
  DEVICE_TYPES,
  EMAIL_PATTERN,
  isPlainObject,
  asString,
  parseTags,
  parseMetadata,
  parseBoolean,
} = require('../models/ticket');

const CREATE_REQUIRED = ['customer_id', 'customer_email', 'customer_name', 'subject', 'description'];

function enumMessage(name, allowed) {
  return `${name} must be one of: ${allowed.join(', ')}`;
}

function validateEmail(email, bag, field = 'customer_email') {
  if (!email) {
    bag.add(field, 'customer_email is required');
    return;
  }
  if (!EMAIL_PATTERN.test(email)) {
    bag.add(field, 'customer_email must be a valid email address');
  }
}

function validateSubject(subject, bag) {
  if (!subject) {
    bag.add('subject', 'subject is required');
    return;
  }
  if (subject.length < 1 || subject.length > 200) {
    bag.add('subject', 'subject must be between 1 and 200 characters');
  }
}

function validateDescription(description, bag) {
  if (!description) {
    bag.add('description', 'description is required');
    return;
  }
  if (description.length < 10 || description.length > 2000) {
    bag.add('description', 'description must be between 10 and 2000 characters');
  }
}

/**
 * Normalize and validate a create/import payload.
 * Missing category/priority are filled later by the classifier or defaults.
 */
function validateCreateInput(body, { partial = false } = {}) {
  const bag = new ValidationErrorBag();
  if (!isPlainObject(body)) {
    bag.add('body', 'Request body must be a JSON object');
    bag.throwIfAny();
  }

  const customer_id = asString(body.customer_id);
  const customer_email = asString(body.customer_email)?.toLowerCase();
  const customer_name = asString(body.customer_name);
  const subject = asString(body.subject);
  const description = asString(body.description);

  if (!partial) {
    for (const field of CREATE_REQUIRED) {
      if (!asString(body[field])) bag.add(field, `${field} is required`);
    }
  }

  if (customer_email !== undefined) validateEmail(customer_email, bag);
  if (subject !== undefined) validateSubject(subject, bag);
  if (description !== undefined) validateDescription(description, bag);

  let category;
  if (body.category !== undefined && body.category !== null && body.category !== '') {
    category = asString(body.category);
    if (!CATEGORIES.includes(category)) bag.add('category', enumMessage('category', CATEGORIES));
  }

  let priority;
  if (body.priority !== undefined && body.priority !== null && body.priority !== '') {
    priority = asString(body.priority);
    if (!PRIORITIES.includes(priority)) bag.add('priority', enumMessage('priority', PRIORITIES));
  }

  let status = 'new';
  if (body.status !== undefined && body.status !== null && body.status !== '') {
    status = asString(body.status);
    if (!STATUSES.includes(status)) bag.add('status', enumMessage('status', STATUSES));
  }

  const assigned_to = body.assigned_to === undefined || body.assigned_to === null || body.assigned_to === ''
    ? null
    : asString(body.assigned_to);

  const tags = parseTags(body.tags);
  const metadata = parseMetadata(body.metadata ?? {
    source: body.source,
    browser: body.browser,
    device_type: body.device_type,
  });

  if (metadata.source && !SOURCES.includes(metadata.source)) {
    bag.add('metadata.source', enumMessage('metadata.source', SOURCES));
  }
  if (metadata.device_type && !DEVICE_TYPES.includes(metadata.device_type)) {
    bag.add('metadata.device_type', enumMessage('metadata.device_type', DEVICE_TYPES));
  }

  const auto_classify = parseBoolean(body.auto_classify, false);

  bag.throwIfAny();

  return {
    customer_id,
    customer_email,
    customer_name,
    subject,
    description,
    category,
    priority,
    status,
    assigned_to,
    tags,
    metadata,
    auto_classify,
  };
}

function validateUpdateInput(body) {
  const bag = new ValidationErrorBag();
  if (!isPlainObject(body)) {
    bag.add('body', 'Request body must be a JSON object');
    bag.throwIfAny();
  }

  const patch = {};
  if (body.customer_id !== undefined) {
    patch.customer_id = asString(body.customer_id);
    if (!patch.customer_id) bag.add('customer_id', 'customer_id cannot be empty');
  }
  if (body.customer_email !== undefined) {
    patch.customer_email = asString(body.customer_email)?.toLowerCase();
    validateEmail(patch.customer_email, bag);
  }
  if (body.customer_name !== undefined) {
    patch.customer_name = asString(body.customer_name);
    if (!patch.customer_name) bag.add('customer_name', 'customer_name cannot be empty');
  }
  if (body.subject !== undefined) {
    patch.subject = asString(body.subject);
    validateSubject(patch.subject, bag);
  }
  if (body.description !== undefined) {
    patch.description = asString(body.description);
    validateDescription(patch.description, bag);
  }
  if (body.category !== undefined) {
    patch.category = asString(body.category);
    if (!CATEGORIES.includes(patch.category)) bag.add('category', enumMessage('category', CATEGORIES));
  }
  if (body.priority !== undefined) {
    patch.priority = asString(body.priority);
    if (!PRIORITIES.includes(patch.priority)) bag.add('priority', enumMessage('priority', PRIORITIES));
  }
  if (body.status !== undefined) {
    patch.status = asString(body.status);
    if (!STATUSES.includes(patch.status)) bag.add('status', enumMessage('status', STATUSES));
  }
  if (body.assigned_to !== undefined) {
    patch.assigned_to = body.assigned_to === null || body.assigned_to === ''
      ? null
      : asString(body.assigned_to);
  }
  if (body.tags !== undefined) patch.tags = parseTags(body.tags);
  if (body.metadata !== undefined) {
    patch.metadata = parseMetadata(body.metadata);
    if (patch.metadata.source && !SOURCES.includes(patch.metadata.source)) {
      bag.add('metadata.source', enumMessage('metadata.source', SOURCES));
    }
    if (patch.metadata.device_type && !DEVICE_TYPES.includes(patch.metadata.device_type)) {
      bag.add('metadata.device_type', enumMessage('metadata.device_type', DEVICE_TYPES));
    }
  }
  if (body.resolved_at !== undefined) {
    patch.resolved_at = body.resolved_at === null || body.resolved_at === ''
      ? null
      : asString(body.resolved_at);
  }

  bag.throwIfAny();
  return patch;
}

function validateListQuery(query) {
  const bag = new ValidationErrorBag();
  const filters = {};

  if (query.category) {
    filters.category = asString(query.category);
    if (!CATEGORIES.includes(filters.category)) bag.add('category', enumMessage('category', CATEGORIES));
  }
  if (query.priority) {
    filters.priority = asString(query.priority);
    if (!PRIORITIES.includes(filters.priority)) bag.add('priority', enumMessage('priority', PRIORITIES));
  }
  if (query.status) {
    filters.status = asString(query.status);
    if (!STATUSES.includes(filters.status)) bag.add('status', enumMessage('status', STATUSES));
  }
  if (query.customer_id) filters.customer_id = asString(query.customer_id);
  if (query.assigned_to) filters.assigned_to = asString(query.assigned_to);
  if (query.q) filters.q = asString(query.q);

  bag.throwIfAny();
  return filters;
}

module.exports = {
  validateCreateInput,
  validateUpdateInput,
  validateListQuery,
  parseBoolean,
};
