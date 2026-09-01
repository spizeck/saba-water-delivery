/**
 * Processes every item while limiting the number of concurrent async
 * operations to `batchSize`. Each batch must settle before the next starts.
 */
export async function processInBatches<T>(
  items: readonly T[],
  batchSize: number,
  processItem: (item: T) => Promise<void>,
): Promise<void> {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error("INVALID_BATCH_SIZE");
  }

  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(processItem));
  }
}

