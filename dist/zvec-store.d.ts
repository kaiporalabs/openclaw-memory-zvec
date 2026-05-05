import type { MemoryCategory } from "./config.js";
export type MemoryEntry = {
    id: string;
    text: string;
    vector: number[];
    importance: number;
    category: MemoryCategory;
    createdAt: number;
};
export type MemoryListEntry = Omit<MemoryEntry, "vector">;
export type MemorySearchResult = {
    entry: MemoryEntry;
    score: number;
};
export declare class MemoryZvecStore {
    private readonly dataRoot;
    private readonly vectorDim;
    private collection;
    private initPromise;
    constructor(dataRoot: string, vectorDim: number);
    private get collectionPath();
    private get idsPath();
    private ensureInitialized;
    private doInitialize;
    private loadIdList;
    private persistIdList;
    private rememberId;
    private forgetId;
    store(entry: Omit<MemoryEntry, "id" | "createdAt"> & {
        id?: string;
    }): Promise<MemoryEntry>;
    search(vector: number[], limit: number, minScore: number): Promise<MemorySearchResult[]>;
    list(limit?: number, orderByCreatedAt?: boolean): Promise<MemoryListEntry[]>;
    delete(id: string): Promise<boolean>;
    count(): Promise<number>;
    close(): Promise<void>;
}
//# sourceMappingURL=zvec-store.d.ts.map