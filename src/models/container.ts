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
  
  // FIXME: syncAfterApplying is not used, perhaps we can get rid of this?
  const sendSharedModelSnapshotToTiles = (containerActionId: string, sourceTileId: string, snapshot: any) => {
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
