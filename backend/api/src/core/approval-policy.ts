/**
 * Separation of duties.
 *
 * A price correction or a master-data change is a commercial decision, so the
 * workflow was built maker-checker: the person who proposes a change is not
 * the person who approves it. That rule assumes there is more than one
 * account to be.
 *
 * This deployment ships with a single administrator, so enforcing it would
 * make every proposal permanently unapprovable — a draft that can be raised
 * and never published. The rule is therefore off by default and the one
 * administrator both proposes and approves, with every step still recorded
 * against them in the revision history and the audit log.
 *
 * Set REQUIRE_SEPARATE_APPROVER=true once a second account exists, and the
 * original two-person control comes back everywhere at once — master data,
 * price circulars and corrections all read this.
 */
export function requiresSeparateApprover(): boolean {
  return (process.env.REQUIRE_SEPARATE_APPROVER ?? "false").trim().toLowerCase() === "true";
}
