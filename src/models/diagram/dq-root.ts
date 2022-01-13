import { Instance, types, getSnapshot, destroy } from "mobx-state-tree";
import { Elements, isNode, OnLoadParams } from "react-flow-renderer/nocss";
import { Items } from "../items/items";
import { DQNode } from "./dq-node";

export const DQRoot = types.model("DQRoot", {
    nodes: types.map(DQNode),
    items: types.reference(Items)
})
.volatile(self => ({
    rfInstance: undefined as OnLoadParams | undefined
}))
.views(self => ({
    get reactFlowElements() {
        const elements: Elements = [];
        self.nodes.forEach((node) => {
            elements.push(...node.reactFlowElements);
        });
        return elements;
    },
    // NOTE: these are not reactive, so components accessing them won't be re-rendered
    // automatically if the value changes
    getDiagramState() {
        const currentSnapshot = getSnapshot(self);
        const currentModel = JSON.parse(JSON.stringify(currentSnapshot));
        const currentDiagram = self.rfInstance?.toObject();
        if (!currentDiagram) {
          return;
        }
        for(const node of currentDiagram.elements) {
          if (isNode(node)) {
            const modelNode = currentModel.nodes[node.id];
            modelNode.x = node.position.x;
            modelNode.y = node.position.y;
          }
        }
        console.log("Exported Diagram", currentModel);
        return currentModel;
    },
    
    getNextId() {
        let maxId = 0;
        for (const idString of Array.from(self.nodes.keys())){
          const id = parseInt(idString, 10);
          if (id > maxId) maxId = id;
        }
        return maxId + 1;
    }
}))
.actions(self => ({
    addNode(newNode: Instance<typeof DQNode>) {
        self.nodes.put(newNode);
    },

    // This triggers a chain reaction which eventually removes the node:
    //   1. remove item from items shared data model
    //   2. this triggers the onInvalidated handler in the DQNode reference to the item
    //   3. DQNode finds its DQRoot (this) and calls destroyNodeById
    //
    // If another tile removes the item from the shared data model,
    // the first step is skipped (this action) and the last 2 steps work the same.
    // 
    // FIXME: a warning is printed here because the QuantityNode component is observing
    // the node.name derived value. This component is not removed immediately, so the mobx
    // observer code runs to see if this derived value has changed. Running this means that
    // derived function is run which tries to use the destroyed node. 
    removeNodeById(nodeId: string) {
        const nodeToRemove = self.nodes.get(nodeId);
        if (!nodeToRemove) {
            return;
        }

        self.items.removeItemById(nodeToRemove.item.id);
    },

    // This action should not be called directly, otherwise there might be a item in 
    // the items shared data model that no longer has a node in the diagram
    destroyNodeById(nodeId: string) {
        const nodeToRemove = self.nodes.get(nodeId);
        if (!nodeToRemove) {
            return;
        }
        destroy(nodeToRemove);
    },
    setRfInstance(rfInstance: OnLoadParams) {
        self.rfInstance = rfInstance;
    }
}));
