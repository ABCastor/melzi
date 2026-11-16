const OPS = new Set(['navigate', 'click', 'type', 'select', 'key', 'hover', 'wait']);

export function normalizeActionLog(log) {
  if (!Array.isArray(log)) throw new TypeError('actionLog must be an array');
  return log.map((action, index) => {
    const path = `actionLog[${index}]`;
    if (!action || typeof action !== 'object' || Array.isArray(action)) {
      throw new TypeError(`${path} must be an object`);
    }
    if (!Number.isInteger(action.step) || action.step < 0) {
      throw new TypeError(`${path}.step must be a non-negative integer`);
    }
    if (!OPS.has(action.op)) throw new TypeError(`${path}.op is invalid`);
    if (typeof action.ref !== 'string') throw new TypeError(`${path}.ref must be a string`);
    if (Object.hasOwn(action, 'value') && typeof action.value !== 'string') {
      throw new TypeError(`${path}.value must be a string`);
    }
    if (Object.hasOwn(action, 'selector') && typeof action.selector !== 'string') {
      throw new TypeError(`${path}.selector must be a string`);
    }
    if (Object.hasOwn(action, 'note') && typeof action.note !== 'string') {
      throw new TypeError(`${path}.note must be a string`);
    }
    return {
      step: index,
      op: action.op,
      ref: action.ref,
      ...(Object.hasOwn(action, 'value') ? { value: action.value } : {}),
      ...(Object.hasOwn(action, 'selector') ? { selector: action.selector } : {}),
      ...(Object.hasOwn(action, 'note') ? { note: action.note } : {}),
    };
  });
}

export function serialize(log) {
  return JSON.stringify(normalizeActionLog(log));
}

export function parse(str) {
  return normalizeActionLog(JSON.parse(str));
}
