import { destroy, getParent, hasParent, Instance, types } from "mobx-state-tree";
import { SharedItem, SharedModel } from "../shared-model/shared-model";
import { autorun, IReactionDisposer } from "mobx";

export const ItemListItem = types.model("ItemListItem", {
    id: types.identifier,
    sharedItem: types.reference(SharedItem, {
      onInvalidated(ev) {
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
        
        // due to the circular reference here between parent and child, if the two were
        // defined in different files (like DQNode and DQRoot), then we can't refer to 
        // the parent from the child. So the approach below is consistent with what DQNode
        // does.
        (itemList as any).destroyItemById(itemListItem.id);

        // NOTE: it isn't safe to just call destroy on ourselves like
        //    destroy(ev.parent)
        // This is because destroy modifies the parent. And because our tree is 
        // protected all modifications of a MST node have to be performed in actions
        // that are part of the the node itself or a parent of the node. In
        // other words actions can only work on self or a child of self.
        // In the case of destroy we are modifying a parent so this is not an
        // allowed modification when done in an action of node being destroyed
      }
    })
})
.views(self => ({
    get name() {
        return self.sharedItem.name;
    }
}))
.actions(self => ({
    setName(newName?: string) {
        self.sharedItem.name = newName;
    }
}));

export const ItemList = types.model("ItemList", {
    sharedModel: types.reference(SharedModel),
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
          Array.from(self.sharedModel.allItems.values()).forEach(item => {
            // sync up shared data model items with the tile data of items
            // look for this item in the itemList, if it is not there add it
            const matchingItem = self.allItems.find(itemListItem => itemListItem.sharedItem.id === item.id);
            if (!matchingItem) {
                const newItem = ItemListItem.create({ id: self.getNextId().toString(), sharedItem: item.id });
                self.addItem(newItem);
            }
          });
      
          // When an item is deleted from the shared data model the onInvalidated callback of the item
          // reference is called. So this should clean up the the related itemListItem
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
