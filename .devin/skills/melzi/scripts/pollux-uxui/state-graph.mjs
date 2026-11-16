import { createHash } from 'node:crypto';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function actionShape(action) {
  return {
    op: action.op,
    ref: action.ref,
    ...(Object.hasOwn(action, 'value') ? { value: action.value } : {}),
  };
}

function actionKey(action) {
  return JSON.stringify(canonical(actionShape(action)));
}

// Structural state key (Sol review 2026-07-15): the key represents the page's exploration TOPOLOGY,
// not its rendered content. Two observations are the same state when they share the route, the same
// regions + interactive controls, and the same action-relevant semantic flags. Transient feedback
// (toasts / live regions), dynamic text (counters, values, timestamps), and pointer presentation
// (focus/hover/cursor) do NOT change the state. Whether an action SUCCEEDED is not a state axis: a
// dead Save and a working Save are the same source state; the missing transition is the flaw.
const TRANSIENT_ROLES = new Set(['alert', 'status', 'log', 'marquee', 'timer']);
const ACTION_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio',
  'switch', 'slider', 'spinbutton', 'tab', 'menuitem', 'option',
]);
const IDENTITY_ROLES = new Set([
  ...ACTION_ROLES, 'dialog', 'alertdialog', 'navigation', 'main', 'form', 'region', 'heading',
]);
const STRUCTURAL_STATE_KEYS = new Set([
  'disabled', 'expanded', 'checked', 'selected', 'pressed', 'required',
  'readonly', 'invalid', 'multiselectable', 'orientation', 'level',
]);

function normalizeIdentityName(name) {
  return String(name ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    // collapse volatile numeric payloads (counters, %, ids) while keeping surrounding words
    .replace(/\b-?\d+(?:[.,]\d+)*(?:%|[a-zA-Z]+)?\b/g, '#');
}

// Reduce one a11y node to its structural contribution, or null if it does not define topology.
// Transient regions return null here (excluded from the KEY) but stay untouched in the observation
// stream so defect detection still sees them (silent-failure, validation-gap, persistent-alert...).
function structuralNode(node) {
  if (!node || typeof node !== 'object') return null;
  const { role, name, state } = node;
  if (TRANSIENT_ROLES.has(role)) return null;
  const stateObject = state && typeof state === 'object' && !Array.isArray(state) ? state : {};
  const semanticState = Object.fromEntries(
    Object.entries(stateObject).filter(([key]) => STRUCTURAL_STATE_KEYS.has(key)),
  );
  return {
    role,
    // control/region names define the available actions; content-payload names are dropped
    ...(IDENTITY_ROLES.has(role) ? { name: normalizeIdentityName(name) } : {}),
    state: semanticState,
  };
}

export function stateKey({ url, a11yTree }) {
  const normalizedUrl = new URL(url);
  normalizedUrl.search = '';
  normalizedUrl.hash = '';
  const structure = Object.values(a11yTree ?? {})
    .map(structuralNode)
    .filter(Boolean)
    .sort((a, b) => JSON.stringify(canonical(a)).localeCompare(JSON.stringify(canonical(b))));
  return `${normalizedUrl.href}\n${hash(JSON.stringify(canonical(structure)))}`;
}

export class StateGraph {
  constructor(k = 5) {
    if (!Number.isInteger(k) || k < 1) throw new TypeError('K must be a positive integer');
    this.k = k;
    this.nodes = new Map();
    this.edges = new Map();
    this.events = [];
  }

  observe({ url, a11yTree, step }) {
    const key = stateKey({ url, a11yTree });
    const id = hash(key);
    let node = this.nodes.get(id);
    const isNew = !node;

    if (isNew) {
      node = {
        id,
        stateKey: key,
        firstSeenStep: step,
        visits: 1,
        actionsAvailable: [],
        actionsTaken: [],
      };
      this.nodes.set(id, node);
    } else {
      node.visits += 1;
    }
    this.events.push({ newNode: isNew, newEdge: false });
    return node;
  }

  addEdge(fromId, toId, action, step) {
    const from = this.nodes.get(fromId);
    if (!from || !this.nodes.has(toId)) throw new Error('Edge endpoints must be observed nodes');
    const normalizedAction = actionShape(action);
    const key = JSON.stringify(canonical([fromId, toId, normalizedAction]));
    let edge = this.edges.get(key);
    const isNew = !edge;

    if (isNew) {
      edge = { from: fromId, to: toId, action: normalizedAction, step };
      this.edges.set(key, edge);
    }
    if (!from.actionsTaken.some((taken) => actionKey(taken) === actionKey(normalizedAction))) {
      from.actionsTaken.push(normalizedAction);
    }
    this.events.push({ newNode: false, newEdge: isNew });
    return edge;
  }

  coverage() {
    const recent = this.events.slice(-this.k);
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      newNodesInLastK: recent.filter(({ newNode }) => newNode).length,
      plateau: recent.length === this.k && recent.every(({ newNode, newEdge }) => !newNode && !newEdge),
    };
  }

  // The live Explorer is an LLM, so every helper invocation is a fresh process and
  // an in-memory graph dies between steps. Without a round-trip the plateau counter
  // restarts at zero each step and can never reach K -- which is why plateau never
  // fired live (the E2/E5 gap) even though the in-process unit test passes.
  // `events` is the plateau counter's whole memory: dropping it loses the signal.
  toJSON() {
    return {
      version: 1,
      k: this.k,
      nodes: [...this.nodes.values()],
      edges: [...this.edges.entries()],
      events: this.events,
    };
  }

  static fromJSON(data) {
    if (!data || typeof data !== 'object') throw new TypeError('state graph payload must be an object');
    if (data.version !== 1) throw new TypeError(`unsupported state graph version: ${data.version}`);
    const graph = new StateGraph(data.k);
    for (const node of data.nodes ?? []) graph.nodes.set(node.id, node);
    for (const [key, edge] of data.edges ?? []) graph.edges.set(key, edge);
    graph.events = [...(data.events ?? [])];
    return graph;
  }

  novelty(nodeId, action) {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    return node.actionsTaken.some((taken) => actionKey(taken) === actionKey(action)) ? 0 : 1;
  }
}
