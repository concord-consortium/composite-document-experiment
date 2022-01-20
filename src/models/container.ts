// This will keep the documents in sync

import { applySnapshot, getSnapshot, onAction } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";

export const Container = ({initialDiagram, initialItemList, initialSharedModel}: any) => {
  
  const diagram = DQRoot.create(initialDiagram);
  const list = ItemList.create(initialItemList);
  const sharedModel = SharedModel.create(initialSharedModel);

  // One way to avoid the infinite loop is using a shared variable between all of
  // these snapshot functions. 
  // However that will only if the applySnapshot runs the onSnapshot before it exits
  // that isn't guarunteed.

  // Another way would be to include some kind of "last updated by" field in the shared
  // model. Then if it is not ourselves we ignore the event. 
  // But how do we update "last updated by" we'd need to be able to know the difference
  // between a snapshot created by applySnapshot and one created by an action

  // Because the tree is protected we can try to use onAction instead of onSnapshot
  // I'd assume that onSnapshot will not get called when applySnapshot is used.
  // Unless applySnapshot can only be called in an action too. :)
  // 
  // If onAction doesn't work, then I think we'd either need to switch to patches
  // or use MobX reactions directly.

  const tiles = {diagram, list};

  const applyAndRepeatSnapshot = (source: any, snapshot: any) => {
    // In this case the shared model doesn't have any logic or direct actions
    // It is just a place to hold the shared data
    // So we can just apply the snapshot and then send it onto the other
    // tiles
    applySnapshot(sharedModel, snapshot);
    for (const tile of Object.entries(tiles)) {
        if (tile[1] === source) continue;

        console.log(`repeating changes to ${tile[0]}`, snapshot);

        // In an iframe case this would be sending a message over postMessage

        // FIXME: It seems like applying a snapshot does not then cause
        // the onInvalidated to fire on the references.
        // 
        // So in this case the tile's
        // internal objects would continue to reference the shared model
        // We could have a new method on tiles which would search the tree for
        // invalid references to the shared model and destroy them after this
        // snapshot is applied. But that is a kind of annoying given that MST
        // should know about these references already.
        //
        // With the current code I don't understand why it doesn't fail sooner.
        // When the snapshot is applied during a test in the mobx code it throws
        // a error as soon as the snapshot is applied with an invalid reference
        // this makes sense, snapshots ought to be consistent.
        //
        // Perhaps this error is being swallowed
        //
        // So now the question is still how to handle this...
        //
        // This seems important: https://github.com/mobxjs/mobx-state-tree/blob/f297ae28159a9c3b276ed5052021f642d74ca919/packages/mobx-state-tree/__tests__/core/reference-custom.test.ts#L154
        //
        // There are 2 cases here:
        // - shared model changes so if an item has been deleted then things referencing it should
        //   be deleted from the tile model
        // - shared model is loaded after tile model, in this case things referencing it need to
        //   be able to handle being invalid until it is loaded. 
        //
        // A possible issue is that once the tile model is loaded in some cases when a snapshot
        // is applied which removes a item being referenced, then MST throws an error. 
        // It isn't clear yet if I can intercept this in some way so we can apply snapshots with
        // invalid references.  
        // I haven't tested if it is possible to create objects using snapshots with invalid references.
        // I'd think at least in that case the reference get method can be overriden to handle this,
        // but I haven't tested it yet.
        //
        // With more testing, I found out that when a snapshot is applied the onInvalidated is called
        // (at least in some cases), and the reason passed in is a "destroy".
        // However, the code in the onInvalidated doesn't seem to work. My guess is that it makes a change
        // to the parent, but then the applySnapshot keeps going and then updates the object that was
        // just changed. This code is running in an action already, so it seems actions run immediately.
        // We could try putting this code in a setImmediate Perhaps this can be solved by calling an action from onInvalidated instead of
        // making the change directly.
        //
        // I added a delay to the onInvalidate, but that didn't work
        // It does work in the jest tests.
        // In our case it seems like onInvalidate is not being called at all when the snapshot is
        // applied. This might be, because the change to the reference happens before the thing it
        // is referencing is cleaned up.
        // 
        // What we switched to instead was to use the same watching mechansim used to add new items
        // to also delete invalid items. This doesn't seem as clean, but given the issues with 
        // onInvalidate it seems like the best option. 
        const tileSnapshot = JSON.parse(JSON.stringify(getSnapshot(tile[1])));
        tileSnapshot.sharedModel = snapshot;
        console.log("applying snapshot", tileSnapshot);
        applySnapshot(tile[1], tileSnapshot);
    }
  };

  // I'm hoping that applying a snapshot by the code above doesn't count
  // as an action. So this won't fire when the applySnapshot is called
  // by applyAndRepeatSnapshot
  onAction(diagram, (call) => {
    // This onAction has to be added to the root diagram 
    // because only top level actions fire. Any actions called by the initial
    // action are ignored and treated as part of the first action.  
    // And currently the UI always calls actions at the top level 
    // 
    // So the current approach is un-optimized. It means that changes to the
    // diagram which don't change the shared model will trigger shared model
    // synchronization.
    //
    // A solution is for the tile to maintain the shared Model
    // in its own tree. But that means that references can't be used.
    // So far the benefit of references has been the automated delete
    // We should also be benefiting from more easy object construction so
    // that a direct object can be used as the value and the MST constructor
    // would convert that to an id in the tree automatically
    //
    // Another solution would be if we could somehow tell if the general
    // action changed the sharedModel or not and only sync it in those cases.
    // 
    // Another possibility is using a middleware which would capture the sub
    // actions too.
    const snapshot = getSnapshot(diagram.sharedModel);
    // send the snapshot to the shared model but in this case
    // we just apply it
    applyAndRepeatSnapshot(diagram, snapshot);
  }, true);

  // I'm hoping that applying a snapshot by the code above doesn't count
  // as an action. So this won't fire when the applySnapshot is called
  // by applyAndRepeatSnapshot
  onAction(list, (call) => {
    const snapshot = getSnapshot(list.sharedModel);
    // update the shared model but we need to avoid the infinite loop
    applyAndRepeatSnapshot(list, snapshot);
  }, true);


  return {diagram, list, sharedModel};
};
