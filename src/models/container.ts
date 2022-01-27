// This model keeps the documents in sync

import { applySnapshot, getSnapshot, onAction } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";
import { createUndoRecorder } from "./undo-manager/undo-manager";

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
    console.log("Diagram Action", entry);
  }, false, /\/sharedModel\/.*/);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const listRecorder = createUndoRecorder(list, (entry) => {
    console.log("List Action", entry);
  }, false, /\/sharedModel\/.*/);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sharedModelRecorder = createUndoRecorder(sharedModel, (entry) => {
    console.log("Shared Model Action", entry);
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

        const tileSnapshot = JSON.parse(JSON.stringify(getSnapshot(tile[1])));
        tileSnapshot.sharedModel = snapshot;
        console.log("applying snapshot", tileSnapshot);
        applySnapshot(tile[1], tileSnapshot);
    }
  };

  /**
   * onAction is used in an attempt to avoid infinite loops. It seems that
   * the applySnapshot above does not trigger an onAction event.
   * 
   * This onAction has to be added to the root diagram because only top 
   * level actions fire this event. Any actions called by the initial
   * action are ignored and treated as part of the first action.  
   * The UI of our tiles always call actions at the top level such as
   * DQRoot or ItemList.
   * 
   * Because of this the current approach is un-optimized. It means that 
   * changes to the diagram which don't change the shared model will trigger 
   * shared model synchronization.
   * 
   * A solution is for the tile to maintain the shared Model
   * in its own tree. But that means that references can't be used.
   *
   * Another possibility is using a middleware which could capture just 
   * actions on the shared model. However a developer might use a top
   * level action to modify the shared model directly, so we'd miss this
   * change. 
   * 
   * It seems the best approach is to use onSnapshot instead and then we
   * deal with the infinite loop problem by tracking the last state we
   * sent. 
   */
  onAction(diagram, (call) => {
    const snapshot = getSnapshot(diagram.sharedModel);
    sendSnapshotToSharedModel(diagram, snapshot);
  }, true);

  onAction(list, (call) => {
    const snapshot = getSnapshot(list.sharedModel);
    sendSnapshotToSharedModel(list, snapshot);
  }, true);


  return {diagram, list, sharedModel};
};
