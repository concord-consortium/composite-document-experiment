import {
    types,
    IJsonPatch,
    Instance,
    getSnapshot,
    getEnv
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
        const applyPatchesToComponents = (entryToUndo: Instance<typeof UndoEntry>, opType: OperationType ) => {
            const getTreeFromId = (getEnv(self) as Environment).getTreeFromId;

            // first disable shared model syncing in the model
            entryToUndo.tileEntries.forEach(tileEntry => {
                getTreeFromId(tileEntry.tileId).startApplyingContainerPatches();
            });

            // apply the patches to all components
            entryToUndo.tileEntries.forEach(tileEntry => {
                console.log(`send tile entry to ${opType} to the tree`, getSnapshot(tileEntry));
                // FIXME: In an iframe system, this will be sent over postMessage
                // Because this would be asynchronous this action should be a flow
                // and it needs to wait for a confirmation from the tile or shared model
                // that all of the patches have been applied and also any tile that is 
                // working with the shared models have had time to update themselves
                getTreeFromId(tileEntry.tileId).applyPatchesFromUndo(tileEntry.getPatches(opType));
            });

            // finish the patch application
            // Need to tell all of the tiles to re-enable the sync and run the sync
            // to resync their tile models with any changes applied to the shared models
            entryToUndo.tileEntries.forEach(tileEntry => {
                getTreeFromId(tileEntry.tileId).finishApplyingContainerPatches();
            });
        };

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
                applyPatchesToComponents(entryToUndo, OperationType.Undo);

                self.undoIdx--;
            },
            redo() {
                if (!self.canRedo) {
                    throw new Error("redo not possible, nothing to redo");
                }
    
                const entryToRedo = self.history[self.undoIdx];

                applyPatchesToComponents(entryToRedo, OperationType.Redo);
    
                self.undoIdx++;
            },        
        };
});
