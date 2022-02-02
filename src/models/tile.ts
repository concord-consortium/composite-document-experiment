import { types, applySnapshot, IJsonPatch, applyPatch, Instance, getEnv, getPath, getSnapshot } from "mobx-state-tree";
import { SharedModel } from "./shared-model/shared-model";
import { createUndoRecorder, SharedModelsConfig } from "./undo-manager/undo-recorder";
import { TileUndoEntry } from "./undo-manager/undo-store";

export interface ContainerAPI {
    sendSnapshotToSharedModel: (containerActionId: string, tileId: string, snapshot: any) => void
}

export const Tile = types.model("Tile", {
    id: types.identifier
})
.volatile(self => ({
    applyingContainerPatches: false,
    sharedModels: {} as Record<string, Instance<typeof SharedModel>>,
}))
.actions(self => ({
    // The tile should override this action to update the tile model with 
    // data from the shared model(s)
    // TODO: we should be able to know which shared models have been updated
    // so they could be passed to this action so the tile can optimize what
    // it updates. We might also be able to use some mobx magic to make this
    // function be reactive, so we'll know what properties of the shared models
    // it reacts to.
    // It isn't possible to just use existing MobX autorun because we need 
    // this to run as an action so we can track any changes made with the 
    // same containerActionId that was triggered the changes to the shared model
    updateTileModel() {
        throw new Error("This action needs to be overridden by the tile");
    },

}))
.actions(self => {
    const containerAPI = () => getEnv(self).containerAPI as ContainerAPI;

    return {
        addSharedModel(model: Instance<typeof SharedModel>) {
            console.log("addShareModel", getSnapshot(model));
            self.sharedModels[model.id] = model;
            // We could consider having the path passed in here, but we can have 
            // MST tell us the path because this will be mounted in the tile
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
                    console.log(`captured changes in sharedModel: ${model.id} of tile: ${self.id}`, {containerActionId, action: call});

                    // What is tricky is that this is being called when the snapshot is applied by the
                    // sharedModel syncing code "sendSnapshotToSharedMode". In that case we want to do
                    // the internal shared model sync, but we don't want to resend the snapshot to the 
                    // shared model. So the current approach is to look for the specific action that
                    // is applying this snapshot to the tile tree. 
                    if (call.name !== "applySharedModelSnapshotFromContainer") {
                
                        // TODO: figure out if we should be recording this special action in the undo
                        // stack
                        const snapshot = getSnapshot(model); 
                        
                        containerAPI().sendSnapshotToSharedModel(containerActionId, self.id, snapshot);
                    }


                    // sync the updates that were just applied to the shared model
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
                    this.syncSharedModelWithTileModel(containerActionId);

                };
            });

            // TODO: We probably want the recorder to be an object so we can modify the shared models
            // it knows about since they might be added after it is initially setup. 
            // Because it is a middleware attached to the tile's tree it probably also needs to be
            // destroyed 
            createUndoRecorder(self, (entry) => {
                console.log("Undoable Action", entry);
                undoStore.addUndoEntry(entry.containerActionId, 
                TileUndoEntry.create({
                    tileId: self.id, 
                    actionName: entry.actionName, 
                    patches: entry.patches, 
                    inversePatches: entry.inversePatches})
                );
            }, false, sharedModelsConfig );
        },

        //
        // Special actions called by the framework. These define the Tile API
        //
        applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any) {
            // Find the shared model by its id in our sharedModels list
            // then apply the snapshot to it
            const model = self.sharedModels[snapshot.id];
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
            // FIXME: what container action id should I use here?
            // If all of the patches applied with no intermediate changes
            // there should be nothing to sync, so this action id would not show
            // up anywhere
            // If the user made a change in the shared model like deleting
            // a node while the patches were applied this would be out of sync
            // So that deleted no change would get applied here.
            // We could try to record the action id of any intermediate actions
            // but if multiple actions happened all of their changes would get 
            // merged together.
            // I guess the best thing we could do is:
            // - merge any actions that happened during the patch application into
            //   a single action. So basically combine their patches.
            // - use the id of that combined action here.
            // If there were no intermediate actions, what should we do?
            // - use a new UUID: it is most likely that no changes will be done 
            //   by the sync. But just incase there are some we can give it an 
            //   a valid ID. It almost would be better to throw an error here 
            //   so we could track down the problem. Recording a new change would
            //   basically break the undo stack. 
            //   TODO: find a way to at least log to the console that this error
            //   condition happened.
            this.syncSharedModelWithTileModel("fake containerActionId");
        },

        syncSharedModelWithTileModel(containerActionId: string) {
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

            console.log("syncing shared models changes with tile:", self.id);
            self.updateTileModel();
        },


    };
    
});
