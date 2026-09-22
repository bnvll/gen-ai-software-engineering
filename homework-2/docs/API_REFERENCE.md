# API reference

For API consumers talking to `http://localhost:3000`.

All successful JSON responses are pretty-printed. Errors are JSON, never HTML.

---

## Conventions

| Topic | Rule |
|---|---|
| IDs | Server-generated UUID v4 |
| Timestamps | ISO 8601 UTC (`created_at`, `updated_at`, `resolved_at`) |
| Enums | Exact strings from the tables below; unknown values → `400` |
| Unknown JSON fields | Ignored |
| Auto-classify | Query `?auto_classify=true` or body `"auto_classify": true` |

### Enums

| Field | Values |
|---|---|
| `category` | `account_access`, `technical_issue`, `billing_question`, `feature_request`, `bug_report`, `other` |
| `priority` | `urgent`, `high`, `medium`, `low` |
| `status` | `new`, `in_progress`, `waiting_customer`, `resolved`, `closed` |
| `metadata.source` | `web_form`, `email`, `api`, `chat`, `phone` |
| `metadata.device_type` | `desktop`, `mobile`, `tablet` |

### Error shapes

**Validation (`400`)**

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "customer_email", "message": "customer_email must be a valid email address" }
  ]
}
```

**Malformed import (`400`)**

```json
{ "error": "Malformed file", "message": "JSON is not valid: Unexpected token" }
```

**Not found (`404`)**

```json
{ "error": "Not found", "message": "Ticket 00000000-0000-4000-8000-000000000000 was not found" }
```

---

## Ticket model

```json
{
  "id": "3f1c0a6e-8b21-4c0a-9d2e-1a2b3c4d5e6f",
  "customer_id": "CUS-1001",
  "customer_email": "ada@example.com",
  "customer_name": "Ada Lovelace",
  "subject": "Cannot log in after 2FA",
  "description": "I cannot access my account after enabling 2FA this morning.",
  "category": "account_access",
  "priority": "urgent",
  "status": "new",
  "created_at": "2026-09-21T10:00:00.000Z",
  "updated_at": "2026-09-21T10:00:00.000Z",
  "resolved_at": null,
  "assigned_to": null,
  "tags": ["login"],
  "metadata": { "source": "api", "browser": null, "device_type": null },
  "classification": {
    "confidence": 0.79,
    "reasoning": "Category account_access matched keywords: log in, 2fa.",
    "keywords_found": ["log in", "2fa", "cannot access"]
  },
  "classification_log": []
}
```

`classification` is `null` until auto-classify runs. List endpoints omit the log (empty array).

---

## Endpoints

### `GET /api`

Machine-readable index of endpoints and enums.

```bash
curl http://localhost:3000/api
```

### `GET /health`

```bash
curl http://localhost:3000/health
```

```json
{ "status": "ok", "uptimeSeconds": 1.2, "ticketCount": 0 }
```

### `POST /tickets`

Create a ticket. Optional `?auto_classify=true` runs the keyword classifier and overwrites category/priority.

**Required:** `customer_id`, `customer_email`, `customer_name`, `subject` (1–200), `description` (10–2000).

```bash
curl -sS -X POST 'http://localhost:3000/tickets?auto_classify=true' \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_id": "CUS-1001",
    "customer_email": "ada@example.com",
    "customer_name": "Ada Lovelace",
    "subject": "Cannot log in after 2FA",
    "description": "I cannot access my account after enabling 2FA this morning."
  }'
```

**`201`** with `Location: /tickets/:id`. Default status is `new`. Missing category/priority without auto-classify become `other` / `medium`.

### `GET /tickets`

```bash
curl 'http://localhost:3000/tickets?category=billing_question&priority=high&status=new'
```

| Query | Meaning |
|---|---|
| `category`, `priority`, `status` | exact enum match; combined with AND |
| `customer_id`, `assigned_to` | exact match |
| `q` | substring on subject, description, name, email |

```json
{ "tickets": [], "count": 0 }
```

### `GET /tickets/:id`

Full ticket including `classification_log`. **`404`** if missing.

```bash
curl http://localhost:3000/tickets/3f1c0a6e-8b21-4c0a-9d2e-1a2b3c4d5e6f
```

### `PUT /tickets/:id`

Partial update. Changing `category` or `priority` appends a `manual_override` log entry. Moving into `resolved`/`closed` sets `resolved_at`; leaving those statuses clears it.

```bash
curl -sS -X PUT http://localhost:3000/tickets/<id> \
  -H 'Content-Type: application/json' \
  -d '{"status":"in_progress","assigned_to":"simone","category":"billing_question"}'
```

### `DELETE /tickets/:id`

**`204`** empty body. Also deletes the classification log.

```bash
curl -sS -X DELETE http://localhost:3000/tickets/<id>
```

### `POST /tickets/:id/auto-classify`

Runs the keyword engine, stores confidence/reasoning/keywords, overwrites category and priority, logs `source: auto_endpoint`.

```bash
curl -sS -X POST http://localhost:3000/tickets/<id>/auto-classify
```

```json
{
  "category": "account_access",
  "priority": "urgent",
  "confidence": 0.79,
  "reasoning": "Category account_access matched keywords: log in.",
  "keywords_found": ["log in"],
  "ticket": {}
}
```

### `POST /tickets/import`

Bulk import. **`200`** even when some rows fail.

**Formats**

| How | Header / field |
|---|---|
| Raw CSV | `Content-Type: text/csv` |
| Raw JSON | `application/json` — array or `{ "tickets": [...] }` |
| Raw XML | `application/xml` — `<tickets><ticket>…</ticket></tickets>` |
| Multipart | field name `file` |

**CSV columns:** `customer_id`, `customer_email`, `customer_name`, `subject`, `description`, optional `category`, `priority`, `status`, `assigned_to`, `tags` (`;` or `,` separated), `source`, `browser`, `device_type`, `auto_classify`.

**Query:** `?auto_classify=true` classifies every successful row.

```bash
curl -sS -X POST 'http://localhost:3000/tickets/import?auto_classify=true' \
  -H 'Content-Type: text/csv' \
  --data-binary @demo/sample_tickets.csv
```

```json
{
  "format": "csv",
  "total": 50,
  "successful": 50,
  "failed": 0,
  "errors": [],
  "tickets": []
}
```

Row errors look like:

```json
{
  "index": 2,
  "error": "Validation failed",
  "details": [{ "field": "customer_email", "message": "customer_email must be a valid email address" }]
}
```

Unparseable files: **`400 Malformed file`**. Completely empty body: **`400`**.

---

## Classification rules (keywords)

Priority is first-match: urgent → high → low → default medium.

| Priority | Keywords |
|---|---|
| urgent | `can't access`, `cannot access`, `critical`, `production down`, `security` |
| high | `important`, `blocking`, `asap` |
| low | `minor`, `cosmetic`, `suggestion` |

Category is the rule with the most keyword hits; tie-break is rule order. No hits → `other`.
