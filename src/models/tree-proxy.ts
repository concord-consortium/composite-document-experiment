// This module will provide a proxy of the actual tree model
// the goal is to emulate what would be required if the tree
// was running in an iframe or worker.
// The container would have one of these proxy implementations
// that it would use to communicate with the remote tree

import { IJsonPatch, Instance } from "mobx-state-tree";
import { delay } from "../utils/delay";
import { Tree } from "./tree";

// This proxy should also serve as a way to document the tile
// API more concretely than the current Tree model does.

export interface TreeLike {
    startApplyingContainerPatches(): Promise<void>;
    applyPatchesFromUndo(patchesToApply: readonly IJsonPatch[]): Promise<void>;
    finishApplyingContainerPatches(): Promise<void>;

    // The returned promise should resolve when all of the changes
    // have been applied to the shared model view in the tree. 
    // The promise should not wait for the rest of the tree to sync
    // with these changes. This is because during the application of 
    // undo patches this syncing shouldn't happen until later. 
    applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any): Promise<void>;
}

export class TreeProxy implements TreeLike {
    tree: Instance<typeof Tree>;

    constructor(tree: Instance<typeof Tree>) {
        this.tree = tree;
    }

    startApplyingContainerPatches() {
        return delay(0).then(() => this.tree.startApplyingContainerPatches());
    }
    applyPatchesFromUndo(patchesToApply: readonly IJsonPatch[]) {
        return delay(100).then(() => this.tree.applyPatchesFromUndo(patchesToApply));
    }
    finishApplyingContainerPatches() {
        // To create a problematic situation, the timeout is set so the finish call occurs before 
        // the patches from the undo are applied to the tile. 
        // And the shared model changes coming from the container are applied before the 
        // the patches from the tile
        return delay(0).then(() => this.tree.finishApplyingContainerPatches());
    }
    applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any) {
        return delay(50).then(() => this.tree.applySharedModelSnapshotFromContainer(containerActionId, snapshot));
    }
} 
