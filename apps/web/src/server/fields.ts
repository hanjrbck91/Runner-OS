/**
 * Field-aware payload mapping. CRITICAL RULE (preserved from M02):
 *   key OMITTED  -> field unchanged  (do NOT put it in the core fields object)
 *   key = null   -> clear the field
 *   key = ''     -> clear the field  (core treats '' as clear)
 *   key = value  -> set the field
 *
 * We detect presence with Object.prototype.hasOwnProperty — never with
 * destructuring/defaults, which would collapse "omitted" into "undefined" and
 * silently overwrite or drop the distinction.
 */
export function present(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * Copy present transport keys into core field names. `map` is
 * transportKey -> coreFieldName. Only present keys are copied (value or null),
 * preserving the omitted/clear/set distinction.
 */
export function mapPresentFields(
  body: Record<string, unknown>,
  map: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [transportKey, coreField] of Object.entries(map)) {
    if (present(body, transportKey)) out[coreField] = body[transportKey];
  }
  return out;
}
