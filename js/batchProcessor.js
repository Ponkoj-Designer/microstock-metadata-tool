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
      const maxAttempts = 4; // Up to 4 attempts with exponential backoff for bulk 100-200+ files
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
            lowerMsg.includes('insufficient credits') ||
            err?.name === 'AbortError'
          );

          if (isFatal || (shouldStop && shouldStop())) {
            break;
          }

          // Rate limit & temporary server recovery (429, 503, Resource Exhausted)
          const isRateLimit = (
            lowerMsg.includes('rate limit') ||
            lowerMsg.includes('quota') ||
            lowerMsg.includes('429') ||
            lowerMsg.includes('503') ||
            lowerMsg.includes('resource_exhausted') ||
            lowerMsg.includes('overloaded') ||
            lowerMsg.includes('too many requests')
          );

          if (isRateLimit) {
            if (!globalPausePromise) {
              const backoffMs = Math.min(10000, 3000 * Math.pow(1.4, attempts - 1) + Math.random() * 500);
              console.warn(`[BatchProcessor] Rate limit / 503 encountered. Pausing queue for ${Math.round(backoffMs)}ms...`);
              globalPausePromise = new Promise(resolve => setTimeout(resolve, backoffMs));
              globalPausePromise.then(() => { globalPausePromise = null; });
            }
            await globalPausePromise;
          }

          if (attempts < maxAttempts && (!shouldStop || !shouldStop())) {
            // Progressive jittered delay: attempt 1 -> ~1500ms, attempt 2 -> ~3000ms, attempt 3 -> ~6000ms
            const delay = Math.round(1500 * Math.pow(2, attempts - 1) + Math.random() * 500);
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
