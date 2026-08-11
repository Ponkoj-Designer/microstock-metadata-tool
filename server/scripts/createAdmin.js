#!/usr/bin/env node
/**
 * Admin Promotion Script
 *
 * Usage:
 *   node server/scripts/createAdmin.js <email>
 *
 * Promotes an existing user account to admin role.
 * Requires a .env file with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 *
 * Example:
 *   node server/scripts/createAdmin.js admin@example.com
 */

import 'dotenv/config';
import { promoteToAdmin, findUserByEmail } from '../services/userService.js';

const email = process.argv[2];

if (!email) {
  console.error('\n❌  Usage: node server/scripts/createAdmin.js <email>\n');
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌  Missing environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n');
  process.exit(1);
}

try {
  // Verify the user exists first
  const user = await findUserByEmail(email);
  if (!user) {
    console.error(`\n❌  No account found with email: ${email}\n`);
    console.error('    The user must sign up first before being promoted to admin.\n');
    process.exit(1);
  }

  if (user.role === 'admin') {
    console.log(`\nℹ️  ${email} is already an admin. No changes made.\n`);
    process.exit(0);
  }

  const updated = await promoteToAdmin(email);
  console.log(`\n✅  Success! ${updated.email} has been promoted to admin.\n`);
  console.log(`    User ID: ${updated.id}`);
  console.log(`    Role:    ${updated.role}\n`);

} catch (err) {
  console.error('\n❌  Error promoting user:', err.message, '\n');
  process.exit(1);
}
