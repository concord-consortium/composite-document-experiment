// This model keeps the documents in sync

import { applySnapshot, getSnapshot } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";
import { createUndoRecorder } from "./undo-manager/undo-recorder";

export const Container = ({initialDiagram, initialItemList, initialSharedModel}: any) => {
  
  const diagram = DQRoot.create(initialDiagram);
  const list = ItemList.create(initialItemList);
  const sharedModel = SharedModel.create(initialSharedModel);

  // const diagramUndoManager = UndoManager.create(undefined, {
  //   // for now we are monitoring the whole diagram tree
  //   targetStore: diagram,
  //   // Filter out patches that are modifying the shared model 
  //   // Having the sharedModel embedded in the tree will also be an issue with any serialization. 
  //   // If we use onSnapshot to serialize it will pick up the shared model.
  //   // Maybe we can put the shared model as a sibling of the main tile model.
  //   // However, this would mean the actions could not modify the shared model directly.
  //   // But it is already the case that we are using actions on the shared model to modify it.
  //   // So another approach would be to wrap all actions on the shared model so they
  //   // disable undo. This would make it harder to write new shared models though.
  //   excludePath: /\/sharedModel\/.*/
  // });

  // right now we aren't doing anything with this, but a tile would use this
  // diagramRecorder instance if it wanted to avoid recording some actions 

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const diagramRecorder = createUndoRecorder(diagram, (entry) => {
    console.log("Undoable Diagram Action", entry);
  }, false, { 
    // This is a list of shared models key'd based on where they are mounted
    // in the tree. The function is run whenever there are changes within 
    // this path. The function should only run after all changes have been
    // made to the tree.
    "/sharedModel/": (containerActionId, call) => {
      // Note: the environment of the call will be undefined because the undoRecorder cleared 
      // it out before it calling this function
      console.log("captured diagram sharedModel changes in containerActionId, action:", containerActionId, call);

      // What is tricky is that this is being called when the snapshot is applied by the
      // sharedModel syncing code "sendSnapshotToSharedMode". In that case we want to do
      // the internal shared model sync, but we don't want to resend the snapshot to the 
      // shared model. So the current approach is to look for the specific action that
      // is applying this snapshot to the tile tree. 
      if (call.name !== "applySharedModelSnapshotFromContainer") {

        // TODO: figure out if we should be recording this special action in the undo
        // stack
        const snapshot = getSnapshot(diagram.sharedModel);      
        sendSnapshotToSharedModel(diagram, snapshot);
      }
      
      // sync the updates that were just applied to the shared model
      // TODO: figure out how undo will be handled here.  We are calling an action
      // from a middleware that just finished the action. Will it start a new top
      // level action? Will it be allowed? Will it cause a inifite loop?
      // what about other middleware that might be added to tree will this approach
      // break that?
      // Because of all these questions it might be better to run this sync in
      // a setTimeout callback so it is part of a different stack, and in that case
      // we would pass in the containerActionId.
      // In theory it shouldn't cause a loop because the synSharedModelWithTileModel
      // shouldn't modify the sharedModel, so it shouldn't come back to this 
      // callback.
      diagram.syncSharedModelWithTileModel();
    } 
  } );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const listRecorder = createUndoRecorder(list, (entry) => {
    console.log("Undoable List Action", entry);
  }, false, { 
    "/sharedModel/": (containerActionId, call) => { 
      // Note: the environment of the call will be undefined because the undoRecorder cleared 
      // it out before it calling this function
      console.log("captured list sharedModel changes in containerActionId, action:", containerActionId, call);
          
      if (call.name !== "applySharedModelSnapshotFromContainer") {
        const snapshot = getSnapshot(list.sharedModel);      
        sendSnapshotToSharedModel(list, snapshot);
      }

      // sync updates that were just applied to the shared model
      // TODO: see the comment in diagram code above for concerns for this
      list.syncSharedModelWithTileModel();
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sharedModelRecorder = createUndoRecorder(sharedModel, (entry) => {
    console.log("Undoable Shared Model Action", entry);
  }, false, undefined);

  /*
    The container takes a simple approach right now. It acts as a repeater of messages
    sent by each tile. The message includes the tile's state of shared model. The
    container only sends the message to the tiles that didn't send the message.

    Right now the container is the one watching the tile trees with `onAction`
    In a real scenario where the tiles are managing their own trees (sometimes in
    an iframe) the tile would watch its own tree. See the first
    onAction handler for more details about this.

    This repeater approach avoids the simple infinite loop. However if there is a delay 
    in the message passing then it can result some strange cases. Also if a tile
    updated the shared model in response to a change made by a different tile 
    there still could be an infinite loop. A simple example are tiles that are 
    sharing numbers represented by strings. Perhaps one tile wants to always have
    1 digit of precision "1.0" and the other wants "1.00". Whenever the number changes
    the two tiles will just keep updating the same number again and again. 
    I don't think there is much we can do to prevent this. But perhaps we could 
    add some kind of loop detection code.

    This approach also doesn't support shared models that have their own logic or 
    reactions. I do not have a use case yet where the shared model needs it own
    logic. An example would be a shared model that wants to keep its items sorted,
    but that doesn't seem like a good case.

    If we do have a good use case, this seems possible to handle, but it adds 
    complexity. The shared model might need to send state back to the tile. So
    to avoid the infinite loop problem both the shared model and the tile should
    keep track of the last state they received and not resend if it matches. This
    could be done with a hash to save memory. But if we want to also reduce the
    amount of data shipped around a full copy is useful so then we can just send
    diffs. 

    Before we add that complexity we should see if there is a use case where the 
    shared model needs to make its own changes. 
    
    Another version of this is if we want to support two tiles changing the state
    at the same time. In this case we might need to send state back to the tile
    immediately after the tile sent state because another tile modified it
    while it was in transit. But again we don't have a good use case for this.
  */

  const tiles = {diagram, list};

  const sendSnapshotToSharedModel = (source: any, snapshot: any) => {
    applySnapshot(sharedModel, snapshot);
    for (const tile of Object.entries(tiles)) {
        if (tile[1] === source) continue;

        console.log(`repeating changes to ${tile[0]}`, snapshot);

        tile[1].applySharedModelSnapshotFromContainer(snapshot);
    }
  };

  return {diagram, list, sharedModel};
};
