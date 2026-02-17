import type { Command, MinerState } from "./types";

type Store = {
  minerStates: Map<string, MinerState>;
  commandQueue: Command[];
};

const globalStore = globalThis as unknown as { __minerStore?: Store };

const store: Store =
  globalStore.__minerStore ?? {
    minerStates: new Map<string, MinerState>(),
    commandQueue: [],
  };

if (!globalStore.__minerStore) {
  globalStore.__minerStore = store;
}

export const minerStates = store.minerStates;
export const commandQueue = store.commandQueue;
