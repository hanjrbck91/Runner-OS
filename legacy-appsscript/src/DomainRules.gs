/**
 * Runner OS V1 — DomainRules.gs
 * Product-level value bounds for Daily fields, kept separate from type checks.
 *
 * TWO TIERS, deliberately distinguished:
 *
 *  FROZEN   — rules the M01 spec states explicitly ("cannot be negative").
 *             These are ratified product truth. Enforced hard.
 *
 *  PROPOSED — scales the frozen spec did NOT define (PAIN_SCORE, RUN_RPE,
 *             NUTRITION_ADHERENCE). Derived from the previously APPROVED
 *             architecture UX (pain 0-3, RPE 1-10, nutrition ON/MOST/OFF),
 *             NOT invented here. They are enforced but flagged for PM
 *             ratification. To change a scale, edit ONLY this file.
 *
 * If the PM rejects a PROPOSED rule, flip its `enforced` flag or adjust bounds
 * here; no other file encodes these numbers.
 */

var PROPOSED_RULES_ENFORCED = true; // PM may flip to false pending ratification.

var RUNNER_OS_DOMAIN_RULES = {
  // ---- FROZEN (M01 spec) ----
  WEIGHT:         { tier: 'FROZEN', min: 0, allowEmpty: true },
  SLEEP_HOURS:    { tier: 'FROZEN', min: 0, allowEmpty: true },
  RUN_ACTUAL_KM:  { tier: 'FROZEN', min: 0, allowEmpty: true },

  // ---- FROZEN (ratified by FI Council, M03) ----
  PAIN_SCORE:     { tier: 'FROZEN', min: 0, max: 3, integer: true, allowEmpty: true },
  RUN_RPE:        { tier: 'FROZEN', min: 1, max: 10, allowEmpty: true },
  NUTRITION_ADHERENCE: { tier: 'FROZEN', enum: ['ON', 'MOST', 'OFF'], allowEmpty: true },

  // ---- Plan20wk (FROZEN; WEEK_NUMBER bounded by the 20-week product) ----
  WEEK_NUMBER:     { tier: 'FROZEN', min: 1, max: 20, integer: true, allowEmpty: true },
  MILEAGE_TARGET:  { tier: 'FROZEN', min: 0, allowEmpty: true }
};

/**
 * Apply the domain rule (if any) for a field to an already type-normalized value.
 * @param {string} field
 * @param {*} value normalized value ('' means cleared/empty)
 * @return {{ok: boolean, error: (object|null), tier: (string|null)}}
 */
function checkDomain(field, value) {
  var rule = RUNNER_OS_DOMAIN_RULES[field];
  if (!rule) { return { ok: true, error: null, tier: null }; }

  var empty = (value === '' || value === null || value === undefined);
  if (empty) {
    if (rule.allowEmpty) { return { ok: true, error: null, tier: rule.tier }; }
    return { ok: false, tier: rule.tier,
             error: domErr_(field, value, rule.tier, 'value required') };
  }

  if (rule.tier === 'PROPOSED' && !PROPOSED_RULES_ENFORCED) {
    return { ok: true, error: null, tier: rule.tier };
  }

  if (rule.enum) {
    if (rule.enum.indexOf(String(value)) === -1) {
      return { ok: false, tier: rule.tier,
               error: domErr_(field, value, rule.tier, 'must be one of ' + rule.enum.join('/')) };
    }
    return { ok: true, error: null, tier: rule.tier };
  }

  var num = Number(value);
  if (rule.integer && !Number.isInteger(num)) {
    return { ok: false, tier: rule.tier,
             error: domErr_(field, value, rule.tier, 'must be an integer') };
  }
  if (rule.min !== undefined && num < rule.min) {
    return { ok: false, tier: rule.tier,
             error: domErr_(field, value, rule.tier, 'must be >= ' + rule.min) };
  }
  if (rule.max !== undefined && num > rule.max) {
    return { ok: false, tier: rule.tier,
             error: domErr_(field, value, rule.tier, 'must be <= ' + rule.max) };
  }
  return { ok: true, error: null, tier: rule.tier };
}

function domErr_(field, value, tier, msg) {
  return {
    code: 'DOMAIN_VALIDATION',
    field: field,
    value: value,
    tier: tier,
    message: field + ': ' + msg + ' [' + tier + ']'
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROPOSED_RULES_ENFORCED: PROPOSED_RULES_ENFORCED,
    RUNNER_OS_DOMAIN_RULES: RUNNER_OS_DOMAIN_RULES,
    checkDomain: checkDomain
  };
}
