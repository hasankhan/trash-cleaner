/**
 * Retries an async function with exponential backoff.
 *
 * @param {Function} fn The async function to retry.
 * @param {object} options Retry options.
 * @param {number} options.maxRetries Maximum number of retries (default: 3).
 * @param {number} options.baseDelay Base delay in ms between retries (default: 1000).
 * @param {Function} options.shouldRetry Predicate to decide if error is retryable.
 * @returns {Promise<*>} The result of the function call.
 */
async function retry(fn, options = {}) {
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
 * @param {Error} err The error to check.
 * @returns {boolean} True if the error is retryable.
 */
function isRetryableError(err) {
    // HTTP status codes that indicate transient failures
    const retryableStatuses = [429, 500, 502, 503, 504];

    const status = err.status || err.statusCode ||
        (err.response && err.response.status) ||
        (err.code && err.code);

    if (retryableStatuses.includes(status)) {
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { retry, isRetryableError, sleep };
