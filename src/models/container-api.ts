import { TreePatchRecordSnapshot } from "./history";

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
    updateSharedModel: (historyEntryId: string, sourceTreeId: string, snapshot: any) => Promise<void>;
    
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
     * the the change entries that are grouped by the historyEntryId to the
     * tree with `applyPatchesFromUndo`.
     *
     * @param historyEntryId should be a UUID. If this tree is initiating
     * this action it should generate a new UUID.  If the changes in this entry
     * were triggered via an `applySharedModelSnapshotFromContainer` call this
     * id should be the `historyEntryId` that was passed to the tree by
     * `applySharedModelSnapshotFromContainer`.
     *
     * @param treeChangeEntry This contains the patches and inversePatches of
     * this change entry.
     *
     * @param undoableAction true if this action should be saved to the undo
     * stack. Changes that result from `applyPatchesFromUndo` should not be
     * undo-able.
     */    
    addHistoryEntry: (entryId: string, treeId: string, actionName: string, undoable: boolean) => void;
    
    /**
     *
     * TODO: there is no "finish" event. So in a system that is sharing document
     * changes it won't be possible to know when to send the history entry to
     * the other computers. Perhaps it is best to just send the patch records as
     * they come in. The problem will be replaying them. So without a "finish"
     * event we'd have to use some kind of timer to know when the history entry
     * is done. 
     *
     * Adding a "finish" event is hard. We don't know which trees will be
     * affected by any changes to the shared model, and whether those trees
     * might trigger updates in other shared models which can cascade down. Each
     * time a tree gets an updated from the container it would have to respond
     * to the container about which shared models it is updating. Then the
     * container can know which trees that shared model is used by and wait for
     * that complete as well as waiting for responses about updates that those
     * trees might be making.
     */
    addTreePatchRecord: (historyEntryId: string, record: TreePatchRecordSnapshot) => void;
}
