/**
 * Lazy-loading singleton wrapper around a Transformers.js
 * zero-shot classification pipeline.
 *
 * The model is downloaded on first use and cached locally.
 * Uses the WASM backend (onnxruntime-web) so it runs on any
 * platform including Termux/Android.
 */

const DEFAULT_MODEL = 'Xenova/distilbert-base-uncased-mnli';
const DEFAULT_THRESHOLD = 0.7;

let _pipelineInstance = null;
let _pipelinePromise = null;

/**
 * Returns (and lazily creates) a shared zero-shot classification pipeline.
 *
 * @param {string} [model] HuggingFace model id.
 * @returns {Promise<Function>} The pipeline function.
 */
async function getPipeline(model = DEFAULT_MODEL) {
    if (_pipelineInstance) {
        return _pipelineInstance;
    }
    if (_pipelinePromise) {
        return _pipelinePromise;
    }

    _pipelinePromise = (async () => {
        // Inject onnxruntime-web before importing transformers so it
        // skips the native onnxruntime-node (unavailable on Android).
        const ort = await import('onnxruntime-web');
        globalThis[Symbol.for('onnxruntime')] = ort;

        const { pipeline, env } = await import('@huggingface/transformers');

        // Force WASM backend
        env.backends.onnx.wasm.numThreads = 1;

        _pipelineInstance = await pipeline(
            'zero-shot-classification',
            model,
            { dtype: 'q8' }
        );
        _pipelinePromise = null;
        return _pipelineInstance;
    })();

    return _pipelinePromise;
}

/**
 * Classifies text against one or more candidate labels.
 *
 * @param {string} text The text to classify.
 * @param {string[]} candidateLabels Labels to score against.
 * @param {string} [model] HuggingFace model id.
 * @returns {Promise<{label: string, score: number}[]>} Sorted label/score pairs.
 */
async function classify(text, candidateLabels, model) {
    const classifier = await getPipeline(model);
    const result = await classifier(text, candidateLabels);
    // Result has { sequence, labels[], scores[] }
    return result.labels.map((label, i) => ({
        label,
        score: result.scores[i]
    }));
}

/**
 * Resets the singleton pipeline (useful for testing).
 */
function resetPipeline() {
    _pipelineInstance = null;
    _pipelinePromise = null;
}

export {
    classify,
    getPipeline,
    resetPipeline,
    DEFAULT_MODEL,
    DEFAULT_THRESHOLD
};
