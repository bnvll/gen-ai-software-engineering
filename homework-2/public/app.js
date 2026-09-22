const THEME_KEY = 'theme';
const themeToggle = document.getElementById('theme-toggle');

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const next = theme === 'dark' ? 'light' : 'dark';
  themeToggle.textContent = next === 'dark' ? 'Dark' : 'Light';
  themeToggle.setAttribute('aria-label', `Switch to ${next} theme`);
}

applyTheme(currentTheme());
themeToggle.addEventListener('click', () => {
  applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
});

const banner = document.getElementById('banner');
const rows = document.getElementById('ticket-rows');
const detail = document.getElementById('detail');
const filters = document.getElementById('filters');
const dialog = document.getElementById('ticket-dialog');
const form = document.getElementById('ticket-form');
const importForm = document.getElementById('import-form');
const importResult = document.getElementById('import-result');

let selectedId = null;
let tickets = [];

function showBanner(message, isError = false) {
  banner.hidden = false;
  banner.textContent = message;
  banner.classList.toggle('error', isError);
}

async function api(method, path, { json, file, autoClassify } = {}) {
  const options = { method, headers: {} };
  if (json !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(json);
  }
  if (file) {
    const type = file.name.endsWith('.csv')
      ? 'text/csv'
      : file.name.endsWith('.xml')
        ? 'application/xml'
        : 'application/json';
    options.headers['Content-Type'] = type;
    options.body = await file.text();
    if (autoClassify) path += (path.includes('?') ? '&' : '?') + 'auto_classify=true';
  }
  const response = await fetch(path, options);
  const text = await response.text();
  const body = text && (response.headers.get('content-type') || '').includes('json')
    ? JSON.parse(text)
    : text;
  if (!response.ok) {
    const message = body?.message
      || body?.error
      || (body?.details ? body.details.map((d) => d.message).join('; ') : `Request failed (${response.status})`);
    throw new Error(message);
  }
  return body;
}

function badge(value, kind) {
  const cls = kind === 'priority' && (value === 'urgent' || value === 'high') ? value : '';
  return `<span class="badge ${cls}">${value}</span>`;
}

function renderRows() {
  if (!tickets.length) {
    rows.innerHTML = '<tr><td colspan="5">No tickets match these filters.</td></tr>';
    return;
  }
  rows.innerHTML = tickets.map((ticket) => `
    <tr data-id="${ticket.id}" class="${ticket.id === selectedId ? 'active' : ''}">
      <td>${escapeHtml(ticket.subject)}</td>
      <td>${escapeHtml(ticket.customer_name)}<br /><span class="muted">${escapeHtml(ticket.customer_email)}</span></td>
      <td>${badge(ticket.category, 'category')}</td>
      <td>${badge(ticket.priority, 'priority')}</td>
      <td>${badge(ticket.status, 'status')}</td>
    </tr>
  `).join('');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function renderDetail(ticket) {
  if (!ticket) {
    detail.innerHTML = '<p class="muted">Select a ticket from the list.</p>';
    return;
  }
  const classification = ticket.classification
    ? `<p><strong>Confidence:</strong> ${ticket.classification.confidence ?? '—'}</p>
       <p><strong>Reasoning:</strong> ${escapeHtml(ticket.classification.reasoning)}</p>
       <p><strong>Keywords:</strong> ${(ticket.classification.keywords_found || []).join(', ') || '—'}</p>`
    : '<p class="muted">Not auto-classified yet.</p>';
  const log = (ticket.classification_log || []).map((entry) => (
    `<li>${escapeHtml(entry.decided_at)} — ${escapeHtml(entry.source)} → ${escapeHtml(entry.category)} / ${escapeHtml(entry.priority)}</li>`
  )).join('') || '<li class="muted">No decisions logged.</li>';

  detail.innerHTML = `
    <p><strong>${escapeHtml(ticket.subject)}</strong></p>
    <p>${escapeHtml(ticket.description)}</p>
    <p>${badge(ticket.category, 'category')} ${badge(ticket.priority, 'priority')} ${badge(ticket.status, 'status')}</p>
    <p><strong>Customer:</strong> ${escapeHtml(ticket.customer_name)} (${escapeHtml(ticket.customer_email)}) · ${escapeHtml(ticket.customer_id)}</p>
    <p><strong>Assigned:</strong> ${escapeHtml(ticket.assigned_to || 'unassigned')}</p>
    <p><strong>Tags:</strong> ${(ticket.tags || []).join(', ') || '—'}</p>
    <p><strong>Source:</strong> ${escapeHtml(ticket.metadata?.source)} · ${escapeHtml(ticket.metadata?.device_type || 'n/a')} · ${escapeHtml(ticket.metadata?.browser || 'n/a')}</p>
    <p class="muted">Created ${escapeHtml(ticket.created_at)} · Updated ${escapeHtml(ticket.updated_at)}</p>
    <h3>Classification</h3>
    ${classification}
    <ul>${log}</ul>
    <p>
      <button type="button" id="edit-ticket">Edit</button>
      <button type="button" id="classify-ticket">Auto-classify</button>
      <button type="button" id="delete-ticket">Delete</button>
    </p>
  `;

  document.getElementById('edit-ticket').onclick = () => openDialog(ticket);
  document.getElementById('classify-ticket').onclick = async () => {
    try {
      const result = await api('POST', `/tickets/${ticket.id}/auto-classify`);
      showBanner(`Classified as ${result.category} / ${result.priority} (${result.confidence})`);
      selectedId = ticket.id;
      await refresh();
    } catch (error) {
      showBanner(error.message, true);
    }
  };
  document.getElementById('delete-ticket').onclick = async () => {
    if (!confirm('Delete this ticket?')) return;
    try {
      await api('DELETE', `/tickets/${ticket.id}`);
      showBanner('Ticket deleted');
      selectedId = null;
      await refresh();
    } catch (error) {
      showBanner(error.message, true);
    }
  };
}

async function refresh() {
  const params = new URLSearchParams(new FormData(filters));
  for (const [key, value] of [...params.entries()]) {
    if (!value) params.delete(key);
  }
  const query = params.toString();
  const data = await api('GET', `/tickets${query ? `?${query}` : ''}`);
  tickets = data.tickets;
  renderRows();
  if (selectedId) {
    try {
      renderDetail(await api('GET', `/tickets/${selectedId}`));
    } catch {
      selectedId = null;
      renderDetail(null);
    }
  } else {
    renderDetail(null);
  }
}

function openDialog(ticket) {
  form.reset();
  document.getElementById('dialog-title').textContent = ticket ? 'Edit ticket' : 'New ticket';
  document.getElementById('auto-classify-row').hidden = Boolean(ticket);
  form.elements.id.value = ticket?.id || '';
  form.elements.customer_id.value = ticket?.customer_id || '';
  form.elements.customer_email.value = ticket?.customer_email || '';
  form.elements.customer_name.value = ticket?.customer_name || '';
  form.elements.subject.value = ticket?.subject || '';
  form.elements.description.value = ticket?.description || '';
  form.elements.category.value = ticket?.category || '';
  form.elements.priority.value = ticket?.priority || '';
  form.elements.status.value = ticket?.status || 'new';
  form.elements.assigned_to.value = ticket?.assigned_to || '';
  form.elements.tags.value = (ticket?.tags || []).join(', ');
  dialog.showModal();
}

rows.addEventListener('click', async (event) => {
  const row = event.target.closest('tr[data-id]');
  if (!row) return;
  selectedId = row.dataset.id;
  renderRows();
  try {
    renderDetail(await api('GET', `/tickets/${selectedId}`));
  } catch (error) {
    showBanner(error.message, true);
  }
});

filters.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await refresh();
  } catch (error) {
    showBanner(error.message, true);
  }
});

document.getElementById('new-ticket').onclick = () => openDialog(null);
document.getElementById('dialog-cancel').onclick = () => dialog.close();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const payload = {
    customer_id: data.customer_id,
    customer_email: data.customer_email,
    customer_name: data.customer_name,
    subject: data.subject,
    description: data.description,
    status: data.status,
    assigned_to: data.assigned_to || null,
    tags: data.tags,
  };
  if (data.category) payload.category = data.category;
  if (data.priority) payload.priority = data.priority;
  try {
    if (data.id) {
      await api('PUT', `/tickets/${data.id}`, { json: payload });
      showBanner('Ticket updated');
      selectedId = data.id;
    } else {
      const created = await api('POST', `/tickets${form.elements.auto_classify.checked ? '?auto_classify=true' : ''}`, {
        json: { ...payload, auto_classify: form.elements.auto_classify.checked },
      });
      showBanner('Ticket created');
      selectedId = created.id;
    }
    dialog.close();
    await refresh();
  } catch (error) {
    showBanner(error.message, true);
  }
});

importForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = importForm.elements.file.files[0];
  try {
    const result = await api('POST', '/tickets/import', {
      file,
      autoClassify: importForm.elements.auto_classify.checked,
    });
    importResult.hidden = false;
    importResult.textContent = JSON.stringify({
      format: result.format,
      total: result.total,
      successful: result.successful,
      failed: result.failed,
      errors: result.errors,
    }, null, 2);
    showBanner(`Imported ${result.successful}/${result.total} ${result.format} records`);
    await refresh();
  } catch (error) {
    showBanner(error.message, true);
  }
});

refresh().catch((error) => showBanner(error.message, true));
