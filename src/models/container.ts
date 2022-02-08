// This model keeps the documents in sync

import { types } from "mobx-state-tree";
import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";
import { Tree } from "./tree";
import { ContainerAPI } from "./container-api";
import { UndoStore } from "./undo-manager/undo-store";
import { TreeLike, TreeProxy } from "./tree-proxy";

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
      const applyPromises = Object.entries(trees).map(([treeId, tree]) => {
        if (treeId === sourceTreeId) {
          return; 
        }

        console.log(`repeating changes to ${treeId}`, snapshot);
  
        return tree.applySharedModelSnapshotFromContainer(containerActionId, snapshot);
      });
      // The contract for this method is to return a Promise<void> so we need the extra
      // then() at the end to do this.
      return Promise.all(applyPromises).then();
    }
  };

  const diagram = DQRoot.create(initialDiagram, {undoStore, containerAPI});
  const itemList = ItemList.create(initialItemList, {undoStore, containerAPI});

  const SharedModelTree = types.compose(Tree, SharedModel);
  const sharedModel = SharedModelTree.create(initialSharedModel, {undoStore, containerAPI});
  sharedModel.setupUndoRecorder();

  // wrap the diagram and itemList in proxies to emulate what happens
  // if they were running in iframes
  // TODO: these models should not have direct access to the undoStore and containerAPI
  const diagramProxy = new TreeProxy(diagram);
  const itemListProxy = new TreeProxy(itemList);

  const trees: Record<string, TreeLike> = {diagram: diagramProxy, itemList: itemListProxy, sharedModel};
  // const trees: Record<string, TreeLike> = {diagram, itemList, sharedModel};

  return {diagram, itemList, sharedModel, undoStore};
};
