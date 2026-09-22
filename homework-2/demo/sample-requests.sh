#!/usr/bin/env bash
set -euo pipefail
BASE="${BASE:-http://localhost:3000}"

curl -sS "$BASE/health"; echo
curl -sS -X POST "$BASE/tickets?auto_classify=true" \
  -H 'Content-Type: application/json' \
  -d '{
    "customer_id": "CUS-1001",
    "customer_email": "ada@example.com",
    "customer_name": "Ada Lovelace",
    "subject": "Cannot log in after 2FA",
    "description": "I cannot access my account after enabling 2FA this morning."
  }'; echo
curl -sS "$BASE/tickets?category=account_access"; echo
