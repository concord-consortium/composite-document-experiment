import { Instance, types } from "mobx-state-tree";
import { Item } from "../items/items";

export const ItemListItem = types.model("ItemListItem", {
    id: types.identifier,
    item: types.reference(Item)
})
.views(self => ({
    get name() {
        return self.item.name;
    }
}))
.actions(self => ({
    setName(newName?: string) {
        self.item.name = newName;
    }
}));

export const ItemList = types.model("ItemList", {
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
    }
}));
