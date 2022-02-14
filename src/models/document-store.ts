import {
    types, Instance, flow, getEnv, IJsonPatch
} from "mobx-state-tree";
import { v4 as uuidv4 } from "uuid";
import { TreeAPI } from "./tree-api";
import { TreeUndoEntry, UndoEntry, UndoStore } from "./undo-manager/undo-store";

interface Environment {
    getTreeFromId: (treeId: string) => TreeAPI | undefined;
}

export const CDocument = types
    .model("CDocument", {
        history: types.array(UndoEntry)
    });

// TODO: since we are sharing the types with the undo store we should give them
// more generic names.

// TODO: it would be more efficient if the undo stack and this one were in the
// same tree, and then the undo stack could just contain references to the
// UndoEntries in this model. 
export const DocumentStore = types
    .model("DocumentStore", {
        document: CDocument,
        undoStore: UndoStore,
    })
    .views((self) => ({
        undoEntry(containerActionId: string) {
            return self.document.history.find(entry => entry.containerActionId === containerActionId);
        }
    }))
    .actions((self) => {

        // This is asynchronous. We might as well use a flow so we don't have to 
        // create separate actions for each of the parts of this single action
        const replayHistoryToTrees = flow(function* replayHistoryToTrees(treeMap: Record<string, TreeAPI> ) {
            const getTreeFromId = (getEnv(self) as Environment).getTreeFromId;
            const trees = Object.values(treeMap);

            const containerActionId = uuidv4();
            // FIXME: this should also start an non-undoable action with this id

            // For now we are going to try to disable shared model syncing on
            // all of the trees. This is different than when the undo patches
            // are applied because we are going to apply lots of undoable
            // actions all at once. 
            const startPromises = trees.map(tree => {
                return tree.startApplyingContainerPatches(containerActionId);
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

            self.document.history.forEach(entry => {
                entry.treeEntries.forEach(treeEntry => {
                    const patches = treePatches[treeEntry.treeId];
                    patches?.push(...treeEntry.patches);
                });
            });

            console.log(treePatches);

            const applyPromises = Object.entries(treePatches).map(([treeId, patches]) => {
                if (patches && patches.length > 0) {
                    const tree = getTreeFromId(treeId);
                    return tree?.applyPatchesFromUndo(containerActionId, patches);
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
                return tree.finishApplyingContainerPatches(containerActionId);
            });
            // I'm using a yield because it isn't clear from the docs if an flow MST action
            // can return a promise or not.
            yield Promise.all(finishPromises);
        });


        return {
            createOrUpdateHistoryEntry(containerActionId: string, name: string, treeId: string, undoable: boolean) {
                let entry = self.undoEntry(containerActionId);
                if (!entry) {
                    entry = UndoEntry.create({containerActionId});
                    self.document.history.push(entry);
                } 
                // update the new or existing entry
                entry.name = name;
                entry.initialTreeId = treeId;
                entry.undoable = undoable;

                // Only add it to the undo stack if it has changes. This means
                // it must have existed before.
                if (undoable && entry.treeEntries.length > 0) {
                    self.undoStore.addUndoEntry(entry);
                }

            },

            addPatchesToHistoryEntry(containerActionId: string, treeUndoEntry: Instance<typeof TreeUndoEntry>) {
                // Find if there is already an UndoEntry with this containerActionId
                let entry = self.undoEntry(containerActionId);
                if (!entry) {
                    // This is a new user action, normally
                    // createOrUpdateHistoryEntry would have been called first
                    // but it is better to handle the out of order case here so
                    // we don't have to deal with synchronizing the two calls.
                    entry = UndoEntry.create({containerActionId});
                    self.document.history.push(entry);
                }

                entry.treeEntries.push(treeUndoEntry);

                // add the entry to the undo stack if it is undoable
                // the entry is shared with the document, so when the code above
                // updates it with the treeUndoEntry that will apply to the undo
                // stack too. 
                if (entry.undoable) {
                    self.undoStore.addUndoEntry(entry);
                }
            },
            replayHistoryToTrees
        };
      
    });

