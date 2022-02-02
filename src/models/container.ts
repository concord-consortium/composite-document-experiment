// This model keeps the documents in sync

import { getSnapshot, IJsonPatch, Instance } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";
import { ContainerAPI } from "./tile";
import { createUndoRecorder } from "./undo-manager/undo-recorder";
import { TileUndoEntry, UndoStore } from "./undo-manager/undo-store";

export const Container = ({initialDiagram, initialItemList, initialSharedModel}: any) => {
  
  const sendPatchesToTileOrShared = (tileId: string, patchesToApply: readonly IJsonPatch[]) => {
    const component = components[tileId];
    // If this was an iframe we'd send it as a message
    component.applyPatchesFromUndo(patchesToApply);

    // TODO: We are manually syncing the shared model here with the tiles
    // it'd be better if we could just apply the patch and the system would repeat it to the 
    // tiles. 
    if (component === sharedModel) {
      sendSharedModelSnapshotToTiles("fake action id", "", getSnapshot(sharedModel));
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

  const sendSnapshotToSharedModel = (containerActionId: string, tileId: string, snapshot: any) => {
    // FIXME: the container should have a registry of sharedModels based on id
    // the snapshot that is being sent should include an id that can be used to look up 
    // the shared model
    sharedModel.applySnapshotFromTile(containerActionId, snapshot);
    sendSharedModelSnapshotToTiles(containerActionId, tileId, snapshot);
  };

  const containerAPI: ContainerAPI = {
    sendSnapshotToSharedModel
  };

  const diagram = DQRoot.create(initialDiagram, {undoStore, containerAPI});
  const itemList = ItemList.create(initialItemList, {undoStore, containerAPI});
  const sharedModel = SharedModel.create(initialSharedModel);

  // TODO use patterns added to CLUE so we can refer to a single MST model type for all
  // of the components
  const components: Record<string, Instance<typeof DQRoot> | Instance<typeof ItemList> | Instance<typeof SharedModel>>
    = {diagram, itemList, sharedModel};

  const tiles = {diagram, itemList};

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

  
  // FIXME: syncAfterApplying is not used, perhaps we can get rid of this?
  const sendSharedModelSnapshotToTiles = (containerActionId: string, sourceTileId: string, snapshot: any, syncAfterApplying = true) => {
    for (const tile of Object.entries(tiles)) {
      // FIXME: the list of tiles is right now not using ids just
      // the name of the tile
      if (tile[0] === sourceTileId) continue;

      console.log(`repeating changes to ${tile[0]}`, snapshot);

      tile[1].applySharedModelSnapshotFromContainer(containerActionId, snapshot);
    }
  };

  return {diagram, itemList, sharedModel, undoStore};
};
