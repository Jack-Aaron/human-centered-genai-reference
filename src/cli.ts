import fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { config } from './config';
import { openDb } from './db';
import { normalizeText } from './normalize';
import {
  approveRegistration,
  rejectRegistration,
} from './apiRegistration';
import { publicKeyFingerprint } from './apiAuth';
import { refreshCorpusSnapshot } from './corpus';

const program = new Command();
program
  .name('genaictl')
  .description('Administrative CLI for the reference serving platform')
  .version('1.0.0');

function setState(key: string, value: string): void {
  const db = openDb();
  try {
    db.prepare(
      `UPDATE state SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?`,
    ).run(value, key);
  } finally {
    db.close();
  }
}

program.command('init').action(() => {
  const db = openDb();
  db.close();
  console.log(`Initialized ${config.dbPath}`);
});

program.command('stats').action(() => {
  const db = openDb();
  try {
    const states = db.prepare('SELECT key, value FROM state ORDER BY key').all() as Array<{
      key: string;
      value: string;
    }>;
    const counts = db.prepare(
      `SELECT status, COUNT(*) AS count
         FROM candidates
        GROUP BY status
        ORDER BY status`,
    ).all() as Array<{ status: string; count: number }>;

    for (const row of states) console.log(`${row.key}: ${row.value}`);
    for (const row of counts) console.log(`${row.status}: ${row.count}`);
  } finally {
    db.close();
  }
});

program.command('enable').action(() => {
  setState('enabled', 'true');
  console.log('enabled');
});

program.command('disable').action(() => {
  setState('enabled', 'false');
  console.log('disabled');
});

program
  .command('add')
  .argument('[text]')
  .option('-f, --file <path>')
  .action((text: string | undefined, options: { file?: string }) => {
    const values = options.file
      ? fs
          .readFileSync(path.resolve(options.file), 'utf8')
          .split(/\r?\n/u)
          .map((line: string) => line.trim())
          .filter(Boolean)
      : text
        ? [text]
        : [];

    if (values.length === 0) throw new Error('Provide text or --file');
    const db = openDb();
    const insert = db.prepare(
      `INSERT OR IGNORE INTO candidates(text, normalized_text)
       VALUES (?, ?)`,
    );
    let inserted = 0;
    try {
      db.transaction(() => {
        for (const value of values) {
          inserted += insert.run(value, normalizeText(value)).changes;
        }
      })();
    } finally {
      db.close();
    }
    console.log(`inserted: ${inserted}`);
    console.log(`duplicates skipped: ${values.length - inserted}`);
  });

program.command('list').action(() => {
  const db = openDb();
  try {
    const rows = db.prepare(
      `SELECT id, text
         FROM candidates
        WHERE status = 'approved_unused'
        ORDER BY id`,
    ).all() as Array<{ id: number; text: string }>;
    for (const row of rows) console.log(`${row.id}\t${row.text}`);
  } finally {
    db.close();
  }
});

program
  .command('client-add')
  .argument('<key-id>')
  .argument('<public-key-file>')
  .option('--daily-cap <number>', 'daily successful-request cap', String(config.apiClientDailyCap))
  .action((keyId: string, publicKeyFile: string, options: { dailyCap: string }) => {
    const publicKeyPem = fs.readFileSync(path.resolve(publicKeyFile), 'utf8');
    const fingerprint = publicKeyFingerprint(publicKeyPem);
    const cap = Number.parseInt(options.dailyCap, 10);
    if (!Number.isInteger(cap) || cap <= 0) throw new Error('daily cap must be positive');
    const db = openDb();
    try {
      db.prepare(
        `INSERT INTO api_clients(key_id, public_key_pem, fingerprint, daily_cap)
         VALUES (?, ?, ?, ?)`,
      ).run(keyId, publicKeyPem, fingerprint, cap);
    } finally {
      db.close();
    }
    console.log(`${keyId}\t${fingerprint}`);
  });

program.command('client-list').action(() => {
  const db = openDb();
  try {
    const rows = db.prepare(
      `SELECT key_id, fingerprint, enabled, daily_cap, daily_count, daily_date
         FROM api_clients ORDER BY key_id`,
    ).all() as Array<Record<string, string | number>>;
    for (const row of rows) console.log(JSON.stringify(row));
  } finally {
    db.close();
  }
});

for (const [name, enabled] of [
  ['client-enable', 1],
  ['client-disable', 0],
] as const) {
  program.command(name).argument('<key-id>').action((keyId: string) => {
    const db = openDb();
    try {
      const result = db.prepare(
        `UPDATE api_clients SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE key_id = ?`,
      ).run(enabled, keyId);
      if (result.changes !== 1) throw new Error('client not found');
    } finally {
      db.close();
    }
    console.log(`${keyId}: ${enabled ? 'enabled' : 'disabled'}`);
  });
}

program
  .command('client-set-cap')
  .argument('<key-id>')
  .argument('<daily-cap>')
  .action((keyId: string, dailyCapText: string) => {
    const dailyCap = Number.parseInt(dailyCapText, 10);
    if (!Number.isInteger(dailyCap) || dailyCap <= 0) throw new Error('daily cap must be positive');
    const db = openDb();
    try {
      const result = db.prepare(
        `UPDATE api_clients SET daily_cap = ?, updated_at = CURRENT_TIMESTAMP WHERE key_id = ?`,
      ).run(dailyCap, keyId);
      if (result.changes !== 1) throw new Error('client not found');
    } finally {
      db.close();
    }
    console.log(`${keyId}: daily_cap=${dailyCap}`);
  });

program.command('registration-list').action(() => {
  const db = openDb();
  try {
    const rows = db.prepare(
      `SELECT key_id, fingerprint, status, created_at, reviewed_at
         FROM api_client_registrations ORDER BY created_at`,
    ).all() as Array<Record<string, string | null>>;
    for (const row of rows) console.log(JSON.stringify(row));
  } finally {
    db.close();
  }
});

program
  .command('registration-approve')
  .argument('<key-id>')
  .option('--daily-cap <number>', 'daily successful-request cap', String(config.apiClientDailyCap))
  .action((keyId: string, options: { dailyCap: string }) => {
    const cap = Number.parseInt(options.dailyCap, 10);
    if (!Number.isInteger(cap) || cap <= 0) throw new Error('daily cap must be positive');
    const db = openDb();
    try {
      approveRegistration(db, keyId, cap);
    } finally {
      db.close();
    }
    console.log(`${keyId}: approved`);
  });

program.command('registration-reject').argument('<key-id>').action((keyId: string) => {
  const db = openDb();
  try {
    rejectRegistration(db, keyId);
  } finally {
    db.close();
  }
  console.log(`${keyId}: rejected`);
});

program
  .command('corpus-refresh')
  .option('--force')
  .action(async (options: { force?: boolean }) => {
    const result = await refreshCorpusSnapshot({ force: options.force });
    console.log(`${result.kind}: ${result.count} entries`);
  });

program
  .command('backup')
  .argument('[destination]')
  .action(async (destination?: string) => {
    const db = openDb();
    const target = path.resolve(
      destination ??
        `./data/backups/app-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      await db.backup(target);
    } finally {
      db.close();
    }
    console.log(target);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
