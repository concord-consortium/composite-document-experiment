import { IJsonPatch } from "mobx-state-tree";

/**
 * This is the API for a Tree in the system.
 *
 * It would typically be implemented by a MST model that defines actions for
 * each fo the functions below.
 *
 * Each action should return a promise that resolves when the action is complete
 * this is necessary to support tress running in iframes or workers. The
 * function comment should define what "complete" means for each action.
 */

export interface TreeAPI {
    /**
     * This is called when the container is doing an undo or redo. The tree
     * should use this action to disable any updating it does when it receives
     * changes in the shared models it is using.
     *
     * @returns a promise that should resolve when the tree is ready to receive
     * patches from the container and changes in the shared models.
     *
     * The `Tree` model implements for you.
     */
    startApplyingContainerPatches(): Promise<void>;

    /**
     * This is called when the container is doing an undo or redo. This will
     * include the patches that the tree sent to the container with
     * addUndoEntry. If the tree did this right, it should only include patches
     * that are modifying the tree's state, it shouldn't include patches that
     * are for the shared models that the tree is using.
     *
     * @param patchesToApply an array of JSON patches to be applied to the
     * tile's tree. This is called by the container when doing an undo or redo.
     * It will be called after startApplyingContainerPatches. The patches should
     * be applied in order starting from the first in the array.
     */
    applyPatchesFromUndo(patchesToApply: readonly IJsonPatch[]): Promise<void>;

    /**
     * This called after the container has applied all of the undo patches.
     * Before this is called by the container, all trees modified by the patches
     * will have confirmed they have received the patches. And all shared models
     * modified by the patches will have confirmed that trees using them have
     * received the updated shared model.
     *
     * When the tree receives this it should re-enable its process of updating
     * the tile state when its shared models change.
     * The `Tree` model implements this for you.
     */
    finishApplyingContainerPatches(): Promise<void>;


    // The returned promise should resolve when all of the changes
    // have been applied to the shared model view in the tree. 
    // The promise should not wait for the rest of the tree to sync
    // with these changes. This is because during the application of 
    // undo patches this syncing shouldn't happen until later. 
    /**
     * The container calls this when something has updated a shared model. Which
     * shared model is identified by the id in the snapshot. The shared model
     * might have been updated by a user action in another tree. The shared
     * model might have been updated during an undo or redo operation.
     *
     * If this isn't an undo or redo operation, the tree should update any state
     * that is linked to the shared model.
     *
     * *Important Note:* the tree should only automatically update its state
     * from the shared model. It shouldn't automatically do the reverse: update
     * the shared model from its state. When the tree needs to change the shared
     * model this should be triggered by a user action in the tree.
     *
     * The returned promise should resolve when all of the changes have been
     * applied to the shared model view in the tree. The promise should not wait
     * for the state updating described above. This gives the promise a
     * consistent behavior regardless of if this is called during an undo/redo
     * operation or because of a user action.
     *
     * The `Tree` model implements this for you. It applies this snapshot in a
     * sub object, and it only calls a `updateTreeAfterSharedModelChanges`
     * action when it is necessary. So then your tree just needs to implement
     * this `updateTreeAfterSharedModelChanges`.
     *
     * @param containerActionId this identifies the group of tree actions which
     * is triggering this call. The tree should use this id to identify any
     * changes that result from applying this shared model change.
     *
     * @param snapshot the shared model snapshot. Simple shared models will just
     * send the whole shared model. In the future, for some shared models, the
     * snapshot might represent the subset of the shared model that this tree
     * needs. For example with a data set shared model it could include just the
     * column data being used by this tree.
     */
    applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any): Promise<void>;
}
