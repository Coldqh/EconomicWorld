import type { ConflictState } from "../domain/model.ts";
export const createConflictState = (): ConflictState => ({ conflicts: [], nextConflictId: 1 });
