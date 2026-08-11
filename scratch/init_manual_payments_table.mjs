import 'dotenv/config';
import { getDbClient } from '../server/services/dbClient.js';

async function main() {
  const db = getDbClient();

  // Test selecting from manual_payments table
  const { data, error } = await db.from('manual_payments').select('count', { count: 'exact' });
  if (error) {
    console.log('manual_payments table error (needs creation in Supabase):', error.message);
    // Execute SQL via Supabase rpc or fallback
  } else {
    console.log('✓ manual_payments table is present and ready! Count:', data);
  }
}

main().catch(console.error);
