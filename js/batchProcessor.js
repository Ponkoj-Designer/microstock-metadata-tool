/**
 * Controlled Async Batch Processor
 * Runs up to MAX_CONCURRENT requests at a time.
 * Individual failures do NOT stop the batch.
 * Provides per-item status and progress callbacks.
 */

const MAX_CONCURRENT = 3;

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
  concurrencyLimit = 3
}) {
  const total = items.length;
  let completed = 0;
  let index = 0;

  async function worker() {
    while (index < total) {
      if (shouldStop && shouldStop()) break;
      const i = index++;
      const item = items[i];
      onItemStart && onItemStart(item, i);
      
      let attempts = 0;
      const maxAttempts = 3;
      let lastErr = null;
      let result = null;

      while (attempts < maxAttempts) {
        if (shouldStop && shouldStop()) break;
        try {
          result = await processFn(item, i);
          lastErr = null;
          break; // Success! Break retry loop
        } catch (err) {
          lastErr = err;
          attempts++;
          
          // Do not retry on explicit missing API keys or Auth errors
          const errMsg = err.message || '';
          if (errMsg.toLowerCase().includes('api key') || errMsg.toLowerCase().includes('unauthorized')) {
             break; 
          }

          if (attempts < maxAttempts) {
            // Exponential backoff: 2s, 4s...
            const delayMs = Math.pow(2, attempts) * 1000;
            await new Promise(r => setTimeout(r, delayMs));
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

  const workers = [];
  const activeConcurrency = Math.min(concurrencyLimit, total);
  for (let w = 0; w < activeConcurrency; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}
