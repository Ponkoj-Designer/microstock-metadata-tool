/**
 * Controlled Async Batch Processor
 * Runs up to MAX_CONCURRENT requests at a time.
 * Individual failures do NOT stop the batch.
 * Provides per-item status and progress callbacks.
 */

const MAX_CONCURRENT = 3;

/**
 * Process items with a controlled concurrency queue.
 *
 * @param {Array}    items          - Array of items to process
 * @param {Function} processFn      - async (item, index) => result
 * @param {Function} onItemStart    - (item, index) => void
 * @param {Function} onItemDone    - (item, index, result, error) => void
 * @param {Function} onProgress    - (completed, total) => void
 * @param {Function} shouldStop    - () => boolean  (for cancellation)
 */
export async function runBatchQueue({
  items,
  processFn,
  onItemStart,
  onItemDone,
  onProgress,
  shouldStop
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
      try {
        const result = await processFn(item, i);
        onItemDone && onItemDone(item, i, result, null);
      } catch (err) {
        onItemDone && onItemDone(item, i, null, err);
      }
      completed++;
      onProgress && onProgress(completed, total);
    }
  }

  // Spawn up to MAX_CONCURRENT workers
  const workers = [];
  const concurrency = Math.min(MAX_CONCURRENT, total);
  for (let w = 0; w < concurrency; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
}
