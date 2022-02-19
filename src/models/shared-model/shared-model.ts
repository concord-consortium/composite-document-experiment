import { types, destroy, applySnapshot, IJsonPatch, applyPatch, getSnapshot, getEnv } from "mobx-state-tree";
import { delay } from "../../utils/delay";
import { ContainerAPI } from "../container-api";

export const SharedItem = types.model("SharedItem", {
    id: types.identifier,
    name: types.maybe(types.string)
})    
.actions(self => ({
    setName(newName?: string) {
        self.name = newName;
    }
}));

export const SharedModel = types.model("SharedModel", {
    id: types.identifier,
    allItems: types.map(SharedItem)
})
.views(self => ({
    getNextId() {
        let maxId = 0;
        for (const idString of Array.from(self.allItems.keys())){
          const id = parseInt(idString, 10);
          if (id > maxId) maxId = id;
        }
        return maxId + 1;
    }
}))
.actions(self => ({
    addItem(name: string) {
        const newItem = SharedItem.create({
            id: self.getNextId().toString(),
            name
        });

        self.allItems.put(newItem);

        return newItem;
    },
    removeItemById(itemId: string) {
        const nodeToRemove = self.allItems.get(itemId);
        // self.nodes.delete(nodeId);
        destroy(nodeToRemove);
    },
}))
.actions(self => {
    // These actions could be moved to some common code that is used by all shared models
    // trees.
    // These actions are only needed by the SharedModelTree not the shared model view
    const containerAPI = () => getEnv(self).containerAPI as ContainerAPI;

    return {
        // We override the Tree implementation of this action here
        // We might be able to use the Tree implementation, but overriding it
        // keeps things more simple for now.
        applySharedModelSnapshotFromContainer(historyEntryId: string, snapshot: any) {
            // make sure this snapshot is for our shared model and not some other
            // shared model
            if (snapshot.id !== self.id) {
                console.warn("tried to apply shared model snapshot from different tree. " +
                    "The container should be improved to not send these snapshots.", 
                    {selfId: self.id, snapshot});
                return Promise.resolve();
            }
            applySnapshot(self, snapshot);

            // The contract for this action is that it returns an promise that resolves
            // when the changes have been applied.
            return Promise.resolve();
        },

        // Override this from Tree so we can also tell the container to update the
        // views of the shared model in all of the other trees
        applyContainerPatches(historyEntryId: string, patchesToApply: readonly IJsonPatch[]) {
            applyPatch(self, patchesToApply);

            // We need to wait for confirmation that all tiles have updated their shared 
            // models before we continue here.
            // An artificial delay is added here to simulate the problem.
            // 
            // Without the changes in the code to address this, the problem can be shown by:
            // 1. adding a node
            // 2. move the new node to the top of the list
            // 3. delete the node
            // 4. undo the last change.
            // If the shared model is not sent to the tile soon enough, then the tiles delete their
            // copy of the node since it is not yet in the shared model view. This will happen when
            // the updateTreeAfterSharedModelChanges is called by the finishApplyingPatches call.
            // The updateTreeAfterSharedModelChanges deletes nodes because it is trying to keep the 
            // tile's references to these shared models in sync with the shared model.
            // When the shared model is finally sent, this causes updateTreeAfterSharedModelChanges 
            // to run again and now the tile recreates a node/item for this shared item.
            //
            // This has 2 effects:
            // - the internal state associated with the node/item is lost (its position in the list,
            // or position on the diagram)
            // - the undo stack will be broken because there will be changes applied outside of 
            //   applyContainerPatches, so these changes are recorded on the undo stack. So now the next undo 
            //   will not go back in time, but instead just try to undo the mess that was caused
            //   before. From testing messed up undo stack has 3 entries added to the stack:
            //   1. finishApplyingContainerPatches on the diagram with a removal of the node
            //   2. finishApplyingContainerPatches on the list with a a removal of the item
            //   3. a single entry with updateTreeAfterSharedModelChangesInternal actions from the 
            //      diagram and list. Which are adding the node back.
            //   I haven't thought through this deeply, but that list makes sense. It might be worth
            //   reviewing because it is an instance of finishApplyingContainerPatches causing problems
            //   which could happen for other reasons.
            //
            // We return a promise that will resolve when the changes to the shared model have
            // all been applied to the tiles
            // TODO: it seems like there might be a case where the promise chain could get really
            // long. I want to trace this through to see how long this could get.
            return delay(150).then(() => containerAPI().updateSharedModel(historyEntryId, self.id, getSnapshot(self)));
        },
    };
});
