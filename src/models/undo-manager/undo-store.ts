import {
    types,
    IJsonPatch,
    Instance,
    getSnapshot,
    getEnv,
    flow
} from "mobx-state-tree";
import { TreeLike } from "../tree-proxy";

// I don't know if it is worth making this a MST model
// we aren't planning to save the undo stack across sessions
// But this approach lets me follow a pattern common to the 
// rest of the code. 
export const TileUndoEntry = types.model("TileUndoEntry", {
    tileId: types.string,
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

const UndoEntry = types.model("UndoEntry", {
    containerActionId: types.identifier,
    tileEntries: types.array(TileUndoEntry)
});

enum OperationType {
    Undo = "undo",
    Redo = "redo",
}

interface Environment {
    getTreeFromId: (treeId: string) => TreeLike;
}

export const UndoStore = types
    .model("UndoStore", {
        history: types.array(UndoEntry),
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
        // This is going to need to be asynchronous, so we might as well use a flow
        // that way we don't have create separate actions for each step of this.
        const applyPatchesToComponents = flow(function* applyPatchesToComponents(entryToUndo: Instance<typeof UndoEntry>, opType: OperationType ) {
            const getTreeFromId = (getEnv(self) as Environment).getTreeFromId;
            const tileEntries = entryToUndo.tileEntries;

            // first disable shared model syncing in the model
            const startPromises = tileEntries.map(tileEntry => {
                return getTreeFromId(tileEntry.tileId).startApplyingContainerPatches();
            });
            yield Promise.all(startPromises);

            // apply the patches to all components
            const applyPromises = tileEntries.map(tileEntry => {
                console.log(`send tile entry to ${opType} to the tree`, getSnapshot(tileEntry));
                // When a patch is applied to shared model, it will send its updated
                // state to all tiles. If this is working properly the promise returned by
                // the shared model's applyPatchesFromUndo will not resolve until all tiles
                // using it have updated. 
                return getTreeFromId(tileEntry.tileId).applyPatchesFromUndo(tileEntry.getPatches(opType));
            });
            yield Promise.all(applyPromises);

            // finish the patch application
            // Need to tell all of the tiles to re-enable the sync and run the sync
            // to resync their tile models with any changes applied to the shared models
            // For this final step, we wait for everything to complete. This is incase a finish
            // is delayed and a new action is undone during this delay.
            const finishPromises = tileEntries.map(tileEntry => {
                return getTreeFromId(tileEntry.tileId).finishApplyingContainerPatches();
            });
            // I'm using a yield because it isn't clear from the docs if an async MST action
            // can return a promise or not.
            yield Promise.all(finishPromises);
        });

        return {
            addUndoEntry(containerActionId: string, tileUndoEntry: Instance<typeof TileUndoEntry>) {
                // Originally this skipped entries with no patches, we are assuming the caller
                // already did that
    
                // Find if there is already an UndoEntry with this containerActionId
                let entry = self.undoEntry(containerActionId);
                if (!entry) {
                    // This is a new user action, so if they had undone some amount already
                    // we delete the part of the history that was past this undone point
                    // NOTE: when we are recording the full history so researchers can play it
                    // back we might not want to delete it this way. 
                    // Or perhaps we want to record that a different way
                    self.history.splice(self.undoIdx);
                    entry = UndoEntry.create({containerActionId});
                    self.history.push(entry);
                }
    
                entry.tileEntries.push(tileUndoEntry);
    
                // reset the undoIdx to the end of the history, this is because it is a 
                // new user action so anything past this point can no longer be redone
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
                // TODO: If there is an applyPatchesToComponents currently running we
                // should wait for it.
                applyPatchesToComponents(entryToUndo, OperationType.Undo);

                self.undoIdx--;
            },
            redo() {
                if (!self.canRedo) {
                    throw new Error("redo not possible, nothing to redo");
                }
    
                const entryToRedo = self.history[self.undoIdx];
                // TODO: If there is an applyPatchesToComponents currently running we
                // should wait for it.
                applyPatchesToComponents(entryToRedo, OperationType.Redo);
    
                self.undoIdx++;
            },        
        };
});
