import { shouldStop } from './coverage-stop.mjs';
import {
  assembleObservation,
  bboxFromEvaluate,
  pageErrorsFromEvaluate,
  parseConsole,
  parseNetwork,
  parseSnapshot,
  screenshotPath,
} from './normalize.mjs';
import { StateGraph } from './state-graph.mjs';

const PLAYWRIGHT_PREFIX = 'mcp__playwright__browser_';

function contentItems(event) {
  const content = event?.message?.content ?? event?.content ?? [];
  return Array.isArray(content) ? content : [];
}

function toolResultText(result) {
  if (typeof result.content === 'string') return result.content;
  if (!Array.isArray(result.content)) return '';
  return result.content
    .filter(({ type, text }) => type === 'text' && typeof text === 'string')
    .map(({ text }) => text)
    .join('\n');
}

export function parseStream(jsonlText) {
  if (typeof jsonlText !== 'string') throw new TypeError('stream must be a string');

  const calls = [];
  const byId = new Map();
  const lines = jsonlText.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;

    let event;
    try {
      event = JSON.parse(lines[index]);
    } catch (error) {
      throw new SyntaxError(`Invalid stream JSON on line ${index + 1}: ${error.message}`);
    }

    for (const item of contentItems(event)) {
      if (
        item.type === 'tool_use'
        && typeof item.id === 'string'
        && typeof item.name === 'string'
        && item.name.startsWith(PLAYWRIGHT_PREFIX)
      ) {
        const call = {
          id: item.id,
          tool: item.name,
          input: item.input ?? {},
          resultText: null,
        };
        calls.push(call);
        byId.set(item.id, call);
      }

      if (item.type === 'tool_result' && byId.has(item.tool_use_id)) {
        byId.get(item.tool_use_id).resultText = toolResultText(item);
      }
    }
  }

  return calls
    .filter(({ resultText }) => typeof resultText === 'string')
    .map(({ id, ...call }) => call);
}

function networkEntryEqual(left, right) {
  return left.method === right.method && left.url === right.url && left.status === right.status;
}

function deltaFromCursor(current, previous, equal = Object.is) {
  const extendsPrevious = previous.length <= current.length
    && previous.every((entry, index) => equal(entry, current[index]));
  return extendsPrevious ? current.slice(previous.length) : current;
}

function inlineSnapshot(text) {
  return /### Snapshot\s*\r?\n```(?:yaml|yml)?\s*\r?\n/i.test(text);
}

export function buildObservations(steps, options = {}) {
  if (!Array.isArray(steps)) throw new TypeError('steps must be an array');

  const graph = new StateGraph(options.plateauK ?? 5);
  const observations = [];
  let draft = null;
  let networkCursor = [];
  let consoleCursor = [];

  function finalizeDraft() {
    if (!draft) return;
    const { step, ...parts } = draft;
    const observation = assembleObservation(parts);
    observations.push(observation);
    graph.observe({
      url: observation.url,
      a11yTree: observation.a11yTree,
      step,
    });
    draft = null;
  }

  steps.forEach((item, stepIndex) => {
    if (!item || typeof item !== 'object' || typeof item.tool !== 'string') return;
    if (!item.tool.startsWith(PLAYWRIGHT_PREFIX) || typeof item.resultText !== 'string') return;

    const tool = item.tool.slice(PLAYWRIGHT_PREFIX.length);
    if (tool === 'navigate') {
      finalizeDraft();
      networkCursor = [];
      consoleCursor = [];
      return;
    }

    if (tool === 'snapshot' && inlineSnapshot(item.resultText)) {
      finalizeDraft();
      draft = {
        step: stepIndex,
        snapshot: parseSnapshot(item.resultText),
        screenshot: '',
        consoleMessages: [],
        pageErrors: [],
        network: [],
      };
      return;
    }

    if (!draft) return;

    if (tool === 'network_requests') {
      const current = parseNetwork(item.resultText);
      draft.network.push(...deltaFromCursor(current, networkCursor, networkEntryEqual));
      networkCursor = current;
      return;
    }

    if (tool === 'console_messages') {
      const current = parseConsole(item.resultText);
      draft.consoleMessages.push(...deltaFromCursor(current, consoleCursor));
      consoleCursor = current;
      return;
    }

    if (tool === 'take_screenshot') {
      draft.screenshot = screenshotPath(item.resultText);
      return;
    }

    if (tool === 'evaluate') {
      const source = typeof item.input?.function === 'string' ? item.input.function : '';
      // A live exploration issues MANY browser_evaluate calls with varied shapes. Only the ones
      // returning the expected structure contribute; a source substring that misfires (e.g.
      // getBoundingClientRect used for a different probe) must be skipped, never fatal.
      try {
        if (source.includes('__polluxPageErrors')) {
          draft.pageErrors = pageErrorsFromEvaluate(item.resultText);
        } else if (source.includes('getBoundingClientRect')) {
          draft.bbox = bboxFromEvaluate(item.resultText);
        }
      } catch {
        // non-conforming evaluate result for this heuristic — leave the channel unset
      }
    }
  });

  finalizeDraft();
  const coverage = graph.coverage();
  const budget = {
    stepsUsed: observations.length,
    stepsMax: Number.POSITIVE_INFINITY,
    ...(options.budget ?? {}),
  };

  return {
    observations,
    coverage,
    stop: shouldStop({ coverage, budget }),
  };
}
