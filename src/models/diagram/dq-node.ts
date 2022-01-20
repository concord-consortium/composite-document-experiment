import { types, getParent, hasParent, tryReference } from "mobx-state-tree";
import { Elements } from "react-flow-renderer/nocss";
import { SharedItem } from "../shared-model/shared-model";

export const DQNode = types.model("BasicNode", {
    id: types.identifier,
    sharedItem: types.reference(SharedItem, {
        onInvalidated(ev) {
            const dqNode = ev.parent;

            if (!hasParent(dqNode, 2)) {
                // For some reason this happens when a dqNode is being added.
                // I think it happens because there is a 2 pass process when the node is added
                // first all of the nodes in the snapshot being created are instantiated 
                // then all of the references are hooked up. This onInvalidated hook is called
                // during this first pass
                return;
            }
        
            // There will be a map between the node and the root
            const dqRoot = getParent(dqNode, 2);
            
            // We need to delay when we actually destroy the node referring to the shared item.
            // This is necessary if this invalidation happens during an applySnapshot.  
            // This is because the process of applying the snapshot might continue after this 
            // onInvalidation callback runs and the remaining updates in the snapshot might 
            // recreate the node again.
            // Note: it seems in this case the ev.type is actually "destroy" instead of "snapshot"
            setTimeout(() => {

                // due to the circular reference here it doesn't seem like we can import
                // the DQRoot type and use getParentOfType. It might work if we use types.late
                // though.
                (dqRoot as any).destroyNodeById(dqNode.id);
            });

            // NOTE: it isn't safe to just call destroy on ourselves like
            //    destroy(ev.parent)
            // This is because destroy modifies the parent. And because our tree is 
            // protected all modifications of a MST node have to be performed in actions
            // that are part of the the node itself or a parent of the node. In
            // other words actions can only work on self or a child of self.
            // In the case of destroy we are modifying a parent so this is not an
            // allowed modification when done in an action of node being destroyed
        }
    }),
    
    // The x and y values are required when initializing the react flow
    // component. However the react flow component ignores them after this.
    // To serialize the state the positions need to be extracted from the react flow
    // and then applied to the models.
    x: types.integer,
    y: types.integer
})
    .views(self => ({
        get reactFlowElements() {
            const elements: Elements = [];
            const {id} = self;
            elements.push({
                id,
                type: "quantityNode", 
                data: { node:  self },
                position: { x: self.x, y: self.y },                
            });

            return elements;
        },
        get name() {
            const sharedItem = tryReference(() => self.sharedItem);
            return sharedItem ? sharedItem.name : "invalid ref";
            // The user should really never see this invalid ref
        }
    }))
    .actions(self => ({
        setName(newName?: string) {
            self.sharedItem.setName(newName);
        },
    }));
