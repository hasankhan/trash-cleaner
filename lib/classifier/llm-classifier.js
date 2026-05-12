/**
 * Lazy-loading singleton wrapper around a Transformers.js
 * sentence embedding pipeline for semantic similarity.
 *
 * The model is downloaded on first use and cached locally.
 * On platforms where onnxruntime-node is unavailable (e.g.
 * Android/Termux), the postinstall script patches it with
 * an onnxruntime-web shim.
 */

import { cos_sim } from '@xenova/transformers';

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';
const DEFAULT_THRESHOLD = 0.3;

let _pipelineInstance = null;
let _pipelinePromise = null;
let _labelEmbeddings = new Map();

/**
 * Returns (and lazily creates) a shared feature-extraction pipeline.
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
        const { pipeline } = await import('@xenova/transformers');

        _pipelineInstance = await pipeline(
            'feature-extraction',
            model,
            { quantized: true }
        );
        _pipelinePromise = null;
        return _pipelineInstance;
    })();

    return _pipelinePromise;
}

/**
 * Computes the embedding for a text string.
 *
 * @param {string} text The text to embed.
 * @param {string} [model] HuggingFace model id.
 * @returns {Promise<Float32Array>} The embedding vector.
 */
async function embed(text, model) {
    const extractor = await getPipeline(model);
    const [output] = await extractor(text, { pooling: 'mean', normalize: true });
    return output.data;
}

/**
 * Computes semantic similarity between text and a label.
 * Label embeddings are cached for efficiency.
 *
 * @param {string} text The text to classify.
 * @param {string} label The label/description to compare against.
 * @param {string} [model] HuggingFace model id.
 * @returns {Promise<number>} Cosine similarity score (0-1).
 */
async function classify(text, label, model) {
    if (!_labelEmbeddings.has(label)) {
        _labelEmbeddings.set(label, await embed(label, model));
    }
    const textEmb = await embed(text, model);
    const labelEmb = _labelEmbeddings.get(label);
    return cos_sim(textEmb, labelEmb);
}

/**
 * Resets the singleton pipeline (useful for testing).
 */
function resetPipeline() {
    _pipelineInstance = null;
    _pipelinePromise = null;
    _labelEmbeddings = new Map();
}

export {
    classify,
    getPipeline,
    resetPipeline,
    DEFAULT_MODEL,
    DEFAULT_THRESHOLD
};
