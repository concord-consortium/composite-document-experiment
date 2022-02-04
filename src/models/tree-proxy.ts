// This module will provide a proxy of the actual tree model
// the goal is to emulate what would be required if the tree
// was running in an iframe or worker.
// The container would have one of these proxy implementations
// that it would use to communicate with the remote tree

import { IJsonPatch, Instance } from "mobx-state-tree";
import { Tree } from "./tree";

// This proxy should also serve as a way to document the tile
// API more concretely than the current Tree model does.

export interface TreeLike {
  startApplyingContainerPatches(): Promise<void>;
  applyPatchesFromUndo(patchesToApply: readonly IJsonPatch[]): Promise<void>;
  finishApplyingContainerPatches(): Promise<void>;

  applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any): void;
}

function delay(milliSeconds: number) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, milliSeconds);
    });
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
    applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any): void {
        setTimeout(() => this.tree.applySharedModelSnapshotFromContainer(containerActionId, snapshot), 50);
    }
} 
