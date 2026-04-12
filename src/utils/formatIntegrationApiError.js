/**
 * Accounting HTTP APIs often return error bodies as `{ message: "..." }` (Bukku, etc.).
 * Use for JSON `reason` fields so clients never receive non-string values (avoids React #31 when shown in UI).
 */
function formatIntegrationApiError(err) {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object') {
    if (typeof err.message === 'string' && err.message) return err.message;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

module.exports = { formatIntegrationApiError };
