// This model keeps the documents in sync

import { getSnapshot, IJsonPatch, Instance, types } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";
import { ContainerAPI, Tree } from "./tree";
import { UndoStore } from "./undo-manager/undo-store";

export const Container = ({initialDiagram, initialItemList, initialSharedModel}: any) => {
  
  const sendPatchesToTileOrShared = (tileId: string, patchesToApply: readonly IJsonPatch[]) => {
    const component = trees[tileId];
    // If this was an iframe we'd send it as a message
    component.applyPatchesFromUndo(patchesToApply);

    // TODO: We are manually syncing the shared model here with the tiles
    // it'd be better if we could just apply the patch and the system would repeat it to the 
    // tiles. 
    // Maybe if we treat shared models the same as tiles, then this will fall out?
    // Or we could have the shared model override the applyPatchesFromUndo 
    // so ti calls super, and then calls sendSharedModelSnapshotToTiles which would
    // be added to the ContainerAPI
    if (component === sharedModel) {      
      sendSharedModelSnapshotToTiles("fake action id", "", getSnapshot(sharedModel));
    }
  };

  // TODO: improve this, the container can just provide a lookup function to the undo store 
  // then the undo store can call this action directly on the tile. Or if the tile is in 
  // an iframe the container can provide a proxy that forwards the action call over postMessage
  const startApplyingContainerPatches = (tileId: string, value: boolean) => {
    const component = trees[tileId];
    if (!component) {
      console.error("Can't find component for", tileId);
    }

    (component as any).startApplyingContainerPatches();
  };

  // TODO: improve this, it crosses many boundaries
  const finishApplyingContainerPatches = (tileId: string, value: boolean) => {
    const component = trees[tileId];

    (component as any).finishApplyingContainerPatches();
  };

  const undoStore = UndoStore.create({}, {
    sendPatchesToTileOrShared,
    startApplyingContainerPatches,
    finishApplyingContainerPatches
  });

  const containerAPI: ContainerAPI = {
    sendSnapshotToSharedModel: (containerActionId: string, tileId: string, snapshot: any) => {
      // FIXME: the container should have a registry of sharedModels based on id
      // the snapshot that is being sent already includes an id that can be used to look up 
      // the shared model
      sharedModel.applySnapshotFromTile(containerActionId, snapshot);
      sendSharedModelSnapshotToTiles(containerActionId, tileId, snapshot);
    }
  };

  // If we include shared models in this list, ie all trees
  // and the applySharedModelSnapshotFromContainer in the shared model tree just applied
  // to the root if the id matched. It might simplify things.
  // Line 59 would go away. 
  // Line 24 is more confusing. In this case we've just patched the shared model
  //   ideally the undo store would call the applyPatchesFromUndo directly on the tree
  //   so it would call this on the shared model tree
  //   the shared model tree would get updated. And now that update of the tree
  //   needs to be sent to the tiles. 
  //
  // This is called in 2 cases:
  // - a tile has made a change to its view of the shared model and sends a snapshot to the container
  //   with sendSnapshotToShareModel. That function calls this one to update all of the other shared
  //   model views in other tiles.
  // - the undo store is applying patches and just applied patches to a shared model, so this new
  //   change of the shared model needs to be sent to all of the tiles.
  //
  // If we treat shared models and tiles the same, then both cases are equal. The difference is just
  // what is the source of the change: a tile action or the undo manage patches
  //
  // Something that we are going to need to add soon is async support
  // in that case we are going to need the trees to acknowledge that they received and applied
  // this acknowledgement is only needed when patches are being applied
  // the shared model changes. 
  const sendSharedModelSnapshotToTiles = (containerActionId: string, sourceTileId: string, snapshot: any) => {
    for (const tile of Object.entries(tiles)) {
      // FIXME: the list of tiles is right now not using ids just
      // the name of the tile
      if (tile[0] === sourceTileId) continue;

      console.log(`repeating changes to ${tile[0]}`, snapshot);

      tile[1].applySharedModelSnapshotFromContainer(containerActionId, snapshot);
    }
  };

  const diagram = DQRoot.create(initialDiagram, {undoStore, containerAPI});
  const itemList = ItemList.create(initialItemList, {undoStore, containerAPI});

  const SharedModelTree = types.compose(Tree, SharedModel);
  const sharedModel = SharedModelTree.create(initialSharedModel, {undoStore, containerAPI});
  sharedModel.setupUndoRecorder();

  const trees: Record<string, Instance<typeof Tree>> = {diagram, itemList, sharedModel};

  const tiles = {diagram, itemList};


  return {diagram, itemList, sharedModel, undoStore};
};
