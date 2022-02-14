import {
    types, IJsonPatch, Instance, getSnapshot, getEnv, flow, getParent
} from "mobx-state-tree";
import { v4 as uuidv4 } from "uuid";
import { DocumentStore } from "../document-store";

import { TreeAPI } from "../tree-api";

// I don't know if it is worth making this a MST model
// we aren't planning to save the undo stack across sessions
// But this approach lets me follow a pattern common to the 
// rest of the code. 
export const TreeUndoEntry = types.model("TreeUndoEntry", {
    treeId: types.string,
    actionName: types.string,
    patches: types.frozen<ReadonlyArray<IJsonPatch>>(),
    inversePatches: types.frozen<ReadonlyArray<IJsonPatch>>()
})
.views(self => ({
    getPatches(opType: OperationType) {
        switch (opType) {
            case OperationType.Undo:
                return self.inversePatches.slice().reverse();
            case OperationType.Redo:
                return self.patches;
        }
    }
}));

export const UndoEntry = types.model("UndoEntry", {
    containerActionId: types.identifier,
    initialTreeId: types.maybe(types.string),
    name: types.maybe(types.string),
    // This doesn't need to be recorded in the state, but putting it here is
    // the easiest place for now.
    undoable: types.maybe(types.boolean),  
    treeEntries: types.array(TreeUndoEntry)
});

enum OperationType {
    Undo = "undo",
    Redo = "redo",
}

interface Environment {
    getTreeFromId: (treeId: string) => TreeAPI;
}

export const UndoStore = types
    .model("UndoStore", {
        history: types.array(types.reference(UndoEntry)),
        undoIdx: 0
    })
    .views((self) => ({
        get undoLevels() {
            return self.undoIdx;
        },
        get redoLevels() {
            return self.history.length - self.undoIdx;
        },
        get canUndo() {
            return this.undoLevels > 0;
        },
        get canRedo() {
            return this.redoLevels > 0;
        },
        undoEntry(containerActionId: string) {
            return self.history.find(entry => entry.containerActionId === containerActionId);
        }
    }))
    .actions((self) => {
        // This is asynchronous. We might as well use a flow so we don't have to 
        // create separate actions for each of the parts of this single action
        const applyPatchesToTrees = flow(function* applyPatchesToTrees(entryToUndo: Instance<typeof UndoEntry>, opType: OperationType ) {
            const getTreeFromId = (getEnv(self) as Environment).getTreeFromId;
            const treeEntries = entryToUndo.treeEntries;

            const containerActionId = uuidv4();

            // Start a non-undoable action with this id
            const docStore = getParent(self) as Instance<typeof DocumentStore>;
            docStore.createOrUpdateHistoryEntry(containerActionId, opType, "container", false);

            // first disable shared model syncing in the tree
            const startPromises = treeEntries.map(treeEntry => {
                return getTreeFromId(treeEntry.treeId).startApplyingContainerPatches(containerActionId);
            });
            yield Promise.all(startPromises);

            // apply the patches to all trees
            const applyPromises = treeEntries.map(treeEntry => {
                console.log(`send tile entry to ${opType} to the tree`, getSnapshot(treeEntry));
                // When a patch is applied to shared model, it will send its updated
                // state to all tiles. If this is working properly the promise returned by
                // the shared model's applyPatchesFromUndo will not resolve until all tiles
                // using it have updated their view of the shared model.
                return getTreeFromId(treeEntry.treeId).applyPatchesFromUndo(containerActionId, treeEntry.getPatches(opType));
            });
            yield Promise.all(applyPromises);

            // finish the patch application
            // Need to tell all of the tiles to re-enable the sync and run the sync
            // to resync their tile models with any changes applied to the shared models
            // For this final step, we still use promises so we can wait for everything to complete. 
            // This can be used in the future to make sure multiple applyPatchesToTrees are not 
            // running at the same time.
            const finishPromises = treeEntries.map(treeEntry => {
                return getTreeFromId(treeEntry.treeId).finishApplyingContainerPatches(containerActionId);
            });
            // I'm using a yield because it isn't clear from the docs if an flow MST action
            // can return a promise or not.
            yield Promise.all(finishPromises);
        });

        return {
            addUndoEntry(undoEntry: Instance<typeof UndoEntry>) {
                // Find if there is already an UndoEntry with this
                // containerActionId. This action is called each time new
                // changes are added to the undoEntry, and we don't want
                // duplicates.
                
                const existingEntry = self.undoEntry(undoEntry.containerActionId);
                if (!existingEntry) {
                    // This is a new user action, so if they had undone some amount already
                    // we delete the part of the history that was past this undone point
                    self.history.splice(self.undoIdx);
                    self.history.push(undoEntry);
                }
    
                // Reset the undoIdx to the end of the history, this is because it is a 
                // user action so if the user had been undoing things, once they
                // start doing new things they can no longer 'redo' what was
                // undone before.
                // 
                // The fact that the undoIdx is reset in all cases even
                // with an existing entry is confusing. This currently happens
                // because the system might add additional patches to a previous
                // entry, and might mean that a redo won't work as expected.
                self.undoIdx = self.history.length;
            },
    
            // TODO: The MST undo manager used atomic operations for this
            // that way if the was an error applying the patch then the whole set of 
            // changes would be aborted.
            // If we want this behavior we'd need to have each tile function that way
            // and notify the container when it succeeded or failed. And then 
            // if it failed the container would have to tell any tiles that successfully
            // applied the patches to revert them. 
            undo() {
                if (!self.canUndo) {
                    throw new Error("undo not possible, nothing to undo");
                }
    
                const entryToUndo = self.history[self.undoIdx -1];
                // TODO: If there is an applyPatchesToTrees currently running we
                // should wait for it.
                //
                // FIXME: we aren't actually calling this as an action and we
                // aren't waiting for it finish before returning
                applyPatchesToTrees(entryToUndo, OperationType.Undo);

                self.undoIdx--;
            },
            redo() {
                if (!self.canRedo) {
                    throw new Error("redo not possible, nothing to redo");
                }
    
                const entryToRedo = self.history[self.undoIdx];
                // TODO: If there is an applyPatchesToTrees currently running we
                // should wait for it.
                //
                // FIXME: we aren't actually calling this as an action and we
                // aren't waiting for it finish before returning
                applyPatchesToTrees(entryToRedo, OperationType.Redo);
    
                self.undoIdx++;
            },        
        };
});
