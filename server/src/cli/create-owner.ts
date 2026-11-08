/**
 * Creates the owner login. There is intentionally NO default account or default password.
 *
 *   npm run create-owner                       (prompts, input for the password is hidden)
 *   OWNER_EMAIL=... OWNER_PASSWORD=... npm run create-owner   (non-interactive, e.g. CI/provisioning)
 */
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { createPool } from '../db.js';
import { hashPassword, passwordSchema } from '../lib/password.js';
import { runMigrations } from '../migrate.js';

function ask(question: string, hidden = false): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    muted = hidden;
  });
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

try {
  await runMigrations(pool);
  const email = z.email().parse((process.env.OWNER_EMAIL ?? (await ask('Owner e-mail: '))).trim());
  const password = passwordSchema.parse(
    process.env.OWNER_PASSWORD ?? (await ask('Password (min 12 chars): ', true)),
  );

  const existing = await pool.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rowCount) {
    console.error('A user with that e-mail already exists.');
    process.exitCode = 1;
  } else {
    await pool.query('INSERT INTO users (email, password_hash) VALUES ($1, $2)', [
      email,
      await hashPassword(password),
    ]);
    console.log(`Owner account created for ${email}.`);
  }
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error(error.issues.map((issue) => issue.message).join('\n'));
  } else {
    console.error((error as Error).message);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
