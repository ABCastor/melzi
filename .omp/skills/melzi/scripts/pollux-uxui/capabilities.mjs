const CAPABILITY_NAMES = [
  'pageErrors',
  'network',
  'a11yTree',
  'consoleMessages',
  'bbox',
  'screenshot',
];

function present(value) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return true;

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return false;
  if (/### result\s+undefined(?:\s+###|\s*$)/i.test(value)) return false;
  return true;
}

function availability(available, name) {
  if (available instanceof Set) return available.has(name);
  if (Array.isArray(available)) return available.includes(name);
  if (!available || typeof available !== 'object') return false;

  if (Object.hasOwn(available, name)) return present(available[name]);
  if (name === 'pageErrors' && Object.hasOwn(available, 'pageErrorsChannel')) {
    return present(available.pageErrorsChannel);
  }
  return false;
}

export function capabilities(available) {
  return Object.fromEntries(
    CAPABILITY_NAMES.map((name) => [name, availability(available, name)]),
  );
}

export function requireCapabilities(caps, required) {
  let names;
  if (required instanceof Set) {
    names = [...required];
  } else if (Array.isArray(required)) {
    names = required;
  } else if (required && typeof required === 'object') {
    names = Object.entries(required)
      .filter(([, isRequired]) => isRequired)
      .map(([name]) => name);
  } else {
    throw new TypeError('required capabilities must be an array, Set, or object');
  }

  const missing = names.filter((name) => caps?.[name] !== true);
  if (missing.length > 0) {
    throw new Error(`Missing required capabilities: ${missing.join(', ')}`);
  }
  return caps;
}
