import { parseStream } from './runner.mjs';

function parseJsonLines(jsonlText, { skipInvalid = false } = {}) {
  if (typeof jsonlText !== 'string') throw new TypeError('stream must be a string');

  const events = [];
  const lines = jsonlText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;

    try {
      events.push(JSON.parse(lines[index]));
    } catch (error) {
      if (skipInvalid) continue;
      throw new SyntaxError(`Invalid stream JSON on line ${index + 1}: ${error.message}`);
    }
  }

  return events;
}

export function parseClaudeStream(jsonlText) {
  return parseStream(jsonlText);
}

export function parseCodexStream(jsonlText) {
  const calls = [];

  for (const event of parseJsonLines(jsonlText, { skipInvalid: true })) {
    const item = event?.item;
    if (event?.type !== 'item.completed' || item?.type !== 'mcp_tool_call') continue;
    if (typeof item.server !== 'string' || !item.server) continue;
    if (typeof item.tool !== 'string' || !item.tool) continue;

    calls.push({
      tool: `mcp__${item.server}__${item.tool}`,
      input: item.arguments ?? {},
      resultText: String(item.result ?? item.output ?? ''),
    });
  }

  return calls;
}

export function extractClaudeVerdict(jsonlText) {
  const results = parseJsonLines(jsonlText).filter((event) => event?.type === 'result');
  if (results.length !== 1) {
    throw new Error(`Claude stream must contain exactly one result event; found ${results.length}`);
  }

  const [result] = results;
  if (result.subtype !== 'success') {
    throw new Error(`Claude result event must have subtype "success"; found "${result.subtype}"`);
  }
  if (result.result && typeof result.result === 'object') return result.result;
  if (typeof result.result !== 'string') {
    throw new TypeError('Claude result.result must be a JSON string or object');
  }

  try {
    return JSON.parse(result.result);
  } catch (error) {
    throw new SyntaxError(`Claude result.result is not valid JSON: ${error.message}`);
  }
}

export function extractCodexVerdict(jsonlText) {
  const messages = parseJsonLines(jsonlText, { skipInvalid: true })
    .filter((event) => (
      event?.type === 'item.completed'
      && event.item?.type === 'agent_message'
    ));
  if (messages.length === 0) throw new Error('Codex stream contains no agent_message item');

  const text = messages.at(-1).item.text;
  if (typeof text !== 'string') {
    throw new TypeError('Codex agent_message text must be a JSON string');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new SyntaxError(`Codex agent_message text is not valid JSON: ${error.message}`);
  }
}
