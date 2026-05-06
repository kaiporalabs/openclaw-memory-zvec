export type StorageValidationResult = {
    ok: true;
    resolvedPath: string;
} | {
    ok: false;
    resolvedPath: string;
    error: string;
    hint?: string;
};
/**
 * Ensure a directory exists (create parents) and is writable for SQLite/Zvec data.
 */
export declare function validateWritableDirectory(rawPath: string): StorageValidationResult;
//# sourceMappingURL=path-validation.d.ts.map