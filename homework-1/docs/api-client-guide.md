# Testing the API with Postman

[`../demo/postman-collection.json`](../demo/postman-collection.json) holds
**37 requests** grouped into one folder per assignment task, and every request
carries a test asserting its expected status code — so a single collection run
verifies the whole API and produces a screenshot with a column of green ticks.

| File | Contents |
|---|---|
| `demo/postman-collection.json` | The 37 requests, in Postman Collection v2.1 format |
| `demo/postman-environment.json` | The `baseUrl` and `txnId` variables |

The collection was verified by running it: `newman` reports **37/37 requests and
37/37 assertions passing**.

---

## 1. Start the API

```bash
cd gen-ai-software-engineering/homework-1
./demo/run.sh                 # http://localhost:3000
./demo/run.sh --port 3456     # if 3000 is taken by another dev server
```

Note the port — it goes into `baseUrl` below. Check it is up:

```bash
curl http://localhost:3000/health
```

## 2. Import and run

1. **Import** — `File → Import` (or the **Import** button), drop in both
   `demo/postman-collection.json` and `demo/postman-environment.json`.
2. **Select the environment** — top-right dropdown → **Banking API — local**.
3. **Check `baseUrl`** — open the environment and set it to the port you started
   on (`http://localhost:3000` or `http://localhost:3456`).
4. **Send a request** — expand *01 · Task 1 — Core endpoints* → **Create a
   transfer → 201** → **Send**. The response pane shows the created
   transaction; the **Test Results** tab shows `Status is 201` passing.
5. **Run everything** — click the collection → **Run** → **Run Banking
   Transactions API**. All 37 requests execute in order with a pass/fail column.

`Create a transfer → 201` saves the new id into the `txnId` environment
variable, which `Retrieve a transaction (uses txnId)` then uses — so run the
create first (the collection runner does this automatically).

## 3. Other clients

The same file imports into **Insomnia** and **Hoppscotch** (*Import from
Postman*), and `demo/sample-requests.http` covers the VS Code REST Client and
the JetBrains HTTP client.

One caveat for **browser-based** clients (e.g. hoppscotch.io in a tab): this API
sends no CORS headers, so a web page on another origin cannot read its
responses. Use a desktop client, a REST-client browser extension, or `curl` —
all of which are unaffected by the same-origin policy.

## 4. What to capture for the submission

The third screenshot `TASKS.md` asks for is sample requests and responses (see
[`screenshots/README.md`](screenshots/README.md)). The two most convincing
frames:

1. **A successful create** — `Create a transfer → 201` with the JSON response
   visible and the test passing.
2. **A validation failure** — `Every field invalid at once → 400`, showing all
   four `details[]` entries in one response.

A collection-run summary (37/37 green) is a good alternative if you would rather
show breadth than one request in detail.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| `ECONNREFUSED` / `Could not get any response` | The API is not running, or `baseUrl` points at the wrong port. `curl http://localhost:3000/health` to check. |
| `Retrieve a transaction` returns `404` | `txnId` is empty — run **Create a transfer → 201** first. |
| Everything returns `429` | The 100 req/min budget is spent (a full collection run uses 37). Wait for `Retry-After`, or restart with `./demo/run.sh --no-rate-limit`. |
| A `400` where you expected `201` | Check `Content-Type: application/json` is still on the request, and that the body matches the per-type account rules in [`api-reference.md`](api-reference.md#which-accounts-each-type-uses). |
| Balances do not match the documented examples | A collection run creates 4 transactions. Restart the server to reset the in-memory ledger to the 10 seeded ones. |

## 6. Running the collection from the command line

Useful for a quick regression check, and how the file was verified:

```bash
npx newman run demo/postman-collection.json -e demo/postman-environment.json
```
