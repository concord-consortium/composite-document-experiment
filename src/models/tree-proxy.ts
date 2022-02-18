import { IJsonPatch, Instance } from "mobx-state-tree";
import { delay } from "../utils/delay";
import { Tree } from "./tree";
import { TreeAPI } from "./tree-api";

/**
 * This module provides a proxy of the actual tree model. The goal is to emulate
 * what would be required if the tree was running in an iframe or worker.
 *
 * This kind of proxy can be used in the real application as a way for the
 * container to work with trees in iframes using the same api that it works with
 * trees not in iframes. The container would have one of these proxy
 * implementations that it would use to communicate with the remote tree
 *
 * To create problematic situations the delays are set so:
 * 1. The finish call occurs before the patches from the undo are applied to the
 *    tile.
 * 2. In this class the shared model changes coming from the container are
 *    applied before the patches for the tile which are sent in
 *    applyPatchesFromUndo
 * 3. In the shared model tree implementation in `shared-model.ts`
 *    `applyPatchesFromUndo` delays sending its new state to the container until
 *    after all of the actions here.
 *
 * Notes: Steps 2 and 3 are in conflict. To test #2 you should set the delay in
 * shared-model.ts to 0. Step 2 is useful because if the shared model changes
 * are applied first and the tree incorrectly updates its state based on these
 * changes, it can result in duplicate objects in the tree state. 
 *
 * Step 3 is useful because it verifies that the container correctly waits to
 * call `finishApplyingContainerPatches` until all shared models have confirmed
 * they have sent their state to each tree and each tree has confirmed it
 * applied it.
 */
export class TreeProxy implements TreeAPI {
    tree: Instance<typeof Tree>;

    constructor(tree: Instance<typeof Tree>) {
        this.tree = tree;
    }

    startApplyingContainerPatches(historyEntryId: string) {
        return delay(0)
        .then(() => this.tree.startApplyingContainerPatches(historyEntryId));
    }
    applyContainerPatches(historyEntryId: string, patchesToApply: readonly IJsonPatch[]) {
        return delay(100)
        .then(() => this.tree.applyContainerPatches(historyEntryId, patchesToApply));
    }
    finishApplyingContainerPatches(historyEntryId: string) {
        return delay(0)
        .then(() => this.tree.finishApplyingContainerPatches(historyEntryId));
    }
    applySharedModelSnapshotFromContainer(historyEntryId: string, snapshot: any) {
        return delay(50)
        .then(() => this.tree.applySharedModelSnapshotFromContainer(historyEntryId, snapshot));
    }
} 
