import { Instance, types, destroy, getSnapshot } from "mobx-state-tree";
import { Elements, isNode, OnLoadParams } from "react-flow-renderer/nocss";
import { DQNode } from "./dq-node";

export const DQRoot = types.model("DQRoot", {
    nodes: types.map(DQNode)
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
    removeNodeById(nodeId: string) {
        const nodeToRemove = self.nodes.get(nodeId);
        // self.nodes.delete(nodeId);
        destroy(nodeToRemove);
    },
    setRfInstance(rfInstance: OnLoadParams) {
        self.rfInstance = rfInstance;
    }
}));
