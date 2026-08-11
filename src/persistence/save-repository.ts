import type {
  DomainEvent,
  GoodsMovement,
  LedgerTransaction,
  WorldState,
} from "../domain/model.ts";
import { migrateWorldState } from "./migrations.ts";

const DB_NAME = "economic-world";
const DB_VERSION = 3;
const SEGMENT_SIZE = 1_000;

export interface SaveManifest {
  id: string;
  label: string;
  savedAtIso: string;
  schemaVersion: number;
  saveVersion: number;
  elapsedMonths: number;
  transactionCount: number;
  eventCount: number;
}

export interface PersistedUiState {
  route: string;
  countryId?: string;
  cityId?: string;
  companyId?: string;
  securityId?: string;
  savedAtIso: string;
}

export interface ActiveWorldRestore {
  world: WorldState;
  uiState: PersistedUiState | null;
  recovered: boolean;
  saveId: string;
}

export interface PersistenceDiagnostics {
  databaseVersion: number;
  activeWorldId: string | null;
  lastAutosaveIso: string | null;
  saveCount: number;
  usageBytes: number | null;
  quotaBytes: number | null;
}

interface MetadataRow<T = unknown> {
  key: string;
  value: T;
}

interface Segment<T> {
  key: string;
  saveId: string;
  sequence: number;
  items: T[];
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Ошибка IndexedDB"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Транзакция IndexedDB отменена"));
    transaction.onabort = () => reject(transaction.error ?? new Error("Транзакция IndexedDB прервана"));
  });
}

function chunk<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += SEGMENT_SIZE) {
    result.push(items.slice(index, index + SEGMENT_SIZE));
  }
  return result;
}

export class SaveRepository {
  private databasePromise: Promise<IDBDatabase> | null = null;

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("manifests")) {
          database.createObjectStore("manifests", { keyPath: "id" });
        }
        if (!database.objectStoreNames.contains("snapshots")) {
          database.createObjectStore("snapshots");
        }
        if (!database.objectStoreNames.contains("ledgerSegments")) {
          database.createObjectStore("ledgerSegments", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("eventSegments")) {
          database.createObjectStore("eventSegments", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("goodsSegments")) {
          database.createObjectStore("goodsSegments", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("metadata")) {
          database.createObjectStore("metadata", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("migrationBackups")) {
          database.createObjectStore("migrationBackups", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Не удалось открыть хранилище"));
    });
    return this.databasePromise;
  }

  async list(): Promise<SaveManifest[]> {
    const database = await this.database();
    const transaction = database.transaction("manifests", "readonly");
    const manifests = await requestResult(
      transaction.objectStore("manifests").getAll() as IDBRequest<SaveManifest[]>,
    );
    return manifests.sort((left, right) => right.savedAtIso.localeCompare(left.savedAtIso));
  }

  private async metadata<T>(key: string): Promise<T | null> {
    const database = await this.database();
    const transaction = database.transaction("metadata", "readonly");
    const row = await requestResult(transaction.objectStore("metadata").get(key) as IDBRequest<MetadataRow<T> | undefined>);
    return row?.value ?? null;
  }

  async save(world: WorldState, label: string, id = "manual", metadataRows: MetadataRow[] = []): Promise<SaveManifest> {
    const database = await this.database();
    const transaction = database.transaction(
      ["manifests", "snapshots", "ledgerSegments", "eventSegments", "goodsSegments", "metadata"],
      "readwrite",
    );
    const manifest: SaveManifest = {
      id,
      label,
      savedAtIso: new Date().toISOString(),
      schemaVersion: world.schemaVersion,
      saveVersion: world.saveVersion,
      elapsedMonths: world.clock.elapsedMonths,
      transactionCount: world.ledger.transactions.length,
      eventCount: world.events.length,
    };
    const { ledger, events, goodsMovements, ...rest } = world;
    const snapshot: WorldState = {
      ...structuredClone(rest),
      ledger: { ...structuredClone(ledger), transactions: [] },
      events: [],
      goodsMovements: [],
    };
    const stores = {
      ledger: transaction.objectStore("ledgerSegments"),
      events: transaction.objectStore("eventSegments"),
      goods: transaction.objectStore("goodsSegments"),
    };
    const deleteOldSegments = async (store: IDBObjectStore): Promise<void> => {
      const rows = (await requestResult(store.getAll())) as Array<{ key: string; saveId: string }>;
      rows.filter((row) => row.saveId === id).forEach((row) => store.delete(row.key));
    };
    await Promise.all([
      deleteOldSegments(stores.ledger),
      deleteOldSegments(stores.events),
      deleteOldSegments(stores.goods),
    ]);
    transaction.objectStore("manifests").put(manifest);
    transaction.objectStore("snapshots").put(snapshot, id);
    for (const row of metadataRows) transaction.objectStore("metadata").put(row);
    chunk(ledger.transactions).forEach((items, sequence) => {
      const segment: Segment<LedgerTransaction> = {
        key: `${id}:${String(sequence).padStart(6, "0")}`,
        saveId: id,
        sequence,
        items,
      };
      stores.ledger.put(segment);
    });
    chunk(events).forEach((items, sequence) => {
      const segment: Segment<DomainEvent> = {
        key: `${id}:${String(sequence).padStart(6, "0")}`,
        saveId: id,
        sequence,
        items,
      };
      stores.events.put(segment);
    });
    chunk(goodsMovements).forEach((items, sequence) => {
      const segment: Segment<GoodsMovement> = {
        key: `${id}:${String(sequence).padStart(6, "0")}`,
        saveId: id,
        sequence,
        items,
      };
      stores.goods.put(segment);
    });
    await transactionDone(transaction);
    return manifest;
  }

  async saveActive(world: WorldState, uiState: Omit<PersistedUiState, "savedAtIso">): Promise<SaveManifest> {
    const currentId = await this.metadata<string>("active-world-id");
    const nextId = currentId === "active-a" ? "active-b" : "active-a";
    const savedAtIso = new Date().toISOString();
    return this.save(world, "Автосохранение", nextId, [
      { key: "active-world-id", value: nextId },
      { key: "last-known-good-id", value: currentId },
      { key: "active-ui-state", value: { ...uiState, savedAtIso } satisfies PersistedUiState },
      { key: "last-autosave-iso", value: savedAtIso },
    ]);
  }

  async load(id: string): Promise<WorldState> {
    const database = await this.database();
    const transaction = database.transaction(
      ["manifests", "snapshots", "ledgerSegments", "eventSegments", "goodsSegments"],
      "readonly",
    );
    const snapshot = await requestResult(
      transaction.objectStore("snapshots").get(id) as IDBRequest<WorldState | undefined>,
    );
    if (!snapshot) throw new Error("Сохранение не найдено");
    const manifest = await requestResult(transaction.objectStore("manifests").get(id) as IDBRequest<SaveManifest | undefined>);
    const collect = async <T>(storeName: string): Promise<T[]> => {
      const rows = (await requestResult(
        transaction.objectStore(storeName).getAll(),
      )) as Segment<T>[];
      return rows
        .filter((row) => row.saveId === id)
        .sort((left, right) => left.sequence - right.sequence)
        .flatMap((row) => row.items);
    };
    const [transactions, events, goodsMovements] = await Promise.all([
      collect<LedgerTransaction>("ledgerSegments"),
      collect<DomainEvent>("eventSegments"),
      collect<GoodsMovement>("goodsSegments"),
    ]);
    await transactionDone(transaction);
    snapshot.ledger.transactions = transactions;
    snapshot.events = events;
    snapshot.goodsMovements = goodsMovements;
    if (manifest && (transactions.length !== manifest.transactionCount || events.length !== manifest.eventCount)) throw new Error("Сохранение неполно: нарушена целостность сегментов");
    if (snapshot.schemaVersion < 5 || snapshot.saveVersion < 5) {
      const backupDatabase = await this.database();
      const backupTransaction = backupDatabase.transaction("migrationBackups", "readwrite");
      backupTransaction.objectStore("migrationBackups").put({ key: `${id}:${new Date().toISOString()}`, saveId: id, createdAtIso: new Date().toISOString(), snapshot: structuredClone(snapshot) });
      await transactionDone(backupTransaction);
    }
    return migrateWorldState(snapshot);
  }

  async loadActive(): Promise<ActiveWorldRestore | null> {
    const activeId = await this.metadata<string>("active-world-id");
    const lastGoodId = await this.metadata<string>("last-known-good-id");
    const uiState = await this.metadata<PersistedUiState>("active-ui-state");
    const candidates = [activeId, lastGoodId, "active-a", "active-b"].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
    for (let index = 0; index < candidates.length; index += 1) {
      try {
        const world = await this.load(candidates[index]);
        return { world, uiState, recovered: index > 0, saveId: candidates[index] };
      } catch {
        // Следующий слот является последней известной исправной контрольной точкой.
      }
    }
    return null;
  }

  async diagnostics(): Promise<PersistenceDiagnostics> {
    const [activeWorldId, lastAutosaveIso, saves, estimate] = await Promise.all([
      this.metadata<string>("active-world-id"),
      this.metadata<string>("last-autosave-iso"),
      this.list(),
      navigator.storage?.estimate?.() ?? Promise.resolve({ usage: undefined, quota: undefined }),
    ]);
    return {
      databaseVersion: DB_VERSION,
      activeWorldId,
      lastAutosaveIso,
      saveCount: saves.length,
      usageBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
    };
  }
}
