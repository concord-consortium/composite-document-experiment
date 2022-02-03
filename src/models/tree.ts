import { types, applySnapshot, IJsonPatch, applyPatch, Instance, getEnv, getPath, getSnapshot } from "mobx-state-tree";
import { SharedModel } from "./shared-model/shared-model";
import { createUndoRecorder, SharedModelsConfig } from "./undo-manager/undo-recorder";
import { TileUndoEntry } from "./undo-manager/undo-store";

export interface ContainerAPI {
    updateSharedModel: (containerActionId: string, tileId: string, snapshot: any) => void
}

export const Tree = types.model("Tree", {
    id: types.identifier
})
.volatile(self => ({
    applyingContainerPatches: false,
    sharedModels: {} as Record<string, Instance<typeof SharedModel>>,
}))
.actions(self => ({
    // Tiles override this to make sure the tile model is in sync with 
    // the possibly updated shared model
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    updateTreeAfterSharedModelChanges() {        
    }
}))
.actions(self => {
    // We might need this later
    const containerAPI = () => getEnv(self).containerAPI as ContainerAPI;

    return {
        addSharedModel(model: Instance<typeof SharedModel>) {
            console.log("addShareModel", getSnapshot(model));
            self.sharedModels[model.id] = model;
        },

        // This should be called in the tile 'afterCreate'
        // currently it needs to be called after all of the shared models
        // have been added. However we 
        // will need to support shared models being added later on
        // so maybe something else should happen here
        setupUndoRecorder() {
            const {undoStore} = getEnv(self);

            // TODO: If shared models are mounted after the undoRecorder has been created 
            // the map of shared in the recorder needs to be updated.
            // For now we'll assume addSharedModel has been called first
            // so then we can construct the map from sharedModels map.
            const sharedModelsConfig: SharedModelsConfig = {};
            Object.values(self.sharedModels).forEach(model => {
                sharedModelsConfig[getPath(model)] = (containerActionId, call) => {

                    // Note: the environment of the call will be undefined because the undoRecorder cleared 
                    // it out before it calling this function
                    console.log(`observed changes in sharedModel: ${model.id} of tile: ${self.id}`, {containerActionId, action: call});

                    // What is tricky is that this is being called when the snapshot is applied by the
                    // sharedModel syncing code "sendSnapshotToSharedMode". In that case we want to do
                    // the internal shared model sync, but we don't want to resend the snapshot to the 
                    // shared model. So the current approach is to look for the specific action that
                    // is applying this snapshot to the tile tree. 
                    if (call.name !== "applySharedModelSnapshotFromContainer") {
                
                        // TODO: figure out if we should be recording this special action in the undo
                        // stack
                        const snapshot = getSnapshot(model); 
                        
                        containerAPI().updateSharedModel(containerActionId, self.id, snapshot);
                    }

                    // let the tile update its model based on the updates that were just applied to 
                    // the shared model
                    //
                    // TODO: an inefficiency  with this approach is that we treating all changes within 
                    // the sharedModelPath the same. 
                    // If the change is a simple property change in the shared model view that
                    // isn't used by updateTreeAfterSharedModelChanges, we do not need to re-run 
                    // updateTreeAfterSharedModelChanges.
                    // When we used the autorun approach this was optimized so the function would
                    // only run when the needed parts of the tree changed.
                    // 
                    // We do need to send the shared model snapshot to the container whenever
                    // there are any changes to the tree so the code above is fine. 
                    //
                    // There might be a way to use the mobx internals so we can track 
                    // what updateTreeAfterSharedModelChanges is using and only run it
                    // when one of those things have changed. 
                    //
                    // TODO: figure out how undo will be handled here.  We are calling an action
                    // from a middleware that just finished the action. Will it start a new top
                    // level action? Will it be allowed? Will it cause a inifite loop?
                    // what about other middleware that might be added to tree will this approach
                    // break that?
                    // Because of all these questions it might be better to run this sync in
                    // a setTimeout callback so it is part of a different stack, and in that case
                    // we would pass in the containerActionId.
                    // In theory it shouldn't cause a loop because the synSharedModelWithTileModel
                    // shouldn't modify the sharedModel, so it shouldn't come back to this 
                    // callback.
                    this.updateTreeAfterSharedModelChangesInternal(containerActionId);

                };
            });

            // TODO: We probably want the recorder to be an object so we can modify the shared models
            // it knows about since they might be added after it is initially setup. 
            // Because it is a middleware attached to the tile's tree it probably also needs to be
            // destroyed 
            createUndoRecorder(self, (entry) => {
                console.log("recording undoable action", {treeId: self.id, ...entry});
                undoStore.addUndoEntry(entry.containerActionId, 
                TileUndoEntry.create({
                    tileId: self.id, 
                    actionName: entry.actionName, 
                    patches: entry.patches, 
                    inversePatches: entry.inversePatches})
                );
            }, false, sharedModelsConfig );
        },

        updateTreeAfterSharedModelChangesInternal(containerActionId: string) {
            // If we are applying container patches, then we ignore any sync actions
            // otherwise the user might make a change such as changing the name of a
            // node while the patches are applied. When they do this the patch for 
            // the shared model might have been applied first, and which if sync is
            // enabled could create a new node in the diagram. Then the patch for the 
            // diagram is applied which also creates a new node in the diagram. 
            // Even if we just disable the sync when the shared model update is done
            // from the patch, if the user makes a change, this would be a separate
            // action would would trigger the sync. So if the user made this change
            // at just the right time it would could result in duplicate nodes in the 
            // diagram.
            if (self.applyingContainerPatches) {
                return;
            }

            console.log("updating tree after shared models changes", {tree: self.id, containerActionId});
            self.updateTreeAfterSharedModelChanges();
        },


        //
        // Special actions called by the framework. These define the Tree API 
        // which are shared by tiles and and shared models
        //

        // This will be called by the container when a shared model tree changes
        // That would normally happen when a tile changed the shared model.
        applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any) {
            // Find the shared model by its id in our sharedModels list
            // then apply the snapshot to it
            const model = self.sharedModels[snapshot.id];

            // Not every tile will use every shared model.
            // Ideally the container will know which tiles are using which shared 
            // models and only send snapshots to those tiles.
            // But to be safe this ignores snapshots from shared models that 
            // aren't being used by this tree.
            if (!model) {
                return;
            }
            applySnapshot(model, snapshot);
        },

        // The container calls this before it calls applyPatchesFromUndo
        startApplyingContainerPatches() {
            self.applyingContainerPatches = true;
        },

        // This is defined as an action so it is clear that is part of the API
        // also by giving it an action name the undo recorder can identify that
        // this action by its name and not record the undo as an undo
        // It might be called multiple times after startApplyingContainerPatches
        applyPatchesFromUndo(patchesToApply: readonly IJsonPatch[]) {
            applyPatch(self, patchesToApply);
        },

        // The container calls this after all patches have been applied
        finishApplyingContainerPatches() {
            self.applyingContainerPatches = false;

            // FIXME: Need to deal with the effects on the undo stack
            // If all of the patches applied with no intermediate changes
            // there should be nothing to update, so there wouldn't be anything
            // in the undo stack.
            // However, if the user made a change in the shared model like deleting
            // a node while the patches were being applied this would be out of sync
            // So that deleted node change would get applied here. The tree would 
            // be out of sync because the `applyingContainerPatches` flag was 
            // enabled during this time.
            // 
            // We could try to record the action id of any actions that happen
            // while the patches are being applied. 
            // But if multiple actions happened, any associated changes in the tree
            // would basically get merged together when updateTreeAfterSharedModelChanges 
            // was called.
            //
            // I guess the best thing we could do is:
            // - merge any actions that happened during the patch application into
            //   a single action. So basically combine their patches.
            // - use the id of that combined action for any changes the 
            //   updateTreeAfterSharedModelChanges causes. 
            //
            // If there were no intermediate actions, but something got corrupted 
            // what should we do?  I think the current implementation will record a new
            // action in the undo stack which would basically break the undo behavior.
            // TODO: find a way to log to the console that this error
            //   condition happened.
            self.updateTreeAfterSharedModelChanges();
        },
    };
    
});
