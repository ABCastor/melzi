function resultBody(text) {
  if (typeof text !== 'string') throw new TypeError('tool result must be a string');

  const header = /(?:^|\r?\n)### Result[^\r\n]*\r?\n/.exec(text);
  if (!header) return text.trim();

  const remainder = text.slice(header.index + header[0].length);
  const nextSection = remainder.search(/\r?\n###\s/);
  return (nextSection === -1 ? remainder : remainder.slice(0, nextSection)).trim();
}

function parseResultJson(text) {
  const body = resultBody(text);
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new SyntaxError(`Playwright result is not valid JSON: ${error.message}`);
  }
}

function decodeQuotedName(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return value;
  }
}

function stateValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  return value;
}

export function parseSnapshot(text) {
  if (typeof text !== 'string') throw new TypeError('snapshot result must be a string');

  const url = text.match(/^- Page URL:\s*(.*)$/m)?.[1]?.trim() ?? '';
  const title = text.match(/^- Page Title:\s*(.*)$/m)?.[1]?.trim() ?? '';
  const yaml = text.match(/### Snapshot\s*\r?\n```(?:yaml|yml)?\s*\r?\n([\s\S]*?)\r?\n```/i)?.[1] ?? '';
  const a11yTree = {};

  for (const line of yaml.split(/\r?\n/)) {
    const ref = line.match(/\[ref=([^\]\s]+)\]/)?.[1];
    const roleMatch = line.match(/^\s*-\s+([^\s:[\]]+)/);
    if (!ref || !roleMatch) continue;

    const rest = line.slice(roleMatch[0].length);
    const quotedName = rest.match(/^\s+"((?:\\.|[^"\\])*)"/);
    const state = {};

    for (const match of line.matchAll(/\[([^\]]+)\]/g)) {
      const flag = match[1];
      if (flag.startsWith('ref=')) continue;

      const equals = flag.indexOf('=');
      if (equals === -1) {
        state[flag] = true;
      } else {
        state[flag.slice(0, equals)] = stateValue(flag.slice(equals + 1));
      }
    }

    a11yTree[ref] = {
      role: roleMatch[1],
      name: quotedName ? decodeQuotedName(quotedName[1]) : '',
      state,
    };
  }

  return { url, title, a11yTree };
}

export function parseNetwork(text) {
  if (typeof text !== 'string') throw new TypeError('network result must be a string');

  const entries = [];
  for (const line of resultBody(text).split(/\r?\n/)) {
    const match = line.match(/^\s*\d+\.\s+\[([^\]]+)\]\s+(.+?)\s+=>\s+\[(\d{3})\](?:\s|$)/);
    if (!match) continue;
    entries.push({
      method: match[1],
      url: match[2],
      status: Number(match[3]),
    });
  }
  return entries;
}

export function parseConsole(text) {
  if (typeof text !== 'string') throw new TypeError('console result must be a string');

  const messages = [];
  for (const line of resultBody(text).split(/\r?\n/)) {
    if (!line.trim() || /^Total messages:\s*\d+/i.test(line.trim())) continue;

    if (/^\s+/.test(line) && messages.length > 0) {
      messages[messages.length - 1] += `\n${line.trimEnd()}`;
    } else {
      messages.push(line.trim());
    }
  }
  return messages;
}

export function pageErrorsFromEvaluate(resultText) {
  const value = parseResultJson(resultText);
  if (!Array.isArray(value)) throw new TypeError('pageErrors result must be an array');
  return value;
}

export function bboxFromEvaluate(resultText) {
  const value = parseResultJson(resultText);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('bbox result must be an object');
  }
  for (const key of ['x', 'y', 'w', 'h']) {
    if (!Number.isFinite(value[key])) throw new TypeError(`bbox.${key} must be a number`);
  }
  return { x: value.x, y: value.y, w: value.w, h: value.h };
}

export function screenshotPath(resultText) {
  const body = resultBody(resultText);
  const markdownLink = body.match(/\[[^\]]*screenshot[^\]]*\]\(([^)\r\n]+)\)/i);
  if (markdownLink) return markdownLink[1];

  const plainPath = body.match(/(?:^|\s)([^\s"'`()]+\.(?:png|jpe?g|webp))(?:\s|$)/i);
  if (plainPath) return plainPath[1];
  throw new Error('Screenshot path not found in Playwright result');
}

export function assembleObservation(parts = {}) {
  const snapshot = parts.snapshot ?? parts;
  const observation = {
    url: snapshot.url ?? parts.url ?? '',
    title: snapshot.title ?? parts.title ?? '',
    a11yTree: snapshot.a11yTree ?? parts.a11yTree ?? {},
    screenshot: parts.screenshot ?? '',
    consoleMessages: [...(parts.consoleMessages ?? [])],
    pageErrors: [...(parts.pageErrors ?? [])],
    network: [...(parts.network ?? [])],
  };

  if (parts.bbox !== undefined) observation.bbox = { ...parts.bbox };
  if (parts.domProbes !== undefined) observation.domProbes = { ...parts.domProbes };
  return observation;
}
