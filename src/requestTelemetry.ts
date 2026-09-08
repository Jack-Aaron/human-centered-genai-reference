export function safeLogToken(value: string | undefined): string | undefined {
  if (!value || value.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    return undefined;
  }
  return value;
}

export function logHttpRequest(input: {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  clientKeyId?: string;
  authResult?: string;
  requestBytes?: number;
}): void {
  const record: Record<string, string | number> = {
    event: 'http_request',
    method: input.method,
    path: input.path,
    status: input.status,
    duration_ms: input.durationMs,
  };

  const keyId = safeLogToken(input.clientKeyId);
  const authResult = safeLogToken(input.authResult);
  if (keyId) record.client_key_id = keyId;
  if (authResult) record.auth_result = authResult;
  if (typeof input.requestBytes === 'number') record.request_bytes = input.requestBytes;

  process.stderr.write(`${JSON.stringify(record)}\n`);
}
