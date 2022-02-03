import { Tree } from "./tree";

export const Tile = Tree.named("Tile")
.actions(self => ({
    // The tile should override this action to update the tile model with 
    // data from the shared model(s)
    // TODO: we should be able to know which shared models have been updated
    // so they could be passed to this action so the tile can optimize what
    // it updates. We might also be able to use some mobx magic to make this
    // function be reactive, so we'll know what properties of the shared models
    // it reacts to.
    // It isn't possible to just use existing MobX autorun because we need 
    // this to run as an action so we can track any changes made with the 
    // same containerActionId that was triggered the changes to the shared model
    updateTreeAfterSharedModelChanges() {
        throw new Error("This action needs to be overridden by the tile");
    },
}));
