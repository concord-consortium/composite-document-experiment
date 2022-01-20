import { destroy, getParent, hasParent, Instance, isValidReference, tryReference, types } from "mobx-state-tree";
import { SharedItem, SharedModel } from "../shared-model/shared-model";
import { autorun, IReactionDisposer } from "mobx";

export const ItemListItem = types.model("ItemListItem", {
    id: types.identifier,
    sharedItem: types.reference(SharedItem, {
      onInvalidated(ev) {
        console.log("itemList.onInvalidated");

        const itemListItem = ev.parent;

        if (!hasParent(itemListItem, 2)) {
            // For some reason this happens when a itemListItem is being added.
            // I think it happens because there is a 2 pass process when the item is added
            // first all of the nodes in the snapshot being created are instantiated 
            // then all of the references are hooked up. This onInvalidated hook is called
            // during this first pass
            return;
        }

        // There will be a array between the node and the root
        const itemList = getParent(itemListItem, 2);
        
        // We need to delay when we actually destroy the item referring to the shared item.
        // This is necessary if this invalidation happens during an applySnapshot.  
        // This is because the process of applying the snapshot might continue after this 
        // onInvalidation callback runs and the remaining updates in the snapshot might 
        // recreate the item again.
        // Note: it seems in this case the ev.type is actually "destroy" instead of "snapshot"
        setTimeout(() => {
            // We have to use the `any` here due to the circular reference between parent
            // We can't use the parent type because the parent type uses the child type
            // Technically it should work in this case because they are in the same file.
            // But in most cases the parent and child models will be defined in different
            // files (like DQNode and DQRoot).  Both files can't import each other. 
            (itemList as any).destroyItemById(itemListItem.id);
        });

        // NOTE: it isn't safe to just call destroy on ourselves like
        //    destroy(ev.parent)
        // This is because destroy modifies the parent. And because our tree is 
        // protected all modifications of a MST node have to be performed in actions
        // that are defined on the node being modified or a parent of the node
        // being modified. 
        // In other words actions can only work on self or a child of self.
        // In the case of destroy it is modifying the parent of the node being 
        // destroyed.
      }
    })
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
    }
}))
.actions(self => {
    let autorunDisposer: IReactionDisposer | undefined;

    function afterCreate() {
        // keep our model in sync with the shared model
        // TODO: analyze performance, does this run when the name changes?
        //   We should try to keep it from running this this case. 
        //   The goal is just to keep the references in sync
        autorunDisposer = autorun(() => {
          Array.from(self.sharedModel.allItems.values()).forEach(sharedItem => {
            // sync up shared data model items with the tile data of items
            // look for this item in the itemList, if it is not there add it
            const sharedItemId = sharedItem.id;
            const matchingItem = self.allItems.find(itemListItem => itemListItem.sharedItem.id === sharedItemId);
            if (!matchingItem) {
                const newItem = ItemListItem.create({ id: self.getNextId().toString(), sharedItem: sharedItemId });
                self.addItem(newItem);
            }
          });
      
          // I tried using onInvalidated to clean up the objects making references but this didn't work.
          // onInvalidated didn't always run when snapshots were applied. This might be a bug in MST.
          // So instead we use this approach. This code should run any time either set of items 
          // changes. So far it seems to be working.
          self.allItems.forEach(itemListItem => {
            // If the sharedItem is not valid destroy the list item
            // CHECKME: This approach might be too aggressive. If this autorun gets applied while an applySnapshot
            // is in the process of running, then the reference might be invalid briefly while the rest of 
            // the items are loading.
            if (!isValidReference(() => itemListItem.sharedItem)) {
                self.destroyItemById(itemListItem.id);
            }
          });        
        });
    }

    function beforeDestroy() {
       autorunDisposer?.();
    }

    return {
        afterCreate,
        beforeDestroy
    };
});
