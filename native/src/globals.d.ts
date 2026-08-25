// Metro provides a global `require` at runtime; the project has no
// @types/node, so declare it here for the lazy HealthKit loader.
declare const require: (id: string) => any;

// Hermes provides atob/btoa at runtime; no lib dom types in this tsconfig.
declare function atob(encoded: string): string;
