'use strict';

const { ApiError, ValidationError } = require('../utils/errors');

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw new ApiError(400, 'Malformed file', 'CSV file is empty');
  }
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  if (headers.length === 0 || headers.every((header) => header === '')) {
    throw new ApiError(400, 'Malformed file', 'CSV file is missing a header row');
  }
  const records = [];
  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    records.push({ index: i, row });
  }
  return records;
}

function parseJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ApiError(400, 'Malformed file', `JSON is not valid: ${error.message}`);
  }
  if (Array.isArray(parsed)) {
    return parsed.map((row, index) => ({ index, row }));
  }
  if (parsed && Array.isArray(parsed.tickets)) {
    return parsed.tickets.map((row, index) => ({ index, row }));
  }
  throw new ApiError(400, 'Malformed file', 'JSON must be an array of tickets or { "tickets": [...] }');
}

function decodeXmlEntities(value) {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlText(block, tag) {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1].trim()) : undefined;
}

function parseXml(text) {
  const source = String(text);
  if (!/<tickets[\s>][\s\S]*<\/tickets>/i.test(source) && !/<ticket[\s>][\s\S]*<\/ticket>/i.test(source)) {
    throw new ApiError(400, 'Malformed file', 'XML must contain a <tickets> root or at least one <ticket> element');
  }
  const ticketBlocks = [...source.matchAll(/<ticket\b[\s\S]*?<\/ticket>/gi)].map((match) => match[0]);
  if (ticketBlocks.length === 0) {
    throw new ApiError(400, 'Malformed file', 'XML contains no <ticket> elements');
  }
  return ticketBlocks.map((block, index) => {
    const tags = [...block.matchAll(/<tag>([\s\S]*?)<\/tag>/gi)].map((match) => decodeXmlEntities(match[1].trim()));
    const metadataBlock = block.match(/<metadata\b[\s\S]*?<\/metadata>/i)?.[0] ?? '';
    const row = {
      customer_id: xmlText(block, 'customer_id'),
      customer_email: xmlText(block, 'customer_email'),
      customer_name: xmlText(block, 'customer_name'),
      subject: xmlText(block, 'subject'),
      description: xmlText(block, 'description'),
      category: xmlText(block, 'category'),
      priority: xmlText(block, 'priority'),
      status: xmlText(block, 'status'),
      assigned_to: xmlText(block, 'assigned_to'),
      tags,
      auto_classify: xmlText(block, 'auto_classify'),
      metadata: {
        source: xmlText(metadataBlock, 'source') ?? xmlText(block, 'source'),
        browser: xmlText(metadataBlock, 'browser') ?? xmlText(block, 'browser'),
        device_type: xmlText(metadataBlock, 'device_type') ?? xmlText(block, 'device_type'),
      },
    };
    return { index, row };
  });
}

function detectFormat({ contentType = '', filename = '', body }) {
  const name = filename.toLowerCase();
  const type = contentType.toLowerCase();
  if (name.endsWith('.csv') || type.includes('csv')) return 'csv';
  if (name.endsWith('.xml') || type.includes('xml')) return 'xml';
  if (name.endsWith('.json') || type.includes('json')) return 'json';

  const sample = String(body).trimStart();
  if (sample.startsWith('{') || sample.startsWith('[')) return 'json';
  if (sample.startsWith('<')) return 'xml';
  return 'csv';
}

function parseImportPayload({ contentType, filename, body }) {
  if (body == null || String(body).trim() === '') {
    throw new ApiError(400, 'Malformed file', 'Import body is empty');
  }
  const format = detectFormat({ contentType, filename, body });
  try {
    if (format === 'csv') return { format, records: parseCsv(body) };
    if (format === 'xml') return { format, records: parseXml(body) };
    return { format, records: parseJson(body) };
  } catch (error) {
    if (error instanceof ApiError || error instanceof ValidationError) throw error;
    throw new ApiError(400, 'Malformed file', `Could not parse ${format.toUpperCase()} file: ${error.message}`);
  }
}

module.exports = {
  parseCsv,
  parseJson,
  parseXml,
  detectFormat,
  parseImportPayload,
};
