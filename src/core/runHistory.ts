import { RunRecord } from "../types/run";
const KEY = "codecrew.runHistory";

interface StateStorage {
  get<T>(key: string, fallback: T): T;
  update<T>(key: string, value: T): Thenable<void>;
}

export class RunHistory {
  constructor(private readonly storage: StateStorage) {}

  list(): RunRecord[] {
    return this.storage.get<RunRecord[]>(KEY, []);
  }

  async add(run: RunRecord): Promise<void> {
    await this.storage.update(KEY, [run, ...this.list()].slice(0, 20));
  }
}
