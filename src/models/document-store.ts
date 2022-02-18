import {
    types, Instance, flow, getEnv, IJsonPatch
} from "mobx-state-tree";
import { v4 as uuidv4 } from "uuid";
import { TreeAPI } from "./tree-api";
import { UndoStore } from "./undo-manager/undo-store";
import { TreePatchRecord, HistoryEntry } from "./history";

interface Environment {
    getTreeFromId: (treeId: string) => TreeAPI | undefined;
}

export const CDocument = types
    .model("CDocument", {
        // TODO: switch to a map, so we get faster lookups in the map and MST can
        // do better at applying snapshots and patches by reusing existing
        // objects. 
        history: types.array(HistoryEntry)
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
        findHistoryEntry(historyEntryId: string) {
            return self.document.history.find(entry => entry.id === historyEntryId);
        }
    }))
    .actions((self) => {

        const createOrUpdateHistoryEntry = (historyEntryId: string, name: string, treeId: string, undoable: boolean) => {
            let entry = self.findHistoryEntry(historyEntryId);
            if (!entry) {
                entry = HistoryEntry.create({id: historyEntryId});
                self.document.history.push(entry);
            } 
            // update the new or existing entry
            entry.action = name;
            entry.tree = treeId;
            entry.undoable = undoable;

            // Only add it to the undo stack if it has changes. This means
            // it must have existed before.
            if (undoable && entry.records.length > 0) {
                self.undoStore.addHistoryEntry(entry);
            }

        };

        const addPatchesToHistoryEntry = (historyEntryId: string, treePatchRecord: Instance<typeof TreePatchRecord>) => {
            // Find if there is already an entry with this historyEntryId
            let entry = self.findHistoryEntry(historyEntryId);
            if (!entry) {
                // This is a new user action, normally
                // createOrUpdateHistoryEntry would have been called first
                // but it is better to handle the out of order case here so
                // we don't have to deal with synchronizing the two calls.
                entry = HistoryEntry.create({id: historyEntryId});
                self.document.history.push(entry);
            }

            entry.records.push(treePatchRecord);

            // Add the entry to the undo stack if it is undoable. The entry is
            // shared with the document store, so when new records are added
            // they are added to the undo stack too.
            if (entry.undoable) {
                self.undoStore.addHistoryEntry(entry);
            }
        };

        // This is asynchronous. We might as well use a flow so we don't have to 
        // create separate actions for each of the parts of this single action
        const replayHistoryToTrees = flow(function* replayHistoryToTrees(treeMap: Record<string, TreeAPI> ) {
            const getTreeFromId = (getEnv(self) as Environment).getTreeFromId;
            const trees = Object.values(treeMap);

            const historyEntryId = uuidv4();
            // Start a non-undoable action with this id. Currently the trees do
            // not have their treeMonitors setup when replayHistoryToTrees is
            // called, so the container should not receive any patches with this
            // historyEntryId. However, it seems good to go ahead and record
            // this anyway.
            createOrUpdateHistoryEntry(historyEntryId, "replayHistoryToTrees", "container", false);

            // Disable shared model syncing on all of the trees. This is
            // different than when the undo store applies patches because in
            // this case we are going to apply lots of history entries all at
            // once. 
            const startPromises = trees.map(tree => {
                return tree.startApplyingContainerPatches(historyEntryId);
            });
            yield Promise.all(startPromises);

            // apply the patches to all trees

            // iterate initialDocument.history This code groups all of the
            // patches for a particular tree into one array. This is done
            // instead of sending just the patches for each history entry one at
            // a time. This approach is taken, because sending the patch records
            // one at a time and waiting for confirmation that they have been
            // applied is limited by the latency of the connection to the tree.
            //
            // This single array of changes might be a problem for large
            // documents so we might have to split the array into pages, and
            // send information about the order of the pages so the tree
            // receiving them can make sure it is getting them in the right
            // order.
            //
            const treePatches: Record<string, IJsonPatch[] | undefined> = {};
            Object.keys(treeMap).forEach(treeId => treePatches[treeId] = []);

            self.document.history.forEach(entry => {
                entry.records.forEach(treeEntry => {
                    const patches = treePatches[treeEntry.tree];
                    patches?.push(...treeEntry.patches);
                });
            });

            console.log(treePatches);

            const applyPromises = Object.entries(treePatches).map(([treeId, patches]) => {
                if (patches && patches.length > 0) {
                    const tree = getTreeFromId(treeId);
                    return tree?.applyContainerPatches(historyEntryId, patches);
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
                return tree.finishApplyingContainerPatches(historyEntryId);
            });
            // I'm using a yield because it isn't clear from the docs if an flow MST action
            // can return a promise or not.
            yield Promise.all(finishPromises);
        });


        return {
            replayHistoryToTrees,
            createOrUpdateHistoryEntry,
            addPatchesToHistoryEntry
        };
      
    });

