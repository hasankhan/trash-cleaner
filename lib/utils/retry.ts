interface RetryableError extends Error {
    status?: number;
    statusCode?: number;
    code?: string;
    response?: { status?: number };
}

interface RetryOptions {
    maxRetries?: number;
    baseDelay?: number;
    shouldRetry?: (err: RetryableError) => boolean;
}

/**
 * Retries an async function with exponential backoff.
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        shouldRetry = isRetryableError
    } = options;

    let lastError: RetryableError | undefined;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err as RetryableError;
            if (attempt >= maxRetries || !shouldRetry(lastError)) {
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
 */
export function isRetryableError(err: RetryableError): boolean {
    // HTTP status codes that indicate transient failures
    const retryableStatuses = [429, 500, 502, 503, 504];

    const status = err.status || err.statusCode ||
        (err.response && err.response.status);

    if (typeof status === 'number' && retryableStatuses.includes(status)) {
        return true;
    }

    // Network errors
    const networkCodes = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'EAI_AGAIN'];
    if (err.code && networkCodes.includes(err.code)) {
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
 */
export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export type { RetryOptions, RetryableError };
