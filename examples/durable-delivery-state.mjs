import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Small reference helper for crash-safe downstream delivery state.
 *
 * It intentionally contains no browser or vendor-specific code. A delivery
 * adapter can use these functions around an external UI/API transaction.
 */

async function syncDirectory(directory) {
  const handle = await fs.open(directory, 'r');

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function atomicWriteJson(filePath, value) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  const temporary = path.join(
    directory,
    `.${basename}.tmp.${process.pid}.${Date.now()}`,
  );

  await fs.mkdir(directory, {
    recursive: true,
    mode: 0o700,
  });

  const handle = await fs.open(
    temporary,
    'wx',
    0o600,
  );

  try {
    await handle.writeFile(
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8',
    );
    await handle.sync();
  } finally {
    await handle.close();
  }

  await fs.rename(temporary, filePath);
  await syncDirectory(directory);
}

export async function readPending(filePath) {
  try {
    const value = JSON.parse(
      await fs.readFile(filePath, 'utf8'),
    );

    if (
      !value ||
      value.version !== 1 ||
      typeof value.text !== 'string' ||
      !['fetched', 'sending'].includes(value.status) ||
      typeof value.fetched_at_ms !== 'number'
    ) {
      throw new Error('Invalid pending-delivery state');
    }

    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function persistFetched(
  filePath,
  {
    jobId = null,
    text,
    now = Date.now(),
  },
) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('text must be a non-empty string');
  }

  const pending = {
    version: 1,
    job_id: jobId,
    status: 'fetched',
    text,
    fetched_at_ms: now,
    attempted_at_ms: null,
  };

  await atomicWriteJson(filePath, pending);
  return pending;
}

export async function markSending(
  filePath,
  pending,
  now = Date.now(),
) {
  const next = {
    ...pending,
    status: 'sending',
    attempted_at_ms: now,
  };

  // Persist "sending" before crossing the external side-effect boundary.
  await atomicWriteJson(filePath, next);
  return next;
}

export async function appendConfirmation(
  historyPath,
  record,
) {
  const directory = path.dirname(historyPath);

  await fs.mkdir(directory, {
    recursive: true,
    mode: 0o700,
  });

  const handle = await fs.open(
    historyPath,
    'a',
    0o600,
  );

  try {
    await handle.writeFile(
      `${JSON.stringify(record)}\n`,
      'utf8',
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function confirmAndClear(
  pendingPath,
  historyPath,
  pending,
  {
    externalMessageId,
    externalTargetId,
    externalSenderId,
    source = 'live-send',
    now = Date.now(),
  },
) {
  if (!externalMessageId) {
    throw new Error('externalMessageId is required');
  }

  await appendConfirmation(historyPath, {
    job_id: pending.job_id ?? null,
    text: pending.text,
    fetched_at_ms: pending.fetched_at_ms,
    attempted_at_ms: pending.attempted_at_ms ?? null,
    confirmed_at_ms: now,
    external_message_id: externalMessageId,
    external_target_id: externalTargetId ?? null,
    external_sender_id: externalSenderId ?? null,
    confirmation_source: source,
  });

  await fs.unlink(pendingPath);
  await syncDirectory(path.dirname(pendingPath));
}
