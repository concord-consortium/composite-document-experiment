import { types, destroy } from "mobx-state-tree";

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
    }
}));
