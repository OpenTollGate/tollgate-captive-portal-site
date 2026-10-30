// gateway-objective capability probe and choice submission.
//
// The portal may only show a gateway picker on a router whose backend actually
// serves the multi-WAN objective endpoint. On a router without it the route
// answers 404 (or the request never resolves), and the caller must render
// NOTHING — a picker that cannot persist a choice is worse than no picker.
//
// Contract (see README, "Gateway objective picker"):
//
//   GET  /api/multi_wan/objectives
//     200 {enabled: true, allow_change: "next_session" | "never",
//          current: "<objective id>",
//          objectives: [{id, label, summary?}, ...]}
//
//   POST /api/multi_wan/objectives   {objective: "<id>"}
//     2xx                                   -> stored for the next session
//     404 / 405 / 501                       -> this build cannot store a choice
//
// `allow_change` is the router's own statement about the pin: "next_session"
// means a change is possible but only takes effect when the next session
// starts; "never" means the objective is operator-pinned and this session (and
// every later one) keeps what it has.

import { getTollgateBaseUrl } from './tollgate.js';

export const OBJECTIVE_ENDPOINT_PATH = '/api/multi_wan/objectives';

// A captive-portal probe has to answer fast or not at all: the buyer is staring
// at a page that is otherwise ready. A slow endpoint is treated exactly like an
// absent one.
export const PROBE_TIMEOUT_MS = 4000;
export const SUBMIT_TIMEOUT_MS = 8000;

const ALLOWED_CHANGE_MODES = ['next_session', 'never'];

// objective ids the catalog carries copy for. The decision record spells them
// `cost` / `speed` / `balanced`; this repo's catalog spells them
// `minimize_cost` / `maximize_speed` / `balanced`. Both spellings resolve to the
// same buyer-facing sentence, so a backend using either one is readable here.
const OBJECTIVE_LABEL_KEYS = {
  minimize_cost: 'gateway.objective.minimize_cost',
  cost: 'gateway.objective.minimize_cost',
  maximize_speed: 'gateway.objective.maximize_speed',
  speed: 'gateway.objective.maximize_speed',
  balanced: 'gateway.objective.balanced',
};

const isNonEmptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0;

// translate an objective id to its catalog key, or null when the id is one the
// catalog does not know (the endpoint's own `label` is used then).
export const objectiveLabelKey = (id) => Object.hasOwn(OBJECTIVE_LABEL_KEYS, id) ? OBJECTIVE_LABEL_KEYS[id] : null;

// Validate an endpoint body into the shape the picker renders.
//
// Returns null for anything that is not a complete, self-consistent capability
// statement. Being strict here is the whole point: a half-understood body must
// produce no UI rather than a picker that shows options the router does not
// have or a "current" the buyer cannot see in the list.
export const parseObjectivesPayload = (payload) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  // `enabled` must be literally true — absent, "true", 1 and null all mean no.
  if (payload.enabled !== true) return null;

  if (!ALLOWED_CHANGE_MODES.includes(payload.allow_change)) return null;

  const rawObjectives = payload.objectives;
  if (!Array.isArray(rawObjectives) || rawObjectives.length === 0) return null;

  const objectives = [];
  const ids = new Set();

  for (const entry of rawObjectives) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (!isNonEmptyString(entry.id)) return null;
    if (!isNonEmptyString(entry.label)) return null;
    if (entry.summary !== undefined && typeof entry.summary !== 'string') return null;
    // a duplicated id would render two rows that set the same value
    if (ids.has(entry.id)) return null;
    ids.add(entry.id);

    objectives.push({
      id: entry.id,
      label: entry.label,
      summary: isNonEmptyString(entry.summary) ? entry.summary : null,
    });
  }

  // `current` has to name one of the offered objectives. Otherwise the picker
  // would have to label the current gateway with a bare id it has no copy for.
  if (!isNonEmptyString(payload.current) || !ids.has(payload.current)) return null;

  return {
    allowChange: payload.allow_change,
    current: payload.current,
    objectives,
  };
};

// fetch + validate the capability statement. Resolves to the parsed capability,
// or null for every failure mode: 404, non-2xx, timeout/abort, network error,
// unparsable JSON, `enabled: false`, malformed body. Callers render on truthy
// only, so no branch here needs an error string.
export const fetchGatewayObjectives = async (fetchImpl = globalThis.fetch) => {
  if (typeof fetchImpl !== 'function') return null;

  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    : null;

  try {
    const response = await fetchImpl(
      `${getTollgateBaseUrl()}${OBJECTIVE_ENDPOINT_PATH}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller ? controller.signal : undefined,
      },
    );

    // 404 is the expected answer on every router that has no multi-WAN support,
    // and a 5xx is not a capability statement either.
    if (!response || !response.ok) return null;

    const payload = await response.json().catch(() => null);
    return parseObjectivesPayload(payload);
  } catch {
    // aborted probe, DNS failure, captive-portal interception — all identical
    // from the buyer's side: do not show the picker.
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// Persist the buyer's choice for the NEXT session.
//
// Returns a three-valued outcome so the caller can distinguish "stored" from
// "this build has no write route" — the second must disable the control rather
// than report a success the router will forget at the next reconnect.
export const submitGatewayObjective = async (objectiveId, fetchImpl = globalThis.fetch) => {
  if (typeof fetchImpl !== 'function') return 'unsupported';
  if (!isNonEmptyString(objectiveId)) return 'error';

  const controller =
    typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)
    : null;

  try {
    const response = await fetchImpl(
      `${getTollgateBaseUrl()}${OBJECTIVE_ENDPOINT_PATH}`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ objective: objectiveId }),
        signal: controller ? controller.signal : undefined,
      },
    );

    if (!response) return 'error';
    // 404/405/501 mean the route (or the method on it) is not there: a read-only
    // build. That is a capability answer, not a transient failure.
    if ([404, 405, 501].includes(response.status)) return 'unsupported';
    if (!response.ok) return 'error';
    return 'ok';
  } catch {
    return 'error';
  } finally {
    if (timer) clearTimeout(timer);
  }
};
