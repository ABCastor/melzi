const MAX_RESPONSES = 20;
const MAX_BODY_LENGTH = 256_000;
const CAPTURE_TIMEOUT_MS = 2000;

export function rememberSourceModuleResponse(responses, response) {
  const url = response.url();
  if (!/\/src\/[^?]*\.[jt]sx?(?:\?|$)/.test(url)) return;
  responses.push({ response, url, status: response.status(), capturedAt: Date.now() });
  if (responses.length > MAX_RESPONSES) responses.shift();
}

export async function captureSourceModuleResponses(responses) {
  const selected = [...responses];
  const records = selected.map(({ response, ...metadata }) => ({ ...metadata, body: null, bodyState: 'pending' }));
  let collecting = true;
  let timer;
  const deadline = new Promise((resolve) => { timer = setTimeout(resolve, CAPTURE_TIMEOUT_MS); });
  const reads = selected.map(async ({ response }, index) => {
    try {
      const body = await response.text();
      if (collecting) Object.assign(records[index], {
        body: body.slice(0, MAX_BODY_LENGTH), bodyState: 'read', bodyTruncated: body.length > MAX_BODY_LENGTH,
      });
    } catch (error) {
      if (collecting) Object.assign(records[index], { bodyState: 'error', error: error.message });
    }
  });
  try {
    // All body reads share this one budget; success runs never read bodies.
    await Promise.race([Promise.all(reads), deadline]);
  } finally {
    collecting = false;
    clearTimeout(timer);
  }
  for (const record of records) {
    if (record.bodyState === 'pending') Object.assign(record, {
      bodyState: 'timeout', error: `body capture timed out after ${CAPTURE_TIMEOUT_MS}ms`,
    });
  }
  return records;
}
