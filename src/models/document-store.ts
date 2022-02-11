import {
    types, Instance, flow, getEnv, IJsonPatch
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
            // Because sending a few patches at a time and waiting for
            // confirmation that they have been applied is limited by the
            // latency of the connection. This code groups all of the patches
            // for a particular tree into one array and then sends that single
            // array to the tree.
            //
            // This single array of changes might be a problem for large
            // documents so we might have to page the array, and send
            // information about the order of the pages so the tree receiving
            // them can make sure it is getting them in the right order.
            //
            const treePatches: Record<string, IJsonPatch[] | undefined> = {};
            Object.keys(treeMap).forEach(treeId => treePatches[treeId] = []);

            self.history.forEach(entry => {
                entry.treeEntries.forEach(treeEntry => {
                    const patches = treePatches[treeEntry.tileId];
                    patches?.push(...treeEntry.patches);
                });
            });

            console.log(treePatches);

            const applyPromises = Object.entries(treePatches).map(([treeId, patches]) => {
                if (patches && patches.length > 0) {
                    const tree = getTreeFromId(treeId);
                    return tree?.applyPatchesFromUndo(patches);
                } 
            });
            yield Promise.all(applyPromises);
  

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

