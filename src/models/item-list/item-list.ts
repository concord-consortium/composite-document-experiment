import { applySnapshot, destroy, getSnapshot, Instance, isValidReference, tryReference, types } from "mobx-state-tree";
import { SharedItem, SharedModel } from "../shared-model/shared-model";

export const ItemListItem = types.model("ItemListItem", {
    id: types.identifier,
    sharedItem: types.reference(SharedItem)
})
.views(self => ({
    get name() {
        // It is annoying but it seems like the observers added by components fire
        // before the the onInvalidated is called, so then this derived value is
        // recomputed.
        console.log("itemList.getName");
        const sharedItem = tryReference(() => self.sharedItem);
        return sharedItem ? sharedItem.name : "invalid ref";
        // The user should really never see this invalid ref
    }
}))
.actions(self => ({
    setName(newName?: string) {
        self.sharedItem.name = newName;
    }
}));

export const ItemList = types.model("ItemList", {
    sharedModel: SharedModel,
    allItems: types.array(ItemListItem)
})
.volatile(self => ({
    applyingContainerPatches: false
}))
.views(self => ({
    getNextId() {
        let maxId = 0;
        for (const item of Array.from(self.allItems.values())){
          const id = parseInt(item.id, 10);
          if (id > maxId) maxId = id;
        }
        return maxId + 1;
    }
}))
.actions(self => ({
    addItem(newItem: Instance<typeof ItemListItem>) {
        self.allItems.push(newItem);
    },
    setItems(updatedItems: Instance<typeof ItemListItem>[]) {
        self.allItems.replace(updatedItems);
    },

    // This action should not be called directly, otherwise there might be an item in 
    // the shared model that no longer has a itemListItem in the itemList
    destroyItemById(id: string) {
        const foundItem = self.allItems.find((item) => item.id === id);
        if (!foundItem) {
            return;
        }
        destroy(foundItem);
    },

    // Special action called by the framework when the container sends
    // a new shared model snapshot
    // TODO: move this to a piece of shared code, that adds support for
    // mounting multiple shared models into the tile tree
    applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any) {
        const tileSnapshot = JSON.parse(JSON.stringify(getSnapshot(self)));
        tileSnapshot.sharedModel = snapshot;
        applySnapshot(self, tileSnapshot);
    },

    startApplyingContainerPatches() {
        self.applyingContainerPatches = true;
    },

    finishApplyingContainerPatches() {
        self.applyingContainerPatches = false;
        // FIXME: what container action id should I use here
        this.syncSharedModelWithTileModel("fake containerActionId");
    },

    syncSharedModelWithTileModel(containerActionId: string) {
        // If we are applying container patches, then we ignore any sync actions
        // otherwise the user might make a change such as changing the name of a
        // node while the patches are applied. When they do this the patch for 
        // the shared model might have been applied first, and which if sync is
        // enabled could create a new node in the diagram. Then the patch for the 
        // diagram is applied which also creates a new node in the diagram. 
        // Even if we just disable the sync when the shared model update is done
        // from the patch, if the user makes a change, this would be a separate
        // action would would trigger the sync. So if the user made this change
        // at just the right time it would could result in duplicate nodes in the 
        // diagram.
        if (self.applyingContainerPatches) {
            return;
        }

        // First cleanup any invalid references this can happen when a item is deleted
        self.allItems.forEach(itemListItem => {
            // If the sharedItem is not valid destroy the list item
            // CHECKME: This approach might be too aggressive. If this autorun gets applied while an applySnapshot
            // is in the process of running, then the reference might be invalid briefly while the rest of 
            // the items are loading.
            if (!isValidReference(() => itemListItem.sharedItem)) {
                this.destroyItemById(itemListItem.id);
            }
        });        

        Array.from(self.sharedModel.allItems.values()).forEach(sharedItem => {
            // sync up shared data model items with the tile data of items
            // look for this item in the itemList, if it is not there add it
            const sharedItemId = sharedItem.id;
            
            // the dereferencing of sharedItem should be safe here because we first cleaned up any
            // items that referenced invalid shared items.
            const matchingItem = self.allItems.find(itemListItem => itemListItem.sharedItem.id === sharedItemId);
            if (!matchingItem) {
                const newItem = ItemListItem.create({ id: self.getNextId().toString(), sharedItem: sharedItemId });
                this.addItem(newItem);
            }
        });
    }

}));

