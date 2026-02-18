import { NoteDBShieldedEntry, NoteDBWormholeEntry } from "@/src/types";

export type NoteStore = "wormhole_note" | "shielded_note"
const objectStoreNames = ["wormhole_note", "shielded_note"]

export class NoteDB {
  private account: string;
  private _db: IDBDatabase | undefined = undefined;

  constructor(account: string) {
    this.account = account;
  }

  private get db(): IDBDatabase {
    if (!this._db) {
      throw new Error("Database not open");
    }
    return this._db;
  }

  async open(): Promise<void> {
    if (this._db) return;
    try {
      this._db = await this.openDB(this.account);
    } catch (error) {
      this._db = undefined;
      throw new Error("Failed to open database");
    }
  }

  async close(): Promise<void> {
    if (!this._db) return;
    this._db.close();
    this._db = undefined;
  }

  // Open a connection to the IndexedDB
  private async openDB(accountId: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(`IsekaiNotesDB-${accountId}`, 4);

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;
        for (const objectStoreName of objectStoreNames) {
          if (db.objectStoreNames.contains(objectStoreName)) {
            db.deleteObjectStore(objectStoreName);
          }
          const store = db.createObjectStore(objectStoreName, { keyPath: 'id' });
          store.createIndex('id', 'id', { unique: true });
          store.createIndex('chainId', 'chainId', { unique: false });
        }
      };

      request.onsuccess = () => resolve((request as IDBOpenDBRequest).result);
      request.onerror = () => reject(request.error);
    });
  }

  async addNote(objectStoreName: NoteStore, note: NoteDBShieldedEntry | NoteDBWormholeEntry): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(objectStoreName, 'readwrite');
      const store = transaction.objectStore(objectStoreName);
      const request = store.add(note);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async updateNote(objectStoreName: NoteStore, note: NoteDBShieldedEntry | NoteDBWormholeEntry): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(objectStoreName, 'readwrite');
      const store = transaction.objectStore(objectStoreName);
      const exists = store.index("id").get(note.id);
      if (!exists) throw new Error(`Note with id ${note.id} does not exist in DB`);
      const request = store.put(note);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async getAllNotes(objectStoreName: NoteStore): Promise<NoteDBShieldedEntry[] | NoteDBWormholeEntry[]> {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(objectStoreName, 'readonly');
      const store = transaction.objectStore(objectStoreName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getWormholeNotes(): Promise<NoteDBWormholeEntry[]> {
    return await this.getAllNotes("wormhole_note") as NoteDBWormholeEntry[]
  }

  async getShieldedNotes(): Promise<NoteDBShieldedEntry[]> {
    return await this.getAllNotes("shielded_note") as NoteDBShieldedEntry[]
  }

  async getNote(objectStoreName: NoteStore, id: string): Promise<NoteDBShieldedEntry | NoteDBWormholeEntry | undefined> {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(objectStoreName, 'readonly');
      const store = transaction.objectStore(objectStoreName).index("id");
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async checkAndAddNote(objectStoreName: NoteStore, note: NoteDBShieldedEntry | NoteDBWormholeEntry): Promise<void> {
    const allNotes = await this.getAllNotes(objectStoreName)
    const existingNote = allNotes.find((n: NoteDBShieldedEntry | NoteDBWormholeEntry) => n.id === note.id)
    if (existingNote) throw new Error(`Note with id ${note.id} already exists in DB`)
    await this.addNote(objectStoreName, note)
  }

  async checkAndAddMultipleNotes(objectStoreName: NoteStore, notes: NoteDBShieldedEntry[] | NoteDBWormholeEntry[]): Promise<void> {
    const allNotes = await this.getAllNotes(objectStoreName)
    for (let i=0; i<notes.length; i++) {
      const existingNote = allNotes.find(n => n.id === notes[i].id)
      if (existingNote) throw new Error(`Note with id ${notes[i].id} already exists in DB`)
    }
    for (let i=0; i<notes.length; i++) {
      await this.addNote(objectStoreName, notes[i])
    }
  }

  async deleteNote(objectStoreName: NoteStore, id: string): Promise<void> {
    await this.open();
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(objectStoreName, 'readwrite');
      const store = transaction.objectStore(objectStoreName);
      const request = store.delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
}
