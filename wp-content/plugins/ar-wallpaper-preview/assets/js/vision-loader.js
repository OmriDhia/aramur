const DEFAULT_TASKS_VERSION = '0.10.3';
const DEFAULT_MODULE_SOURCES = [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${DEFAULT_TASKS_VERSION}`,
    `https://unpkg.com/@mediapipe/tasks-vision@${DEFAULT_TASKS_VERSION}?module`,
];
const DEFAULT_WASM_ROOTS = [
    `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${DEFAULT_TASKS_VERSION}/wasm`,
    `https://unpkg.com/@mediapipe/tasks-vision@${DEFAULT_TASKS_VERSION}/wasm`,
];

let moduleSources = [...DEFAULT_MODULE_SOURCES];
let wasmRoots = [...DEFAULT_WASM_ROOTS];
let modulePromise = null;
let filesetPromise = null;

function normaliseUrl(url) {
    if (!url) {
        return null;
    }
    const trimmed = url.trim();
    if (!trimmed) {
        return null;
    }
    // Ensure base URLs do not end with a trailing slash to avoid duplicate slashes later.
    return trimmed.replace(/\/$/, '');
}

export function configureVisionSources({ moduleSources: newModuleSources, wasmRoots: newWasmRoots } = {}) {
    if (Array.isArray(newModuleSources) && newModuleSources.length) {
        moduleSources = newModuleSources.map(normaliseUrl).filter(Boolean);
        modulePromise = null;
        filesetPromise = null;
    }
    if (Array.isArray(newWasmRoots) && newWasmRoots.length) {
        wasmRoots = newWasmRoots.map(normaliseUrl).filter(Boolean);
        filesetPromise = null;
    }
}

async function importFromSources(sources) {
    let lastError = null;
    for (const source of sources) {
        if (!source) {
            continue;
        }
        try {
            // eslint-disable-next-line no-await-in-loop
            const module = await import(/* webpackIgnore: true */ source);
            return module;
        } catch (error) {
            console.warn('AR Wallpaper Preview: failed to import Mediapipe Tasks module', source, error);
            lastError = error;
        }
    }
    throw lastError || new Error('Unable to load Mediapipe Tasks module');
}

async function resolveFileset(resolver, roots) {
    let lastError = null;
    for (const root of roots) {
        if (!root) {
            continue;
        }
        try {
            // eslint-disable-next-line no-await-in-loop
            const fileset = await resolver.forVisionTasks(root);
            return fileset;
        } catch (error) {
            console.warn('AR Wallpaper Preview: failed to resolve Mediapipe wasm fileset', root, error);
            lastError = error;
        }
    }
    throw lastError || new Error('Unable to load Mediapipe wasm fileset');
}

export async function loadVisionModule() {
    if (!modulePromise) {
        modulePromise = importFromSources(moduleSources);
    }
    return modulePromise;
}

export async function loadVisionFileset() {
    if (!filesetPromise) {
        const module = await loadVisionModule();
        filesetPromise = resolveFileset(module.FilesetResolver, wasmRoots);
    }
    return filesetPromise;
}
