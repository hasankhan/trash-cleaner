/**
 * Retries an async function with exponential backoff.
 *
 * @param {Function} fn The async function to retry.
 * @param {Partial<{maxRetries: number, baseDelay: number, shouldRetry: Function}>} [options] Retry options.
 * @returns {Promise<*>} The result of the function call.
 */
export async function retry(fn, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        shouldRetry = isRetryableError
    } = options;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt >= maxRetries || !shouldRetry(err)) {
                throw err;
            }
            const delay = baseDelay * Math.pow(2, attempt);
            await sleep(delay);
        }
    }
    throw lastError;
}

/**
 * Determines if an error is retryable (transient network/rate limit errors).
 *
 * @param {Error & {status?: number, statusCode?: number, code?: string, response?: {status?: number}}} err The error to check.
 * @returns {boolean} True if the error is retryable.
 */
export function isRetryableError(err) {
    // HTTP status codes that indicate transient failures
    const retryableStatuses = [429, 500, 502, 503, 504];

    const status = err.status || err.statusCode ||
        (err.response && err.response.status);

    if (typeof status === 'number' && retryableStatuses.includes(status)) {
        return true;
    }

    // Network errors
    const networkCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN'];
    if (networkCodes.includes(err.code)) {
        return true;
    }

    // Axios network error
    if (err.message && err.message.includes('Network Error')) {
        return true;
    }

    return false;
}

/**
 * Sleeps for the given number of milliseconds.
 *
 * @param {number} ms Milliseconds to sleep.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
