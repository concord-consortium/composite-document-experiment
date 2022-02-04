import { types, applySnapshot, IJsonPatch, applyPatch, Instance, getEnv, getPath, getSnapshot } from "mobx-state-tree";
import { ContainerAPI } from "./container-api";
import { SharedModel } from "./shared-model/shared-model";
import { createUndoRecorder, SharedModelsConfig } from "./undo-manager/undo-recorder";
import { TileUndoEntry } from "./undo-manager/undo-store";

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
                    // NOTE: We are calling an action from a middleware that just finished a
                    // different action. Doing this starts a new top level action:
                    // an action with no parent actions. This is what we want so we can record
                    // any changes made to the tree as part of the undo entry.
                    // I don't know if calling an action from a middleware is an officially 
                    // supported or tested approach. 
                    // It would probably be safer to run this in a setTimeout callback. 
                    // 
                    // This should not cause a loop because the implementation of 
                    // updateTreeAfterSharedModelChanges should not modify the shared model
                    // view that triggered this handler in the first place. 
                    // However a developer might make a mistake. So it would be useful if
                    // we could identify the looping and notify them.
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

            // We return a promise because the API is async
            // The action itself doesn't do anything asynchronous though
            // so it isn't necessary to use a flow
            return Promise.resolve();
        },

        // This is defined as an action so it is clear that is part of the API
        // also by giving it an action name the undo recorder can identify that
        // this action by its name and not record the undo as an undo
        // It might be called multiple times after startApplyingContainerPatches
        applyPatchesFromUndo(patchesToApply: readonly IJsonPatch[]) {
            applyPatch(self, patchesToApply);
            // We return a promise because the API is async
            // The action itself doesn't do anything asynchronous though
            // so it isn't necessary to use a flow
            return Promise.resolve();
        },

        // The container calls this after all patches have been applied
        finishApplyingContainerPatches() {
            self.applyingContainerPatches = false;

            // TODO: Need to deal with possible effects on the undo stack
            // 
            // If all of the patches applied correctly and the user didn't inject
            // any changes while the patches were applying, then everything should
            // be fine. There should be nothing updated by with no intermediate changes
            // there should be nothing to updated by updateTreeAfterSharedModelChanges
            // 
            // However, if the user made a change in the shared model like deleting
            // a node while the patches were being applied this would make the 
            // shared model be out of sync with the tree. The tree would not be updated
            // before now because applyingContainerPatches is true. 
            // So that deleted node change would get applied here. 
            // When it is applied it would generate a new undoable action that is not
            // grouped with the action that deleted the node from the shared model.
            // So now if the user undoes, the actions will not get undone together. 
            // This will probably result in a broken UI for the user. 
            // 
            // We could record the action id of any actions that happen
            // while the patches are being applied. It is possible that multiple actions
            // could happen. Because we aren't running the updateTreeAfterSharedModelChanges
            // after each of these actions, we wouldn't be able to tell what tree updates
            // are associated with which if the multiple actions. 
            //
            // I think the best thing to do is:
            // - merge any actions that happened during the patch application into
            //   a single action. So basically combine their patches.
            // - use the id of that combined action for any changes the 
            //   updateTreeAfterSharedModelChanges causes here.
            //
            // If there were no injected or intermediate actions, but for some reason 
            // this update function does make changes in the tree, 
            // what should we do?  
            // We should at least log this issue to the console, so we can try to track
            // down what happened. One likely reason is a broken implementation of the 
            // updateTreeAfterSharedModelChanges. And that will be likely to happen 
            // during development.
            self.updateTreeAfterSharedModelChanges();

            // We return a promise because the API is async
            // The action itself doesn't do anything asynchronous though
            // so it isn't necessary to use a flow
            return Promise.resolve();
        },
    };
    
});
