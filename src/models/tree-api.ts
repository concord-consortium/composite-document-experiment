import { IJsonPatch } from "mobx-state-tree";

/**
 * This is the API for a Tree in the system.
 *
 * It would typically be implemented by a MST model that defines actions for
 * each of the functions below.
 *
 * Each action should return a promise that resolves when the action is complete
 * this is necessary to support trees running in iframes or workers. The
 * function comment should define what "complete" means for each action.
 */

export interface TreeAPI {
    /**
     * This is called when the container is doing an undo or redo or is loading
     * the initial document into all of the trees. The tree should use this
     * action to disable any updating it does when it receives changes in the
     * shared models it is using.
     *
     * @param historyEntryId the id of the history entry that will record all of
     * these changes to the tree. This is *not* the historyEntryId that is the
     * source of the patches. 
     *
     * @returns a promise that should resolve when the tree is ready to receive
     * patches from the container and changes in the shared models.
     *
     * The `Tree` model implements this for you.
     */
    startApplyingContainerPatches(historyEntryId: string): Promise<void>;

    /**
     * This is called when the container is doing an undo/redo or is loading the
     * initial document into all of the trees. This will include the patches
     * that the tree sent to the container with addHistoryEntry and
     * addTreePatchRecord. If the tree did this right, it should only include
     * patches that are modifying the tree's state, it shouldn't include patches
     * that are for the shared model views that are mounted in the tree.
     *
     * @param historyEntryId the id of the history entry that will record all of
     * these changes to the tree. This is *not* the historyEntryId that is the
     * source of the patches. 
     * 
     * @param patchesToApply an array of JSON patches to be applied to the
     * tile's tree. This is called by the container when doing an undo or redo.
     * It will be called after startApplyingContainerPatches. The patches should
     * be applied in order starting from the first in the array.
     */
    applyContainerPatches(historyEntryId: string, patchesToApply: readonly IJsonPatch[]): Promise<void>;

    /**
     * This is called after the container has applied all of the patches.
     * Before this is called by the container, all trees modified by the patches
     * will have confirmed they have received the patches. And all shared models
     * modified by the patches will have confirmed that trees using them have
     * received the updated shared model.
     *
     * When the tree receives this it should re-enable its process of updating
     * the tile state when its shared models change.
     * The `Tree` model implements this for you.
     * 
     * @param historyEntryId the id of the history entry that will record all of
     * these changes to the tree. This is *not* the historyEntryId that is the
     * source of the patches. 
     * 
     */
    finishApplyingContainerPatches(historyEntryId: string): Promise<void>;

    /**
     * The container calls this when something has updated a shared model. Which
     * shared model is identified by the id in the snapshot. The shared model
     * might have been updated by a user action in another tree. The shared
     * model might have been updated during an undo/redo or when the document is
     * initially loaded.
     *
     * If this is not an undo/redo or the initial load of the document. The tree
     * should immediately update any state that is linked to the shared model.
     * When this is an undo/redo or the initial load the document the container
     * will call startApplyingContainerPatches before
     * applySharedModelSnapshotFromContainer and after all patches have been
     * applied it will call finishApplyingContainerPatches. During this time
     * before the start and finish the tree should not update any state that is
     * linked to the share model. If everything is working properly any of those
     * state changes will be included in the patches being applied in between
     * the start and finish.
     *
     * *Important Note:* during this call the tree should only update its state
     * from the shared model. It shouldn't update the shared model from its
     * state. For example if a shared model change comes in that disagrees with
     * what is in the tree state, the tree should not try to fix the shared
     * model. The tree should only update the shared model during a user action. 
     *
     * The returned promise should resolve when all of the changes have been
     * applied to the shared model view in the tree. The promise should not wait
     * for the state updating described above. This gives the promise a
     * consistent behavior regardless of if this is called during an undo/redo
     * operation or because of a user action.
     *
     * The `Tree` model implements this for you. It applies this snapshot in a
     * sub model of the tree, and it only calls a
     * `updateTreeAfterSharedModelChanges` action when it is necessary. So your
     * tree just needs to implement this `updateTreeAfterSharedModelChanges`.
     *
     * @param historyEntryId this identifies the history entry or group of tree
     * patches which is triggering this call. The tree should send this id back
     * with any patch records that result from applying this shared model
     * change. Those patch records are sent with `addTreePatchRecord`.
     *
     * @param snapshot the shared model snapshot. Simple shared models will just
     * send the whole shared model. In the future, for some shared models, the
     * snapshot might represent the subset of the shared model that this tree
     * needs. For example with a data set shared model it could include just the
     * columns of data being used by this tree.
     */
    applySharedModelSnapshotFromContainer(historyEntryId: string, snapshot: any): Promise<void>;
}
