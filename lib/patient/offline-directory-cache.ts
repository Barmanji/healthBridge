export type CachedDoctor = {
  id: string;
  name: string;
  bio: string | null;
  department: string | null;
  city: string | null;
  state: string | null;
  languages: string[];
  consultModes: Array<"video" | "audio">;
  yearsExperience: number | null;
  feeInr: number | null;
};

type DirectorySnapshot = {
  key: "verified-doctors";
  savedAt: number;
  doctors: CachedDoctor[];
};

const DATABASE_NAME = "health-bridge-public-cache";
const DATABASE_VERSION = 1;
const STORE_NAME = "directory";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the offline cache."));
  });
}

export async function saveVerifiedDoctorSnapshot(doctors: CachedDoctor[]) {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database!.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ key: "verified-doctors", savedAt: Date.now(), doctors } satisfies DirectorySnapshot);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the offline directory."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline directory save was cancelled."));
    });
  } catch {
    // Browsers may disable IndexedDB in private mode or under storage pressure.
  } finally {
    database?.close();
  }
}

export async function readVerifiedDoctorSnapshot(): Promise<DirectorySnapshot | null> {
  let database: IDBDatabase | undefined;
  try {
    database = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = database!.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get("verified-doctors");
      request.onsuccess = () => {
        const value = request.result as DirectorySnapshot | undefined;
        resolve(value && Array.isArray(value.doctors) ? value : null);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not read the offline directory."));
    });
  } catch {
    return null;
  } finally {
    database?.close();
  }
}
