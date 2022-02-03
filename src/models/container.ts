// This model keeps the documents in sync

import { Instance, types } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";
import { ContainerAPI, Tree } from "./tree";
import { UndoStore } from "./undo-manager/undo-store";

export const Container = ({initialDiagram, initialItemList, initialSharedModel}: any) => {
  
  const getTreeFromId = (treeId: string) => {
    return trees[treeId];
  };

  const undoStore = UndoStore.create({}, {
    getTreeFromId,
  });

  const containerAPI: ContainerAPI = {
    updateSharedModel: (containerActionId: string, sourceTreeId: string, snapshot: any) => {
      // Right now this is can be called in 2 cases:
      // 1. when a user changes something in a tile which 
      //    then updates the tile's view of the shared model, so the tile wants all copies
      //    of this shared model to be updated.
      // 2. when a user undos or redos an action that affects the shared model tree. In this
      //    case the shared model calls updateSharedModel to send these changes to all of 
      //    the tile views
      // If we support tiles having customized views of shared models then this will
      // need to become more complex.
      for (const tree of Object.entries(trees)) {
        if (tree[0] === sourceTreeId) continue;
  
        console.log(`repeating changes to ${tree[0]}`, snapshot);
  
        tree[1].applySharedModelSnapshotFromContainer(containerActionId, snapshot);
      }
    }
  };

  const diagram = DQRoot.create(initialDiagram, {undoStore, containerAPI});
  const itemList = ItemList.create(initialItemList, {undoStore, containerAPI});

  const SharedModelTree = types.compose(Tree, SharedModel);
  const sharedModel = SharedModelTree.create(initialSharedModel, {undoStore, containerAPI});
  sharedModel.setupUndoRecorder();

  const trees: Record<string, Instance<typeof Tree>> = {diagram, itemList, sharedModel};

  return {diagram, itemList, sharedModel, undoStore};
};
