import { IJsonPatch } from "mobx-state-tree";

export interface TreeChangeEntry {
    treeId: string;
    actionName: string;
    patches: readonly IJsonPatch[];
    inversePatches: readonly IJsonPatch[];
}

export interface ContainerAPI {
    /**
     * Propagate shared model state to other trees. 
     * This is called by either a tile or a shared model
     * 
     * The shared model is identified by an id inside of the snapshot
     * The sourceTreeId indicates which tree is sending this update.
     * The new shared model snapshot will not be sent back to this source.
     * 
     * Note: The returned promise should only resolve after the shared model has been 
     * updated in the container and in all tiles that are using the shared model
     * The promise does not guarantee that all of the tiles have updated their own 
     * objects related to the shared model.
     * In particular when this is called by a shared model when it is applying patches 
     * from an undo or redo, the tiles will explicitly not update their related objects
     * because they will receive patches that should contain these changes separately.
     */
    updateSharedModel: (containerActionId: string, sourceTreeId: string, snapshot: any) => Promise<void>;
    
    /**
     * Trees should call this to send new changes to the container. These
     * changes are used for 2 things:
     * - the state of the document that is saved and later loaded
     * - the undo stack
     *
     * When the state is loaded the container will combine all of the patches of
     * all of the recorded change entries and send that to the tree with with
     * `applyPatchesFromUndo`.
     *
     * When the user does an undo the container will send the inversePatches of
     * the the change entries that are grouped by the containerActionId to the
     * tree with `applyPatchesFromUndo`.
     *
     * @param containerActionId should be a UUID. If this tree is initiating
     * this action it should generate a new UUID.  If the changes in this entry
     * were triggered via an `applySharedModelSnapshotFromContainer` call this
     * id should be the `containerActionId` that was passed to the tree by
     * `applySharedModelSnapshotFromContainer`.
     *
     * @param treeChangeEntry This contains the patches and inversePatches of
     * this change entry.
     *
     * @param undoableAction true if this action should be saved to the undo
     * stack. Changes that result from `applyPatchesFromUndo` should not be
     * undo-able.
     */    
    recordActionStart: (containerActionId: string, treeId: string, actionName: string, undoable: boolean) => void;
    
    recordActionChanges: (containerActionId: string, treeChangeEntry: TreeChangeEntry) => void;
}
