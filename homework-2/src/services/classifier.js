'use strict';

/**
 * Rule-based categorisation and priority assignment.
 *
 * Matches the keyword lists in TASKS.md. Scores are deterministic so tests
 * can pin exact categories, and the API can return confidence, reasoning,
 * and the keywords that fired.
 */

const CATEGORY_RULES = [
  {
    category: 'account_access',
    keywords: [
      'login', 'log in', 'sign in', 'signin', 'password', '2fa', 'two-factor',
      'two factor', 'locked out', 'reset password', "can't access", 'cannot access',
      'account locked', 'otp',
    ],
  },
  {
    category: 'billing_question',
    keywords: [
      'payment', 'invoice', 'refund', 'charge', 'billing', 'subscription',
      'credit card', 'receipt', 'overcharged',
    ],
  },
  {
    category: 'feature_request',
    keywords: [
      'feature request', 'enhancement', 'suggestion', 'would be nice',
      'please add', 'it would help', 'new feature',
    ],
  },
  {
    category: 'bug_report',
    keywords: [
      'bug', 'defect', 'reproduce', 'reproduction steps', 'unexpected behavior',
      'steps to reproduce',
    ],
  },
  {
    category: 'technical_issue',
    keywords: [
      'error', 'crash', 'exception', 'timeout', 'not working', 'outage',
      'stack trace', '500', 'fails', 'broken',
    ],
  },
];

const PRIORITY_RULES = [
  {
    priority: 'urgent',
    keywords: ["can't access", 'cannot access', 'critical', 'production down', 'security'],
  },
  {
    priority: 'high',
    keywords: ['important', 'blocking', 'asap'],
  },
  {
    priority: 'low',
    keywords: ['minor', 'cosmetic', 'suggestion'],
  },
];

function haystackFrom(ticket) {
  const parts = [ticket.subject, ticket.description, ...(ticket.tags || [])];
  return parts.filter(Boolean).join('\n').toLowerCase();
}

function findKeywords(text, keywords) {
  return keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
}

function classifyCategory(text) {
  let best = { category: 'other', keywords: [], score: 0 };
  for (const rule of CATEGORY_RULES) {
    const found = findKeywords(text, rule.keywords);
    if (found.length > best.score) {
      best = { category: rule.category, keywords: found, score: found.length };
    }
  }
  return best;
}

function classifyPriority(text) {
  for (const rule of PRIORITY_RULES) {
    const found = findKeywords(text, rule.keywords);
    if (found.length > 0) {
      return { priority: rule.priority, keywords: found };
    }
  }
  return { priority: 'medium', keywords: [] };
}

/**
 * @param {{subject?: string, description?: string, tags?: string[]}} ticket
 */
function classifyTicket(ticket) {
  const text = haystackFrom(ticket);
  const categoryResult = classifyCategory(text);
  const priorityResult = classifyPriority(text);
  const keywords = [...new Set([...categoryResult.keywords, ...priorityResult.keywords])];

  const signal = categoryResult.score + (priorityResult.keywords.length > 0 ? 1 : 0);
  const confidence = categoryResult.category === 'other' && priorityResult.priority === 'medium'
    ? 0.35
    : Math.min(0.95, 0.55 + signal * 0.12);

  const reasoningParts = [];
  if (categoryResult.category === 'other') {
    reasoningParts.push('No strong category keywords matched; defaulting to other.');
  } else {
    reasoningParts.push(
      `Category ${categoryResult.category} matched keywords: ${categoryResult.keywords.join(', ')}.`,
    );
  }
  if (priorityResult.keywords.length === 0) {
    reasoningParts.push('No urgency keywords matched; defaulting to medium priority.');
  } else {
    reasoningParts.push(
      `Priority ${priorityResult.priority} matched keywords: ${priorityResult.keywords.join(', ')}.`,
    );
  }

  return {
    category: categoryResult.category,
    priority: priorityResult.priority,
    confidence: Number(confidence.toFixed(2)),
    reasoning: reasoningParts.join(' '),
    keywords_found: keywords,
  };
}

module.exports = {
  classifyTicket,
  CATEGORY_RULES,
  PRIORITY_RULES,
};
