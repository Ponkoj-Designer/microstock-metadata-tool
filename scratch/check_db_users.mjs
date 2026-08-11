import 'dotenv/config';
import { getDbClient } from '../server/services/dbClient.js';

async function main() {
  const db = getDbClient();
  const { data: users, error } = await db.from('users').select('id, email, full_name, role, plan, credits, is_active, created_at');
  if (error) {
    console.error('Error fetching users:', error);
    return;
  }
  console.log('\n=== CURRENT SUPABASE USERS ===');
  console.table(users);

  const { data: sessions } = await db.from('sessions').select('*');
  console.log('\n=== CURRENT ACTIVE SESSIONS ===');
  console.table(sessions);
}

main().catch(console.error);
