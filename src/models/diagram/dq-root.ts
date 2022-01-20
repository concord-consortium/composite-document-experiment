import { types, getSnapshot, destroy, isValidReference } from "mobx-state-tree";
import { autorun, IReactionDisposer } from "mobx";
import { Elements, isNode, OnLoadParams } from "react-flow-renderer/nocss";
import { SharedModel } from "../shared-model/shared-model";
import { DQNode } from "./dq-node";

export const DQRoot = types.model("DQRoot", {
    nodes: types.map(DQNode),
    sharedModel: SharedModel
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
    addNode({name, position}: {name: string, position: {x: number, y: number}}) {
        // The diagram is syncing with the shared model so
        // we could stop here, but we wouldn't know what position to put
        // the item in.
        console.log("addNode action");
        const sharedItem = self.sharedModel.addItem(name);
    
        const dqNode = DQNode.create({
            id: self.getNextId().toString(),
            sharedItem: sharedItem.id,
            x: position.x,
            y: position.y   
        });

        self.nodes.put(dqNode);
    },

    // This triggers a chain reaction which eventually removes the node:
    //   1. remove item from shared model
    //   2. this triggers the onInvalidated handler in the DQNode reference to the sharedItem
    //   3. DQNode finds its DQRoot (this) and calls destroyNodeById
    //
    // If another tile removes the item from the shared model,
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

        self.sharedModel.removeItemById(nodeToRemove.sharedItem.id);
    },

    // This action should not be called directly, otherwise there might be a item in 
    // the shared model that no longer has a node in the diagram
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
            const matchingItem = Array.from(self.nodes.values()).find(node => node.sharedItem.id === sharedItemId);
            if (!matchingItem) {
                const newNode = DQNode.create({ 
                    id: self.getNextId().toString(), 
                    sharedItem: sharedItemId,
                    x: 100,
                    y: 100
                });
                self.nodes.put(newNode);
            }
          });
      
          // I tried using onInvalidated to clean up the objects making references but this didn't work.
          // onInvalidated didn't always run when snapshots were applied. This might be a bug in MST.
          // So instead we use this approach. This code should run any time either set of items 
          // changes. So far it seems to be working.
          self.nodes.forEach(node => {
            // If the sharedItem is not valid destroy the list item
            // CHECKME: This approach might be too aggressive. If this autorun gets applied while an applySnapshot
            // is in the process of running, then the reference might be invalid briefly while the rest of 
            // the items are loading.
            if (!isValidReference(() => node.sharedItem)) {
                self.destroyNodeById(node.id);
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
