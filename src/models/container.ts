// This model keeps the documents in sync

import { getSnapshot, IJsonPatch, Instance } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";
import { createUndoRecorder } from "./undo-manager/undo-recorder";
import { TileUndoEntry, UndoStore } from "./undo-manager/undo-store";

export const Container = ({initialDiagram, initialItemList, initialSharedModel}: any) => {
  
  const diagram = DQRoot.create(initialDiagram);
  const list = ItemList.create(initialItemList);
  const sharedModel = SharedModel.create(initialSharedModel);

  // TODO use patterns added to CLUE so we can refer to a single MST model type for all
  // of the components
  const components: Record<string, Instance<typeof DQRoot> | Instance<typeof ItemList> | Instance<typeof SharedModel>>
    = {diagram, list, sharedModel};
  const sendPatchesToTileOrShared = (tileId: string, patchesToApply: readonly IJsonPatch[]) => {
    const component = components[tileId];
    // If this was an iframe we'd send it as a message
    component.applyPatchesFromUndo(patchesToApply);

    // FIXME: We are manually syncing the shared model here with the tiles
    // it'd be better if we could just apply the patch and the system would repeat it to the 
    // tiles. 
    if (component === sharedModel) {
      sendSharedModelSnapshotToTiles("fake action id", null, getSnapshot(sharedModel));
    }
  };

  // TODO: improve this, it crosses many boundaries
  const startApplyingContainerPatches = (tileId: string, value: boolean) => {
    // skip sharedModels because they don't sync with other shared models
    if (tileId === "sharedModel") {
      return;
    }
    const component = components[tileId];

    (component as any).startApplyingContainerPatches();
  };

  // TODO: improve this, it crosses many boundaries
  const finishApplyingContainerPatches = (tileId: string, value: boolean) => {
    // skip sharedModels because they don't sync with other shared models
    if (tileId === "sharedModel") {
      return;
    }
    const component = components[tileId];

    (component as any).finishApplyingContainerPatches();
  };

  const undoStore = UndoStore.create({}, {
    sendPatchesToTileOrShared,
    startApplyingContainerPatches,
    finishApplyingContainerPatches
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const diagramRecorder = createUndoRecorder(diagram, (entry) => {
    console.log("Undoable Diagram Action", entry);
    undoStore.addUndoEntry(entry.containerActionId, 
       TileUndoEntry.create({
         tileId: "diagram", 
         actionName: entry.actionName, 
         patches: entry.patches, 
         inversePatches: entry.inversePatches})
    );
  }, false, { 
    // This is a list of shared models key'd based on where they are mounted
    // in the tree. The function is run whenever there are changes within 
    // this path. The function should only run after all changes have been
    // made to the tree.
    "/sharedModel/": (containerActionId, call) => {
      // Note: the environment of the call will be undefined because the undoRecorder cleared 
      // it out before it calling this function
      console.log("captured diagram sharedModel changes", {containerActionId, action: call});

      // What is tricky is that this is being called when the snapshot is applied by the
      // sharedModel syncing code "sendSnapshotToSharedMode". In that case we want to do
      // the internal shared model sync, but we don't want to resend the snapshot to the 
      // shared model. So the current approach is to look for the specific action that
      // is applying this snapshot to the tile tree. 
      if (call.name !== "applySharedModelSnapshotFromContainer") {

        // TODO: figure out if we should be recording this special action in the undo
        // stack
        const snapshot = getSnapshot(diagram.sharedModel);      
        sendSnapshotToSharedModel(containerActionId, diagram, snapshot);
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
      diagram.syncSharedModelWithTileModel(containerActionId);
    } 
  } );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const listRecorder = createUndoRecorder(list, (entry) => {
    console.log("Undoable List Action", entry);
    undoStore.addUndoEntry(entry.containerActionId, 
      TileUndoEntry.create({
        tileId: "list", 
        actionName: entry.actionName, 
        patches: entry.patches, 
        inversePatches: entry.inversePatches})
    );

  }, false, { 
    "/sharedModel/": (containerActionId, call) => { 
      // Note: the environment of the call will be undefined because the undoRecorder cleared 
      // it out before it calling this function
      console.log("captured list sharedModel changes", {containerActionId, action: call});
          
      if (call.name !== "applySharedModelSnapshotFromContainer") {
        const snapshot = getSnapshot(list.sharedModel);      
        sendSnapshotToSharedModel(containerActionId, list, snapshot);
      }

      // sync updates that were just applied to the shared model
      // TODO: see the comment in diagram code above for concerns for this
      list.syncSharedModelWithTileModel(containerActionId);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const sharedModelRecorder = createUndoRecorder(sharedModel, (entry) => {
    console.log("Undoable Shared Model Action", entry);
    undoStore.addUndoEntry(entry.containerActionId, 
      TileUndoEntry.create({
        tileId: "sharedModel", 
        actionName: entry.actionName, 
        patches: entry.patches, 
        inversePatches: entry.inversePatches})
    );

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

  const sendSnapshotToSharedModel = (containerActionId: string, source: any, snapshot: any) => {
    sharedModel.applySnapshotFromTile(containerActionId, snapshot);
    sendSharedModelSnapshotToTiles(containerActionId, source, snapshot);
  };

  const sendSharedModelSnapshotToTiles = (containerActionId: string, source: any, snapshot: any, syncAfterApplying = true) => {
    for (const tile of Object.entries(tiles)) {
      if (tile[1] === source) continue;

      console.log(`repeating changes to ${tile[0]}`, snapshot);

      tile[1].applySharedModelSnapshotFromContainer(containerActionId, snapshot);
    }
  };

  return {diagram, list, sharedModel, undoStore};
};
