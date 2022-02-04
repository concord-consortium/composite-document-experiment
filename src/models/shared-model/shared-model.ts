import { types, destroy, applySnapshot, IJsonPatch, applyPatch, getSnapshot, getEnv } from "mobx-state-tree";
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
        applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any) {
            // make sure this snapshot is for our shared model and not some other
            // shared model
            if (snapshot.id !== self.id) {
                console.log("tried to apply shared model snapshot from different tree", {selfId: self.id, snapshot});
                return;
            }
            applySnapshot(self, snapshot);
        },

        // Override this from Tree so we can also tell the container to update the
        // views of the shared model in all of the other trees
        applyPatchesFromUndo(patchesToApply: readonly IJsonPatch[]) {
            applyPatch(self, patchesToApply);

            // FIXME: we need to wait for confirmation that all tiles have updated their shared 
            // models before we continue here.
            // An artificial delay is added here to simulate the problem.
            // The problem can be shown by:
            // 1. adding a node
            // 2. move the new node to the top of the list
            // 3. delete th node
            // 4. undo the last change.
            // If the shared model is not sent to the tile soon enough, then the tiles delete their
            // copy of the node since it is not yet in the shared model view. This will happen when
            // the updateTreeAfterSharedModelChanges is called by the finishApplyingPatches call.
            // The updateTreeAfterSharedModelChanges deletes nodes because it is trying to keep the 
            // tile's references to these shared models in sync with the shared model.
            // when the shared model is finally sent, this causes updateTreeAfterSharedModelChanges 
            // to run again and now the tile recreates a node/item for this shared item.
            //
            // This has 2 effects:
            // - the internal state associated with the node/item is lost (its position in the list,
            // or position on the diagram)
            // - the undo stack will be broken because there will be a change applied outside of 
            //   applyPatches, so this change is recorded on the undo stack. So now the next undo 
            //   will not go back in time, but instead just try to undo the mess that was caused
            //   before.
            setTimeout(() => containerAPI().updateSharedModel("fake action id", self.id, getSnapshot(self)), 150);
        },
    };
});
