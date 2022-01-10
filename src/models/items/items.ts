import { Instance, types, destroy } from "mobx-state-tree";

export const Item = types.model("Item", {
    id: types.identifier,
    name: types.maybe(types.string)
})    
.actions(self => ({
    setName(newName?: string) {
        self.name = newName;
    }
}));


export const Items = types.model("Items", {
    items: types.map(Item)
})
.views(self => ({
    getNextId() {
        let maxId = 0;
        for (const idString of Array.from(self.items.keys())){
          const id = parseInt(idString, 10);
          if (id > maxId) maxId = id;
        }
        return maxId + 1;
    }
}))
.actions(self => ({
    addItem(newItem: Instance<typeof Item>) {
        self.items.put(newItem);
    },
    removeItemById(itemId: string) {
        const nodeToRemove = self.items.get(itemId);
        // self.nodes.delete(nodeId);
        destroy(nodeToRemove);
    }
}));
