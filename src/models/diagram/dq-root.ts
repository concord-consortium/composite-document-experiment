import { types, destroy, isValidReference, getSnapshot, applySnapshot, IJsonPatch, applyPatch } from "mobx-state-tree";
import { Elements } from "react-flow-renderer/nocss";
import { SharedModel } from "../shared-model/shared-model";
import { DQNode } from "./dq-node";

export const DQRoot = types.model("DQRoot", {
    nodes: types.map(DQNode),
    sharedModel: SharedModel
})
.volatile(self => ({
    applyingContainerPatches: false
}))
.views(self => ({
    get reactFlowElements() {
        const elements: Elements = [];
        self.nodes.forEach((node) => {
            elements.push(...node.reactFlowElements);
        });
        return elements;
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

    // Special action called by the framework when the container sends
    // a new shared model snapshot
    // TODO: move this to a piece of shared code, that adds support for
    // mounting multiple shared models into the tile tree
    applySharedModelSnapshotFromContainer(containerActionId: string, snapshot: any) {
        const tileSnapshot = JSON.parse(JSON.stringify(getSnapshot(self)));
        tileSnapshot.sharedModel = snapshot;
        applySnapshot(self, tileSnapshot);
    },

    applyPatchesFromUndo(patchesToApply: readonly IJsonPatch[]) {
        applyPatch(self, patchesToApply);
    },

    startApplyingContainerPatches() {
        self.applyingContainerPatches = true;
    },

    finishApplyingContainerPatches() {
        self.applyingContainerPatches = false;
        // FIXME: what container action id should I use here?
        // If all of the patches applied with no intermediate changes
        // there should be nothing to sync, so this action id would not show
        // up anywhere
        // If the user made a change in the shared model like deleting
        // a node while the patches were applied this would be out of sync
        // So that deleted no change would get applied here.
        // We could try to record the action id of any intermediate actions
        // but if multiple actions happened all of their changes would get 
        // merged together.
        // I guess the best thing we could do is:
        // - merge any actions that happened during the patch application into
        //   a single action. So basically combine their patches.
        // - use the id of that combined action here.
        // If there were no intermediate actions, what should we do?
        // - use a new UUID: it is most likely that no changes will be done 
        //   by the sync. But just incase there are some we can give it an 
        //   a valid ID. It almost would be better to throw an error here 
        //   so we could track down the problem. Recording a new change would
        //   basically break the undo stack. 
        //   TODO: find a way to at least log to the console that this error
        //   condition happened.
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

        // First clean up any nodes that reference invalid (removed) shared items.
        // See notes.md for while using onInvalidated didn't work for doing this
        self.nodes.forEach(node => {
            // If the sharedItem is not valid destroy the list item
            // CHECKME: This approach might be too aggressive. If the sync is run 
            // while an applySnapshot is in the process of running, 
            // then the reference might be invalid briefly while the rest of 
            // the items are loading.
            if (!isValidReference(() => node.sharedItem)) {
                // `this` is used so we can reference actions defined in the same block
                this.destroyNodeById(node.id);
            }
        });        

        // Second add new nodes for any new shared items.
        Array.from(self.sharedModel.allItems.values()).forEach(sharedItem => {
            const sharedItemId = sharedItem.id;
            const nodeArray = Array.from(self.nodes.values());
        
            // We cleaned up any nodes with invalid sharedItem references first so 
            // calling `node.sharedItem.id` should be safe
            const matchingItem = nodeArray.find(node => node.sharedItem.id === sharedItemId);
            if (!matchingItem) {
                // CHECKME: just like deletion, if this sync is run during a time
                // when tile model hasn't been fully loaded yet, new nodes might be
                // added that are already present in the diagram state that just hasn't
                // been loaded yet.
                const newNode = DQNode.create({ 
                    id: self.getNextId().toString(), 
                    sharedItem: sharedItemId,
                    x: 100,
                    y: 100
                });
                self.nodes.put(newNode);
            }
        });      
    }
}));

