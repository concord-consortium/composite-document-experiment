import { types } from "mobx-state-tree";
import { Elements } from "react-flow-renderer/nocss";

export const DQNode = types.model("BasicNode", {
    id: types.identifier,
    name: types.maybe(types.string),
    
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
    }))
    .actions(self => ({
        setName(newName?: string) {
            self.name = newName;
        },
    }));
