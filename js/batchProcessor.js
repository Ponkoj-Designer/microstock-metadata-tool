/**
 * Controlled Async Batch Processor
 * Runs up to concurrencyLimit requests at a time with smart backoff and rate-limit recovery.
 * Individual failures do NOT stop the batch.
 * Provides per-item status and progress callbacks.
 */

/**
 * Process items with a controlled concurrency queue and automatic retries.
 *
 * @param {Array}    items          - Array of items to process
 * @param {Function} processFn      - async (item, index) => result
 * @param {Function} onItemStart    - (item, index) => void
 * @param {Function} onItemDone    - (item, index, result, error) => void
 * @param {Function} onProgress    - (completed, total) => void
 * @param {Function} shouldStop    - () => boolean  (for cancellation)
 * @param {Number}   concurrencyLimit - max parallel tasks
 */
export async function runBatchQueue({
  items,
  processFn,
  onItemStart,
  onItemDone,
  onProgress,
  onCooldown,
  shouldStop,
  concurrencyLimit = 2
}) {
  const total = items.length;
  if (total === 0) return;

  let completed = 0;
  let index = 0;
  let globalPausePromise = null;

  async function worker() {
    while (index < total) {
      if (shouldStop && shouldStop()) break;
      if (globalPausePromise) await globalPausePromise;

      const i = index++;
      if (i >= total) break;

      const item = items[i];
      onItemStart && onItemStart(item, i);

      let attempts = 0;
      const maxAttempts = 4; // Managed retry with exponential backoff & exact server cooldown
      let lastErr = null;
      let result = null;

      while (attempts < maxAttempts) {
        if (shouldStop && shouldStop()) break;
        if (globalPausePromise) await globalPausePromise;

        try {
          result = await processFn(item, i);
          lastErr = null;
          break; // Success!
        } catch (err) {
          lastErr = err;
          attempts++;

          const errMsg = String(err?.message || '');
          const lowerMsg = errMsg.toLowerCase();

          // Fatal errors: Stop retrying this specific item immediately
          const isFatal = (
            lowerMsg.includes('invalid gemini api key') ||
            lowerMsg.includes('invalid api key') ||
            lowerMsg.includes('api key is required') ||
            lowerMsg.includes('api_key_invalid') ||
            lowerMsg.includes('unauthorized') ||
            lowerMsg.includes('permission_denied') ||
            lowerMsg.includes('401') ||
            lowerMsg.includes('403') ||
            lowerMsg.includes('not supported for ai analysis') ||
            err?.name === 'AbortError'
          );

          if (isFatal || (shouldStop && shouldStop())) {
            break;
          }

          // Parse Google's exact retry time if provided (e.g. "Please retry in 22.87599564s")
          const retryMatch = errMsg.match(/retry in\s*([0-9.]+)\s*s/i) || errMsg.match(/retry after\s*([0-9.]+)\s*s/i);

          // Rate limit & temporary server recovery (429, 503, Resource Exhausted)
          const isRateLimit = retryMatch || (
            lowerMsg.includes('rate limit') ||
            lowerMsg.includes('quota') ||
            lowerMsg.includes('429') ||
            lowerMsg.includes('503') ||
            lowerMsg.includes('resource_exhausted') ||
            lowerMsg.includes('overloaded') ||
            lowerMsg.includes('too many requests')
          );

          let backoffMs = 0;
          if (retryMatch) {
            backoffMs = Math.ceil(parseFloat(retryMatch[1]) * 1000) + 1200; // Exact required seconds + 1.2s safety buffer
          } else if (isRateLimit) {
            backoffMs = Math.min(15000, 3000 * Math.pow(1.4, attempts - 1) + Math.random() * 400);
          }

          if (backoffMs > 0) {
            onCooldown && onCooldown(item, Math.round(backoffMs / 1000), errMsg);
            if (!globalPausePromise) {
              console.warn(`[BatchProcessor] API rate limit cooldown (${Math.round(backoffMs / 1000)}s). Pausing workers...`);
              globalPausePromise = new Promise(resolve => setTimeout(resolve, backoffMs));
              globalPausePromise.then(() => { globalPausePromise = null; });
            }
            await globalPausePromise;
          } else if (attempts < maxAttempts && (!shouldStop || !shouldStop())) {
            const delay = Math.round(1000 * Math.pow(1.5, attempts - 1) + Math.random() * 400);
            await new Promise(r => setTimeout(r, delay));
          }
        }
      }

      if (lastErr && (!shouldStop || !shouldStop())) {
        onItemDone && onItemDone(item, i, null, lastErr);
      } else if (!lastErr && (!shouldStop || !shouldStop())) {
        onItemDone && onItemDone(item, i, result, null);
      }

      completed++;
      onProgress && onProgress(completed, total);
    }
  }

  const activeConcurrency = Math.max(1, Math.min(concurrencyLimit || 2, total));
  const workers = [];
  for (let w = 0; w < activeConcurrency; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}
