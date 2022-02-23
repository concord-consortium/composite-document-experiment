// This model keeps the documents in sync

import { applySnapshot, types } from "mobx-state-tree";
import { v4 as uuidv4 } from "uuid";

import { DQRoot } from "./diagram/dq-root";
import { ItemList } from "./item-list/item-list";
import { SharedModel } from "./shared-model/shared-model";
import { Tree } from "./tree";
import { ContainerAPI } from "./container-api";
import { TreePatchRecord, TreePatchRecordSnapshot } from "./history";
import { TreeProxy } from "./tree-proxy";
import { TreeAPI } from "./tree-api";
import { DocumentStore } from "./document-store";

enum DocType {
  SNAPSHOT,
  HISTORY
}

function docType(initialDocument: any): DocType {
  if (initialDocument.history) {
    return DocType.HISTORY;
  }

  return DocType.SNAPSHOT;
}

export const Container = (initialDocument: any) => {

  const getTreeFromId = (treeId: string) => {
    return trees[treeId];
  };

  const documentStore = DocumentStore.create({document: initialDocument, undoStore: {}}, {
    getTreeFromId,
  });

  const undoStore = documentStore.undoStore;

  const containerAPI: ContainerAPI = {
    updateSharedModel: (historyEntryId: string, callId: string, sourceTreeId: string, snapshot: any) => {
      // Right now this is can be called in 2 cases:
      // 1. when a user changes something in a tile which then updates the
      //    tile's view of the shared model, so the tile wants all copies of
      //    this shared model to be updated.
      // 2. when a user undoes or redoes an action that affects the shared model
      //    tree. In this case the shared model calls updateSharedModel to send
      //    these changes to all of the tile views.
      //
      // If we support tiles having customized views of shared models then this
      // will need to become more complex.
      const applyPromises = Object.entries(trees).map(([treeId, tree]) => {
        if (treeId === sourceTreeId) {
          return;
        }

        console.log(`repeating changes to ${treeId}`, snapshot);

        // In case #1 the passed in callId comes from the action that updated
        // the shared model view in the tree. This callId will be closed by the
        // tree after updateSharedModel is called. updateSharedModel will be
        // waited for, so it should not be possible for the historyEntry to be
        // closed before this new callId is setup. So really we don't need the
        // callId to be passed, but it can be useful for debugging. 
        // 
        // FIXME: how is callId handle in case #2?
        const applyCallId = uuidv4();
        documentStore.startHistoryEntryCall(historyEntryId, applyCallId);
        return tree.applySharedModelSnapshotFromContainer(historyEntryId, applyCallId, snapshot);
      });
      // The contract for this method is to return a Promise<void> so we need the extra
      // then() at the end to do this.
      return Promise.all(applyPromises).then();
    },
    addHistoryEntry: (historyEntryId: string, callId: string, treeId: string, actionName: string, undoable: boolean) => {
      // The reason we have this separate recordActionStart is so we can record
      // the top level treeId and name of actions in tiles that are only
      // changing the shared model. An example in the current code is when the
      // name of a node is changed.
      console.log("addHistoryEntry", { historyEntryId, callId, treeId, actionName, undoable });
      documentStore.createOrUpdateHistoryEntry(historyEntryId, callId, actionName, treeId, undoable);
      return Promise.resolve();
    },
    addTreePatchRecord: (historyEntryId: string, callId: string, record: TreePatchRecordSnapshot) => {
      console.log("addTreePatchRecord", { historyEntryId, callId, record} );

      // When the entry already exists the documentStore will add to it.
      // If the entry doesn't exist yet because this was called before
      // recordActionStart then it will be created. 
      documentStore.addPatchesToHistoryEntry(historyEntryId, callId, TreePatchRecord.create(record));
    },
    startHistoryEntryCall: (historyEntryId: string, callId: string) => {
      documentStore.startHistoryEntryCall(historyEntryId, callId);
      return Promise.resolve();
    }
  };

  const diagram = DQRoot.create({id: "diagram", sharedModel: {id: "sharedModel"}},{containerAPI});
  const itemList = ItemList.create({id: "itemList", sharedModel: {id: "sharedModel"}},{containerAPI});

  const SharedModelTree = types.compose(Tree, SharedModel);
  const sharedModel = SharedModelTree.create({id: "sharedModel"}, {containerAPI});

  // wrap the diagram and itemList in proxies to emulate what happens
  // if they were running in iframes
  // TODO: these models should not have direct access to the containerAPI
  const diagramProxy = new TreeProxy(diagram);
  const itemListProxy = new TreeProxy(itemList);

  const trees: Record<string, TreeAPI> = {diagram: diagramProxy, itemList: itemListProxy, sharedModel};
  // const trees: Record<string, TreeLike> = {diagram, itemList, sharedModel};

  Promise.resolve()
  .then(async () => {
    switch (docType(initialDocument)) {
      case DocType.SNAPSHOT: 
        applySnapshot(diagram, initialDocument.diagram);
        applySnapshot(itemList, initialDocument.itemList);
        applySnapshot(sharedModel, initialDocument.sharedModel);
        break;
      case DocType.HISTORY:
        
        await documentStore.replayHistoryToTrees(trees);
        break;
    }  
  })
  .then(() => {
    // TODO: the container should probably not call this directly on the trees
    // instead it should be some action that indicates the initialization is done
    // then the trees can call this themselves.
    sharedModel.setupTreeMonitor();
    diagram.setupTreeMonitor();
    itemList.setupTreeMonitor();
  });

  // TODO: We are returning here before things are ready to be used. This seems to
  // work though, the views are setup with this list of tiles and then they are
  // hydrated with the state. This could cause problems if the user does things
  // while it is still loading. So it would be better to provide a way to block
  // the screen while it is loading. 
  return {diagram, itemList, sharedModel, undoStore, documentStore};
};
