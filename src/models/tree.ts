import { types, applySnapshot, IJsonPatch, applyPatch, Instance, getEnv, getPath, getSnapshot, flow } from "mobx-state-tree";
import { v4 as uuidv4 } from "uuid";
import { delay } from "../utils/delay";
import { ContainerAPI } from "./container-api";
import { SharedModel } from "./shared-model/shared-model";
import { addTreeMonitor, SharedModelsConfig } from "./undo-manager/tree-monitor";

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
    const updateTreeAfterSharedModelChangesInternal = 
        flow(function* updateTreeAfterSharedModelChangesInternal(historyEntryId: string, callId: string){
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

            // FIXME: If there is a long delay here changes to the tree state
            // won't make it back to the container, and if the container then
            // undoes this entry or if the entry is sent to another app viewing
            // the document, the entry will be incomplete. the container won't know
            // when it can go ahead and "close" the history entry.
            // So to be able to emulate that error I'm want to add a delay here,
            // so then I can call undo before this delay has occurred. However
            // that means this has to be turned into a asynchronous flow action.
            yield delay(3000);

            console.log("updating tree after shared models changes", {tree: self.id, historyEntryId});

            // The TreeMonitor middleware should pickup the historyEntryId and
            // callId parameters automatically. And then when it sends any
            // changes captured during the update, it should include these ids
            self.updateTreeAfterSharedModelChanges();
        });
    
    return {
        updateTreeAfterSharedModelChangesInternal
    };
})
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
        setupTreeMonitor() {

            // TODO: It would be better to refactor this, so tree monitor was
            // just passed the tree model itself. And then on each change the
            // tree monitor can check the sharedModels mounted in the tree to
            // see if any of them match the change. If they do the tree monitor
            // can call an action on the tree that basically works the same as
            // the anonymous function below. The action either needs to be
            // passed the path or perhaps it can just be passed the model
            // itself.
            //
            // One advantage of this is that now shared models can be mounted
            // whenever and the tree monitor will pick up changes to them as
            // soon as they are mounted.
            //
            // Because we haven't made this change, for now we'll assume
            // addSharedModel has been called first, so then we can construct the
            // map from sharedModels map.
            const sharedModelsConfig: SharedModelsConfig = {};
            Object.values(self.sharedModels).forEach(model => {
                sharedModelsConfig[getPath(model)] = async (historyEntryId, callId, call) => {

                    // Note: the environment of the call will be undefined because the undoRecorder cleared 
                    // it out before it calling this function
                    console.log(`observed changes in sharedModel: ${model.id} of tile: ${self.id}`, {historyEntryId, action: call});

                    // What is tricky is that this is being called when the snapshot is applied by the
                    // sharedModel syncing code "sendSnapshotToSharedModel". In that case we want to do
                    // the internal shared model sync, but we don't want to resend the snapshot to the 
                    // shared model. So the current approach is to look for the specific action that
                    // is applying this snapshot to the tile tree. 
                    if (call.name !== "applySharedModelSnapshotFromContainer") {
                
                        // TODO: figure out if we should be recording this special action in the undo
                        // stack
                        const snapshot = getSnapshot(model); 
                        
                        // TODO: we use the callId from the original call here
                        // so we need to wait for the container to confirm this
                        // updateSharedModel call before we can continue.
                        // Otherwise the container might receive the final
                        // addTreePatchRecord before it gets any shared model
                        // updates. Currently updateSharedModel waits for all of
                        // the dependent trees to update their shared models
                        // before returning, so this might cause a long delay.  
                        //
                        // We could start a new "call" with the container and
                        // just wait for that, and then call updateSharedModel
                        // with the callId for this new "call".
                        //
                        // Or we could add a new option to updateSharedModel so
                        // in some cases it waits for all of the dependent trees
                        // to be updated and in other cases it just waits for
                        // the container to confirm it received the request.
                        //
                        // It might also be possible we can change the async
                        // flow of applying history events so it isn't necessary
                        // for the trees to wait for the shared model to be
                        // fully updated. So then this updateSharedModel call
                        // can just wait for a confirmation in all cases.
                        //
                        // - Q: Why is the callId passed to updateSharedModel
                        // - A: It isn't really needed but it is useful for
                        //   debugging. updateSharedModel makes a new callId for
                        //   each tree that it sends the shared model to. It
                        //   doesn't do anything with the passed in callId.
                        //
                        // Note that the TreeMonitor takes care of closing the
                        // callId used here. This same callId is passed to all
                        // the shared model callbacks and then they are all
                        // waited for, and finally the callId is closed. 
                        //
                        await containerAPI().updateSharedModel(historyEntryId, callId, self.id, snapshot);
                    }

                    // let the tile update its model based on the updates that
                    // were just applied to the shared model
                    //
                    // TODO: an inefficiency  with this approach is that we
                    // treating all changes within the sharedModelPath the same.
                    // If the change is a simple property change in the shared
                    // model view that isn't used by
                    // updateTreeAfterSharedModelChanges, we do not need to
                    // re-run updateTreeAfterSharedModelChanges. When we used
                    // the autorun approach this was optimized so the function
                    // would only run when the needed parts of the tree changed.
                    //
                    // We do need to send the shared model snapshot to the
                    // container whenever there are any changes to the tree so
                    // the code above is fine. 
                    //
                    // There might be a way to use the mobx internals so we can
                    // track what updateTreeAfterSharedModelChanges is using and
                    // only run it when one of those things have changed. 
                    //
                    // NOTE: We are calling an action from a middleware that
                    // just finished a different action. Doing this starts a new
                    // top level action: an action with no parent actions. This
                    // is what we want so we can record any changes made to the
                    // tree as part of the undo entry. I don't know if calling
                    // an action from a middleware is an officially supported or
                    // tested approach. It would probably be safer to run this
                    // in a setTimeout callback. 
                    //
                    // This should not cause a loop because the implementation
                    // of updateTreeAfterSharedModelChanges should not modify
                    // the shared model view that triggered this handler in the
                    // first place. However a developer might make a mistake. So
                    // it would be useful if we could identify the looping and
                    // notify them.
                    //
                    // The container needs to track when a history entry is
                    // complete. Since this update call can be async the
                    // container needs to know to wait for it to finish. Before
                    // callback is called we should not have called
                    // addTreePatches for the passed in callId. But
                    // addTreePatches will be called immediately after this
                    // callback is resolved. So we start a new history entry
                    // call and make sure that start request has been seen by
                    // the container before returning/resolving from this shared
                    // model callback. 
                    //
                    // - Q: Do we really want to make a new callId here? 
                    // - A: When this callback is triggered by the container
                    //   when it calls applySharedModelSnapshot, a callId is
                    //   passed in which we need to close out anyway so we could
                    //   just use that here. So in that case we don't really
                    //   need to make a new callId. But it is also possible this
                    //   callback will be triggered by a user action. In that
                    //   case multiple shared models might be modified by the
                    //   same action which would then result in multiple
                    //   updateTreeAfterSharedModelChangesInternal calls which
                    //   would probably result in multiple addTreePatchRecord
                    //   calls for the same callId. Also because
                    //   updateTreeAfterSharedModelChangesInternal is
                    //   asynchronous it is better if we don't wait for it, if
                    //   we can avoid it, so the new callId allows us to wrap up
                    //   the recordAction of TreeMonitor sooner.
                    // - Q: This is happening in a middleware will all of this
                    //   await stuff work?
                    // - A: Yes this callback is called from recordAction which
                    //   is asynchronous itself. The recordAction function
                    //   will store a reference to all of the objects it needs
                    //   so it can run after the middleware has continued on
                    //   handling other actions. 
                    // - Q: What is the passed in callId for?
                    // - A: It isn't necessary, but it can be a useful
                    //   piece of information to help with debugging.
                    // - Q: Will there be more than one addTreePatchRecord call
                    //   if more than one shared model is updated a user action?
                    // - A: Yes each of these shared model updates will kick of
                    //   a new top level action when
                    //   updateTreeAfterSharedModelChangesInternal is called. It
                    //   would be better if we could streamline this.
                    //
                    const updateTreeCallId = uuidv4();
                    await containerAPI().startHistoryEntryCall(historyEntryId, updateTreeCallId);

                    // This should always result in a addTreePatchRecord being
                    // called even if there are no changes.
                    //
                    // This is because it will be a top level action, so the
                    // TreeMonitor will record it, and when the action is
                    // finished the TreeMonitor's recordAction function will
                    // call addTreePatchRecord even if there are no changes. 
                    self.updateTreeAfterSharedModelChangesInternal(historyEntryId, updateTreeCallId);
                };
            });

            // TODO: We probably want the recorder to be an object so we can modify the shared models
            // it knows about since they might be added after it is initially setup. 
            // Because it is a middleware attached to the tile's tree it probably also needs to be
            // destroyed 
            // Note: we have to cast self here because it isn't fully configured
            // yet and createUndoRecorder is expecting the full tree type.
            // FIXME: this is a circular module dependency, tree is depending
            // on undo-recorder and undo recorder is depending on tree. I think
            // this currently works because only the types of Tree are used by
            // undo-recorder.
            // It is hacky but we could put the model definition of Tree in its
            // own module, and then a separate module adds its actions.
            addTreeMonitor(self as Instance<typeof Tree>, containerAPI(), false, sharedModelsConfig );
        },

        //
        // Special actions called by the framework. These define the Tree API 
        // which are shared by tiles and and shared models
        //

        // This will be called by the container when a shared model tree changes
        // That would normally happen when a tile changed the shared model.
        applySharedModelSnapshotFromContainer(historyEntryId: string, callId: string, snapshot: any) {
            // Find the shared model by its id in our sharedModels list
            // then apply the snapshot to it
            const model = self.sharedModels[snapshot.id];

            // Not every tile will use every shared model.
            // Ideally the container will know which tiles are using which shared 
            // models and only send snapshots to those tiles.
            // But to be safe this ignores snapshots from shared models that 
            // aren't being used by this tree.
            if (!model) {
                // Even in this case we need to let the container know
                // that this callId is now closed. The TreeMonitor middleware
                // should do this automatically since this is a top level action
                // call and it calls addTreePatchRecord for every top level
                // action call. 
                return Promise.resolve();
            }

            // We need to make sure that the container is told this callId has
            // been closed. The TreeMonitor middleware should close it
            // automatically in the recordAction function. It will also create
            // additional callIds for each sharedModel that is modified. 
            //
            // - Q: Is the callId needed here?
            // - A: Probably, the tree needs to make sure to start the
            //   additional callIds before it "closes" this callId by calling
            //   addTreePatchRecord. It might be possible for the container to
            //   use the returned promise from
            //   applySharedModelSnapshotFromContainer to close an internal
            //   callId. In this case the tree would have to make sure to
            //   confirm any new callIds are started before it resolves this
            //   promise. However doing that adds complication because it means
            //   the TreeMonitor needs to treat this
            //   applySharedModelSnapshotFromContainer specially and not call
            //   addTreePatchRecord. More specifically the callId is not used by
            //   this function directly, but it is used by the TreeMonitor
            //   middleware as it augments this action.
            // - Q: Does this call need to be synchronized?
            // - A: Yes, when this action is used to replay patches during an
            //   undo or load. In that case we need to wait for the changes to
            //   be applied to the shared model before the container can tell
            //   all of the trees that the patches have finished being applied.
            //   When this action is used during a user trigger, it is not
            //   necessary for it to be synchronized. The callId is passed in
            //   here is already an active callId that will be closed by this
            //   action.  
            //
            applySnapshot(model, snapshot);

            // The contract is that the promise we return should not resolve
            // until all of the changes have been applied to shared model.
            // We should not wait until the tree has run 
            // updateTreeAfterSharedModelChanges
            // So we can just resolve immediately
            return Promise.resolve();
        },

        // The container calls this before it calls applyContainerPatches
        startApplyingContainerPatches(historyEntryId: string, callId: string) {
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
        applyContainerPatches(historyEntryId: string, callId: string, patchesToApply: readonly IJsonPatch[]) {
            applyPatch(self, patchesToApply);
            // We return a promise because the API is async
            // The action itself doesn't do anything asynchronous though
            // so it isn't necessary to use a flow
            return Promise.resolve();
        },

        // The container calls this after all patches have been applied
        finishApplyingContainerPatches(historyEntryId: string, callId: string) {
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
