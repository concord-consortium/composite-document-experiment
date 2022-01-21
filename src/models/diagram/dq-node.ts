import { types, tryReference } from "mobx-state-tree";
import { Elements } from "react-flow-renderer/nocss";
import { SharedItem } from "../shared-model/shared-model";

export const DQNode = types.model("BasicNode", {
    id: types.identifier,
    sharedItem: types.reference(SharedItem),
    
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
