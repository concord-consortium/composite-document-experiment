import {
    types, Instance, flow, getEnv
} from "mobx-state-tree";
import { TreeAPI } from "./tree-api";
import { TreeUndoEntry, UndoEntry } from "./undo-manager/undo-store";

interface Environment {
    getTreeFromId: (treeId: string) => TreeAPI | undefined;
}

// TODO: since we are sharing the types with the undo store we should give them
// more generic names.

// TODO: it would be more efficient if the undo stack and this one were in the
// same tree, and then the undo stack could just contain references to the
// UndoEntries in this model. 
export const DocumentStore = types
    .model("DocumentStore", {
        history: types.array(UndoEntry)
    })
    .views((self) => ({
        undoEntry(containerActionId: string) {
            return self.history.find(entry => entry.containerActionId === containerActionId);
        }
    }))
    .actions((self) => {

        // This is asynchronous. We might as well use a flow so we don't have to 
        // create separate actions for each of the parts of this single action
        const replayHistoryToTrees = flow(function* replayHistoryToTrees(treeMap: Record<string, TreeAPI> ) {
            const getTreeFromId = (getEnv(self) as Environment).getTreeFromId;
            const trees = Object.values(treeMap);

            // For now we are going to try to disable shared model syncing on
            // all of the trees. This is different than when the undo patches
            // are applied because we are going to apply lots of undoable
            // actions all at once. 
            const startPromises = trees.map(tree => {
                return tree.startApplyingContainerPatches();
            });
            yield Promise.all(startPromises);

            // apply the patches to all trees

            // iterate initialDocument.history
            // It isn't efficient, but I'm going to try 'yielding' on each top
            // level entry. This way the syncrhounousness will be closer to what
            // happens during an undo.
            for ( const entry of self.history) {
                const applyPromises = entry.treeEntries.map(treeEntry => {
                    // When a patch is applied to shared model, it will send its updated
                    // state to all tiles. If this is working properly the promise returned by
                    // the shared model's applyPatchesFromUndo will not resolve until all tiles
                    // using it have updated their view of the shared model.
                    const tree = getTreeFromId(treeEntry.tileId);
                    if (!tree) {
                        throw new Error(`History contains tree that isn't available. id: ${treeEntry.tileId}`);
                    }

                    // FIXME: this is a hack, we are using this function in a
                    // way it wasn't intended. It should be OK because we
                    // calling start first and finish after but this isn't
                    // really a patch from an undo.
                    //
                    // However, this is inefficient because we are waiting for
                    // confirmation from the tree after applying each of the
                    // sets of patches. So that means the total time will be the
                    // latency * number of entries We could easily get into the
                    // thousands of entries case, so that can take many seconds
                    // to replay. 
                    return tree.applyPatchesFromUndo(treeEntry.patches);
                });
                yield Promise.all(applyPromises);    
            }
  

            // finish the patch application
            // Need to tell all of the tiles to re-enable the sync and run the sync
            // to resync their tile models with any changes applied to the shared models
            // For this final step, we still use promises so we can wait for everything to complete. 
            // This can be used in the future to make sure multiple applyPatchesToTrees are not 
            // running at the same time.
            const finishPromises = trees.map(tree => {
                return tree.finishApplyingContainerPatches();
            });
            // I'm using a yield because it isn't clear from the docs if an flow MST action
            // can return a promise or not.
            yield Promise.all(finishPromises);
        });


        return {
            
            addUndoEntry(containerActionId: string, treeUndoEntry: Instance<typeof TreeUndoEntry>) {
                // Find if there is already an UndoEntry with this containerActionId
                let entry = self.undoEntry(containerActionId);
                if (!entry) {
                    // This is a new user action
                    entry = UndoEntry.create({containerActionId});
                    self.history.push(entry);
                }

                entry.treeEntries.push(treeUndoEntry);    
            },
            replayHistoryToTrees
        };
      
    });

