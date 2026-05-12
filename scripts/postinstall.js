#!/usr/bin/env node

/**
 * Postinstall script that patches native modules on platforms where
 * they are unavailable (e.g. Android/Termux).
 *
 * - onnxruntime-node → shim that re-exports onnxruntime-web
 * - sharp → no-op shim (only needed for image tasks, not text)
 */

import { existsSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);

/**
 * Tests whether a CJS module loads without error.
 *
 * @param {string} name Package name.
 * @returns {boolean} True if it loads successfully.
 */
function canLoad(name) {
    try {
        require(name);
        return true;
    } catch {
        return false;
    }
}

/**
 * Writes shim content to files in a module's dist directory.
 *
 * @param {string} moduleName The module to patch.
 * @param {string} shimContent The shim source to write.
 * @param {string[]} files Which files to overwrite.
 */
function patchModule(moduleName, shimContent, files) {
    let shimDir;
    try {
        shimDir = dirname(require.resolve(moduleName));
    } catch {
        return; // Module not installed
    }
    for (const file of files) {
        const filePath = join(shimDir, file);
        if (existsSync(filePath)) {
            writeFileSync(filePath, shimContent);
        }
    }
    console.log(`Patched ${moduleName} with shim for this platform.`);
}

// Patch onnxruntime-node → onnxruntime-web
if (!canLoad('onnxruntime-node')) {
    patchModule('onnxruntime-node', `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ort = require("onnxruntime-web");
ort.env.wasm.proxy = false;
ort.env.wasm.numThreads = 1;
exports.registerBackend = ort.registerBackend;
exports.env = ort.env;
exports.InferenceSession = ort.InferenceSession;
exports.Tensor = ort.Tensor;
exports.TRACE = ort.TRACE;
exports.TRACE_FUNC_BEGIN = ort.TRACE_FUNC_BEGIN;
exports.TRACE_FUNC_END = ort.TRACE_FUNC_END;
exports.TRACE_EVENT_BEGIN = ort.TRACE_EVENT_BEGIN;
exports.TRACE_EVENT_END = ort.TRACE_EVENT_END;
`, ['index.js', 'backend.js', 'binding.js']);
}

// Patch sharp → no-op (only needed for image processing, not text)
// Sharp can be nested inside @xenova/transformers/node_modules/
if (!canLoad('sharp')) {
    patchModule('sharp', `"use strict";
module.exports = function() { throw new Error("sharp is not available on this platform"); };
module.exports.default = module.exports;
`, ['sharp.js', 'index.js', 'constructor.js']);
}

// Also patch nested sharp inside @xenova/transformers
try {
    const xenovaPkg = join(dirname(require.resolve('@xenova/transformers')), '..');
    const nestedSharpLib = join(xenovaPkg, 'node_modules', 'sharp', 'lib');
    if (existsSync(join(nestedSharpLib, 'sharp.js'))) {
        const sharpShim = `"use strict";
module.exports = function() { throw new Error("sharp is not available on this platform"); };
module.exports.default = module.exports;
`;
        for (const file of ['sharp.js', 'index.js', 'constructor.js']) {
            const filePath = join(nestedSharpLib, file);
            if (existsSync(filePath)) {
                writeFileSync(filePath, sharpShim);
            }
        }
        console.log('Patched nested sharp with no-op shim.');
    }
} catch {
    // @xenova/transformers not installed
}
