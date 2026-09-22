'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SUBJECTS = [
  { subject: 'Cannot log in after password reset', description: 'I cannot access my account. The login form rejects the new password and 2FA codes.', category: 'account_access', priority: 'urgent' },
  { subject: 'Production down for checkout', description: 'Checkout is production down. This is critical and customers cannot complete payment.', category: 'technical_issue', priority: 'urgent' },
  { subject: 'Security warning on login page', description: 'Browser shows a security certificate warning when we try to sign in.', category: 'account_access', priority: 'urgent' },
  { subject: 'App crash when exporting CSV', description: 'The desktop app crash throws an exception and a stack trace during export.', category: 'technical_issue', priority: 'high' },
  { subject: 'Refund for duplicate invoice', description: 'Please refund the duplicate invoice payment from last week. Billing charged twice.', category: 'billing_question', priority: 'high' },
  { subject: 'Feature request for dark mode', description: 'It would be nice to have a dark mode. This enhancement is a suggestion from the design team.', category: 'feature_request', priority: 'low' },
  { subject: 'Bug in notification badge', description: 'Unexpected behavior on the badge count. Steps to reproduce: open inbox, mark one read.', category: 'bug_report', priority: 'medium' },
  { subject: 'Minor cosmetic alignment', description: 'A minor cosmetic issue on the settings page. Suggestion only, not blocking.', category: 'other', priority: 'low' },
  { subject: 'Subscription renewal question', description: 'When will my subscription renew and will the credit card on file be charged automatically?', category: 'billing_question', priority: 'medium' },
  { subject: 'Timeout calling the reports API', description: 'Reports endpoint returns a timeout error and is not working for large date ranges.', category: 'technical_issue', priority: 'high' },
];

function ticket(index, formatExtra = {}) {
  const template = SUBJECTS[index % SUBJECTS.length];
  const id = index + 1;
  return {
    customer_id: `CUS-${String(id).padStart(4, '0')}`,
    customer_email: `customer${id}@example.com`,
    customer_name: `Customer ${id}`,
    subject: `${template.subject} (${id})`,
    description: `${template.description} Ticket number ${id} for the sample dataset.`,
    category: template.category,
    priority: template.priority,
    status: ['new', 'in_progress', 'waiting_customer', 'resolved', 'closed'][id % 5],
    assigned_to: id % 3 === 0 ? 'simone' : null,
    tags: [template.category, 'sample'],
    metadata: {
      source: ['web_form', 'email', 'api', 'chat', 'phone'][id % 5],
      browser: ['Chrome', 'Safari', 'Firefox'][id % 3],
      device_type: ['desktop', 'mobile', 'tablet'][id % 3],
    },
    ...formatExtra,
  };
}

function toCsv(tickets) {
  const headers = [
    'customer_id', 'customer_email', 'customer_name', 'subject', 'description',
    'category', 'priority', 'status', 'assigned_to', 'tags', 'source', 'browser', 'device_type',
  ];
  const escape = (value) => {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [headers.join(',')];
  for (const row of tickets) {
    lines.push([
      row.customer_id, row.customer_email, row.customer_name, row.subject, row.description,
      row.category, row.priority, row.status, row.assigned_to, row.tags.join(';'),
      row.metadata.source, row.metadata.browser, row.metadata.device_type,
    ].map(escape).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function toXml(tickets) {
  const tag = (name, value) => `    <${name}>${String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</${name}>`;
  const blocks = tickets.map((row) => `  <ticket>
${tag('customer_id', row.customer_id)}
${tag('customer_email', row.customer_email)}
${tag('customer_name', row.customer_name)}
${tag('subject', row.subject)}
${tag('description', row.description)}
${tag('category', row.category)}
${tag('priority', row.priority)}
${tag('status', row.status)}
${tag('assigned_to', row.assigned_to ?? '')}
    <tags>${row.tags.map((item) => `<tag>${item}</tag>`).join('')}</tags>
    <metadata>
${tag('source', row.metadata.source)}
${tag('browser', row.metadata.browser)}
${tag('device_type', row.metadata.device_type)}
    </metadata>
  </ticket>`).join('\n');
  return `<tickets>\n${blocks}\n</tickets>\n`;
}

function writeSamples() {
  const demo = path.join(__dirname, '..', '..', 'demo');
  const csvTickets = Array.from({ length: 50 }, (_, index) => ticket(index));
  const jsonTickets = Array.from({ length: 20 }, (_, index) => ticket(index + 50));
  const xmlTickets = Array.from({ length: 30 }, (_, index) => ticket(index + 70));

  fs.mkdirSync(demo, { recursive: true });
  fs.writeFileSync(path.join(demo, 'sample_tickets.csv'), toCsv(csvTickets));
  fs.writeFileSync(path.join(demo, 'sample_tickets.json'), `${JSON.stringify(jsonTickets, null, 2)}\n`);
  fs.writeFileSync(path.join(demo, 'sample_tickets.xml'), toXml(xmlTickets));
  fs.writeFileSync(path.join(demo, 'invalid_tickets.csv'), 'customer_id,customer_email,subject,description\nCUS-X,not-an-email,Short,Nope\n');
  fs.writeFileSync(path.join(demo, 'invalid_tickets.json'), '{not json\n');
  fs.writeFileSync(path.join(demo, 'invalid_tickets.xml'), '<root><nope/></root>\n');
}

if (require.main === module) writeSamples();

module.exports = { writeSamples, ticket };
