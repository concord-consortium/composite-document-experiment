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

            containerAPI().updateSharedModel("fake action id", self.id, getSnapshot(self));
        },
    };
});
