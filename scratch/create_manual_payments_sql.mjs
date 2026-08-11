import 'dotenv/config';

async function createTable() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const sql = `
  CREATE TABLE IF NOT EXISTS manual_payments (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan           VARCHAR(20) NOT NULL CHECK (plan IN ('free', 'pro', 'business')),
    amount         INTEGER     NOT NULL,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('bkash', 'nagad')),
    sender_number  VARCHAR(50) NOT NULL,
    trx_id         VARCHAR(100) NOT NULL,
    status         VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    admin_notes    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  `;

  // Try calling pg/sql endpoint or rpc query
  console.log('Sending SQL table creation query...');
  const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': key,
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({ query: sql })
  });

  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
}

createTable().catch(console.error);
