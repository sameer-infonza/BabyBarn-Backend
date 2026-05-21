/** Central feature toggles — enable via environment when inventory is ready. */
export function isRefurbishedEnabled() {
  return process.env.REFURBISHED_ENABLED === 'true';
}
